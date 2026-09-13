// B-081: Global shortcut interception while locked.
//
// Problem: a malicious user (or accidental toddler) can press Alt+F4, the
// Super/Win key, Cmd+Q, etc. while Shieldr is locked. The OS will then close,
// minimize, or launch the start menu — bypassing the lock screen.
//
// Solution: while `is_locked` is true, register a set of OS-level global
// shortcuts via `tauri-plugin-global-shortcut`. When any of them fire, emit
// an event to the frontend which opens the unlock modal. The OS will not
// interpret these keys for their normal action because we consumed them.
//
// When unlocked, the shortcuts are unregistered so the user gets the normal
// platform behavior back.
//
// Reference: https://docs.rs/tauri-plugin-global-shortcut/latest/tauri_plugin_global_shortcut/

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Shortcuts to block while the shield is locked.
/// Format: (Code, Modifiers, event-name-to-emit-to-frontend)
const LOCKED_SHORTCUTS: &[(Code, Modifiers, &str)] = &[
    // Alt+F4 — Windows / Linux "close window"
    (Code::F4, Modifiers::ALT, "shield-escape-attempt"),
    // Super+Q (Linux) / Cmd+Q (macOS) "quit app"
    (Code::KeyQ, Modifiers::SUPER, "shield-escape-attempt"),
    // Super+W (Linux/macOS) "close window"
    (Code::KeyW, Modifiers::SUPER, "shield-escape-attempt"),
    // Cmd+M (macOS) / Super+M (Linux) "minimize window"
    (Code::KeyM, Modifiers::SUPER, "shield-escape-attempt"),
    // Cmd+H (macOS) "hide window"
    (Code::KeyH, Modifiers::SUPER, "shield-escape-attempt"),
    // Ctrl+W (Linux/Windows) "close tab/window"
    (Code::KeyW, Modifiers::CONTROL, "shield-escape-attempt"),
    // Alt+Tab handled at OS level — cannot intercept portably. Skip.
    // Escape (alone) — covered by ShieldOverlay keydown. Skip here.
];

/// Register the lock-mode shortcuts. Idempotent: unregisters any existing ones first.
pub fn register_lock_shortcuts(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let plugin = app.global_shortcut();

    // First, unregister anything we previously registered.
    let _ = plugin.unregister_all();

    let app_handle = app.clone();
    let mut errors: Vec<String> = Vec::new();

    for (code, mods, event) in LOCKED_SHORTCUTS {
        let shortcut = Shortcut::new(Some(*mods), *code);
        let event_name = event.to_string();
        let handle = app_handle.clone();

        let result = plugin.on_shortcut(shortcut, move |_app, _shortcut, ev| {
            // Only react to "Pressed" — ignore key release events.
            if ev.state() == ShortcutState::Pressed {
                // Bring the main window forward and emit the escape-attempt event
                // so the frontend can open the unlock modal.
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
                if let Err(e) = handle.emit(&event_name, ()) {
                    eprintln!("Failed to emit {event_name}: {e}");
                }
            }
        });

        if let Err(e) = result {
            errors.push(format!("{:?}: {e}", shortcut));
        }
    }

    if !errors.is_empty() {
        eprintln!(
            "Warning: {} shortcut(s) failed to register: {}",
            errors.len(),
            errors.join("; ")
        );
    }

    Ok(())
}

/// Unregister all lock-mode shortcuts. Called when the shield unlocks.
pub fn unregister_lock_shortcuts(app: &AppHandle) {
    if let Err(e) = app.global_shortcut().unregister_all() {
        eprintln!("Warning: failed to unregister shortcuts: {e}");
    }
}
