import { Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { sound } from "../services/sound";
import { Tooltip } from "./ui/tooltip";

interface UnlockModalProps {
  isOpen: boolean;
  isLockedOut: boolean;
  lockoutRemainingSecs: number | null;
  onUnlock: (credential: string, action?: "unlock" | "hide" | "close") => Promise<void>;
  onDismiss: () => void;
  onRequestRecovery: () => void;
}

export const UnlockModal: Component<UnlockModalProps> = (props) => {
  const [pin, setPin] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [useMasterPassword, setUseMasterPassword] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [isShaking, setIsShaking] = createSignal(false);
  const [isSuccess, setIsSuccess] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  const handleDigit = (digit: string) => {
    if (props.isLockedOut || isSubmitting()) return;
    if (pin().length < 8) {
      sound.playKeypadBeep(digit);
      setPin((prev) => prev + digit);
      setErrorMessage(null);
    }
  };

  const handleBackspace = () => {
    if (props.isLockedOut || isSubmitting()) return;
    sound.playKeypadBeep();
    setPin((prev) => prev.slice(0, -1));
    setErrorMessage(null);
  };

  const handleClear = () => {
    sound.playKeypadBeep();
    setPin("");
    setPassword("");
    setErrorMessage(null);
  };

  const submitUnlock = async (action: "unlock" | "hide" | "close" = "unlock") => {
    const cred = useMasterPassword() ? password() : pin();
    if (!cred.trim() || props.isLockedOut || isSubmitting()) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await props.onUnlock(cred.trim(), action);
      // Success! Play unlock animation and sound
      setIsSuccess(true);
      sound.playUnlockSound();
    } catch (err: unknown) {
      sound.playErrorBuzz();
      setIsShaking(true);
      setPin("");
      setPassword("");
      const msg = err instanceof Error ? err.message : "Incorrect PIN or Password";
      setErrorMessage(msg);
      setTimeout(() => setIsShaking(false), 500);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.isOpen) return;

    if (e.key === "Escape") {
      props.onDismiss();
      return;
    }

    if (!useMasterPassword()) {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === "Enter") {
        e.preventDefault();
        submitUnlock("unlock");
      }
    } else {
      if (e.key === "Enter") {
        e.preventDefault();
        submitUnlock("unlock");
      }
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <Show when={props.isOpen}>
      <div class="modal-backdrop" onClick={props.onDismiss}>
        <div
          class={`unlock-card ${isShaking() ? "shake-card" : ""} ${
            isSuccess() ? "success-card" : ""
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Icon with SVG shackle animation */}
          <div class="unlock-icon-wrap">
            <svg
              class={`modal-padlock-svg ${isSuccess() ? "shackle-open" : "shackle-closed"}`}
              viewBox="0 0 48 48"
              fill="none"
            >
              <path
                class="shackle"
                d="M16 22V14C16 9.58172 19.5817 6 24 6C28.4183 6 32 9.58172 32 14V22"
                stroke="currentColor"
                stroke-width="4.5"
                stroke-linecap="round"
              />
              <rect
                class="body"
                x="10"
                y="20"
                width="28"
                height="22"
                rx="6"
                fill="url(#modalBodyGradient)"
                stroke="rgba(255, 255, 255, 0.25)"
                stroke-width="1.5"
              />
              <circle cx="24" cy="29" r="2.5" fill="rgba(0, 0, 0, 0.8)" />
              <path d="M22.8 29.5L22 36H26L25.2 29.5" fill="rgba(0, 0, 0, 0.8)" />
              <defs>
                <linearGradient id="modalBodyGradient" x1="10" y1="20" x2="38" y2="42" gradientUnits="userSpaceOnUse">
                  <stop stop-color={isSuccess() ? "#22c55e" : "#e4e4e7"} />
                  <stop offset="1" stop-color={isSuccess() ? "#16a34a" : "#71717a"} />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <h2 class="unlock-title">
            {isSuccess() ? "Unlocked" : "Enter PIN"}
          </h2>
          <p class="unlock-subtitle">
            {isSuccess()
              ? "Restoring access..."
              : "Screen protection is active."}
          </p>

          {/* Lockout banner */}
          <Show when={props.isLockedOut}>
            <div class="lockout-alert">
              <span class="alert-icon">⚠️</span>
              <div>
                <strong>Locked Out</strong>
                <p>
                  Too many attempts. Wait{" "}
                  <span class="countdown-highlight">
                    {props.lockoutRemainingSecs ?? 30}s
                  </span>
                </p>
              </div>
            </div>
          </Show>

          {/* Error Message */}
          <Show when={errorMessage() && !props.isLockedOut}>
            <div class="error-banner">{errorMessage()}</div>
          </Show>

          {/* Standard PIN Mode */}
          <Show when={!useMasterPassword()}>
            {/* PIN Dots Display */}
            <div class="pin-dots-container">
              <For each={[0, 1, 2, 3]}>
                {(idx) => (
                  <div
                    class={`pin-dot ${
                      pin().length > idx ? "filled" : ""
                    } ${pin().length === idx ? "active" : ""}`}
                  />
                )}
              </For>
            </div>

            {/* Virtual Numpad */}
            <div class="numpad-grid">
              <For each={["1", "2", "3", "4", "5", "6", "7", "8", "9"]}>
                {(num) => (
                  <button
                    type="button"
                    class="numpad-key"
                    disabled={props.isLockedOut || isSubmitting()}
                    onClick={() => handleDigit(num)}
                  >
                    {num}
                  </button>
                )}
              </For>
              <Tooltip content="Clear entered digits" placement="bottom">
                <button
                  type="button"
                  class="numpad-key fn-key"
                  disabled={props.isLockedOut || isSubmitting() || pin().length === 0}
                  onClick={handleClear}
                  aria-label="Clear PIN"
                >
                  C
                </button>
              </Tooltip>
              <button
                type="button"
                class="numpad-key"
                disabled={props.isLockedOut || isSubmitting()}
                onClick={() => handleDigit("0")}
                aria-label="0"
              >
                0
              </button>
              <Tooltip content="Backspace (delete last digit)" placement="bottom">
                <button
                  type="button"
                  class="numpad-key fn-key"
                  disabled={props.isLockedOut || isSubmitting() || pin().length === 0}
                  onClick={handleBackspace}
                  aria-label="Backspace"
                >
                  ⌫
                </button>
              </Tooltip>
            </div>
          </Show>

          {/* Master Password Mode */}
          <Show when={useMasterPassword()}>
            <div class="master-pass-wrap">
              <input
                type="password"
                class="master-input"
                placeholder="Enter Master Password..."
                value={password()}
                onInput={(e) => {
                  setPassword(e.currentTarget.value);
                  setErrorMessage(null);
                }}
                disabled={props.isLockedOut || isSubmitting()}
                autofocus
              />
            </div>
          </Show>

          {/* Primary Unlock Buttons */}
          <div class="action-buttons-stack">
            <button
              type="button"
              class="primary-unlock-btn"
              disabled={
                props.isLockedOut ||
                isSubmitting() ||
                (!useMasterPassword() && pin().length === 0) ||
                (useMasterPassword() && password().length === 0)
              }
              onClick={() => submitUnlock("unlock")}
            >
              {isSubmitting() ? "Verifying..." : "Unlock"}
            </button>

            <div class="secondary-actions-row">
              <Tooltip content="Unlock and hide to tray" placement="top">
                <button
                  type="button"
                  class="action-pill-btn"
                  disabled={props.isLockedOut || isSubmitting()}
                  onClick={() => submitUnlock("hide")}
                  aria-label="Hide to Tray"
                >
                  Hide
                </button>
              </Tooltip>
              <Tooltip content="Unlock and quit application" placement="top">
                <button
                  type="button"
                  class="action-pill-btn danger-pill"
                  disabled={props.isLockedOut || isSubmitting()}
                  onClick={() => submitUnlock("close")}
                  aria-label="Quit Application"
                >
                  Quit
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Bottom Links */}
          <div class="modal-footer-links">
            <button
              type="button"
              class="text-link"
              onClick={() => {
                setUseMasterPassword(!useMasterPassword());
                setErrorMessage(null);
              }}
            >
              {useMasterPassword() ? "Use PIN" : "Use Master Password"}
            </button>
            <span class="link-divider">•</span>
            <button
              type="button"
              class="text-link accent"
              onClick={props.onRequestRecovery}
            >
              Forgot PIN?
            </button>
          </div>

          <Tooltip content="Dismiss modal" placement="top">
            <button
              type="button"
              class="dismiss-shield-btn"
              onClick={props.onDismiss}
              aria-label="Keep Locked"
            >
              ✕ Dismiss
            </button>
          </Tooltip>
        </div>
      </div>
    </Show>
  );
};
