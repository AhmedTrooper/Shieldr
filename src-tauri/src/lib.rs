pub mod commands;
pub mod crypto;
pub mod db;
pub mod error;
pub mod keyring_store;
pub mod stronghold_store;
#[cfg(desktop)]
pub mod tray;
pub mod vault;

use std::sync::atomic::{AtomicBool, Ordering};

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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
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
            let salt_path = app_data_dir.join("stronghold_salt.txt");
            if !salt_path.exists() {
                let mut salt_bytes = [0u8; 32];
                rand::rng().fill(&mut salt_bytes);
                std::fs::write(&salt_path, salt_bytes)?;
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
            let raw_salt = std::fs::read(&salt_path).unwrap_or_else(|_| vec![42u8; 32]);
            let stronghold_key = Sha256::digest(&raw_salt).to_vec();
            let stronghold = StrongholdStore::new(snap_path, stronghold_key)?;

            // 5. Initialize unified Vault
            let vault = Vault::new(keyring, stronghold, db);

            // Record startup in SQLite audit log
            let _ = vault
                .db()
                .record_audit_event("SYSTEM_START", "Shieldr service initialized.");

            let app_state = AppState {
                vault,
                is_locked: AtomicBool::new(false),
            };

            app.manage(app_state);

            // Intercept window close requests to prevent toddlers/accidental closes when locked
            if let Some(window) = app.get_webview_window("main") {
                let win_clone = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if let Some(state) = win_clone.try_state::<AppState>() {
                            if state.is_locked.load(Ordering::SeqCst) {
                                api.prevent_close();
                                eprintln!("Close attempt blocked: Shield is locked in fullscreen.");
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
            minimize_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
