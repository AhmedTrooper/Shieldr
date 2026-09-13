use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

use crate::AppState;

/// B-034: Tray-side debounce so a malicious script that can spam the tray
/// menu (or a stray double-click) cannot lock the screen in a tight loop and
/// DoS the legitimate user out of their session. The first lock click within
/// a 1-second window is honored; subsequent clicks are silently dropped.
static LAST_LOCK_CLICK: std::sync::Mutex<Option<Instant>> = std::sync::Mutex::new(None);
const LOCK_DEBOUNCE: Duration = Duration::from_secs(1);

#[cfg(desktop)]
pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let toggle_item = MenuItem::with_id(app, "toggle", "Show Shieldr", true, None::<&str>)?;
    let lock_item = MenuItem::with_id(app, "lock", "🔒 Lock Screen Now", true, None::<&str>)?;
    let updates_item = MenuItem::with_id(
        app,
        "updates",
        "🔄 Check for Updates...",
        true,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Exit Shieldr", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_item,
            &lock_item,
            &sep1,
            &updates_item,
            &sep2,
            &quit_item,
        ],
    )?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false);

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let _tray = builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(is_visible) = window.is_visible() {
                        if is_visible {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            let _ = window.emit("window-shown", ());
                        }
                    }
                }
            }
            "lock" => {
                // B-034: Drop the click if it's within the debounce window
                // of the previous one to prevent lock-spam DoS.
                {
                    let Ok(mut guard) = LAST_LOCK_CLICK.lock() else {
                        return;
                    };
                    let now = Instant::now();
                    if let Some(prev) = *guard {
                        if now.duration_since(prev) < LOCK_DEBOUNCE {
                            eprintln!("Tray lock click debounced (DoS protection).");
                            return;
                        }
                    }
                    *guard = Some(now);
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = window.emit("tray-lock-request", ());
                }
            }
            "updates" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = window.emit("tray-check-updates", ());
                }
            }
            "quit" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if state.is_locked.load(Ordering::SeqCst) {
                        eprintln!("Blocked: Cannot quit Shieldr while locked!");
                        return;
                    }
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = window.emit("window-shown", ());
                }
            }
        })
        .build(app)?;

    Ok(())
}
