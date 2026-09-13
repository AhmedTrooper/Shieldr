use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

use iota_stronghold::{KeyProvider, SnapshotPath, Stronghold};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

const CLIENT_NAME: &[u8] = b"shieldr_secrets_client";

#[derive(Clone)]
pub struct StrongholdStore {
    snapshot_path: PathBuf,
    key_bytes: Vec<u8>,
    stronghold: Arc<Mutex<Stronghold>>,
}

impl StrongholdStore {
    /// B-070: Lock the Stronghold mutex, recovering from poisoning so a
    /// single panicked accessor cannot permanently brick the vault.
    fn lock_inner(&self) -> MutexGuard<'_, Stronghold> {
        match self.stronghold.lock() {
            Ok(g) => g,
            Err(p) => {
                eprintln!("WARN: Stronghold mutex was poisoned, recovering.");
                p.into_inner()
            }
        }
    }

    pub fn new<P: AsRef<Path>>(snapshot_path: P, raw_key: Vec<u8>) -> AppResult<Self> {
        let path = snapshot_path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Stronghold strictly requires NCKey of 32 bytes
        let key_bytes: Vec<u8> = if raw_key.len() == 32 {
            raw_key
        } else {
            Sha256::digest(&raw_key).to_vec()
        };

        let snap_path = SnapshotPath::from_path(&path);
        let stronghold = Stronghold::default();
        let key_provider = KeyProvider::try_from(Zeroizing::new(key_bytes.clone()))
            .map_err(|e| AppError::Stronghold(format!("Failed to create KeyProvider: {e}")))?;

        if snap_path.exists() {
            if let Err(e) = stronghold.load_snapshot(&key_provider, &snap_path) {
                eprintln!(
                    "Warning: could not load existing Stronghold snapshot at {}: {e}",
                    path.display()
                );
                eprintln!(
                    "         This is usually caused by a corrupted or rotated salt \
                     file. Stronghold starts empty and the user will need to \
                     re-onboard (set a new PIN and master password)."
                );
            }
        }

        // Ensure client exists
        if stronghold.load_client(CLIENT_NAME).is_err() {
            let _ = stronghold.create_client(CLIENT_NAME);
        }

        Ok(Self {
            snapshot_path: path,
            key_bytes,
            stronghold: Arc::new(Mutex::new(stronghold)),
        })
    }

    pub fn set_secret(&self, key: &str, value: &str) -> AppResult<()> {
        let stronghold = self.lock_inner();

        let client = match stronghold.load_client(CLIENT_NAME) {
            Ok(c) => c,
            Err(_) => stronghold
                .create_client(CLIENT_NAME)
                .map_err(|e| AppError::Stronghold(format!("Failed to create client: {e}")))?,
        };

        client
            .store()
            .insert(key.as_bytes().to_vec(), value.as_bytes().to_vec(), None)
            .map_err(|e| {
                AppError::Stronghold(format!("Failed to insert into stronghold store: {e}"))
            })?;

        let snap_path = SnapshotPath::from_path(&self.snapshot_path);
        let key_provider = KeyProvider::try_from(Zeroizing::new(self.key_bytes.clone()))
            .map_err(|e| AppError::Stronghold(format!("Failed to create KeyProvider: {e}")))?;

        stronghold
            .commit_with_keyprovider(&snap_path, &key_provider)
            .map_err(|e| {
                AppError::Stronghold(format!("Failed to commit stronghold snapshot: {e}"))
            })?;

        Ok(())
    }

    pub fn get_secret(&self, key: &str) -> AppResult<Option<String>> {
        let stronghold = self.lock_inner();

        let client = match stronghold.load_client(CLIENT_NAME) {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };

        let result = client
            .store()
            .get(key.as_bytes())
            .map_err(|e| AppError::Stronghold(format!("Failed to read stronghold store: {e}")))?;

        match result {
            Some(bytes) => {
                let string_val = String::from_utf8(bytes).map_err(|e| {
                    AppError::Stronghold(format!("Invalid UTF-8 in stronghold secret: {e}"))
                })?;
                Ok(Some(string_val))
            }
            None => Ok(None),
        }
    }

    pub fn delete_secret(&self, key: &str) -> AppResult<()> {
        let stronghold = self.lock_inner();

        if let Ok(client) = stronghold.load_client(CLIENT_NAME) {
            let _ = client.store().delete(key.as_bytes());

            let snap_path = SnapshotPath::from_path(&self.snapshot_path);
            let key_provider = KeyProvider::try_from(Zeroizing::new(self.key_bytes.clone()))
                .map_err(|e| AppError::Stronghold(format!("KeyProvider error: {e}")))?;

            let _ = stronghold.commit_with_keyprovider(&snap_path, &key_provider);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stronghold_init() {
        let test_path = std::env::temp_dir().join("shieldr_test_sh.vault");
        let _ = std::fs::remove_file(&test_path);
        let store = StrongholdStore::new(&test_path, vec![1u8; 32]);
        assert!(store.is_ok());
        let _ = std::fs::remove_file(&test_path);
    }
}
