use crate::{
    crypto::CryptoService,
    db::SqliteStore,
    error::{AppError, AppResult},
    keyring_store::{KeyringStore, KEY_MASTER_HASH, KEY_PIN_HASH, KEY_RESET_PHRASE},
    stronghold_store::StrongholdStore,
};

#[derive(Clone)]
pub struct Vault {
    keyring: KeyringStore,
    stronghold: StrongholdStore,
    db: SqliteStore,
}

impl Vault {
    pub fn new(keyring: KeyringStore, stronghold: StrongholdStore, db: SqliteStore) -> Self {
        Self {
            keyring,
            stronghold,
            db,
        }
    }

    pub fn db(&self) -> &SqliteStore {
        &self.db
    }

    /// Sets up security credentials: PIN, Master Password, and generated BIP-39 phrase.
    pub fn setup_security(&self, pin: &str, master_password: &str) -> AppResult<String> {
        if pin.trim().is_empty() {
            return Err(AppError::Crypto("PIN cannot be empty".to_string()));
        }
        if master_password.trim().is_empty() {
            return Err(AppError::Crypto(
                "Master password cannot be empty".to_string(),
            ));
        }

        let pin_hash = CryptoService::hash_password(pin.trim())?;
        let master_hash = CryptoService::hash_password(master_password.trim())?;
        let recovery_phrase = CryptoService::generate_recovery_phrase()?;

        // Save secret hashes to OS Keyring
        let _ = self.keyring.set_secret(KEY_PIN_HASH, &pin_hash);
        let _ = self.keyring.set_secret(KEY_MASTER_HASH, &master_hash);
        let _ = self.keyring.set_secret(KEY_RESET_PHRASE, &recovery_phrase);

        // Save to Stronghold encrypted vault snapshot
        self.stronghold.set_secret(KEY_PIN_HASH, &pin_hash)?;
        self.stronghold.set_secret(KEY_MASTER_HASH, &master_hash)?;
        self.stronghold
            .set_secret(KEY_RESET_PHRASE, &recovery_phrase)?;

        // Update SQLite non-secret properties
        let mut props = self.db.get_all_properties()?;
        props.has_pin_configured = true;
        props.has_master_password = true;
        props.has_reset_phrase = true;
        self.db.save_all_properties(&props)?;

        // Audit log in SQLite
        self.db.record_audit_event(
            "SECURITY_CONFIGURED",
            "Initial PIN, Master Password, and 12-word BIP-39 recovery phrase created.",
        )?;

        Ok(recovery_phrase)
    }

    /// Helper to get a secret hash from Keyring with fallback to Stronghold.
    fn get_secret_with_fallback(&self, key: &str) -> AppResult<Option<String>> {
        if let Ok(Some(val)) = self.keyring.get_secret(key) {
            return Ok(Some(val));
        }
        self.stronghold.get_secret(key)
    }

    /// Checks if a PIN has been configured.
    pub fn is_configured(&self) -> AppResult<bool> {
        let props = self.db.get_all_properties()?;
        if props.has_pin_configured {
            return Ok(true);
        }
        // Verify underlying storage
        let pin_hash = self.get_secret_with_fallback(KEY_PIN_HASH)?;
        Ok(pin_hash.is_some())
    }

    /// Verifies candidate PIN or Master Password with constant-time check & rate limiting.
    pub fn verify_credential(&self, candidate: &str) -> AppResult<bool> {
        // 1. Check lockout state
        if let Some(remaining_secs) = self.db.check_lockout()? {
            return Err(AppError::LockedOut {
                remaining_seconds: remaining_secs,
            });
        }

        let pin_hash = self.get_secret_with_fallback(KEY_PIN_HASH)?;
        let master_hash = self.get_secret_with_fallback(KEY_MASTER_HASH)?;

        if pin_hash.is_none() && master_hash.is_none() {
            return Err(AppError::NotConfigured);
        }

        let mut matched = false;

        if let Some(ref ph) = pin_hash {
            if CryptoService::verify_password(candidate, ph) {
                matched = true;
            }
        }

        if !matched {
            if let Some(ref mh) = master_hash {
                if CryptoService::verify_password(candidate, mh) {
                    matched = true;
                }
            }
        }

        if matched {
            self.db.reset_rate_limiter()?;
            self.db
                .record_audit_event("AUTH_SUCCESS", "Authentication successful.")?;
            Ok(true)
        } else {
            let props = self.db.get_all_properties()?;
            let (attempts, is_locked, lock_secs) = self
                .db
                .record_failed_attempt(props.max_failed_attempts, props.lockout_duration_secs)?;

            let details = format!(
                "Failed attempt ({}/{}). Lockout: {}",
                attempts, props.max_failed_attempts, is_locked
            );
            self.db.record_audit_event("AUTH_FAILED", &details)?;

            if let Some(secs) = lock_secs {
                Err(AppError::LockedOut {
                    remaining_seconds: secs,
                })
            } else {
                Ok(false)
            }
        }
    }

    /// Resets PIN using the BIP-39 recovery phrase.
    pub fn reset_pin_with_recovery_phrase(&self, phrase: &str, new_pin: &str) -> AppResult<()> {
        if !CryptoService::validate_recovery_phrase(phrase) {
            return Err(AppError::InvalidRecoveryPhrase);
        }

        let stored_phrase = self
            .get_secret_with_fallback(KEY_RESET_PHRASE)?
            .ok_or(AppError::NotConfigured)?;

        if !CryptoService::compare_phrases(phrase, &stored_phrase) {
            self.db.record_audit_event(
                "PIN_RESET_FAILED",
                "Recovery phrase verification failed (words mismatch).",
            )?;
            return Err(AppError::InvalidRecoveryPhrase);
        }

        let pin_hash = CryptoService::hash_password(new_pin.trim())?;

        let _ = self.keyring.set_secret(KEY_PIN_HASH, &pin_hash);
        self.stronghold.set_secret(KEY_PIN_HASH, &pin_hash)?;

        self.db.reset_rate_limiter()?;
        self.db.record_audit_event(
            "PIN_RESET_SUCCESS",
            "PIN successfully reset using BIP-39 recovery phrase.",
        )?;

        Ok(())
    }

    /// Changes PIN after authenticating current PIN or Master Password.
    pub fn change_pin(&self, current_credential: &str, new_pin: &str) -> AppResult<()> {
        let valid = self.verify_credential(current_credential)?;
        if !valid {
            return Err(AppError::InvalidCredentials);
        }

        let pin_hash = CryptoService::hash_password(new_pin.trim())?;
        let _ = self.keyring.set_secret(KEY_PIN_HASH, &pin_hash);
        self.stronghold.set_secret(KEY_PIN_HASH, &pin_hash)?;

        self.db
            .record_audit_event("PIN_CHANGED", "PIN was updated successfully.")?;
        Ok(())
    }

    /// Changes Master Password after authenticating existing Master Password.
    pub fn change_master_password(&self, current_master: &str, new_master: &str) -> AppResult<()> {
        let master_hash = self
            .get_secret_with_fallback(KEY_MASTER_HASH)?
            .ok_or(AppError::NotConfigured)?;

        if !CryptoService::verify_password(current_master, &master_hash) {
            return Err(AppError::InvalidCredentials);
        }

        let new_hash = CryptoService::hash_password(new_master.trim())?;
        let _ = self.keyring.set_secret(KEY_MASTER_HASH, &new_hash);
        self.stronghold.set_secret(KEY_MASTER_HASH, &new_hash)?;

        self.db.record_audit_event(
            "MASTER_PASSWORD_CHANGED",
            "Master Password was updated successfully.",
        )?;
        Ok(())
    }

    /// Reveals the 12-word recovery phrase ONLY after authenticating Master Password.
    pub fn reveal_recovery_phrase(&self, master_password: &str) -> AppResult<String> {
        let master_hash = self
            .get_secret_with_fallback(KEY_MASTER_HASH)?
            .ok_or(AppError::NotConfigured)?;

        if !CryptoService::verify_password(master_password, &master_hash) {
            self.db.record_audit_event(
                "RECOVERY_REVEAL_DENIED",
                "Unauthorized attempt to reveal recovery phrase.",
            )?;
            return Err(AppError::InvalidCredentials);
        }

        let phrase = self
            .get_secret_with_fallback(KEY_RESET_PHRASE)?
            .ok_or(AppError::NotConfigured)?;

        self.db.record_audit_event(
            "RECOVERY_REVEALED",
            "BIP-39 recovery phrase was viewed after master password authentication.",
        )?;

        Ok(phrase)
    }
}
