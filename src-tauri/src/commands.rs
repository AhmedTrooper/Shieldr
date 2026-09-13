use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, LogicalSize, Manager, Size, State};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
use zeroize::Zeroizing;

#[cfg(desktop)]
use crate::shortcut_interceptor;

use crate::{
    db::{PaginatedAuditLogs, ShieldProperties},
    error::AppError,
    AppState,
};

pub const DEFAULT_WINDOW_WIDTH: f64 = 900.0;
pub const DEFAULT_WINDOW_HEIGHT: f64 = 640.0;

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

    // B-037: Record audit FIRST so we have a record even if subsequent ops fail.
    // Audit failures are logged but do not block the lock (see B-064).
    if let Err(e) = state.vault.db().record_audit_event(
        "SHIELD_LOCKED",
        "Shield locked in transparent fullscreen mode.",
    ) {
        eprintln!("Audit log failure for SHIELD_LOCKED: {e}");
    }

    // Enable fullscreen, always-on-top, and grab focus.
    // If any of these fail, we still proceed to set is_locked so the
    // logical state matches the user's intent, then log the failure.
    let mut window_warnings: Vec<String> = Vec::new();
    if let Err(e) = window.set_fullscreen(true) {
        window_warnings.push(format!("set_fullscreen: {e}"));
    }
    if let Err(e) = window.set_always_on_top(true) {
        window_warnings.push(format!("set_always_on_top: {e}"));
    }
    if let Err(e) = window.set_focus() {
        window_warnings.push(format!("set_focus: {e}"));
    }

    state.is_locked.store(true, Ordering::SeqCst);

    // B-081: Register OS-level global shortcuts that intercept Alt+F4, Super+Q/W/M/H,
    // Ctrl+W while locked. These would otherwise close/minimize/hide the window.
    #[cfg(desktop)]
    {
        if let Err(e) = shortcut_interceptor::register_lock_shortcuts(&app) {
            eprintln!("Warning: failed to register lock shortcuts: {e}");
            window_warnings.push(format!("shortcuts: {e}"));
        }
    }

    // Keep OS and display awake while locked if enabled.
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
                window_warnings.push(format!("keepawake: {e}"));
            }
        }
    }

    if !window_warnings.is_empty() {
        let details = format!("Partial lock (warnings): {}", window_warnings.join("; "));
        if let Err(e) = state
            .vault
            .db()
            .record_audit_event("SHIELD_LOCK_WARNINGS", &details)
        {
            eprintln!("Audit failure for SHIELD_LOCK_WARNINGS: {e}");
        }
    }

    get_shield_status(state).await
}

#[tauri::command]
pub async fn unlock_shield(
    app: AppHandle,
    state: State<'_, AppState>,
    credential: String,
) -> Result<ShieldStatus, AppError> {
    let credential = Zeroizing::new(credential);
    state.vault.verify_credential(&credential)?;

    // B-036: Flip is_locked to false FIRST so the UI reflects the user's intent,
    // then attempt the window operations. If they fail, we still consider the
    // shield unlocked logically and record a warning in the audit log.
    state.is_locked.store(false, Ordering::SeqCst);

    // B-081: Unregister the lock-mode global shortcuts so the user regains
    // normal OS-level hotkey behavior (Alt+F4 closes the window, etc.).
    #[cfg(desktop)]
    {
        shortcut_interceptor::unregister_lock_shortcuts(&app);
    }

    // Release OS keepawake inhibitor lock.
    if let Ok(mut guard) = state.keep_awake_guard.lock() {
        if guard.is_some() {
            *guard = None; // Drops keepawake::KeepAwake, releasing OS sleep inhibitor
            eprintln!("KeepAwake lock released.");
        }
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Window("Main window not found".to_string()))?;

    let mut window_warnings: Vec<String> = Vec::new();
    if let Err(e) = window.set_fullscreen(false) {
        window_warnings.push(format!("set_fullscreen: {e}"));
    }
    if let Err(e) = window.set_always_on_top(false) {
        window_warnings.push(format!("set_always_on_top: {e}"));
    }
    // B-084 & B-030: Apply size + center AFTER exiting fullscreen so the OS
    // doesn't snap us back to the pre-fullscreen position that the
    // window-state plugin last saw. Uses DEFAULT_WINDOW_WIDTH and DEFAULT_WINDOW_HEIGHT.
    if let Err(e) = window.set_size(Size::Logical(LogicalSize {
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
    })) {
        window_warnings.push(format!("set_size: {e}"));
    }
    if let Err(e) = window.center() {
        window_warnings.push(format!("center: {e}"));
    }
    if let Err(e) = window.set_focus() {
        window_warnings.push(format!("set_focus: {e}"));
    }

    // B-084: Explicitly persist the centered state so subsequent launches
    // (and any pending auto-save that was queued while we were fullscreen)
    // overwrite any "top-right" position with our freshly-centered one.
    // We save SIZE + POSITION only — we already excluded FULLSCREEN and
    // MAXIMIZED from the plugin builder's auto-tracked flags in lib.rs.
    if let Err(e) = app.save_window_state(StateFlags::SIZE | StateFlags::POSITION) {
        window_warnings.push(format!("save_window_state: {e}"));
    }

    // B-064: Audit is best-effort; don't propagate failures.
    if let Err(e) = state
        .vault
        .db()
        .record_audit_event("SHIELD_UNLOCKED", "Shield unlocked successfully.")
    {
        eprintln!("Audit log failure for SHIELD_UNLOCKED: {e}");
    }

    if !window_warnings.is_empty() {
        let details = format!("Partial unlock (warnings): {}", window_warnings.join("; "));
        if let Err(e) = state
            .vault
            .db()
            .record_audit_event("SHIELD_UNLOCK_WARNINGS", &details)
        {
            eprintln!("Audit failure for SHIELD_UNLOCK_WARNINGS: {e}");
        }
    }

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
    current_master: String,
    new_pin: String,
) -> Result<(), AppError> {
    let current_master = Zeroizing::new(current_master);
    let new_pin = Zeroizing::new(new_pin);
    state.vault.change_pin(&current_master, &new_pin)
}

#[tauri::command]
pub async fn change_master_password(
    state: State<'_, AppState>,
    current_master: String,
    new_master: String,
) -> Result<(), AppError> {
    let current_master = Zeroizing::new(current_master);
    let new_master = Zeroizing::new(new_master);
    state
        .vault
        .change_master_password(&current_master, &new_master)
}

#[tauri::command]
pub async fn reveal_recovery_phrase(
    state: State<'_, AppState>,
    master_password: String,
) -> Result<String, AppError> {
    let master_password = Zeroizing::new(master_password);
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
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<PaginatedAuditLogs, AppError> {
    let page = page.unwrap_or(1);
    let page_size = page_size.unwrap_or(10);
    state.vault.db().get_audit_logs_paginated(page, page_size)
}

#[tauri::command]
pub async fn request_close_window(
    app: AppHandle,
    state: State<'_, AppState>,
    credential: Option<String>,
) -> Result<(), AppError> {
    // B-035: Always require a valid credential regardless of lock state.
    // The unlock modal's "Quit" button supplies one; any other path that
    // omits it (e.g. a desynced state) must be refused.
    let credential = Zeroizing::new(credential.ok_or(AppError::LockedPermissionDenied)?);
    state.vault.verify_credential(&credential)?;

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
    // B-035: Same hardening as request_close_window.
    let credential = Zeroizing::new(credential.ok_or(AppError::LockedPermissionDenied)?);
    state.vault.verify_credential(&credential)?;

    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| AppError::Window(e.to_string()))?;
    }

    Ok(())
}

/// Unlocked-only variant: hides the window to tray without requiring a credential.
/// Refuses to operate while the shield is locked so a frontend bug cannot call it
/// to bypass the lock screen (B-035 defense in depth).
#[tauri::command]
pub async fn request_hide_window_unlocked(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if state.is_locked.load(Ordering::SeqCst) {
        return Err(AppError::LockedPermissionDenied);
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
