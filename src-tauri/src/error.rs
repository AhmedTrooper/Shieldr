use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Keyring error: {0}")]
    Keyring(String),

    #[error("Stronghold error: {0}")]
    Stronghold(String),

    #[error("Cryptography error: {0}")]
    Crypto(String),

    #[error("Invalid credentials provided")]
    InvalidCredentials,

    #[error("Account is locked out. Please wait {remaining_seconds} seconds before trying again.")]
    LockedOut { remaining_seconds: u64 },

    #[error("Security not initialized. Please set up your PIN first.")]
    NotConfigured,

    #[error("Invalid recovery phrase. Words do not match or checksum failed.")]
    InvalidRecoveryPhrase,

    #[error("Window management error: {0}")]
    Window(String),

    #[error("Operation not permitted while shield is locked without password")]
    LockedPermissionDenied,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Serialize)]
pub struct SerializedAppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_seconds: Option<u64>,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let (code, remaining_seconds) = match self {
            AppError::Database(_) => ("DATABASE_ERROR".to_string(), None),
            AppError::Keyring(_) => ("KEYRING_ERROR".to_string(), None),
            AppError::Stronghold(_) => ("STRONGHOLD_ERROR".to_string(), None),
            AppError::Crypto(_) => ("CRYPTO_ERROR".to_string(), None),
            AppError::InvalidCredentials => ("INVALID_CREDENTIALS".to_string(), None),
            AppError::LockedOut { remaining_seconds } => {
                ("LOCKED_OUT".to_string(), Some(*remaining_seconds))
            }
            AppError::NotConfigured => ("NOT_CONFIGURED".to_string(), None),
            AppError::InvalidRecoveryPhrase => ("INVALID_RECOVERY_PHRASE".to_string(), None),
            AppError::Window(_) => ("WINDOW_ERROR".to_string(), None),
            AppError::LockedPermissionDenied => ("LOCKED_PERMISSION_DENIED".to_string(), None),
            AppError::Io(_) => ("IO_ERROR".to_string(), None),
        };

        SerializedAppError {
            code,
            message: self.to_string(),
            remaining_seconds,
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
