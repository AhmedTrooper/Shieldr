import { Component, createSignal, onCleanup, onMount, Show } from "solid-js";
import { clsx } from "clsx";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ShieldProperties, ShieldStatus } from "./types";
import { tauriBridge } from "./services/tauriBridge";
import { sound } from "./services/sound";
import { updaterService } from "./services/updater";
import { TitleBar } from "./components/TitleBar";
import { LockIconWidget } from "./components/LockIconWidget";
import { ShieldOverlay } from "./components/ShieldOverlay";
import { UnlockModal } from "./components/UnlockModal";
import { RecoveryModal } from "./components/RecoveryModal";
import { InitialSetupModal } from "./components/InitialSetupModal";
import { Dashboard } from "./components/Dashboard";

const defaultProperties: ShieldProperties = {
  overlay_opacity: 0.02,
  overlay_blur: 0,
  lock_icon_position: "floating",
  lock_icon_autohide_secs: 3,
  sound_enabled: true,
  max_failed_attempts: 5,
  lockout_duration_secs: 30,
  has_pin_configured: false,
  has_master_password: false,
  has_reset_phrase: false,
  keep_awake: true,
};

const App: Component = () => {
  const [status, setStatus] = createSignal<ShieldStatus>({
    is_locked: false,
    is_configured: false,
    is_locked_out: false,
    lockout_remaining_secs: null,
    properties: defaultProperties,
  });

  const [isUnlockModalOpen, setIsUnlockModalOpen] = createSignal(false);
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = createSignal(false);
  const [isSetupModalOpen, setIsSetupModalOpen] = createSignal(false);
  const [isShaking, setIsShaking] = createSignal(false);
  const [isUnlocking, setIsUnlocking] = createSignal(false);

  // B-039: A monotonic "end time" stored in a signal so re-entry during a
  // lockout cannot reset the visible countdown to a higher value. The
  // interval computes remaining seconds from the end time on every tick.
  const [lockoutEndAt, setLockoutEndAt] = createSignal<number | null>(null);
  let lockoutCountdownTimer: ReturnType<typeof setInterval> | null = null;

  const refreshStatus = async () => {
    try {
      const current = await tauriBridge.getShieldStatus();
      // B-051: Always trust the Rust-provided properties as the source of
      // truth. Merge them defensively over a fallback so a partial payload
      // doesn't crash renderers that read e.g. `properties.overlay_blur`.
      setStatus((prev) => ({
        ...prev,
        ...current,
        properties: {
          ...defaultProperties,
          ...(prev.properties ?? {}),
          ...(current.properties ?? {}),
        },
      }));
      sound.setEnabled(current.properties?.sound_enabled ?? defaultProperties.sound_enabled);

      if (!current.is_configured) {
        setIsSetupModalOpen(true);
      }

      if (current.is_locked_out && current.lockout_remaining_secs) {
        startLockoutTimer(current.lockout_remaining_secs);
      }
    } catch (e) {
      console.error("Failed to fetch shield status:", e);
    }
  };

  // B-039: Compute the end-of-lockout timestamp once and update only the
  // visible remaining-seconds field on each tick. If `refreshStatus` is
  // re-entered (e.g. user clicks unlock during lockout), the new server
  // value is compared against the existing end time and discarded if it
  // would push the timer backward.
  const startLockoutTimer = (initialSecs: number) => {
    const proposedEnd = Date.now() + initialSecs * 1000;
    const existing = lockoutEndAt();
    if (existing !== null && existing > proposedEnd) {
      // Server reports a shorter window than what we're already counting
      // down — ignore so the UI doesn't jump forward.
      return;
    }
    setLockoutEndAt(proposedEnd);

    if (lockoutCountdownTimer) clearInterval(lockoutCountdownTimer);

    const tick = () => {
      const end = lockoutEndAt();
      if (end === null) {
        if (lockoutCountdownTimer) {
          clearInterval(lockoutCountdownTimer);
          lockoutCountdownTimer = null;
        }
        return;
      }
      const remainingMs = end - Date.now();
      const remainingSecs = Math.max(0, Math.ceil(remainingMs / 1000));
      if (remainingSecs <= 0) {
        if (lockoutCountdownTimer) {
          clearInterval(lockoutCountdownTimer);
          lockoutCountdownTimer = null;
        }
        setLockoutEndAt(null);
        refreshStatus();
        return;
      }
      setStatus((prev) => ({
        ...prev,
        lockout_remaining_secs: remainingSecs,
      }));
    };

    // Run one tick immediately so the visible number is correct.
    tick();
    lockoutCountdownTimer = setInterval(tick, 500);
  };

  let unlistenTrayLock: UnlistenFn | null = null;
  let unlistenTrayUpdates: UnlistenFn | null = null;
  let unlistenEscapeAttempt: UnlistenFn | null = null;
  let unlistenWindowShown: UnlistenFn | null = null;
  const handleWindowFocus = () => {
    if (mounted) refreshStatus();
  };
  // B-042: Track whether the component is still mounted so listeners
  // registered asynchronously can avoid touching signals after onCleanup
  // runs (which happens on window close during init or HMR).
  let mounted = true;

  onMount(async () => {
    try {
      await refreshStatus();
    } finally {
      tauriBridge.closeSplashscreen().catch((err) => {
        console.error("Failed to close splashscreen:", err);
      });
    }
    window.addEventListener("focus", handleWindowFocus);

    try {
      unlistenTrayLock = await listen("tray-lock-request", () => {
        if (mounted) handleLockNow();
      });

      unlistenTrayUpdates = await listen("tray-check-updates", () => {
        if (mounted) updaterService.checkForUpdates(false);
      });

      // B-025: Refresh status when window is revealed from tray
      unlistenWindowShown = await listen("window-shown", () => {
        if (mounted) refreshStatus();
      });

      // B-081: Listen for OS-level escape attempts (Alt+F4, Super+Q/W/M/H, Ctrl+W).
      // The Rust global-shortcut interceptor consumes these keys while locked
      // and emits this event so we can pop the unlock modal.
      unlistenEscapeAttempt = await listen("shield-escape-attempt", () => {
        if (!mounted) return;
        if (status().is_locked && !isUnlockModalOpen()) {
          setIsUnlockModalOpen(true);
        }
      });
    } catch (e) {
      console.warn("Tray / shortcut event listeners registration failed:", e);
    }
  });

  onCleanup(() => {
    mounted = false;
    window.removeEventListener("focus", handleWindowFocus);
    if (lockoutCountdownTimer) clearInterval(lockoutCountdownTimer);
    if (unlistenTrayLock) unlistenTrayLock();
    if (unlistenTrayUpdates) unlistenTrayUpdates();
    if (unlistenEscapeAttempt) unlistenEscapeAttempt();
    if (unlistenWindowShown) unlistenWindowShown();
    setLockoutEndAt(null);
  });


  // Lock Action
  const handleLockNow = async () => {
    try {
      const updated = await tauriBridge.lockShield();
      setStatus(updated);
      sound.playLockSound();
    } catch (e) {
      console.error("Failed to lock shield:", e);
    }
  };

  // Unlock Action
  //
  // B-032: The unlock path and the secondary "hide"/"close" path are now
  // separated. If the credential check fails, we rethrow so the modal can
  // surface the error. If unlock succeeds but the secondary window action
  // fails, we log and surface a soft error WITHOUT rolling back the unlock —
  // the shield is already unlocked, the user should see that as success.
  const handleUnlock = async (
    credential: string,
    action: "unlock" | "hide" | "close" = "unlock"
  ) => {
    setIsUnlocking(true);
    try {
      const updated = await tauriBridge.unlockShield(credential);
      setStatus(updated);

      setTimeout(() => {
        setIsUnlocking(false);
        setIsUnlockModalOpen(false);
      }, 500);

      if (action === "hide") {
        try {
          await tauriBridge.requestHideWindow(credential);
        } catch (e) {
          console.warn("Unlock succeeded but hide-to-tray failed:", e);
        }
      } else if (action === "close") {
        try {
          await tauriBridge.requestCloseWindow(credential);
        } catch (e) {
          console.warn("Unlock succeeded but close-window failed:", e);
        }
      }
    } catch (err) {
      setIsUnlocking(false);
      throw err;
    }
  };

  // Blocked click on locked screen
  const handleBlockedInteraction = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 450);
  };

  // Onboarding setup completion
  const handleSetupComplete = async (pin: string, masterPass: string): Promise<string> => {
    const phrase = await tauriBridge.setupSecurity(pin, masterPass);
    await refreshStatus();
    return phrase;
  };

  // Reset PIN with phrase
  const handleResetWithPhrase = async (phrase: string, newPin: string) => {
    await tauriBridge.resetPinWithPhrase(phrase, newPin);
    await refreshStatus();
    setIsRecoveryModalOpen(false);
    setIsUnlockModalOpen(false);
  };

  // Window close request — TitleBar "close to tray" should always hide,
  // not terminate the app. The TitleBar is only shown when unlocked, so we
  // call the unlocked-only backend command which refuses if locked (B-035).
  const handleCloseRequest = async () => {
    try {
      await tauriBridge.requestHideWindowUnlocked();
    } catch (e) {
      console.error("Failed to hide window to tray:", e);
    }
  };

  return (
    <main
      class={clsx(
        "w-full h-full min-h-0 relative flex flex-col overflow-hidden pb-20",
        status().is_locked
          ? "!bg-transparent"
          : "bg-slate-950 bg-[radial-gradient(circle_at_15%_15%,rgba(59,130,246,0.10)_0%,transparent_50%),radial-gradient(circle_at_85%_85%,rgba(16,185,129,0.07)_0%,transparent_50%),radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.05)_0%,transparent_65%)]"
      )}
    >
      {/* Frameless Custom Titlebar (Shown when Unlocked) */}
      <Show when={!status().is_locked}>
        <TitleBar
          onRequestClose={handleCloseRequest}
        />
      </Show>

      {/* Main Dashboard Control Center (Shown when Unlocked) */}
      <Show when={!status().is_locked}>
        <Dashboard
          status={status()}
          isLocked={status().is_locked}
          properties={status().properties}
          onLockNow={handleLockNow}
          onPropertiesUpdated={(props) => {
            setStatus((prev) => ({ ...prev, properties: props }));
            sound.setEnabled(props.sound_enabled);
          }}
        />
      </Show>

      {/* Locked Mode: Transparent Event-Blocking Overlay */}
      <Show when={status().is_locked}>
        <ShieldOverlay
          opacity={status().properties.overlay_opacity}
          blur={status().properties.overlay_blur}
          onBlockedInteraction={handleBlockedInteraction}
          onUnlockRequest={() => setIsUnlockModalOpen(true)}
        />

        {/* Minimalist Floating Padlock Icon */}
        <LockIconWidget
          isLocked={status().is_locked}
          position={status().properties.lock_icon_position}
          autohideSecs={status().properties.lock_icon_autohide_secs}
          shaking={isShaking()}
          isUnlocking={isUnlocking()}
          onClick={() => {
            sound.playKeypadBeep();
            setIsUnlockModalOpen(true);
          }}
        />
      </Show>

      {/* Unlock PIN / Password Modal */}
      <UnlockModal
        isOpen={isUnlockModalOpen()}
        isLockedOut={status().is_locked_out}
        lockoutRemainingSecs={status().lockout_remaining_secs}
        onUnlock={handleUnlock}
        onDismiss={() => setIsUnlockModalOpen(false)}
        onRequestRecovery={() => {
          setIsUnlockModalOpen(false);
          setIsRecoveryModalOpen(true);
        }}
      />

      {/* 12-Word BIP-39 Recovery Phrase Modal */}
      <RecoveryModal
        isOpen={isRecoveryModalOpen()}
        onReset={handleResetWithPhrase}
        onClose={() => setIsRecoveryModalOpen(false)}
      />

      {/* Initial Onboarding Wizard (First Launch) */}
      <InitialSetupModal
        isOpen={isSetupModalOpen()}
        onComplete={handleSetupComplete}
        onDismiss={() => setIsSetupModalOpen(false)}
      />
    </main>
  );
};

export default App;
