use argon2::{
    password_hash::{phc::PasswordHash, PasswordHasher, PasswordVerifier},
    Argon2,
};
use bip39::Mnemonic;
use rand::RngExt;

use crate::error::{AppError, AppResult};

pub struct CryptoService;

impl CryptoService {
    /// Hashes a password or PIN with Argon2id using cryptographically secure random salt.
    pub fn hash_password(secret: &str) -> AppResult<String> {
        let argon2 = Argon2::default();

        argon2
            .hash_password(secret.as_bytes())
            .map(|hash| hash.to_string())
            .map_err(|e| AppError::Crypto(format!("Failed to hash password with Argon2: {e}")))
    }

    /// Verifies a candidate password or PIN against an Argon2id PHC string in constant time.
    pub fn verify_password(candidate: &str, stored_hash: &str) -> bool {
        let Ok(parsed_hash) = PasswordHash::new(stored_hash) else {
            return false;
        };

        Argon2::default()
            .verify_password(candidate.as_bytes(), &parsed_hash)
            .is_ok()
    }

    /// Generates a BIP-39 standard 12-word mnemonic recovery phrase.
    pub fn generate_recovery_phrase() -> AppResult<String> {
        let mut entropy = [0u8; 16]; // 128 bits entropy = 12 words
        rand::rng().fill(&mut entropy);

        let mnemonic = Mnemonic::from_entropy(&entropy)
            .map_err(|e| AppError::Crypto(format!("Failed to generate BIP-39 mnemonic: {e}")))?;

        Ok(mnemonic.to_string())
    }

    /// Validates a BIP-39 mnemonic phrase (word correctness and checksum).
    pub fn validate_recovery_phrase(phrase: &str) -> bool {
        Mnemonic::parse_normalized(phrase).is_ok()
    }

    /// Compares two recovery phrases safely by normalizing whitespace and casing.
    pub fn compare_phrases(candidate: &str, stored: &str) -> bool {
        let norm_cand: Vec<&str> = candidate.split_whitespace().collect();
        let norm_stored: Vec<&str> = stored.split_whitespace().collect();

        if norm_cand.len() != norm_stored.len() {
            return false;
        }

        norm_cand
            .iter()
            .zip(norm_stored.iter())
            .all(|(a, b)| a.eq_ignore_ascii_case(b))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_password_hashing_and_verification() {
        let pin = "1234";
        let hash = CryptoService::hash_password(pin).expect("Hashing should succeed");
        assert!(CryptoService::verify_password("1234", &hash));
        assert!(!CryptoService::verify_password("9999", &hash));
        assert!(!CryptoService::verify_password("", &hash));
    }

    #[test]
    fn test_bip39_recovery_phrase() {
        let phrase =
            CryptoService::generate_recovery_phrase().expect("Mnemonic generation should succeed");
        let words: Vec<&str> = phrase.split_whitespace().collect();
        assert_eq!(words.len(), 12, "Should generate exactly 12 words");
        assert!(CryptoService::validate_recovery_phrase(&phrase));
        assert!(!CryptoService::validate_recovery_phrase(
            "invalid random gibberish words that are not mnemonic"
        ));

        // Compare phrases case-insensitively
        let upper = phrase.to_uppercase();
        assert!(CryptoService::compare_phrases(&upper, &phrase));
    }
}
