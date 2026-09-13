# 🛡️ Shieldr — Toddler & Touch Screen Guard

**Shieldr** is a high-performance desktop application built with **Tauri v2**, **Rust**, **SolidJS**, **TypeScript**, and **Bun**. It creates a transparent, fullscreen, always-on-top interactive barrier that intercepts mouse clicks, touches, and keyboard shortcuts while allowing background videos, presentations, or applications to play completely unobstructed.

---

## 🏗️ FAANG-Grade Architectural Design

### 1. Zero-Knowledge Value vs. Property Separation
- **Values / Secrets (Keyring + Stronghold Vault)**:
  - **User PIN**: Hashed with Argon2id; stored in the **OS Keyring** (`keyring` crate) and encrypted in the **Tauri Stronghold Vault** (`shieldr.vault`).
  - **Master Password**: Hashed with Argon2id; stored in OS Keyring & Stronghold.
  - **Reset / Recovery Phrase**: Standard 12-word BIP-39 cryptographic mnemonic generated with CSPRNG entropy; stored securely in OS Keyring & Stronghold.
  - *No plain-text passwords or secret keys ever touch SQLite or client memory.*
- **Properties & Audit Logs (SQLite)**:
  - SQLite database (`shieldr_metadata.db`) is strictly utilized for non-sensitive metadata, UI configuration, lockout timers, and tamper-evident audit logs:
    - Overlay transparency level (`overlay_opacity`)
    - Frosted glass blur radius (`overlay_blur`)
    - Padlock widget positioning & idle autohide duration
    - Sound FX settings (synthesized Web Audio API)
    - Rate limiter status (`failed_attempts`, `locked_until`)
    - Audit log events: `SHIELD_LOCKED`, `SHIELD_UNLOCKED`, `AUTH_FAILED`, `SECURITY_CONFIGURED`

---

## 🔒 Security & Anti-Escape Guardrails

- **Fullscreen & Always-on-Top Overlay**:
  - Covers the entire monitor space with a transparent click-interceptor.
  - Suppresses right-click context menus (`contextmenu`), touch events, and keyboard leaks (`Escape`, `Alt+Tab`, `Super/Win`).
- **Protected Close & Hide Operations**:
  - The application window close event (`WindowEvent::CloseRequested`) is intercepted at the Rust level while locked.
  - Hiding, minimizing, or closing the window while armed requires entering the PIN or Master Password.
- **Brute-Force Rate Limiting**:
  - After configured failed unlock attempts (default: 5), a time-locked penalty lockout is enforced in the Rust backend.

---

## 🎨 UI/UX & Micro-Interactions

- **Minimalist Floating Lock Icon**:
  - Only a discreet padlock widget is visible when locked.
  - Configurable positioning (Floating, Center, Top-Right, Bottom-Right).
  - Autohide on idle so videos and cartoons are 100% visible.
- **SVG Padlock Animation**:
  - Hardware-accelerated CSS shackle snap on lock.
  - Spring-release shackle jump and golden glow on successful unlock.
  - Elastic horizontal shake and red aura on incorrect credentials.
  - Expanding touch ripple effect at pointer coordinates when clicks are blocked.
- **Procedural Audio (Web Audio API)**:
  - Synthesizes mechanical lock clicks, harmonic unlock chimes, and keypad touches with zero external audio assets.

---

## 🚀 Development & Build Workflow

Using **Bun** as the primary package manager and runtime:

```bash
# Install dependencies
bun install

# Run frontend development server
bun run dev

# Launch full desktop app in development
bun run tauri dev

# Run Rust unit tests
cd src-tauri && cargo test

# Build production bundle
bun run build
bun run tauri build
```

---

## 🩺 Security & Robustness Audit

A comprehensive audit of the Rust + TypeScript codebase lives in **[`AUDIT.md`](./AUDIT.md)**.

The audit enumerates **30 concrete defects** (P0–P3 severity) covering:

- Authentication bypass risks (rate-limit holes on `change_master_password`, `reveal_recovery_phrase`)
- Concurrency / state divergence (Stronghold mutex, `is_locked` ordering)
- Frontend defensive coding gaps (missing Zod parsing of backend payloads, NaN slider values, leaked `setTimeout`s)
- Backend hardening (Keyring silent failure, plaintext salt, `panic = "abort"` no supervisor)
- UX edge cases (countdown race, stale tab messages, sound toggle timing)

Each finding includes the exact file path, line numbers, severity, and reproduction context.

### Bug Tracker

The audit contains a **[Bug Tracker table](./AUDIT.md#7-bug-tracker-status--file-refs)** where every defect has a stable ID (`B-001` … `B-030`) and an explicit `Status` column. As fixes are implemented, flip the status emoji:

- 🔴 Open
- 🟡 In Progress
- 🟢 Fixed
- ⚪ Won't Fix

### AI Fix Workflow

To address a bug from the audit (manually or via an AI agent):

1. Reference the bug ID and title in your commit/PR
2. Read the cited file(s) in full before editing
3. Add a unit test (Rust `#[cfg(test)] mod tests` or vitest)
4. Update the tracker row to 🟢
5. Add a one-line note below in **Latest changes**

---

## 📝 Latest changes

> **Format:** `YYYY-MM-DD · B-XXX — short description`

- **2026-09-13 · B-084 (window-state plugin + drag region)** — Added `tauri-plugin-window-state` 2.x with `StateFlags::SIZE | POSITION | VISIBLE | DECORATIONS` (FULLSCREEN/MAXIMIZED excluded so the lock screen's fullscreen state doesn't pollute the saved state). After every unlock, `unlock_shield` now calls `app.save_window_state(StateFlags::SIZE | POSITION)` so subsequent launches start centered at 900×640 instead of restoring the pre-lock "top-right" position. The TitleBar also got `data-tauri-no-drag` on every button so clicks register cleanly while the rest of the header remains draggable.
- **2026-09-13 · Linux WebKit hardening** — On Linux, `run()` now sets `WEBKIT_DISABLE_COMPOSITING_MODE=1` and `GDK_BACKEND=x11` if those env vars are not already set by the user. This mitigates the known WebKitGTK + Wayland + NVIDIA crash (`Gdk-Message: Error flushing display: Resource temporarily unavailable` / `Error 71`). `main.rs` also installs a panic hook so any uncaught panic prints a clear `=== SHIELDR PANIC ===` banner with the location to stderr before aborting. The Stronghold load-snapshot warning now includes the snapshot path and a hint that the user needs to re-onboard if the salt file was rotated externally.
- **2026-09-13 · B-032** — `handleUnlock` no longer conflates unlock success with hide/close success: secondary window ops are best-effort and only log a warning if they fail after the credential check has already passed.
- **2026-09-13 · B-033** — `change_pin` now requires the **Master Password** instead of accepting either credential. The Rust command signature is `currentMaster`, the Zod schema is updated, the Dashboard UI was re-labelled, and failed attempts now share the lock-screen rate limiter so brute-forcing the master through `change_pin` is no easier than through unlock.
- **2026-09-13 · B-034** — Tray "Lock Now" is now debounced (1 second). Repeated clicks within the window are silently dropped with an explanatory log line, removing the lock-spam DoS path.
- **2026-09-13 · B-039, B-042** — `startLockoutTimer` now tracks an end-of-lockout timestamp instead of a counter; re-entry from `refreshStatus` no longer resets the countdown to a higher value. Tray / global-shortcut event listeners are also gated by a `mounted` flag so async registration after a fast unmount can no longer leak listeners.
- **2026-09-13 · B-045** — Recovery phrase is rendered with `(phrase ?? "").trim().split(/\s+/).filter(Boolean)` so a corrupted phrase no longer draws empty badges.
- **2026-09-13 · B-046** — `loadAuditLogs` now always coerces the result to an array (`Array.isArray(entries) ? entries : []`) and resets to `[]` on error so a malformed backend response cannot crash `<For>`.
- **2026-09-13 · B-048** — `ShieldOverlay` blur/opacity values are wrapped in `Number.isFinite(...)` checks so a NaN payload silently degrades to "no blur / 0 opacity" instead of disappearing without a trace.
- **2026-09-13 · B-051** — `refreshStatus` now merges Rust-provided properties over the previous ones, so a partial response can no longer crash downstream renderers that read `properties.overlay_blur` etc.
- **2026-09-13 · B-054** — Tooltip placement now listens to `scroll` (capture phase) so it stays anchored to its trigger after the user scrolls a scrollable container like the Dashboard tabs.
- **2026-09-13 · B-057** — `verify_credential` now always runs two Argon2 verifications (against a precomputed dummy hash when a slot is empty) so a PIN-only user and a PIN+master user take the same amount of CPU per attempt. Closes the timing oracle.
- **2026-09-13 · B-062** — Stronghold salt file is validated at startup: missing / wrong-size / corrupt salt is rewritten with a fresh CSPRNG value and a warning is logged. The fallback `vec![42u8; 32]` is gone.
- **2026-09-13 · B-063** — `verify_credential`, `change_master_password`, and `reveal_recovery_phrase` now `.trim()` the candidate, matching the `.trim()` already applied at setup time so `" 1234 "` unlocks as expected.
- **2026-09-13 · B-066** — Lockout remaining-seconds math now uses `clamp(1, i64::from(u32::MAX))` so a corrupted `locked_until` written by another process (or a wildly future clock) cannot panic with i64 overflow.
- **2026-09-13 · B-069, B-070** — All `Mutex::lock().unwrap()` sites in `db.rs` and `stronghold_store.rs` now go through `lock_conn()` / `lock_inner()` helpers that recover from poisoning with a `WARN` log, so a single panic in one accessor no longer permanently bricks the database or the vault.
- **2026-09-13 · B-040, B-041** — Dashboard countdown no longer locks the screen when cancelled, and the timer is cleared before starting a new one (double-click race fixed).
- **2026-09-13 · B-071, B-072, B-074** — `ShieldOverlay` now blocks mouse wheel, drag-and-drop, and app-switcher key combos (Tab, Alt, Cmd/Win, Ctrl+Shift+Esc, F12, devtools shortcuts).
- **2026-09-13 · B-031** — Unlock modal now clears `pin()` / `password()` on successful unlock (not only on failure). Added a `createEffect` that wipes sensitive signals whenever the modal closes, preventing stale-credential re-use. Same hygiene applied to Dashboard tab switches (`currentCred`, `newPin`, `currentMaster`, `newMaster`, `revealMasterPass`).
- **2026-09-13 · B-035** — `request_close_window` and `request_hide_window` now require a valid credential regardless of lock state. Added a separate `request_hide_window_unlocked` (no credential) for the TitleBar's close-to-tray button; it refuses to operate while locked.
- **2026-09-13 · B-036, B-037** — Lock and unlock flows now record audit events **first** (so the timeline is never gapped by a partial failure) and treat window-operation failures as best-effort warnings logged to `SHIELD_LOCK_WARNINGS` / `SHIELD_UNLOCK_WARNINGS`. `is_locked` is flipped **before** window ops on unlock so UI matches the user's intent even if a window call fails.
- **2026-09-13 · B-055** — Fixed `tauriBridge.handleInvokeError`: the inner `try { JSON.parse } catch {}` was swallowing the `throw new TauriError(parsed)`. The parse and the throw are now separated so a backend JSON error correctly surfaces its `code` and `remaining_seconds` instead of being downgraded to `GENERAL_ERROR`.
- **2026-09-13 · B-064** — Audit logging is now best-effort. Added `SqliteStore::audit_log_best_effort` and migrated `setup_security`, `verify_credential` (success and failure paths), `reset_pin_with_recovery_phrase`, `change_pin`, `change_master_password`, and `reveal_recovery_phrase` to use it. A SQLite hiccup no longer makes the user think their setup failed.
- **2026-09-13 · B-079** — All credential-bearing Tauri commands now wrap their `String` argument in `zeroize::Zeroizing<String>` so the buffer is wiped on drop (`unlock_shield`, `change_pin`, `change_master_password`, `reveal_recovery_phrase`, `request_close_window`, `request_hide_window`).
- **2026-09-13 · B-056** — Deferred. Stronghold key derivation needs to switch from salt-only to `master_password || salt`, but doing so safely requires a startup master-password prompt UX, which is its own feature. Tracked here for follow-up.
- **2026-09-13 · B-081, B-082, B-083** — OS-level escape attempts are now intercepted while locked. Added `src-tauri/src/shortcut_interceptor.rs` (uses `tauri-plugin-global-shortcut`) to consume **Alt+F4, Super/⌘+Q, Super/⌘+W, Super/⌘+M, Super/⌘+H, Ctrl+W**. Each intercepted combo brings the window forward, fires `shield-escape-attempt` to the frontend, which pops the unlock modal. Shortcuts are registered on `lock_shield` and unregistered on `unlock_shield`. `WindowEvent::Resized` and `WindowEvent::Moved` now snap the window back to fullscreen if anything tries to un-fullscreen it while locked. Standalone Super/Meta/OS/Hyper keys are blocked in `ShieldOverlay` (and `e.ctrlKey` is now treated as a switcher-key modifier to cover Linux/Win Ctrl+Tab etc.).
