use keyring::Entry;

use crate::error::{AppError, AppResult};

pub const KEYRING_SERVICE: &str = "com.ahmedtrooper.shieldr";
pub const KEY_PIN_HASH: &str = "shieldr_pin_hash";
pub const KEY_MASTER_HASH: &str = "shieldr_master_password_hash";
pub const KEY_RESET_PHRASE: &str = "shieldr_reset_phrase";
pub const KEY_VAULT_KEY: &str = "shieldr_vault_master_key";

#[derive(Clone, Default)]
pub struct KeyringStore {
    service: &'static str,
}

impl KeyringStore {
    pub fn new() -> Self {
        Self {
            service: KEYRING_SERVICE,
        }
    }

    pub fn set_secret(&self, key: &str, value: &str) -> AppResult<()> {
        let entry = Entry::new(self.service, key).map_err(|e| {
            AppError::Keyring(format!("Keyring initialization error for {key}: {e}"))
        })?;

        entry.set_password(value).map_err(|e| {
            AppError::Keyring(format!("Failed to set OS Keyring password for {key}: {e}"))
        })
    }

    pub fn get_secret(&self, key: &str) -> AppResult<Option<String>> {
        let entry = Entry::new(self.service, key).map_err(|e| {
            AppError::Keyring(format!("Keyring initialization error for {key}: {e}"))
        })?;

        match entry.get_password() {
            Ok(pass) => Ok(Some(pass)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Keyring(format!(
                "Failed to read OS Keyring for {key}: {e}"
            ))),
        }
    }

    pub fn delete_secret(&self, key: &str) -> AppResult<()> {
        let entry = Entry::new(self.service, key).map_err(|e| {
            AppError::Keyring(format!("Keyring initialization error for {key}: {e}"))
        })?;

        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Keyring(format!(
                "Failed to delete OS Keyring entry {key}: {e}"
            ))),
        }
    }
}
