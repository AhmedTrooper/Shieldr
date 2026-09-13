use crate::{
    crypto::CryptoService,
    db::SqliteStore,
    error::{AppError, AppResult},
    keyring_store::{KeyringStore, KEY_MASTER_HASH, KEY_PIN_HASH, KEY_RESET_PHRASE},
    stronghold_store::StrongholdStore,
};

/// B-057: Constant-time dummy Argon2id hash used to equalize the cost of
/// `verify_credential` regardless of which credential slots are populated.
/// The hash is generated once on first use and cached. It will never match
/// any real credential because its plaintext is a fixed unguessable string.
use std::sync::OnceLock;
fn dummy_hash() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| {
        // Hashing takes ~250ms; only paid once per process lifetime.
        CryptoService::hash_password("__shieldr_dummy_credential__")
            .expect("Argon2 dummy hash generation must succeed")
    })
}

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

        // B-064: Audit is best-effort — a SQLite hiccup must not make the
        // user think their security setup failed.
        self.db.audit_log_best_effort(
            "SECURITY_CONFIGURED",
            "Initial PIN, Master Password, and 12-word BIP-39 recovery phrase created.",
        );

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
    ///
    /// B-057: To avoid a timing oracle that distinguishes users who set only a
    /// PIN from users who set both PIN and master password, we always run both
    /// Argon2 verifications. If a slot is empty, we run the verify against a
    /// fixed dummy hash that will always fail in the same amount of work.
    ///
    /// B-063: The PIN and master are stored with `.trim()` applied at setup
    /// time, so the candidate must be trimmed here too. Without this, a user
    /// who accidentally types `" 1234 "` cannot unlock even though the stored
    /// hash is for `"1234"`.
    pub fn verify_credential(&self, candidate: &str) -> AppResult<bool> {
        let candidate = candidate.trim();

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

        // B-057: Always do two Argon2 verifications so a user with PIN-only
        // and a user with PIN+master take the same amount of CPU time per
        // attempt. A precomputed dummy hash is used when the slot is empty.
        let dummy = dummy_hash();
        let pin_verified =
            CryptoService::verify_password(candidate, pin_hash.as_deref().unwrap_or(dummy));
        let master_verified =
            CryptoService::verify_password(candidate, master_hash.as_deref().unwrap_or(dummy));

        let matched = pin_verified || master_verified;

        if matched {
            self.db.reset_rate_limiter()?;
            self.db
                .audit_log_best_effort("AUTH_SUCCESS", "Authentication successful.");
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
            self.db.audit_log_best_effort("AUTH_FAILED", &details);

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
            self.db.audit_log_best_effort(
                "PIN_RESET_FAILED",
                "Recovery phrase verification failed (words mismatch).",
            );
            return Err(AppError::InvalidRecoveryPhrase);
        }

        let pin_hash = CryptoService::hash_password(new_pin.trim())?;

        let _ = self.keyring.set_secret(KEY_PIN_HASH, &pin_hash);
        self.stronghold.set_secret(KEY_PIN_HASH, &pin_hash)?;

        self.db.reset_rate_limiter()?;
        self.db.audit_log_best_effort(
            "PIN_RESET_SUCCESS",
            "PIN successfully reset using BIP-39 recovery phrase.",
        );

        Ok(())
    }

    /// Changes PIN after authenticating with the **Master Password only**.
    ///
    /// B-033: Previously this accepted either the current PIN or the master
    /// password (`verify_credential`), which made the intent ambiguous and
    /// meant a user who set a strong master could quietly rotate the PIN by
    /// already knowing it. We now require the master password explicitly,
    /// removing ambiguity and forcing PIN rotation to be a privileged action.
    pub fn change_pin(&self, master_password: &str, new_pin: &str) -> AppResult<()> {
        if master_password.trim().is_empty() {
            return Err(AppError::InvalidCredentials);
        }

        let master_hash = self
            .get_secret_with_fallback(KEY_MASTER_HASH)?
            .ok_or(AppError::NotConfigured)?;

        if !CryptoService::verify_password(master_password, &master_hash) {
            // B-006/B-033: Rate-limit by reusing the same table as normal unlock
            // attempts so brute-forcing the master through change_pin is no
            // easier than brute-forcing the lock screen itself.
            let props = self.db.get_all_properties()?;
            let (_attempts, _is_locked, lock_secs) = self
                .db
                .record_failed_attempt(props.max_failed_attempts, props.lockout_duration_secs)?;
            if let Some(secs) = lock_secs {
                return Err(AppError::LockedOut {
                    remaining_seconds: secs,
                });
            }
            return Err(AppError::InvalidCredentials);
        }

        let new_pin = new_pin.trim();
        if new_pin.is_empty() {
            return Err(AppError::Crypto("New PIN cannot be empty".to_string()));
        }

        let pin_hash = CryptoService::hash_password(new_pin)?;
        let _ = self.keyring.set_secret(KEY_PIN_HASH, &pin_hash);
        self.stronghold.set_secret(KEY_PIN_HASH, &pin_hash)?;

        self.db
            .audit_log_best_effort("PIN_CHANGED", "PIN was updated successfully.");
        Ok(())
    }

    /// Changes Master Password after authenticating existing Master Password.
    pub fn change_master_password(&self, current_master: &str, new_master: &str) -> AppResult<()> {
        // B-063: Master password is hashed with .trim() at setup, so the
        // candidate must be trimmed here too.
        let current_master = current_master.trim();
        let new_master = new_master.trim();

        let master_hash = self
            .get_secret_with_fallback(KEY_MASTER_HASH)?
            .ok_or(AppError::NotConfigured)?;

        if !CryptoService::verify_password(current_master, &master_hash) {
            return Err(AppError::InvalidCredentials);
        }

        let new_hash = CryptoService::hash_password(new_master)?;
        let _ = self.keyring.set_secret(KEY_MASTER_HASH, &new_hash);
        self.stronghold.set_secret(KEY_MASTER_HASH, &new_hash)?;

        self.db.audit_log_best_effort(
            "MASTER_PASSWORD_CHANGED",
            "Master Password was updated successfully.",
        );
        Ok(())
    }

    /// Reveals the 12-word recovery phrase ONLY after authenticating Master Password.
    pub fn reveal_recovery_phrase(&self, master_password: &str) -> AppResult<String> {
        // B-063: Trim the candidate for consistency with the other auth paths.
        let master_password = master_password.trim();

        let master_hash = self
            .get_secret_with_fallback(KEY_MASTER_HASH)?
            .ok_or(AppError::NotConfigured)?;

        if !CryptoService::verify_password(master_password, &master_hash) {
            self.db.audit_log_best_effort(
                "RECOVERY_REVEAL_DENIED",
                "Unauthorized attempt to reveal recovery phrase.",
            );
            return Err(AppError::InvalidCredentials);
        }

        let phrase = self
            .get_secret_with_fallback(KEY_RESET_PHRASE)?
            .ok_or(AppError::NotConfigured)?;

        self.db.audit_log_best_effort(
            "RECOVERY_REVEALED",
            "BIP-39 recovery phrase was viewed after master password authentication.",
        );

        Ok(phrase)
    }
}
