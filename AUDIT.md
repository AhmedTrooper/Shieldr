# Shieldr Security & Robustness Audit

> **Generated:** 2026-09-13 · **Scope:** Full codebase (Rust + TypeScript) · **Project:** Shieldr (Tauri v2, SolidJS)
> **Audience:** Self / AI Agent performing follow-up fixes
>
> This audit enumerates **concrete defects** observed by reading every source file in `src-tauri/src/` and `src/`. Each entry is reproducible from the file paths cited. Severity legend:
>
> - **P0 — Critical** · Security boundary bypass, data loss, lockout failure
> - **P1 — High** · Functional breakage under realistic conditions
> - **P2 — Medium** · UX / resilience / hardening
> - **P3 — Low** · Code quality / future-proofing

---

## Table of Contents

1. [Critical Security Flaws](#1-critical-security-flaws)
2. [Concurrency & State Bugs](#2-concurrency--state-bugs)
3. [Frontend Defensive Coding Gaps](#3-frontend-defensive-coding-gaps)
4. [Backend (Rust) Hardening Gaps](#4-backend-rust-hardening-gaps)
5. [UX & Edge-Case Bugs](#5-ux--edge-case-bugs)
6. [Cleanup & Hygiene](#6-cleanup--hygiene)
7. [Bug Tracker (Status + File Refs)](#7-bug-tracker-status--file-refs)
8. [AI Fix Workflow](#8-ai-fix-workflow)
9. [Round-2 Deep Audit (new findings)](#9-round-2-deep-audit-new-findings)

---

## 1. Critical Security Flaws

### 1.1 [P0] Unlock modal's Enter key submits even when modal is closed
**File:** `src/components/UnlockModal.tsx` (lines 73–98)
The `handleKeyDown` listener is attached **globally** on `window` in `onMount`, but it is **never removed until the component unmounts** (i.e. never, since it lives at app root). When the modal is closed (`!props.isOpen` early-return saves us), the listener is still mounted. Critically, `submitUnlock` early-returns on `!cred.trim()` — but if the user previously had a digit typed, hid the modal, then reopened it later, **the same listener fires Enter from any keyboard input** even after `setPin("")`. Worse: when the modal is open but `useMasterPassword()` flips, leftover listener state can fire.
**Impact:** May unlock when user did not intend to, or submit with stale credential.
**Fix:** Either guard `if (!props.isOpen) return;` at the **top** of `handleKeyDown` (already done) **and** register listener lazily inside a `createEffect`, or rely on the modal's own focus trap.

---

### 1.2 [P0] Stale `useMasterPassword` state leaks across modal opens
**File:** `src/components/UnlockModal.tsx` (lines 16–46)
`useMasterPassword()`, `pin()`, `password()`, `errorMessage()`, `isShaking()`, `isSuccess()` are component-local signals, but since `UnlockModal` is **always mounted** (controlled only via `<Show>`), its signals **persist across hide/show cycles**. When the user closes the modal after typing partial digits, opens it again, those digits are still there. Worse: `isShaking` and `isSuccess` flags can remain true if a `setTimeout` is pending when the modal is dismissed — leading to the modal appearing with the success styling or shake animation out of nowhere.
**Fix:** `createEffect(() => { if (!props.isOpen) { setPin(""); setPassword(""); setIsShaking(false); setIsSuccess(false); setErrorMessage(null); } });`

---

### 1.3 [P0] `setTimeout`s are not aborted on unmount
**Files:**
- `src/components/ShieldOverlay.tsx` line 25 (`setTimeout(... 700)` for ripples)
- `src/components/UnlockModal.tsx` line 67 (`setTimeout(() => setIsShaking(false), 500)`)
- `src/components/UnlockModal.tsx` line 140 (`setTimeout(... 500)` in App.tsx via `handleUnlock`)
- `src/App.tsx` line 150 (`setTimeout(() => setIsShaking(false), 450)`)
- `src/components/Dashboard.tsx` line 238 (`setTimeout(() => setSaveDisplayMsg(null), 2500)`)
- `src/components/Dashboard.tsx` line 861 (copied phrase timeout)

**Impact:** Calling `setIsShaking` / `setIsSuccess` on an unmounted component is harmless in SolidJS (no warnings), but if the closure captures a stale value and the user has interacted in between, the UI flashes incorrectly. For the unlock-modal shake/success, this can cause **an already-unlocked shield to look like it's still failing** (false shake animation), or worse, a callback that re-opens the modal fires after the user navigated away.
**Fix:** Track all timers, clear them in `onCleanup`.

---

### 1.4 [P0] `reveal_recovery_phrase` is callable from any thread context with no rate limit
**File:** `src-tauri/src/commands.rs` lines 179–185 + `src-tauri/src/vault.rs` lines 219–242
The master-password check is constant-time, but `reveal_recovery_phrase` records an audit event on **success only**, not on **failure**, and `verify_credential` (which it doesn't use) is the only path that increments the rate limiter. So an attacker (or a curious toddler hammering keys, or an automated script) can brute-force the master password through `reveal_recovery_phrase` indefinitely without triggering lockout.
**Impact:** Master password can be brute-forced offline-style by repeatedly invoking `reveal_recovery_phrase` and waiting for `InvalidCredentials`. No lockout, no audit.
**Fix:** Call `vault.verify_credential` instead of doing a standalone Argon2 verify, OR add a separate `reveal_recovery_phrase_attempts` counter that triggers lockout.

---

### 1.5 [P0] Tray "Lock Now" is unauthenticated; emits `tray-lock-request` to anyone
**File:** `src-tauri/src/tray.rs` lines 60–67
The tray menu has a `lock` item that unconditionally calls `window.emit("tray-lock-request", ())`. The frontend listener `src/App.tsx` line 91 simply calls `handleLockNow()`. So anyone with physical access (or a malicious tray menu injection) can lock the screen without authenticating. Locking is meant to be a privileged action in some threat models, but **unlocking requires credentials** — the asymmetry is by design. However, the tray click also calls `window.show()` and `set_focus()`, so a malicious process that can interact with the tray icon can wake the app and lock it, but they cannot unlock it. **Still a P0 because:** a DoS attacker locks the legitimate user out repeatedly until they enter the master password.
**Fix:** Optionally require a short confirmation dialog before locking from the tray; or rate-limit lock requests.

---

### 1.6 [P1] `change_pin` accepts master password OR PIN as `currentCredential`, but reveals no auth-method failure
**File:** `src-tauri/src/vault.rs` lines 182–195, frontend `Dashboard.tsx` lines 132–163
The schema says "Current PIN or Password" but the only path that returns `InvalidCredentials` is `verify_credential` which returns `Ok(false)` on failure. The frontend then shows `err.message`, which comes from `TauriError` carrying the message `"Invalid credentials provided"`. OK on the surface. But: `change_pin` itself returns the wrong error type — it calls `verify_credential` which **may also return `LockedOut`** (rate limit hit), and that propagates correctly. However, **`change_master_password` does NOT use `verify_credential`**, it does its own Argon2 verify (lines 199–205). So master-password brute force via `change_master_password` is **not rate-limited either**.
**Impact:** Same as 1.4 — master password can be brute-forced via `change_master_password` with no lockout.
**Fix:** Centralize credential verification in `verify_credential`; have `change_master_password` call it.

---

## 2. Concurrency & State Bugs

### 2.1 [P0] `state.is_locked: AtomicBool` can be flipped while commands are in-flight
**File:** `src-tauri/src/lib.rs` lines 85–91, `src-tauri/src/commands.rs` lines 67, 139
`lock_shield` sets `is_locked.store(true)` **before** all side-effects finish (window setup, keepawake acquire). If the window operation fails midway (returns an error to the frontend), `is_locked` stays `true` even though the UI may not be in fullscreen — UI and backend state diverge.
Conversely, `unlock_shield` sets `is_locked.store(false)` only **after** window operations succeed (line 139), but if window centering fails silently (it uses `let _ = window.set_size(...)`), the state is still flipped. That's actually fine. **The real bug:** `lock_shield` should set `is_locked` **only after** all side-effects succeed, and roll back on error.
**Fix:** Re-order: try all window operations first, then `store(true)` last. Same in reverse for unlock.

---

### 2.2 [P1] `lockoutCountdownTimer` set via `let` may be re-assigned across calls
**File:** `src/App.tsx` lines 45, 65–82
`let lockoutCountdownTimer: ReturnType<typeof setInterval> | null = null;` is declared inside the component body. When `refreshStatus()` is called multiple times in quick succession (e.g. after a failed unlock then a successful one), the previous timer may not have been cleared, leading to **two concurrent intervals** racing and updating `status` repeatedly.
The early return on `if (lockoutCountdownTimer) clearInterval(lockoutCountdownTimer);` (line 66) is good, but only protects the path through `startLockoutTimer`. `refreshStatus` calls `startLockoutTimer` if `current.is_locked_out && current.lockout_remaining_secs`. So that's fine. **The leak** is: if `refreshStatus` is called from elsewhere (e.g. after a successful unlock), the timer continues to tick **even though lockout is no longer active**, eventually calling `refreshStatus()` again with stale data — but the new status won't be locked-out, so it just clears. Minor.
**Fix:** Move `lockoutCountdownTimer` into a `createSignal` or wrap in a ref-like object; ensure cleared on every `refreshStatus` invocation.

---

### 2.3 [P1] `StrongholdStore.stronghold` is `Arc<Mutex<Stronghold>>` — deadlock-prone
**File:** `src-tauri/src/stronghold_store.rs` lines 14–19, 59, 89, 113
Every operation locks the Stronghold mutex. The mutex is **not reentrant**, so if `set_secret` ever called another method that locks (it doesn't today, but `KeyProvider::try_from` and `commit_with_keyprovider` are called *while holding the lock*), the program would deadlock. Currently safe, but fragile.
**Fix:** Document the non-reentrance invariant; consider dropping the lock between logical operations.

---

### 2.4 [P1] `Vault::setup_security` silently ignores Keyring failures
**File:** `src-tauri/src/vault.rs` lines 45–47
```rust
let _ = self.keyring.set_secret(KEY_PIN_HASH, &pin_hash);
let _ = self.keyring.set_secret(KEY_MASTER_HASH, &master_hash);
let _ = self.keyring.set_secret(KEY_RESET_PHRASE, &recovery_phrase);
```
If the OS Keyring is unavailable (e.g. headless Linux without `gnome-keyring`, or locked Windows Credential Manager), the secrets are **only** saved to Stronghold. The Stronghold snapshot is encrypted with a key derived from a **random salt on disk** (`stronghold_salt.txt` line 53 of `lib.rs`). Anyone who copies the Stronghold snapshot file + salt file + applies Argon2 to the salt (no password!) can decrypt it.
**Impact:** If Keyring fails, the entire vault is effectively **unprotected** because Stronghold's only "password" is a local file.
**Fix:** Make Keyring failures fatal at setup; on subsequent reads, if Keyring is missing, refuse to unlock with `Stronghold` fallback (or require explicit user acknowledgement).

---

### 2.5 [P2] SQLite `connection` is shared via `Arc<Mutex<Connection>>` — fine, but no `WAL` mode
**File:** `src-tauri/src/db.rs` lines 53–72
`Connection::open` opens a SQLite file with default journal mode (DELETE). Concurrent reads + writes are serialized by the mutex, so this works, but at high write rates (audit logging) the DELETE journal will create transient locks. Switching to WAL would improve concurrency.
**Fix:** `conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")` at startup.

---

## 3. Frontend Defensive Coding Gaps

### 3.1 [P0] `revealMasterPass()` may be `""` and still be sent to backend
**File:** `src/components/Dashboard.tsx` lines 199–211
`handleRevealPhrase` does not validate input length before calling `revealRecoveryPhrase`. The backend correctly rejects (master password min length enforced at hash time, but verify_password accepts empty), but **every empty submission** triggers a full Argon2 verification (slow, ~250ms+ per attempt) plus an audit row on failure.
**Impact:** Enables a low-rate DoS by hammering the reveal button.
**Fix:** Frontend guard: `if (!revealMasterPass().trim()) { ... return; }`.

---

### 3.2 [P0] Arrays rendered without null/empty guards
**Files:**
- `src/components/RecoveryModal.tsx` line 92: `recoveryPhrase().split(/\s+/).filter(Boolean)` — `For each={words()}` is safe because `filter(Boolean)` returns `string[]`. ✅
- `src/components/Dashboard.tsx` line 836: `revealedPhrase()?.split(/\s+/) || []` — guarded with `|| []`. ✅
- `src/components/Dashboard.tsx` line 921: `<For each={logs()}>` — `logs()` is initialized to `[]` (line 103). ✅
- `src/components/ShieldOverlay.tsx` line 81: `<For each={ripples()}>` — `ripples()` initialized to `[]`. ✅
- **`src/services/updater.ts` line 22:** `updaterState` is a module-level signal — fine.

**However:** `src/components/Dashboard.tsx` line 250: `setLogs(entries)` — if backend returns malformed JSON or an error, `entries` could be `undefined`. The audit logs table renders fine with `For` over empty array, but if `entries` is `null`, Solid will throw.
**Fix:** `setLogs(entries ?? [])`.

---

### 3.3 [P1] `ShieldStatus` from backend is trusted as-is — no Zod parse
**Files:** all `tauriBridge` callers in `src/App.tsx`, `Dashboard.tsx`, `UnlockModal.tsx`, `RecoveryModal.tsx`
The frontend defines Zod schemas in `schemas.ts` but **never validates** the runtime payload. If the Rust backend serializes a `ShieldStatus` with a missing field (e.g. someone changes `ShieldProperties` defaults and forgets to update the struct), the TS will read `undefined` and crash.
**Fix:** Wrap every `invoke<T>` return in `Schema.parse(...)` via a helper, or use `safeParse` and surface errors.

---

### 3.4 [P1] `status().properties` may be `undefined` after schema drift
**File:** `src/App.tsx` line 200 (`properties={status().properties}`)
The initial state sets `properties: defaultProperties` so it's defined at boot. But if `refreshStatus` fails or returns malformed data, `setStatus(current)` may overwrite with an object that lacks `properties`, then `ShieldOverlay opacity={status().properties.overlay_opacity}` throws.
**Fix:** Defensive merge: `setStatus((prev) => ({ ...prev, ...current, properties: { ...defaultProperties, ...current.properties } }))`.

---

### 3.5 [P1] No null check on `updaterService.state().updateInfo?.body`
**File:** `src/components/Dashboard.tsx` line 995
`<Show when={... .body}>` guards correctly, but if the body is an empty string, the `<p>` renders empty. Cosmetic.
**Fix:** `<Show when={... .body?.length}>`. Low priority.

---

### 3.6 [P1] `ShieldOverlay` key listener doesn't ignore modifier keys
**File:** `src/components/ShieldOverlay.tsx` lines 45–58
`Cmd+R`, `Ctrl+Shift+I` (devtools), `F12` all fall through to the "block other key" branch which calls `props.onBlockedInteraction()` (shake animation). This causes the shake to fire whenever a developer hits a keyboard shortcut while the app is locked, which is annoying but also opens devtools in some webview configs.
**Impact:** Devtools could be opened while locked if the user has the right shortcut memorized. Solid prevents this via Tauri's CSP (set to `null` in `tauri.conf.json`), but `null` CSP is itself a problem.
**Fix:** Set a proper CSP and ignore `Ctrl+Shift+I` / `F12` / `Cmd+Option+I` in the keydown handler.

---

### 3.7 [P0] CSP is `null` — disables browser security model entirely
**File:** `src-tauri/tauri.conf.json` line 29
`"csp": null` means the webview accepts any script, style, image source, etc. Combined with the tray's `tray-lock-request` event listener and the fact that any local file access from a Tauri command can return arbitrary data, an XSS-style vulnerability in user-supplied content (e.g. the recovery phrase displayed in `Dashboard.tsx` lines 836–843 — those words come from the local store but are rendered via `For`, not `innerHTML`, so it's safe **today**) becomes catastrophic.
**Fix:** Set a real CSP, e.g. `"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"`.

---

### 3.8 [P1] `recoveryPhrase` rendered as plain `<For>` — but surrounding div uses `font-mono` and `select-text` (line 838)
**File:** `src/components/Dashboard.tsx` lines 834–844
The recovery phrase is rendered with `select-text`, which is good for copy. But the same component on `InitialSetupModal.tsx` line 224 renders the words via `<For>` with `truncate` — if a word is longer than expected (shouldn't happen with BIP-39, but a corrupted store might have garbage), it could overflow.
**Fix:** Use `break-all` or word-wrap to prevent visual breakage.

---

### 3.9 [P2] `localStorage`/`sessionStorage` never used; secrets are not cleared from signals
**Files:** `UnlockModal.tsx`, `RecoveryModal.tsx`
`pin()` and `password()` are cleared on success and failure, but **`revealMasterPass()` is only cleared on `handleChangeMasterPassword` success** (line 188). If the user reveals the phrase, closes the dashboard tab, and revisits, the master password signal may still hold the value. In SolidJS, signals are GC'd when no references remain — but the `Dashboard` component is mounted for the app's lifetime.
**Fix:** Clear all sensitive signals in `onCleanup` of relevant components.

---

### 3.10 [P2] `RecoveryModal.handleReset` allows pressing Enter from textarea, submits with empty pin
**File:** `src/components/RecoveryModal.tsx` lines 27–59
The `onSubmit` handler runs `RecoveryPhraseResetSchema.safeParse` first, which catches empty pin. ✅
But the textarea + button layout has the submit button at index 1 of a 2-column grid, which means **Tab + Enter** submits even when the user is mid-edit.
**Fix:** Add `disabled={isSubmitting() || !validation.success}` to the submit button.

---

## 4. Backend (Rust) Hardening Gaps

### 4.1 [P1] `verify_credential` may set audit row to `"AUTH_SUCCESS"` with no destination detail
**File:** `src-tauri/src/vault.rs` lines 121–126
`record_audit_event("AUTH_SUCCESS", "Authentication successful.")` — same string for every success. A forensic investigator cannot tell which credential (PIN vs master) was used. Same for `AUTH_FAILED` (lines 137–146) — only attempt count is logged, not whether the PIN or master was attempted.
**Fix:** Differentiate: `"AUTH_SUCCESS_PIN"` vs `"AUTH_SUCCESS_MASTER"`.

---

### 4.2 [P1] `verify_credential` exposes `Ok(false)` for "wrong credential but not locked out" — frontend must check both
**File:** `src-tauri/src/vault.rs` lines 91–147 + `src-tauri/src/commands.rs` lines 102–112
Backend returns `Ok(false)` for "wrong but not locked". `unlock_shield` command converts this to `AppError::InvalidCredentials`. Frontend treats as error. ✅ But the type signature `Result<bool, AppError>` is misleading — `Ok(false)` is also an "error" semantically.
**Fix:** Return `Result<(), AppError>` and map to `InvalidCredentials` inside.

---

### 4.3 [P1] `record_failed_attempt` returns `(attempts, is_locked, lock_secs)` — `Option<u64>` for lockout seconds is awkward
**File:** `src-tauri/src/db.rs` lines 287–322
When `is_locked_out`, lock_secs is `Some(lockout_duration_secs)`. When not, it's `None`. Caller must check `is_locked` flag to know which to use. Cleaner: just always return `lockout_remaining_secs: Option<u64>`.
**Fix:** Refactor signature.

---

### 4.4 [P2] `panic = "abort"` in release profile (line 47 of Cargo.toml) — no recovery
**File:** `src-tauri/Cargo.toml`
A panic in any thread (e.g. a poisoned Mutex in `StrongholdStore`) will terminate the entire process. The window closes, the user loses access. There's no watchdog or auto-restart.
**Fix:** Add a supervisor that restarts the app on panic, or use `catch_unwind` around critical paths.

---

### 4.5 [P2] `keepawake::Builder::default()` is called per-lock without storing the Builder
**File:** `src-tauri/src/commands.rs` lines 72–91
The `keepawake::KeepAwake` handle is stored in `AppState.keep_awake_guard`, but the **Builder configuration is hardcoded** (display=true, idle=true, sleep=true). There's no way for users to pick "only display, not system idle" or vice versa via properties.
**Fix:** Read keepawake options from `ShieldProperties`.

---

### 4.6 [P2] `i64` overflow possible in `check_lockout`
**File:** `src-tauri/src/db.rs` lines 263–284
`(until_utc - now).num_seconds()` returns `i64`. The `.max(1) as u64` cast handles negative, but if the server clock is in the future beyond `i64::MAX` seconds, we'd panic. Extremely unlikely.
**Fix:** Use `saturating_sub` semantics.

---

### 4.7 [P3] `tauri.conf.json` has `"csp": null` and `"transparent": true` — combination is fragile
**File:** `src-tauri/tauri.conf.json` lines 22, 29
Transparent windows on macOS have rendering quirks; combined with no CSP, the WebView2 backend (Windows) can render unexpected content during partial transparency.
**Fix:** Set CSP, test transparent rendering on all platforms.

---

### 4.8 [P1] `is_locked` close-prevention only triggers for explicit close — not for OS shutdown
**File:** `src-tauri/src/lib.rs` lines 94–106
If the user/OS shuts down the computer while locked, the Stronghold snapshot file on disk remains readable by anyone with disk access (since it's encrypted only with a salt file, not a master password). The **Stronghold vault file is decrypted by the app at startup**, so disk-encryption at the OS level is the only defense.
**Fix:** Document the threat model; consider encrypting the snapshot with the master password (would require prompt at startup).

---

### 4.9 [P2] `Salt` written to disk unprotected (`stronghold_salt.txt`)
**File:** `src-tauri/src/lib.rs` lines 53–58
The 32-byte random salt is stored in plaintext in the app data directory. Combined with 4.8, an attacker with disk access can decrypt the Stronghold snapshot by simply running the app's code path with their own salt. Argon2 in the Stronghold plugin protects the key derivation but the salt file is the input.
**Fix:** Salt should be derived from a secret (master password + a fixed app secret), or stored in OS Keyring.

---

### 4.10 [P3] No CLI / IPC authentication for tray-launched commands
**File:** `src-tauri/src/tray.rs` lines 60–67
The tray menu can trigger events that the frontend blindly acts on. While this is by design, the events have no payload validation or signature.
**Fix:** If multi-window is ever added, this becomes critical.

---

## 5. UX & Edge-Case Bugs

### 5.1 [P1] `countdown` in Dashboard uses `setInterval` with stale `countdown()` read
**File:** `src/components/Dashboard.tsx` lines 106–122
```ts
const current = countdown();
if (current === null || current <= 1) {
```
Solid signals are functions, and reading `countdown()` inside the interval reads the **current value at tick time**. But because `setCountdown(current - 1)` schedules an async update, the next tick may see `current - 1` after a microtask. Generally works, but on a slow machine, the countdown may tick twice for the same second.
**Fix:** Use `setCountdown((c) => (c ?? 0) - 1)` updater form.

---

### 5.2 [P2] Sound playback may fail silently on first interaction (browser autoplay policy)
**File:** `src/services/sound.ts` lines 17–20
`if (this.ctx && this.ctx.state === "suspended") { this.ctx.resume(); }` is called inside `getContext()`. But `getContext()` is called from event handlers (clicks), which DO qualify as user gestures. Should work, but on macOS Safari and some Linux WebKit configs, the first resume is racy.
**Fix:** Add explicit user-gesture bootstrap on app start.

---

### 5.3 [P2] `delaySeconds()` defaults to 5 but UI permits 1-60 with no persistence
**File:** `src/components/Dashboard.tsx` line 59
In-memory only. Comment line 405 confirms: "1-60s, session only". Intentional, but the UI doesn't make this clear — users may expect the delay to persist.
**Fix:** Add "session only" label or persist to SQLite.

---

### 5.4 [P3] Sound is enabled by default and cannot be muted until setting is saved
**File:** `src/components/Dashboard.tsx` lines 97–99
`soundEnabled` initial state comes from props.properties.sound_enabled, but the **actual** `sound` service is updated only via `setEnabled` calls scattered across App.tsx (line 51) and Dashboard (line 232). If a user toggles sound off but doesn't save settings, sound remains on. UX confusion.
**Fix:** Toggle sound service immediately on checkbox change, even before save.

---

### 5.5 [P2] `setup_security` always returns the phrase, but the modal stores it in a signal forever
**File:** `src/components/InitialSetupModal.tsx` lines 45–47
After `setRecoveryPhrase(phrase)`, the phrase lives in the `recoveryPhrase` signal until the component unmounts (which never happens because the modal is always mounted with `<Show when={isOpen}>`). On the next onboarding (e.g. test mode), if a stale state lingers, the phrase may briefly display before the new setup completes.
**Fix:** Clear `recoveryPhrase` when modal closes or on success.

---

### 5.6 [P3] Window restore size is hardcoded 900×640 — ignores `properties.window_size`
**File:** `src-tauri/src/commands.rs` lines 132–135
There's no `window_size` in `ShieldProperties` yet, but if added, this code needs updating.
**Fix:** When adding window-size property, plumb it through.

---

### 5.7 [P1] `localStorage` not used; refresh after unlock state change is missed
**File:** `src/App.tsx` lines 87–101
On app start, `onMount` calls `refreshStatus()`. If the user opens the dashboard and immediately closes the window, then reopens, the tray `toggle` action shows the window but `App.tsx`'s `onMount` doesn't re-run. State stays as last-known. Acceptable, but if the user changed PIN in the Dashboard (Dashboard doesn't run onMount on tab switch), the new PIN won't be reflected in cached state until next refresh.
**Fix:** `refreshStatus()` on window-show event.

---

### 5.8 [P2] Tab change doesn't reset `pinChangeMsg` / `masterChangeMsg`
**File:** `src/components/Dashboard.tsx` lines 65, 70
If user sees "PIN updated successfully!" then switches to the Master Password tab, the green banner stays. They return and it's still there.
**Fix:** `createEffect` clearing messages when active tab changes.

---

### 5.9 [P3] `Slider` `value` not constrained in `onInput`
**File:** `src/components/Dashboard.tsx` lines 540–543
`onInput={(e) => setOpacity(parseFloat(e.currentTarget.value))}` — relies on HTML `min`/`max`. Some browsers send `NaN` if user types non-numeric. The value then becomes `NaN`, breaking the overlay.
**Fix:** Guard `if (Number.isFinite(parsed)) setOpacity(parsed)`.

---

### 5.10 [P3] `KeepAwake` is requested but only `display=true, idle=true, sleep=true` — no graceful "off"
**File:** `src-tauri/src/commands.rs` lines 71–91
`if props.keep_awake` is read once at lock time. If user disables the toggle in Dashboard while locked, the keep-awake handle still runs until unlock. UX mismatch.
**Fix:** Poll `keep_awake` setting periodically, or release on toggle-off.

---

## 6. Cleanup & Hygiene

### 6.1 [P3] `console.error` / `console.warn` left in production code
**Files:** numerous (App.tsx lines 61, 117, 175; Dashboard.tsx line 252; TitleBar.tsx lines 21, 35, 44; etc.)
In a release build with `console` cleared by Vite, these are no-ops. But logs may leak to the WebView's stderr, and Tauri's log capture is on.
**Fix:** Use a `logger` wrapper that respects log levels; mute in production.

---

### 6.2 [P3] No tests for `tauriBridge` error handling
**Files:** `src/services/tauriBridge.ts`
The `handleInvokeError` function (lines 16–32) handles 3 error shapes (object, string-JSON, string) but has no unit tests. Easy to break.
**Fix:** Add vitest tests for each error path.

---

### 6.3 [P2] `recoveryPhrase` schema allows extra whitespace, but Dashboard rendering uses `split(/\s+/)` which is fine
**Files:** `schemas.ts` line 122 vs `Dashboard.tsx` line 836
The `.trim()` in Zod doesn't normalize internal whitespace. A phrase like "abandon abandon  abandon" (double space) is technically valid but stores with extra spaces. Rendering is robust.
**Fix:** Normalize whitespace at the Zod layer.

---

### 6.4 [P3] `setIsShaking` race in App.tsx vs UnlockModal.tsx
**Files:** `src/App.tsx` line 149, `src/components/UnlockModal.tsx` line 62
Both files have their own `isShaking` signal that fires on failed unlock. The App's is for the floating lock icon, UnlockModal's is for the modal card. They don't interfere because they're in different components. **But** if the modal is dismissed before the 450ms timeout completes, the App's `isShaking` resets late — fine.
**Fix:** None needed, just document.

---

### 6.5 [P3] `sound.playKeypadBeep` signature accepts `digit?: string | number` but only uses type
**File:** `src/services/sound.ts` line 100
`const baseFreq = typeof digit === "number" ? 440 + digit * 40 : 580;` — if `digit` is `"5"` (string), it returns 580 always. Caller in `handleDigit` passes `digit` (a string), so the conditional always falls through.
**Fix:** `parseInt(digit)` or pass a number.

---

## 7. Bug Tracker (Status + File Refs)

> Use this table to track each bug through `Open → In Progress → Fixed → Verified`.
> Status legend: 🔴 Open · 🟡 In Progress · 🟢 Fixed · ⚪ Won't Fix

| ID | Severity | Title | Primary File(s) | Status |
|---|---|---|---|---|
| B-001 | P0 | Unlock modal listener leaks across hide/show | `src/components/UnlockModal.tsx` | 🟢 Fixed |
| B-002 | P0 | Stale signal state in UnlockModal | `src/components/UnlockModal.tsx` | 🟢 Fixed |
| B-003 | P0 | `setTimeout` not aborted on unmount | `UnlockModal.tsx`, `ShieldOverlay.tsx`, `App.tsx`, `Dashboard.tsx` | 🟢 Fixed |
| B-004 | P0 | `reveal_recovery_phrase` not rate-limited | `src-tauri/src/commands.rs`, `vault.rs` | 🟢 Fixed |
| B-005 | P0 | Tray lock is unauthenticated + DoS-able | `src-tauri/src/tray.rs`, `src/App.tsx` | 🟢 Fixed |
| B-006 | P1 | `change_master_password` bypasses rate limit | `src-tauri/src/vault.rs` | 🟢 Fixed |
| B-007 | P0 | `is_locked` set before window ops succeed | `src-tauri/src/commands.rs` | 🟢 Fixed |
| B-008 | P1 | Concurrent countdown timers possible | `src/App.tsx` | 🟢 Fixed |
| B-009 | P1 | Stronghold mutex deadlock risk | `src-tauri/src/stronghold_store.rs` | 🟢 Fixed |
| B-010 | P1 | Keyring failures silently ignored | `src-tauri/src/vault.rs` | 🟢 Fixed |
| B-011 | P2 | SQLite not in WAL mode | `src-tauri/src/db.rs` | 🟢 Fixed |
| B-012 | P0 | Empty master password hits Argon2 | `src/components/Dashboard.tsx` | 🟢 Fixed |
| B-013 | P0 | Backend payload not Zod-validated | all `tauriBridge` callers | 🟢 Fixed |
| B-014 | P1 | `status().properties` may be undefined | `src/App.tsx` | 🟢 Fixed |
| B-015 | P1 | Modifier keys (devtools) while locked | `src/components/ShieldOverlay.tsx` | 🟢 Fixed |
| B-016 | P0 | CSP is `null` | `src-tauri/tauri.conf.json` | ⚪ Intentionally Open (User Specified) |
| B-017 | P1 | `change_pin` audit too coarse | `src-tauri/src/vault.rs` | 🟢 Fixed |
| B-018 | P1 | `verify_credential` returns `Ok(false)` | `src-tauri/src/commands.rs`, `vault.rs` | 🟢 Fixed |
| B-019 | P1 | Stronghold snapshot unprotected by master password | `src-tauri/src/lib.rs` | ⚪ Deferred (needs master-prompt UX, see B-056) |
| B-020 | P2 | `panic = "abort"` no supervisor | `src-tauri/Cargo.toml` | 🟢 Fixed |
| B-021 | P2 | Salt file unprotected | `src-tauri/src/lib.rs` | 🟢 Fixed |
| B-022 | P1 | Countdown uses stale read | `src/components/Dashboard.tsx` | 🟢 Fixed |
| B-023 | P2 | Sound toggle doesn't apply until save | `src/components/Dashboard.tsx` | 🟢 Fixed |
| B-024 | P2 | Recovery phrase persists across onboarding | `src/components/InitialSetupModal.tsx` | 🟢 Fixed |
| B-025 | P2 | `refreshStatus` not called on window show | `src/App.tsx`, `src-tauri/src/tray.rs` | 🟢 Fixed |
| B-026 | P2 | Tab switch doesn't clear form messages | `src/components/Dashboard.tsx` | 🟢 Fixed |
| B-027 | P3 | Slider NaN risk | `src/components/Dashboard.tsx` | 🟢 Fixed |
| B-028 | P3 | `playKeypadBeep` ignores digit param | `src/services/sound.ts` | 🟢 Fixed |
| B-029 | P3 | Recovery phrase whitespace not normalized | `src/schemas.ts` | 🟢 Fixed |
| B-030 | P2 | Window size hardcoded 900×640 | `src-tauri/src/commands.rs` | 🟢 Fixed |

---

## 8. AI Fix Workflow

When using an AI agent (or human) to address a bug from this audit:

1. **Pick one bug.** Reference the bug ID (e.g. `B-001`) and title.
2. **Read the cited file(s) in full.** Confirm the bug still exists.
3. **Plan the fix.** Describe the diff before writing code.
4. **Implement.** Make the minimal change; preserve all existing behavior.
5. **Test.**
   - For Rust: add a unit test in the file's `#[cfg(test)] mod tests`.
   - For TS: add a vitest test in `src/services/__tests__/` or a `*.test.ts` next to the source.
6. **Update the tracker.** Change the row's status from 🔴 → 🟡 → 🟢.
7. **Update the README** with a short note: "Latest changes" section listing the closed bug IDs and a one-line description per fix. Use date-stamped sections.

### Bug Fix Template (copy-paste into commit / PR)

```md
## Fix B-XXX: <Title>

**Files touched:**
- `<path/to/file>` — what changed

**Behavior change:**
- Before: ...
- After: ...

**Tests added:**
- `<test path>` — covers ...

**Closes:** B-XXX
```

### Verification Checklist (per fix)
- [ ] Original bug reproducer is no longer reproducible
- [ ] No regression in adjacent code paths
- [ ] Existing tests still pass (`bun test` / `cargo test`)
- [ ] TypeScript `bun run lint` passes
- [ ] `cargo clippy` has no new warnings
- [ ] Bug tracker row updated to 🟢
- [ ] README "Latest changes" updated

---

## Appendix A — Files Audited

**Backend (Rust):**
- `src-tauri/Cargo.toml`
- `src-tauri/build.rs`
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/error.rs`
- `src-tauri/src/crypto.rs`
- `src-tauri/src/vault.rs`
- `src-tauri/src/keyring_store.rs`
- `src-tauri/src/stronghold_store.rs`
- `src-tauri/src/db.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/tray.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/desktop.json`

**Frontend (TypeScript / SolidJS):**
- `src/App.tsx`, `src/index.tsx`, `src/types.ts`, `src/schemas.ts`
- `src/lib/utils.ts`, `src/vite-env.d.ts`
- `src/services/tauriBridge.ts`, `src/services/sound.ts`, `src/services/updater.ts`
- `src/components/TitleBar.tsx`, `src/components/Dashboard.tsx`
- `src/components/ShieldOverlay.tsx`, `src/components/LockIconWidget.tsx`
- `src/components/UnlockModal.tsx`, `src/components/RecoveryModal.tsx`
- `src/components/InitialSetupModal.tsx`
- `src/components/ui/{tooltip,select,button,badge,tabs,card}.tsx`
- `tsconfig.json`, `package.json`

**Files NOT audited (out of scope / generated):**
- `src-tauri/target/**` — build artifacts
- `node_modules/**` — third-party
- `dist/**` — frontend build output
- `src-tauri/gen/schemas/**` — auto-generated

---

## Appendix B — Methodology

Each finding was discovered by **reading the cited code line-by-line** during a single pass through the project tree. The audit does not execute the application, fuzz inputs, or run static analysis tools. Some defects may be intentional design choices that an experienced reader would recognize; they are still listed for completeness, marked with severity and rationale so a maintainer can decide whether to fix or accept.

**Threat model assumed:**
- Adversary has physical access to the unlocked computer.
- Adversary can submit arbitrary `invoke()` calls if a vulnerability allows.
- Adversary can read the app data directory if disk encryption is absent.
- The user (parent/owner) is the only authorized actor.
- "Toddler" use case: random physical input from a child who should not be able to unlock.

---

*End of audit. Begin triage in the order: B-001 → B-007 → B-013 → B-016 (P0 first), then P1 batch, then P2/P3 as polish.*

---

## 9. Round-2 Deep Audit (new findings)

A second pass focused on: (a) **array/object null guards before render**, (b) **assumed Rust behavior that does not exist**, (c) **RAM-resident credentials re-used after unlock**, (d) **race conditions and async ordering**, (e) **toddler-evasion paths**. Twenty-five additional defects.

### 9.1 Critical — Authentication & State

#### B-031 [P0] Unlocked state re-uses last successful credential implicitly
**File:** `src/App.tsx` lines 121–145
`handleUnlock(credential, action)` receives a `credential: string` and passes it to both `unlockShield` and `requestHideWindow` / `requestCloseWindow` (which **also verify the credential server-side**). After unlock, `credential` is in the closure scope until the function returns. The user reports: *"sometime after i unlock it, again instantly lock it..its password is in ram or in variable, thus i can click unlock without reenter sometimes"*.

What's happening: the unlock modal sets `setIsUnlockModalOpen(false)` only inside a `setTimeout(..., 500)` (line 137–140). During that 500ms window, the modal is **still rendered with `isOpen=true`** and the digits typed previously may still be in `pin()`. If the shield auto-relocks (e.g. via a missed tray event, or a clock skew, or a future auto-lock feature), the modal re-displays with **stale, valid digits already filled in** — pressing Unlock unlocks again with no re-entry.

**Reproduction (logical):**
1. Set PIN `1234`
2. Lock the shield
3. Click lock icon → modal opens
4. Type `1234`, hit Enter → unlock succeeds, modal closes
5. (Hypothetical) Shield auto-relocks within 500ms → `handleUnlock` finishes its setTimeout → modal state has `pin() === "1234"` (wait, `setPin("")` is called on failure in UnlockModal line 63, but **not on success**)
6. User sees the modal reopen with `1234` already entered → Enter unlocks again

**Fix:** Clear `pin()` / `password()` on success in `UnlockModal.submitUnlock` (line 56–59). Or use a signal reset on close via `createEffect`.

---

#### B-032 [P0] `handleUnlock` ignores `request_hide_window` / `request_close_window` errors
**File:** `src/App.tsx` lines 130–135
After `unlockShield` succeeds, if `requestHideWindow(credential)` or `requestCloseWindow(credential)` throws, the function re-throws via `throw err` (line 143), but the shield state is already unlocked — the error is uncaught at the call site (`UnlockModal.submitUnlock` line 56). The modal still shows the success animation because `setIsSuccess(true)` ran on line 58. The user thinks the action succeeded, but it didn't.

**Fix:** Await the secondary action separately and surface its error distinctly; don't conflate unlock success with hide/close success.

---

#### B-033 [P0] `change_pin` re-uses the new PIN as `currentCredential` for next change
**File:** `src-tauri/src/vault.rs` lines 182–195
`change_pin(current_credential, new_pin)` calls `verify_credential(current_credential)` then immediately hashes and stores `new_pin`. But the **next** time `change_pin` is called (e.g. user changes PIN, then immediately changes again), the frontend's `currentCred` field defaults to empty. There's no confusion here — but `verify_credential` accepts **both PIN and master password**, so after the first change, the user's *new* PIN works as the current credential. This is intentional, but a **mis-feature** because:
- A user who set their master to `apple123` and PIN to `1234` changes PIN to `5678`
- Now `5678` unlocks. The master `apple123` still works. ✅
- But if the user expected `change_pin` to require the master (only), they have a **false sense of security** — the previous PIN is still valid until next successful `change_pin`. The intent of `change_pin` is ambiguous.

**Fix:** Require explicit "current PIN" (not master) for `change_pin`, or rename the field to clarify.

---

#### B-034 [P0] Tray "Lock" fires from anywhere without confirmation → DoS
**File:** `src-tauri/src/tray.rs` lines 60–67, `src/App.tsx` lines 91–93
Already noted as B-005 in round 1. **Round-2 detail:** the tray click on `lock` calls `window.show()`, `unminimize`, `set_focus`, then `emit("tray-lock-request")`. The frontend `handleLockNow` calls `lockShield()` which sets `is_locked = true`. So a malicious script that can fire IPC events (theoretical — would require XSS via CSP-null, see B-016) could `emit("tray-lock-request")` repeatedly, **locking the user out**. Since unlock requires a password, this is a denial-of-service via lock-spam. **Severity upgraded to P0.**

**Fix:** Add a tray-side debounce (only allow one lock per second) and require tray to be the source.

---

#### B-035 [P0] `request_close_window` and `request_hide_window` always succeed when not locked
**File:** `src-tauri/src/commands.rs` lines 203–227, 229–248
When `is_locked == false`, both commands skip the credential check and call `window.close()` / `window.hide()`. The frontend `handleCloseRequest` (App.tsx line 171) calls `requestHideWindow()` **without** a credential when unlocked. This is by design (title bar's close-to-tray).

**But:** `request_close_window` is invoked from `UnlockModal` (UnlockModal.tsx line 348) with a credential. If `is_locked == false` at the time of the command (state desync — see B-007), the window closes **without verifying the credential**. A race: user clicks "Quit" in the unlock modal between the unlock succeeding and the frontend updating `status().is_locked` — the modal's `submitUnlock("close")` calls `requestCloseWindow(credential)`. Backend sees `is_locked == false`, ignores credential, closes window. The user effectively quits without re-confirming.

**Fix:** Always verify credential in `request_close_window` regardless of lock state.

---

### 9.2 Concurrency & Async Bugs

#### B-036 [P0] `setStatus(updated)` after `unlockShield` may carry stale `is_locked = true`
**File:** `src/App.tsx` lines 128–129, `src-tauri/src/commands.rs` lines 138–145
`unlockShield` backend does:
1. `verify_credential` (succeeds)
2. Window operations (set_fullscreen(false), etc.)
3. `state.is_locked.store(false, ...)`
4. `record_audit_event`
5. `get_shield_status` — reads `state.is_locked` and returns `ShieldStatus { is_locked: false, ... }`

Step 5 reads the just-set `is_locked`. ✅ correct.

**But** if `record_audit_event` fails (SQLite busy), step 4 errors out and `get_shield_status` is never called. The frontend still shows the unlock modal because `setStatus` never ran. The window is no longer fullscreen (step 2 succeeded) and `is_locked` is false (step 3 ran). The UI is unlocked visually but the modal is still showing. User clicks unlock again → Argon2 verifies the same credential → succeeds → window re-renders. ✅ eventually consistent.

**The real bug:** steps 2 and 3 are not atomic. If step 2 fails (e.g. set_fullscreen errors), step 3 is skipped, `is_locked` stays true, but the audit log records "UNLOCKED". Inconsistent state.

**Fix:** Roll back window state on error, or split: do all window ops first, then atomically flip `is_locked` and write audit. If audit fails, still flip `is_locked` and log the audit error separately.

---

#### B-037 [P1] `lockShield` records audit **before** window ops — wrong event order
**File:** `src-tauri/src/commands.rs` lines 56–96
Order: window.set_fullscreen → window.set_always_on_top → window.set_focus → `is_locked.store(true)` → `keepawake.create()` → **then** `record_audit_event("SHIELD_LOCKED", ...)`.

If `keepawake.create()` fails, audit is never written. If `set_fullscreen` fails, no audit. **Result:** the audit log skips "SHIELD_LOCKED" events when the lock partially failed. Forensic timeline has gaps.

**Fix:** Record audit as the **first** step, then attempt window ops. On failure, record "SHIELD_LOCK_FAILED" with reason.

---

#### B-038 [P1] `is_locked` state is read with `SeqCst` but written with `SeqCst` inconsistently
**File:** `src-tauri/src/lib.rs` line 99, `src-tauri/src/commands.rs` lines 67, 139
All reads/writes use `Ordering::SeqCst` which is the strongest but slowest. No actual bug, but on ARM/x86 mixed systems this is overkill. Low priority — leave it.

**Skip.**

---

#### B-039 [P1] `startLockoutTimer` re-reads `current.lockout_remaining_secs` on each refresh
**File:** `src/App.tsx` lines 47–82
If `refreshStatus` is called multiple times while locked out (e.g. user clicks unlock during lockout → fails → modal closes → no, refreshStatus only runs on mount and from internal calls), the timer is cleared and restarted. The remaining time is recomputed from server, which may have ticked down by 1-2 seconds. The countdown jumps.

**Reproduction:** Wait 25s into a 30s lockout, click anything that triggers `refreshStatus`. The countdown resets to 29s.

**Fix:** Only restart timer if not already running, or compute drift since last tick.

---

#### B-040 [P1] `countdownTimer` in Dashboard also racy
**File:** `src/components/Dashboard.tsx` lines 106–122
`let countdownTimer: ReturnType<typeof setInterval> | null = null;` is module-level. If `startCountdownLock` is called twice quickly (double-click), **two intervals** run, both decrementing the signal. The countdown jumps by 2 per second.

**Fix:** Clear existing timer before setting a new one.

---

#### B-041 [P1] `startCountdownLock` reads stale `countdown()` inside the interval
**File:** `src/components/Dashboard.tsx` lines 110–121
```ts
countdownTimer = setInterval(() => {
  const current = countdown();  // <-- stale read
  if (current === null || current <= 1) {
    ...
    setCountdown(null);
    props.onLockNow();
  } else {
    setCountdown(current - 1);  // <-- uses captured `current`, not the new one
  }
}, 1000);
```
If `cancelCountdown()` runs and sets `countdown` to `null`, the interval's next tick sees `current = null` and the early-return path runs — which calls `props.onLockNow()`. **So cancelling a countdown actually locks the screen immediately.** Confirmed logical bug.

**Reproduction:** Click "Lock in 5s", wait 2s, click "Cancel" → shield locks immediately.

**Fix:** Read `countdown()` and only proceed if it's a number. Use `createSignal` updater form.

---

#### B-042 [P1] `unlistenTrayLock` / `unlistenTrayUpdates` not awaited before cleanup
**File:** `src/App.tsx` lines 84–107
```ts
let unlistenTrayLock: UnlistenFn | null = null;
let unlistenTrayUpdates: UnlistenFn | null = null;

onMount(async () => {
  await refreshStatus();
  try {
    unlistenTrayLock = await listen("tray-lock-request", () => {
      handleLockNow();
    });
    unlistenTrayUpdates = await listen("tray-check-updates", () => {
      updaterService.checkForUpdates(false);
    });
  } catch (e) {
    console.warn(...);
  }
});

onCleanup(() => {
  if (lockoutCountdownTimer) clearInterval(lockoutCountdownTimer);
  if (unlistenTrayLock) unlistenTrayLock();
  if (unlistenTrayUpdates) unlistenTrayUpdates();
});
```

`onMount`'s async function is fire-and-forget. If cleanup runs before `await listen` resolves (very fast HMR or window-close during init), `unlistenTrayLock` is still `null` when cleanup runs — listener leaks. Low risk in production (cleanup only runs on app exit), but real.

**Fix:** Use a `createResource` or store the listener promise in a signal.

---

#### B-043 [P1] `ShieldOverlay` and `LockIconWidget` both listen to `keydown` on `window` capture
**File:** `src/components/ShieldOverlay.tsx` lines 60–68, `src/components/LockIconWidget.tsx` lines 27–39
Both attach `keydown` listeners with `{ capture: true }`. Capture phase means they fire before any other handler. Order between them depends on attachment order. LockIconWidget's `resetIdleTimer` only runs on keydown (no `e.preventDefault`) — non-interfering. ShieldOverlay's `handleKeyDown` blocks Escape/Enter/Space and opens the unlock modal.

**Bug:** if ShieldOverlay unmounts (via `<Show when={is_locked}>`) but the keydown listener isn't removed (because `onCleanup` ran already, fine), then re-mounts, two listeners are attached briefly. During that window, both `handleKeyDown` and the new instance's `handleKeyDown` fire — modal opens twice.

Actually SolidJS `<Show>` toggles DOM, not lifecycle. **The component is mounted once**, listeners attached once. ✅ No bug here. **Skip.**

---

#### B-044 [P1] `UnlockModal` keydown listener attaches on mount, never detaches unless component unmounts
**File:** `src/components/UnlockModal.tsx` lines 100–106
Already noted as B-001. **Round-2 detail:** the listener is registered via `window.addEventListener` — SolidJS's `<Show>` does NOT unmount the component, only hides the DOM. So the listener is **always live**. When the modal is "closed", pressing Enter anywhere in the app still triggers `submitUnlock` if `props.isOpen` happens to be true at the moment of keypress — but `props.isOpen` early-returns, so safe. **But:** the listener captures `props.isOpen` reactively, and the listener closure references `useMasterPassword()` etc. which update. So functionally OK.

**The real risk:** if a user has the modal open, types a PIN, dismisses via clicking outside (which calls `onDismiss`), and then presses Enter elsewhere → no effect. ✅ Safe.

**Skip this round-2.**

---

### 9.3 Frontend Defensive Coding — Array/Object Null Guards

#### B-045 [P0] `recoveryPhrase` from backend could be `undefined` or `""`
**File:** `src/components/Dashboard.tsx` line 836
```tsx
<For each={revealedPhrase()?.split(/\s+/) || []}>
  {(word, idx) => (...)}
</For>
```
Guarded with `?.` and `|| []`. ✅ Safe. **But** if `revealedPhrase() === ""` (empty string), `split(/\s+/)` returns `[""]` — one empty word, idx 0. The render shows one badge with empty text. Visually confusing, no crash.

**Fix:** `revealedPhrase()?.trim().split(/\s+/).filter(Boolean) || []`.

---

#### B-046 [P1] `logs()` set with potentially-undefined array
**File:** `src/components/Dashboard.tsx` lines 246–256
```ts
const entries = await tauriBridge.getAuditLogs(30);
setLogs(entries);
```
If `tauriBridge.getAuditLogs` returns `undefined` (e.g. backend serializes nothing), `setLogs(undefined)` → SolidJS's signal becomes `undefined`. The `<For each={logs()}>` (line 921) with `each={undefined}` — Solid treats undefined as "no items", no render, no crash. ✅ Safe. But type-unsafe.

**Fix:** `setLogs(entries ?? [])`.

---

#### B-047 [P1] `updateInfo?.body` rendered raw
**File:** `src/components/Dashboard.tsx` lines 994–996
```tsx
<Show when={updaterService.state().updateInfo?.body}>
  <p class={clsx(...)}>{updaterService.state().updateInfo?.body}</p>
</Show>
```
The body is rendered as text inside `<p>`. ✅ XSS-safe because Solid escapes by default. **But** if body contains markdown (e.g. `## Features`), it's shown as raw text. UX issue.

**Fix:** Render with a markdown library or strip markdown chars.

---

#### B-048 [P1] `properties.overlay_blur > 0 ? blur(...) : "none"` — what about `properties.overlay_blur === NaN`?
**File:** `src/components/ShieldOverlay.tsx` lines 74–76
If backend sends `overlay_blur: NaN` (somehow), the comparison is `NaN > 0 === false`, so `backdrop-filter: none`. ✅ No crash, but no blur either.

**Fix:** `(Number.isFinite(props.blur) && props.blur > 0) ? ... : "none"`.

---

#### B-049 [P1] `getPositionClasses()` switch missing default but provided
**File:** `src/components/LockIconWidget.tsx` lines 41–53
`switch` covers all 4 cases plus default. The TypeScript type for `position` is `"floating" | "center" | "top-right" | "bottom-right"` (line 6). If a new position is added to the backend but the type isn't updated, this falls through to default. ✅ Safe.

**Skip.**

---

#### B-050 [P1] `currentVersion` from `getVersion()` may be `""` or `undefined`
**File:** `src/services/updater.ts` lines 33–43
```ts
const v = await getVersion();
if (v) {
  setUpdaterState((s) => ({ ...s, currentVersion: v }));
}
```
Guards with `if (v)`. ✅ Safe.

**Skip.**

---

#### B-051 [P1] `localProperties` initial values may not match Rust defaults
**File:** `src/App.tsx` lines 16–28
Frontend default: `overlay_opacity: 0.02, overlay_blur: 0, sound_enabled: true, max_failed_attempts: 5, lockout_duration_secs: 30, keep_awake: true`.

Rust default (`db.rs` lines 27–43): `overlay_opacity: 0.02, overlay_blur: 0, sound_enabled: true, max_failed_attempts: 5, lockout_duration_secs: 30, keep_awake: true`.

✅ Match. **But** if either side changes a default, the other becomes stale. No runtime check.

**Fix:** Single source of truth — let Rust return defaults via `get_shield_status` always; never use a frontend default.

---

#### B-052 [P1] `isOpen` early-return doesn't unregister keydown listener
**File:** `src/components/UnlockModal.tsx` lines 73–106
Same as B-001/B-044. Confirmed not a bug because listener is always attached (acceptable).

**Skip.**

---

#### B-053 [P2] `<For each={revealedPhrase()?.split(/\s+/) || []}>` — `split(/\s+/)` includes trailing empty on whitespace input
**File:** `src/components/Dashboard.tsx` line 836
If backend returns `"word "` (trailing space), `split(/\s+/)` returns `["word", ""]`. The second item renders an empty badge.

**Fix:** Same as B-045.

---

#### B-054 [P2] `tooltip` placement computation runs only on mount
**File:** `src/components/ui/tooltip.tsx` lines 110–122
`updatePlacement` runs on mount, on window resize, on mouse enter, on touch start. **But not on scroll.** If the trigger is inside a scrollable container (e.g. Dashboard tabs), the tooltip placement becomes wrong after scrolling.

**Fix:** Also `window.addEventListener("scroll", updatePlacement, { passive: true, capture: true })`.

---

#### B-055 [P2] `TauriError` thrown with empty `message` from JSON parse fails
**File:** `src/services/tauriBridge.ts` lines 16–32
```ts
if (typeof err === "string") {
  try {
    const parsed = JSON.parse(err);
    if (parsed.code && parsed.message) {
      throw new TauriError(parsed);
    }
  } catch {
    // not JSON string
  }
  throw new TauriError({ code: "GENERAL_ERROR", message: err });
}
```
The inner `try { JSON.parse } catch { /* not JSON */ }` catches **both** JSON.parse errors AND the `throw new TauriError(parsed)`. So if `parsed.code` and `parsed.message` exist, `TauriError` is thrown — but caught by the outer catch — which silently swallows it and throws `GENERAL_ERROR` instead. **Real bug.**

**Fix:** Differentiate catches:
```ts
let parsed: AppErrorPayload | null = null;
try { parsed = JSON.parse(err); } catch { /* not JSON */ }
if (parsed?.code && parsed?.message) {
  throw new TauriError(parsed);
}
throw new TauriError({ code: "GENERAL_ERROR", message: err });
```

---

### 9.4 Backend Rust — Assumed Behavior That Doesn't Exist

#### B-056 [P0] `StrongholdStore` snapshot key is **derived from salt only**, not user password
**File:** `src-tauri/src/lib.rs` lines 53–76, `src-tauri/src/stronghold_store.rs` lines 21–56
The Stronghold vault is encrypted with `Sha256::digest(&raw_salt)` where `raw_salt` is the 32 random bytes from `stronghold_salt.txt`. **Anyone with read access to the Stronghold file + salt file can decrypt the vault offline.**

The Stronghold plugin uses Argon2 internally to derive the snapshot key from the input `key_bytes` — so the input key is hashed again. But the input key itself is fully predictable if you have the salt.

**Threat:** if a user runs Shieldr on a shared computer and another user (or malware) copies `<app_data>/stronghold_salt.txt` + `<app_data>/shieldr.vault`, they can decrypt the vault with a 10-line Rust script using the same Argon2 params.

**Fix:** Make the Stronghold key = `Sha256(master_password || salt)`, requiring the user to enter master password on first launch each session, OR use a hardware-bound key (TPM/Keychain protected).

---

#### B-057 [P1] `verify_credential` returns `Ok(false)` for invalid credentials — leaks info via timing
**File:** `src-tauri/src/vault.rs` lines 91–147
The Argon2 verification is constant-time. **But:** the function checks PIN hash first, then master hash. If PIN is configured but master isn't, the timing differs (only one Argon2 call vs two). A timing attacker could distinguish "PIN-only" from "PIN+master" users.

**Fix:** Always run both Argon2 verifies (against dummy hashes if not configured) to equalize timing.

---

#### B-058 [P1] `validate_recovery_phrase` accepts whitespace-padded input
**File:** `src-tauri/src/crypto.rs` lines 46–48
```rust
pub fn validate_recovery_phrase(phrase: &str) -> bool {
    Mnemonic::parse_normalized(phrase).is_ok()
}
```
`parse_normalized` trims whitespace and lowercases, then validates. ✅ Behaves as expected.

**However,** `compare_phrases` does case-insensitive comparison on word-by-word. If a user enters `"Abandon   ABANDON abandon..."` (mixed case, multiple spaces), `compare_phrases` normalizes via `.split_whitespace()` and `eq_ignore_ascii_case`. ✅ Robust.

**Skip — no bug.**

---

#### B-059 [P1] `bip39::Mnemonic::from_entropy` requires 128/160/192/224/256 bits
**File:** `src-tauri/src/crypto.rs` lines 36–43
```rust
let mut entropy = [0u8; 16]; // 128 bits entropy = 12 words
```
16 bytes = 128 bits ✅. Mnemonic generation works.

**Skip.**

---

#### B-060 [P1] `rand::rng().fill(&mut entropy)` uses OS CSPRNG (via getrandom)
**File:** `src-tauri/src/crypto.rs` line 37
**Assumes** `rand 0.10` defaults to `OsRng`. Let me check: in `rand 0.10`, `rand::rng()` returns a `ThreadRng` which is **not cryptographically secure** by default. **This is a real assumption violation.**

**Verification needed:** in `rand 0.10.x`, `rand::rng()` returns a thread-local RNG seeded from the OS but is documented as "not for cryptographic use" in older versions. In `0.9+`, `rand::rng()` was changed to be CSPRNG by default. The project uses `rand = "0.10.2"` which uses the new API where `rand::rng()` is a CSPRNG. ✅ Probably safe.

**However,** `lib.rs` line 56 does the same: `rand::rng().fill(&mut salt_bytes)` for the Stronghold salt. ✅ Same API, same guarantee.

**Mark as "verify" rather than fix.**

---

#### B-061 [P1] `keepawake::Builder::default()` — assumes default behavior matches our intent
**File:** `src-tauri/src/commands.rs` lines 72–90
`keepawake 0.6.x` defaults to keeping display awake only on macOS, both display+system on Windows/Linux. Documentation varies. The code explicitly sets `.display(true).idle(true).sleep(true)` so this is fine. ✅

**Skip.**

---

#### B-062 [P1] `tauri_plugin_stronghold::Builder::with_argon2(&salt_path)` — assumes the salt file is valid
**File:** `src-tauri/src/lib.rs` line 62
If `stronghold_salt.txt` is corrupted (e.g. 0 bytes, or non-UTF8), the plugin may panic or use empty key. There's no validation.

**Fix:** Read the file, check length == 32, else regenerate + warn user.

---

#### B-063 [P1] `verify_password` ignores candidate with leading/trailing whitespace
**File:** `src-tauri/src/vault.rs` lines 40–41
```rust
let pin_hash = CryptoService::hash_password(pin.trim())?;
```
Hashes trimmed PIN. But `verify_password` (called by `verify_credential`) verifies the raw candidate. So if PIN is `" 1234 "` (with spaces), hashed value is for `"1234"`. User enters `"1234"`, matches. User enters `" 1234"`, no match. **Inconsistent UX.**

**Fix:** Either hash raw and require exact match, or trim before verify too.

---

#### B-064 [P2] `record_audit_event` returns `AppResult<()>` — failed audit silently breaks flows
**File:** `src-tauri/src/vault.rs` lines 64–66, 173–176, etc.
If SQLite is locked, `record_audit_event` returns `Err(Database)`. The caller `setup_security` returns this error to the frontend, **even though the credentials were successfully saved**. The user sees a scary error and assumes their security setup failed.

**Fix:** Log audit failures to stderr but don't propagate them to user-facing flows. Audit is best-effort.

---

#### B-065 [P2] `set_property` uses `INSERT ... ON CONFLICT DO UPDATE` — handles concurrency but no `WHERE` clause on the update
**File:** `src-tauri/src/db.rs` lines 132–141
Fine. SQLite serializes writes via the mutex. ✅

**Skip.**

---

#### B-066 [P2] `i64::MAX` overflow in `(until_utc - now).num_seconds()`
**File:** `src-tauri/src/db.rs` line 276
Same as round-1 B-006. Marked as P3 in round 1. **Round-2 upgrade:** if `locked_until` is set to year 9999, `num_seconds()` overflows i64. Low probability, but worth `saturating_sub`.

---

#### B-067 [P2] `Argon2::default()` uses default params — assumes secure
**File:** `src-tauri/src/crypto.rs` line 15
Argon2id default in `argon2 0.6.x`: `m=19456 (19 MiB), t=2, p=1`. These are reasonable for ~250ms verification on a modern CPU. ✅ Acceptable.

**Skip.**

---

#### B-068 [P2] `keyring::Entry::new(self.service, key)` — assumes service name is valid on all OSes
**File:** `src-tauri/src/keyring_store.rs` lines 23–31
`"com.ahmedtrooper.shieldr"` is a valid reverse-DNS. ✅ On macOS this requires the app's bundle ID to match for proper keychain access; on Linux requires Secret Service. Failure modes are silently swallowed by `let _ = self.keyring.set_secret(...)` in `setup_security`.

**Already noted as B-010.**

---

#### B-069 [P2] `Mutex::lock().unwrap()` in `db.rs` — panics on poisoned mutex
**File:** `src-tauri/src/db.rs` lines 75, 119, 132, etc. (10+ sites)
If any thread panics while holding the SQLite mutex, the mutex becomes poisoned. Subsequent `lock().unwrap()` calls panic. With `panic = "abort"` in Cargo.toml (round-1 B-020), the whole process dies.

**Fix:** Use `lock().expect("sqlite mutex poisoned")` for clarity, or implement a recovery helper.

---

#### B-070 [P2] `Mutex::lock().unwrap()` in `stronghold_store.rs`
**File:** `src-tauri/src/stronghold_store.rs` lines 59, 89, 113
Same as B-069.

---

### 9.5 Toddler-Evasion Paths (UX-level)

#### B-071 [P0] Keyboard combo `Ctrl+Alt+Delete` not intercepted
**File:** `src/components/ShieldOverlay.tsx` lines 45–58
On Windows, `Ctrl+Alt+Delete` is a Secure Attention Sequence handled by the OS — the app cannot intercept it. ✅ Acceptable, but a toddler cannot trigger it.

**However**, `Ctrl+Shift+Esc` (Task Manager on Windows), `Cmd+Tab` (macOS app switcher), `Alt+Tab` (Windows app switcher) ARE interceptable. The current code blocks `Escape`, `Enter`, `Space` but **NOT `Tab`, `Alt`, `Cmd`, `Win`**.

**Fix:** Block all `Tab`, `Meta`, `Alt` keys explicitly.

---

#### B-072 [P0] Mouse middle-click and right-click captured but **forward** scroll events
**File:** `src/components/ShieldOverlay.tsx` lines 30–36, 38–43
Only `pointerdown` and `contextmenu` are intercepted. `wheel` events scroll the underlying app. A toddler dragging a YouTube video to skip ads via scroll wheel — the overlay doesn't block it.

**Fix:** Add `onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}`.

---

#### B-073 [P1] Three-finger trackpad gestures not intercepted
**File:** `src/components/ShieldOverlay.tsx`
macOS trackpad gestures (three-finger swipe = Mission Control / app expose) fire synthetic events that may not trigger `pointerdown`. Not interceptable via DOM.

**Mitigation:** window is fullscreen + always-on-top — gestures won't reveal underlying apps visually.

**Skip.**

---

#### B-074 [P1] Drag-and-drop of files blocked by webview but not by app
**File:** `src/components/ShieldOverlay.tsx`
`pointerdown` blocks the click but **does not** prevent drag-and-drop. If a user drags a file from Explorer onto the locked app, it may be intercepted by Tauri (default behavior: drop into window opens it). Toddler unlikely to drag files, but a curious user could inadvertently drop malware.

**Fix:** `onDragOver={(e) => e.preventDefault()}` and `onDrop={(e) => e.preventDefault()}`.

---

#### B-075 [P1] Mouse leaves the window edge — overlay still covers full screen but cursor shows "resize" on resize borders
**File:** `tauri.conf.json` lines 22–25
`resizable: true` → window has resize handles. When overlay is active, clicking on resize borders triggers resize instead of pointerdown. The overlay is `fixed inset-0` which **does** cover resize borders, so clicks on borders fire overlay's pointerdown. ✅ Safe.

**Skip.**

---

#### B-076 [P1] Power button, sleep button, volume keys — OS-level, not interceptable
Not a bug. Document as accepted risk.

---

#### B-077 [P2] Touch with 5+ fingers may trigger OS-level gestures (iOS-style)
Not applicable on desktop. Skip.

---

#### B-078 [P2] Voice assistants (Cortana, Siri, Google Assistant) wake on "Hey X" — not interceptable
Not a bug. Document as accepted risk.

---

### 9.6 RAM-Resident Credentials

#### B-079 [P0] `verify_credential` receives credential via IPC — lives in memory
**File:** `src-tauri/src/commands.rs` lines 102–111, 203–227, 229–248
The credential string is serialized over IPC, lives in the WebView's V8 heap as a JavaScript string, then in Rust's `String` buffer. After the function returns, the Rust `String` is dropped (zeroed by allocator, not necessarily by us). The JS string is GC'd at some point.

**Risk:** a memory dump could recover the last credential. Mitigation: use `zeroize::Zeroizing<String>` for credential params.

**Fix:** Wrap `credential: String` in `Zeroizing<String>` (already a dep in Cargo.toml).

---

#### B-080 [P1] `setPin("")`, `setPassword("")`, `setRevealMasterPass("")` don't zero memory
**File:** `src/components/UnlockModal.tsx`, `Dashboard.tsx`
JS strings are immutable; setting to `""` allocates a new string. The old string with the credential is GC'd but the memory is not zeroed. In V8, strings are stored contiguously; the GC eventually frees them but the data lingers.

**Mitigation:** Limited — JS engines don't expose zeroize. Use Web Crypto subtle API to derive a key, throw away the original. Document as accepted risk.

---

### 9.7 Updated Bug Tracker

| ID | Sev | Title | File(s) | Status |
|---|---|---|---|---|
| B-031 | P0 | Unlocked state re-uses credential after 500ms timeout | `src/App.tsx` | 🟢 Fixed |
| B-032 | P0 | `handleUnlock` conflates unlock and hide/close errors | `src/App.tsx` | 🟢 Fixed |
| B-033 | P0 | `change_pin` accepts PIN or master as current — ambiguous | `vault.rs` | 🟢 Fixed |
| B-034 | P0 | Tray lock-spam DoS (upgrade of B-005) | `tray.rs`, `App.tsx` | 🟢 Fixed |
| B-035 | P0 | `request_close_window` skips auth when unlocked | `commands.rs` | 🟢 Fixed |
| B-036 | P0 | `unlockShield` non-atomic state + audit | `commands.rs` | 🟢 Fixed |
| B-037 | P1 | `lockShield` records audit after side-effects | `commands.rs` | 🟢 Fixed |
| B-039 | P1 | `startLockoutTimer` jumps on re-entry | `App.tsx` | 🟢 Fixed |
| B-040 | P1 | Dashboard countdown double-interval race | `Dashboard.tsx` | 🟢 Fixed |
| B-041 | P1 | **Cancel countdown → locks immediately** | `Dashboard.tsx` | 🟢 Fixed |
| B-042 | P1 | Tray listener race during init | `App.tsx` | 🟢 Fixed |
| B-045 | P0 | Recovery phrase split may produce empty entries | `Dashboard.tsx` | 🟢 Fixed |
| B-046 | P1 | `setLogs(undefined)` accepted | `Dashboard.tsx` | 🟢 Fixed |
| B-048 | P1 | `overlay_blur` NaN comparison | `ShieldOverlay.tsx` | 🟢 Fixed |
| B-051 | P1 | Frontend/Rust defaults drift silently | `App.tsx`, `db.rs` | 🟢 Fixed |
| B-054 | P2 | Tooltip placement not updated on scroll | `tooltip.tsx` | 🟢 Fixed |
| B-055 | P2 | `TauriError` from JSON.parse silently swallowed | `tauriBridge.ts` | 🟢 Fixed |
| B-056 | P0 | **Stronghold key derived from salt only — offline decrypt** | `lib.rs`, `stronghold_store.rs` | ⚪ Deferred (needs master-prompt UX) |
| B-057 | P1 | `verify_credential` timing leak between PIN-only vs PIN+master | `vault.rs` | 🟢 Fixed |
| B-062 | P1 | Stronghold salt file not validated | `lib.rs` | 🟢 Fixed |
| B-063 | P1 | Hash trims PIN but verify doesn't trim candidate | `vault.rs` | 🟢 Fixed |
| B-064 | P2 | Failed audit propagates as user error | `vault.rs`, `db.rs` | 🟢 Fixed |
| B-066 | P2 | `i64` overflow in lockout time math | `db.rs` | 🟢 Fixed |
| B-069 | P2 | `Mutex::lock().unwrap()` poisons on panic | `db.rs` | 🟢 Fixed |
| B-070 | P2 | Stronghold mutex poison risk | `stronghold_store.rs` | 🟢 Fixed |
| B-071 | P0 | `Ctrl+Shift+Esc`, `Alt+Tab`, `Cmd+Tab` not blocked | `ShieldOverlay.tsx` | 🟢 Fixed |
| B-072 | P0 | Mouse wheel not blocked | `ShieldOverlay.tsx` | 🟢 Fixed |
| B-074 | P1 | Drag-and-drop into locked window | `ShieldOverlay.tsx` | 🟢 Fixed |
| B-079 | P0 | Credential String not zeroized | `commands.rs` | 🟢 Fixed |
| B-080 | P1 | JS credential strings not zeroized | `UnlockModal.tsx`, `Dashboard.tsx` | ⚪ Won't Fix (JS limitation; createEffect reset on modal close mitigates) |
| B-081 | P0 | **Alt+F4 / Super+Q/W/M/H, Ctrl+W bypass the lock** | `shortcut_interceptor.rs` (new), `commands.rs`, `lib.rs`, `App.tsx` | 🟢 Fixed |
| B-082 | P0 | Window can be un-fullscreened/moved while locked | `lib.rs` | 🟢 Fixed |
| B-083 | P1 | Standalone Super/Meta key not blocked | `ShieldOverlay.tsx` | 🟢 Fixed |
| B-084 | P1 | After unlock, app jumps to pre-lock position (top-right) | `commands.rs`, `lib.rs`, `TitleBar.tsx` | 🟢 Fixed |

(30 new findings added; total now **60 defects tracked**.)

---

### 9.9 Round-3 Followups

#### B-084 [P1] After unlock, window jumps to its pre-lock "top-right" position
**File:** `src-tauri/src/commands.rs` (lines 167–195), `src-tauri/src/lib.rs` (builder), `src/components/TitleBar.tsx`

When the user moves the unlocked window to top-right and then locks, the
`tauri-plugin-window-state` plugin (added in round 3 via `bun tauri add
window-state`) auto-saves that position on every move event. On unlock,
`set_fullscreen(false)` releases fullscreen; on Linux GNOME/Wayland the
window sometimes reverts to the last-saved non-fullscreen rect before our
explicit `set_size` + `center()` take effect, leaving the user staring at
a top-right window they didn't intend.

**Fix:**
1. Builder now sets `with_state_flags(SIZE | POSITION | VISIBLE | DECORATIONS)`
   so FULLSCREEN/MAXIMIZED are NOT auto-tracked — the lock screen never
   poisons the saved state with `fullscreen: true`.
2. `unlock_shield` reorders: `set_fullscreen(false)` → `set_always_on_top(false)`
   → `set_size(900×640)` → `center()` → `set_focus()` → `save_window_state(SIZE | POSITION)`,
   so the freshly-centered state is explicitly persisted over anything the
   plugin auto-saved while we were locked.
3. TitleBar buttons get `data-tauri-no-drag` to keep clicks clean; the rest
   of the header retains `data-tauri-drag-region` for window dragging.

---

### 9.8 Round-2 Top-Priority Fix Order

1. **B-041** — Cancel countdown locks screen. **Critical UX bug.** Easy fix.
2. **B-056** — Stronghold key from salt only. **Critical security.** Hard fix (requires master-password unlock at startup).
3. **B-072 + B-071** — Wheel + Alt+Tab not blocked. **Critical toddler evasion.**
4. **B-031** — Credential re-use after unlock. **Critical confusion bug.**
5. **B-079** — Zeroize credentials. **Low effort, high hygiene.**
6. **B-035** — `request_close_window` always verify. **Low effort, high security.**
7. **B-036 + B-037** — Atomic state + audit ordering. **Medium effort, high reliability.**
8. **B-064** — Don't propagate audit errors. **Low effort, UX win.**
9. **B-055** — Fix the swallowed JSON.parse catch. **Low effort, correctness.**
10. **B-040 + B-042** — Clear countdown timer before re-set. **Low effort.**

---

*End of round-2. Total tracked defects: 60. Begin round-3 by hunting for: internationalization issues (RTL languages), multi-monitor edge cases (overlay on secondary display), high-DPI rendering bugs, accessibility (screen reader when locked).*