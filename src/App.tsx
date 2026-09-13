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

  let lockoutCountdownTimer: ReturnType<typeof setInterval> | null = null;

  const refreshStatus = async () => {
    try {
      const current = await tauriBridge.getShieldStatus();
      setStatus(current);
      sound.setEnabled(current.properties.sound_enabled);

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

  const startLockoutTimer = (initialSecs: number) => {
    if (lockoutCountdownTimer) clearInterval(lockoutCountdownTimer);
    let remaining = initialSecs;

    lockoutCountdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(lockoutCountdownTimer!);
        lockoutCountdownTimer = null;
        refreshStatus();
      } else {
        setStatus((prev) => ({
          ...prev,
          lockout_remaining_secs: remaining,
        }));
      }
    }, 1000);
  };

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
      console.warn("Tray event listeners registration failed:", e);
    }
  });

  onCleanup(() => {
    if (lockoutCountdownTimer) clearInterval(lockoutCountdownTimer);
    if (unlistenTrayLock) unlistenTrayLock();
    if (unlistenTrayUpdates) unlistenTrayUpdates();
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
  const handleUnlock = async (
    credential: string,
    action: "unlock" | "hide" | "close" = "unlock"
  ) => {
    setIsUnlocking(true);
    try {
      const updated = await tauriBridge.unlockShield(credential);
      setStatus(updated);

      if (action === "hide") {
        await tauriBridge.requestHideWindow(credential);
      } else if (action === "close") {
        await tauriBridge.requestCloseWindow(credential);
      }

      setTimeout(() => {
        setIsUnlocking(false);
        setIsUnlockModalOpen(false);
      }, 500);
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

  // Window close request (enforces password when locked)
  const handleCloseRequest = async () => {
    if (status().is_locked) {
      setIsUnlockModalOpen(true);
    } else {
      try {
        await tauriBridge.requestCloseWindow();
      } catch (e) {
        console.error("Failed to close window:", e);
      }
    }
  };

  return (
    <main
      class={clsx(
        "w-full h-full min-h-0 relative flex flex-col overflow-hidden",
        status().is_locked
          ? "!bg-transparent"
          : "bg-slate-950 bg-[radial-gradient(circle_at_15%_15%,rgba(59,130,246,0.10)_0%,transparent_50%),radial-gradient(circle_at_85%_85%,rgba(16,185,129,0.07)_0%,transparent_50%),radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.05)_0%,transparent_65%)]"
      )}
    >
      {/* Frameless Custom Titlebar (Shown when Unlocked) */}
      <Show when={!status().is_locked}>
        <TitleBar
          isLocked={status().is_locked}
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
