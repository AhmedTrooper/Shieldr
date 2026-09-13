import { Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { clsx } from "clsx";
import { AlertTriangle, Delete, X } from "lucide-solid";
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
      <div
        class={clsx(
          "fixed inset-0 w-full h-full bg-black/80 backdrop-blur-md z-[1100]",
          "flex justify-center items-start overflow-y-auto overflow-x-hidden p-2 sm:p-4 box-border animate-[fadeIn_0.2s_ease-out]"
        )}
        onClick={props.onDismiss}
      >
        <div
          class={clsx(
            "my-auto w-full max-w-[360px] max-h-[calc(100vh-16px)] min-h-0",
            "flex flex-col items-center overflow-y-auto overflow-x-hidden box-border",
            "bg-slate-900/95 border border-white/15 rounded-xl shadow-2xl shadow-black/80 p-3.5 sm:p-4 relative",
            "animate-[cardPop_0.22s_cubic-bezier(0.16,1,0.3,1)] transition-all",
            isShaking() && "animate-[shakeElastic_0.45s_cubic-bezier(0.36,0.07,0.19,0.97)_both] border-red-500/80",
            isSuccess() && "border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.35)]"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Icon with SVG shackle animation */}
          <div class={clsx("mb-2 flex items-center justify-center")}>
            <svg
              class={clsx("w-9 h-9 text-zinc-300 transition-all duration-350")}
              viewBox="0 0 48 48"
              fill="none"
            >
              <path
                class={clsx(
                  "transition-all duration-350 ease-out origin-[16px_22px]",
                  isSuccess() ? "-translate-y-2 rotate-[15deg] text-emerald-400" : "text-zinc-300"
                )}
                d="M16 22V14C16 9.58172 19.5817 6 24 6C28.4183 6 32 9.58172 32 14V22"
                stroke="currentColor"
                stroke-width="4.5"
                stroke-linecap="round"
              />
              <rect
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
                  <stop stop-color={isSuccess() ? "#22c55e" : "#60a5fa"} />
                  <stop offset="1" stop-color={isSuccess() ? "#16a34a" : "#2563eb"} />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <h2 class={clsx("text-base font-bold text-zinc-100 mb-0.5 text-center tracking-tight")}>
            {isSuccess() ? "Unlocked" : "Enter PIN"}
          </h2>
          <p class={clsx("text-[11px] text-zinc-400 mb-2.5 text-center leading-normal")}>
            {isSuccess()
              ? "Restoring access..."
              : "Screen protection is active."}
          </p>

          {/* Lockout banner */}
          <Show when={props.isLockedOut}>
            <div class={clsx("w-full flex items-center gap-2.5 bg-red-500/15 border border-red-500/35 rounded-lg p-2.5 mb-2.5 text-red-300 text-xs")}>
              <AlertTriangle size={18} class={clsx("text-amber-400 shrink-0")} />
              <div>
                <strong>Locked Out</strong>
                <p>
                  Too many attempts. Wait{" "}
                  <span class={clsx("font-bold text-white")}>
                    {props.lockoutRemainingSecs ?? 30}s
                  </span>
                </p>
              </div>
            </div>
          </Show>

          {/* Error Message */}
          <Show when={errorMessage() && !props.isLockedOut}>
            <div class={clsx("w-full bg-red-500/15 border border-red-500/30 text-red-300 py-1.5 px-2.5 rounded-lg text-xs mb-2.5 text-center")}>
              {errorMessage()}
            </div>
          </Show>

          {/* Standard PIN Mode */}
          <Show when={!useMasterPassword()}>
            {/* PIN Dots Display */}
            <div class={clsx("flex justify-center items-center gap-2.5 mb-3")}>
              <For each={[0, 1, 2, 3]}>
                {(idx) => (
                  <div
                    class={clsx(
                      "w-2.5 h-2.5 rounded-full border border-white/30 bg-transparent transition-all duration-180",
                      pin().length > idx && "bg-blue-500 border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)] scale-115",
                      pin().length === idx && "border-white"
                    )}
                  />
                )}
              </For>
            </div>

            {/* Virtual Numpad */}
            <div class={clsx("grid grid-cols-3 gap-1.5 w-full max-w-[250px] mb-2.5")}>
              <For each={["1", "2", "3", "4", "5", "6", "7", "8", "9"]}>
                {(num) => (
                  <button
                    type="button"
                    class={clsx(
                      "h-9 rounded-md bg-white/[0.06] hover:bg-white/[0.14] active:bg-blue-600 active:scale-95",
                      "border border-white/10 hover:border-white/20 text-zinc-100 text-base font-semibold cursor-pointer",
                      "flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all",
                      "disabled:opacity-40 disabled:pointer-events-none"
                    )}
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
                  class={clsx(
                    "h-9 rounded-md bg-white/[0.06] hover:bg-white/[0.14] active:bg-blue-600 active:scale-95",
                    "border border-white/10 hover:border-white/20 text-xs font-semibold text-zinc-400 cursor-pointer",
                    "flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all",
                    "disabled:opacity-40 disabled:pointer-events-none"
                  )}
                  disabled={props.isLockedOut || isSubmitting() || pin().length === 0}
                  onClick={handleClear}
                  aria-label="Clear PIN"
                >
                  C
                </button>
              </Tooltip>
              <button
                type="button"
                class={clsx(
                  "h-9 rounded-md bg-white/[0.06] hover:bg-white/[0.14] active:bg-blue-600 active:scale-95",
                  "border border-white/10 hover:border-white/20 text-zinc-100 text-base font-semibold cursor-pointer",
                  "flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all",
                  "disabled:opacity-40 disabled:pointer-events-none"
                )}
                disabled={props.isLockedOut || isSubmitting()}
                onClick={() => handleDigit("0")}
                aria-label="0"
              >
                0
              </button>
              <Tooltip content="Backspace (delete last digit)" placement="bottom">
                <button
                  type="button"
                  class={clsx(
                    "h-9 rounded-md bg-white/[0.06] hover:bg-white/[0.14] active:bg-blue-600 active:scale-95",
                    "border border-white/10 hover:border-white/20 text-zinc-400 cursor-pointer",
                    "flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all",
                    "disabled:opacity-40 disabled:pointer-events-none"
                  )}
                  disabled={props.isLockedOut || isSubmitting() || pin().length === 0}
                  onClick={handleBackspace}
                  aria-label="Backspace"
                >
                  <Delete size={16} />
                </button>
              </Tooltip>
            </div>
          </Show>

          {/* Master Password Mode */}
          <Show when={useMasterPassword()}>
            <div class={clsx("w-full mb-2.5")}>
              <input
                type="password"
                class={clsx(
                  "w-full h-10 px-3 rounded-lg bg-slate-950/70 border border-white/15",
                  "focus:border-blue-500 focus:outline-none text-xs text-zinc-100 placeholder:text-zinc-500 transition-colors"
                )}
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
          <div class={clsx("w-full flex flex-col gap-1.5")}>
            <button
              type="button"
              class={clsx(
                "w-full h-10 px-4 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 active:scale-[0.985]",
                "text-white text-xs font-semibold tracking-tight shadow-lg shadow-blue-500/25 border border-blue-400/35 transition-all",
                "flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:pointer-events-none disabled:shadow-none"
              )}
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

            <div class={clsx("grid grid-cols-2 gap-1.5 w-full")}>
              <Tooltip content="Unlock and hide to tray" placement="top">
                <button
                  type="button"
                  class={clsx(
                    "w-full h-[34px] px-2.5 rounded-lg bg-slate-800/65 hover:bg-slate-700/85 border border-white/15 hover:border-white/25",
                    "text-slate-200 text-xs font-medium cursor-pointer transition-all flex items-center justify-center gap-1.5 whitespace-nowrap",
                    "shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] disabled:opacity-45 disabled:pointer-events-none"
                  )}
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
                  class={clsx(
                    "w-full h-[34px] px-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 hover:border-red-500/50",
                    "text-red-400 text-xs font-medium cursor-pointer transition-all flex items-center justify-center gap-1.5 whitespace-nowrap",
                    "disabled:opacity-45 disabled:pointer-events-none"
                  )}
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
          <div class={clsx("flex items-center justify-center gap-1.5 mt-2 flex-wrap text-xs")}>
            <button
              type="button"
              class={clsx("bg-transparent border-none text-zinc-400 hover:text-zinc-200 text-xs cursor-pointer transition-colors hover:underline")}
              onClick={() => {
                setUseMasterPassword(!useMasterPassword());
                setErrorMessage(null);
              }}
            >
              {useMasterPassword() ? "Use PIN" : "Use Master Password"}
            </button>
            <span class={clsx("text-zinc-600 text-[9px]")}>•</span>
            <button
              type="button"
              class={clsx("bg-transparent border-none text-zinc-300 hover:text-white text-xs font-medium cursor-pointer transition-colors hover:underline")}
              onClick={props.onRequestRecovery}
            >
              Forgot PIN?
            </button>
          </div>

          <Tooltip content="Dismiss modal" placement="top">
            <button
              type="button"
              class={clsx("mt-1.5 bg-transparent border-none text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer transition-colors inline-flex items-center gap-1")}
              onClick={props.onDismiss}
              aria-label="Keep Locked"
            >
              <X size={12} />
              <span>Dismiss</span>
            </button>
          </Tooltip>
        </div>
      </div>
    </Show>
  );
};
