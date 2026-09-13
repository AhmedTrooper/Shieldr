use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, LogicalSize, Manager, Size, State};

use crate::{
    db::{AuditLogEntry, ShieldProperties},
    error::AppError,
    AppState,
};

#[derive(Serialize)]
pub struct ShieldStatus {
    pub is_locked: bool,
    pub is_configured: bool,
    pub is_locked_out: bool,
    pub lockout_remaining_secs: Option<u64>,
    pub properties: ShieldProperties,
}

#[tauri::command]
pub async fn get_shield_status(state: State<'_, AppState>) -> Result<ShieldStatus, AppError> {
    let is_locked = state.is_locked.load(Ordering::SeqCst);
    let is_configured = state.vault.is_configured()?;
    let lockout_secs = state.vault.db().check_lockout()?;
    let is_locked_out = lockout_secs.is_some();
    let properties = state.vault.db().get_all_properties()?;

    Ok(ShieldStatus {
        is_locked,
        is_configured,
        is_locked_out,
        lockout_remaining_secs: lockout_secs,
        properties,
    })
}

#[tauri::command]
pub async fn setup_security(
    state: State<'_, AppState>,
    pin: String,
    master_password: String,
) -> Result<String, AppError> {
    state.vault.setup_security(&pin, &master_password)
}

#[tauri::command]
pub async fn lock_shield(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ShieldStatus, AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Window("Main window not found".to_string()))?;

    // Enable fullscreen, always-on-top, and grab focus
    window
        .set_fullscreen(true)
        .map_err(|e| AppError::Window(e.to_string()))?;
    window
        .set_always_on_top(true)
        .map_err(|e| AppError::Window(e.to_string()))?;
    window
        .set_focus()
        .map_err(|e| AppError::Window(e.to_string()))?;

    state.is_locked.store(true, Ordering::SeqCst);

    // Keep OS and display awake while locked if enabled
    let props = state.vault.db().get_all_properties().unwrap_or_default();
    if props.keep_awake {
        match keepawake::Builder::default()
            .display(true)
            .idle(true)
            .sleep(true)
            .reason("Shieldr screen lock active")
            .app_name("Shieldr")
            .app_reverse_domain("com.shieldr.app")
            .create()
        {
            Ok(handle) => {
                if let Ok(mut guard) = state.keep_awake_guard.lock() {
                    *guard = Some(handle);
                }
                eprintln!("KeepAwake lock acquired: display and system sleep inhibited.");
            }
            Err(e) => {
                eprintln!("Warning: Failed to acquire KeepAwake lock: {e}");
            }
        }
    }

    state.vault.db().record_audit_event(
        "SHIELD_LOCKED",
        "Shield locked in transparent fullscreen mode (KeepAwake active).",
    )?;

    get_shield_status(state).await
}

#[tauri::command]
pub async fn unlock_shield(
    app: AppHandle,
    state: State<'_, AppState>,
    credential: String,
) -> Result<ShieldStatus, AppError> {
    let valid = state.vault.verify_credential(&credential)?;

    if !valid {
        return Err(AppError::InvalidCredentials);
    }

    // Release OS keepawake inhibitor lock
    if let Ok(mut guard) = state.keep_awake_guard.lock() {
        if guard.is_some() {
            *guard = None; // Drops keepawake::KeepAwake, releasing OS sleep inhibitor
            eprintln!("KeepAwake lock released.");
        }
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Window("Main window not found".to_string()))?;

    window
        .set_fullscreen(false)
        .map_err(|e| AppError::Window(e.to_string()))?;
    window
        .set_always_on_top(false)
        .map_err(|e| AppError::Window(e.to_string()))?;

    let _ = window.set_size(Size::Logical(LogicalSize {
        width: 900.0,
        height: 640.0,
    }));
    let _ = window.center();
    let _ = window.set_focus();

    state.is_locked.store(false, Ordering::SeqCst);
    state
        .vault
        .db()
        .record_audit_event("SHIELD_UNLOCKED", "Shield unlocked successfully.")?;

    get_shield_status(state).await
}

#[tauri::command]
pub async fn reset_pin_with_phrase(
    state: State<'_, AppState>,
    recovery_phrase: String,
    new_pin: String,
) -> Result<(), AppError> {
    state
        .vault
        .reset_pin_with_recovery_phrase(&recovery_phrase, &new_pin)
}

#[tauri::command]
pub async fn change_pin(
    state: State<'_, AppState>,
    current_credential: String,
    new_pin: String,
) -> Result<(), AppError> {
    state.vault.change_pin(&current_credential, &new_pin)
}

#[tauri::command]
pub async fn change_master_password(
    state: State<'_, AppState>,
    current_master: String,
    new_master: String,
) -> Result<(), AppError> {
    state
        .vault
        .change_master_password(&current_master, &new_master)
}

#[tauri::command]
pub async fn reveal_recovery_phrase(
    state: State<'_, AppState>,
    master_password: String,
) -> Result<String, AppError> {
    state.vault.reveal_recovery_phrase(&master_password)
}

#[tauri::command]
pub async fn save_properties(
    state: State<'_, AppState>,
    properties: ShieldProperties,
) -> Result<(), AppError> {
    state.vault.db().save_all_properties(&properties)
}

#[tauri::command]
pub async fn get_audit_logs(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<AuditLogEntry>, AppError> {
    state.vault.db().get_audit_logs(limit.unwrap_or(50))
}

#[tauri::command]
pub async fn request_close_window(
    app: AppHandle,
    state: State<'_, AppState>,
    credential: Option<String>,
) -> Result<(), AppError> {
    if state.is_locked.load(Ordering::SeqCst) {
        let cred = credential.ok_or(AppError::LockedPermissionDenied)?;
        let valid = state.vault.verify_credential(&cred)?;
        if !valid {
            return Err(AppError::InvalidCredentials);
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        if let Ok(mut guard) = state.keep_awake_guard.lock() {
            *guard = None;
        }
        window
            .close()
            .map_err(|e| AppError::Window(e.to_string()))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn request_hide_window(
    app: AppHandle,
    state: State<'_, AppState>,
    credential: Option<String>,
) -> Result<(), AppError> {
    if state.is_locked.load(Ordering::SeqCst) {
        let cred = credential.ok_or(AppError::LockedPermissionDenied)?;
        let valid = state.vault.verify_credential(&cred)?;
        if !valid {
            return Err(AppError::InvalidCredentials);
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| AppError::Window(e.to_string()))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn minimize_window(app: AppHandle) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .minimize()
            .map_err(|e| AppError::Window(e.to_string()))?;
    }
    Ok(())
}
