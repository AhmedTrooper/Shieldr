pub mod commands;
pub mod crypto;
pub mod db;
pub mod error;
pub mod keyring_store;
pub mod stronghold_store;
#[cfg(desktop)]
pub mod tray;
pub mod vault;

#[cfg(desktop)]
mod shortcut_interceptor;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use rand::RngExt;
use sha2::{Digest, Sha256};
use tauri::{Manager, WindowEvent};

use crate::{
    commands::*, db::SqliteStore, keyring_store::KeyringStore, stronghold_store::StrongholdStore,
    vault::Vault,
};

pub struct AppState {
    pub vault: Vault,
    pub is_locked: AtomicBool,
    pub keep_awake_guard: Mutex<Option<keepawake::KeepAwake>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Defensive hardening for Linux dev/runtime stability:
    //
    // WebKitGTK + Wayland + NVIDIA (and some compositors) is known to crash
    // the WebView with messages like:
    //   "Gdk-Message: Error flushing display: Resource temporarily unavailable"
    //   "Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display"
    //
    // Workarounds (no-op on unaffected systems):
    //   - WEBKIT_DISABLE_COMPOSITING_MODE=1  (force CPU compositing, avoids GPU reset)
    //   - GDK_BACKEND=x11                    (fall back to X11 if Wayland misbehaves)
    //
    // We only set these if they are not already set by the user's environment,
    // so a deliberate override still wins.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        if std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // B-084: Persist window size + position across launches, but
        // explicitly skip FULLSCREEN and MAXIMIZED so the lock screen
        // (which goes fullscreen) doesn't poison the saved state with
        // `fullscreen: true`. On unlock we always center + size anyway,
        // and the explicit `save_window_state(...)` call in
        // `unlock_shield` overwrites whatever the auto-save wrote during
        // the locked fullscreen phase.
        // We denylist the splashscreen and omit VISIBLE so the splashscreen
        // isn't tracked and main remains hidden until frontend signals readiness.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["splashscreen"])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            std::fs::create_dir_all(&app_data_dir)?;

            // 1. Setup Stronghold salt and plugin
            //
            // B-062: Validate the salt file at startup — if it's missing,
            // wrong size, or corrupt, regenerate it (and emit a warning so
            // the operator can investigate). A zero-length or truncated salt
            // would otherwise silently produce a weak Argon2 input.
            let salt_path = app_data_dir.join("stronghold_salt.txt");
            let salt_needs_regen = match std::fs::read(&salt_path) {
                Ok(bytes) if bytes.len() == 32 => false,
                Ok(bad) => {
                    eprintln!(
                        "Stronghold salt file is invalid ({} bytes); regenerating.",
                        bad.len()
                    );
                    true
                }
                Err(_) => true, // missing
            };
            if salt_needs_regen {
                let mut salt_bytes = [0u8; 32];
                rand::rng().fill(&mut salt_bytes);
                std::fs::write(&salt_path, salt_bytes)?;
            }

            // B-021: Harden salt file and app data directory permissions against
            // other local OS accounts on multi-user Unix workstations.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ =
                    std::fs::set_permissions(&app_data_dir, std::fs::Permissions::from_mode(0o700));
                let _ =
                    std::fs::set_permissions(&salt_path, std::fs::Permissions::from_mode(0o600));
            }

            // Register stronghold plugin
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            // 2. Setup SQLite Metadata & Properties Store
            let db_path = app_data_dir.join("shieldr_metadata.db");
            let db = SqliteStore::new(&db_path)?;

            // 3. Setup OS Keyring Store
            let keyring = KeyringStore::new();

            // 4. Setup Stronghold Secret Store
            let snap_path = app_data_dir.join("shieldr.vault");
            // B-062: Re-read the validated salt (always 32 bytes) rather than
            // fall back to a hard-coded all-42 vector which previously masked
            // a corrupted salt file. If the read now fails, the Stronghold
            // store construction will return the I/O error to the caller.
            let raw_salt = std::fs::read(&salt_path).map_err(|e| {
                Box::new(std::io::Error::new(
                    e.kind(),
                    format!("Failed to read Stronghold salt: {e}"),
                )) as Box<dyn std::error::Error>
            })?;
            let stronghold_key = Sha256::digest(&raw_salt).to_vec();
            let stronghold = StrongholdStore::new(snap_path, stronghold_key)?;

            // 5. Initialize unified Vault
            let vault = Vault::new(keyring, stronghold, db);

            // Record startup in SQLite audit log
            vault
                .db()
                .audit_log_best_effort("SYSTEM_START", "Shieldr service initialized.");

            let app_state = AppState {
                vault,
                is_locked: AtomicBool::new(false),
                keep_awake_guard: Mutex::new(None),
            };

            app.manage(app_state);

            // Intercept window close requests to prevent toddlers/accidental closes when locked.
            // Also force-resize back to fullscreen if the user (or another app) tries to
            // un-fullscreen via dragging/resizing while locked (B-082).
            if let Some(window) = app.get_webview_window("main") {
                let win_clone = window.clone();
                window.on_window_event(move |event| {
                    if let Some(state) = win_clone.try_state::<AppState>() {
                        let locked = state.is_locked.load(Ordering::SeqCst);
                        if locked {
                            match event {
                                WindowEvent::CloseRequested { api, .. } => {
                                    api.prevent_close();
                                    eprintln!(
                                        "Close attempt blocked: Shield is locked in fullscreen."
                                    );
                                    state.vault.db().audit_log_best_effort(
                                        "ESCAPE_BLOCKED",
                                        "Close attempt blocked while locked.",
                                    );
                                }
                                WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                                    // Snap back to fullscreen.
                                    if let Err(e) = win_clone.set_fullscreen(true) {
                                        eprintln!("Failed to restore fullscreen: {e}");
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                });
            }

            #[cfg(desktop)]
            {
                tray::setup_tray(app)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_shield_status,
            setup_security,
            lock_shield,
            unlock_shield,
            reset_pin_with_phrase,
            change_pin,
            change_master_password,
            reveal_recovery_phrase,
            save_properties,
            get_audit_logs,
            request_close_window,
            request_hide_window,
            request_hide_window_unlocked,
            minimize_window,
            close_splashscreen,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
