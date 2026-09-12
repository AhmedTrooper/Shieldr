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
