import { Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { clsx } from "clsx";
import { AlertTriangle, Delete, Eraser, Lock, X } from "lucide-solid";
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
            "my-auto w-full max-w-[340px] sm:max-w-[380px] md:max-w-[400px] max-h-[calc(100vh-16px)] min-h-0",
            "flex flex-col items-center overflow-y-auto overflow-x-hidden box-border",
            "bg-slate-900/95 border border-white/15 rounded-2xl shadow-2xl shadow-black/80 p-4 sm:p-5 md:p-6 gap-2 sm:gap-2.5 relative",
            "animate-[cardPop_0.22s_cubic-bezier(0.16,1,0.3,1)] transition-all",
            isShaking() && "animate-[shakeElastic_0.45s_cubic-bezier(0.36,0.07,0.19,0.97)_both] border-red-500/80",
            isSuccess() && "border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.35)]"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Icon with SVG shackle animation */}
          <div class={clsx("mb-1 sm:mb-1.5 flex items-center justify-center")}>
            <svg
              class={clsx("w-11 h-11 sm:w-12 sm:h-12 text-zinc-300 transition-all duration-350")}
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

          <h2 class={clsx("text-[15px] sm:text-base font-bold text-zinc-100 m-0 text-center tracking-tight")}>
            {isSuccess() ? "Unlocked" : "Enter PIN"}
          </h2>
          <p class={clsx("text-[11px] sm:text-[11.5px] text-zinc-400 m-0 text-center leading-snug")}>
            {isSuccess()
              ? "Restoring access..."
              : "Screen protection is active."}
          </p>

          {/* Lockout banner */}
          <Show when={props.isLockedOut}>
            <div class={clsx(
              "w-full flex items-start gap-2 sm:gap-2.5 bg-red-500/15 border border-red-500/35 rounded-lg",
              "p-2.5 sm:p-3 mt-1 text-red-300"
            )}>
              <AlertTriangle size={18} class={clsx("text-amber-400 shrink-0 mt-px")} />
              <div class="min-w-0 flex-1">
                <strong class={clsx("text-[12px] sm:text-[13px] block text-red-200 font-bold")}>Locked Out</strong>
                <p class={clsx("text-[11px] sm:text-xs text-red-300/90 m-0 mt-0.5 leading-snug")}>
                  Too many attempts. Wait{" "}
                  <span class={clsx("font-bold text-white tabular-nums")}>
                    {props.lockoutRemainingSecs ?? 30}s
                  </span>
                </p>
              </div>
            </div>
          </Show>

          {/* Error Message */}
          <Show when={errorMessage() && !props.isLockedOut}>
            <div class={clsx(
              "w-full bg-red-500/15 border border-red-500/30 text-red-300",
              "py-1.5 px-2.5 sm:px-3 rounded-lg text-[11px] sm:text-xs mt-1 text-center leading-snug"
            )}>
              {errorMessage()}
            </div>
          </Show>

          {/* Standard PIN Mode */}
          <Show when={!useMasterPassword()}>
            {/* PIN Dots Display */}
            <div class={clsx("flex justify-center items-center gap-2.5 sm:gap-3 mt-1")}>
              <For each={[0, 1, 2, 3]}>
                {(idx) => (
                  <div
                    class={clsx(
                      "w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full border border-white/30 bg-transparent transition-all duration-180",
                      pin().length > idx && "bg-blue-500 border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)] scale-115",
                      pin().length === idx && "border-white"
                    )}
                  />
                )}
              </For>
            </div>

            {/* Virtual Numpad — 3×3 digit grid */}
            <div class={clsx("grid grid-cols-3 gap-2 sm:gap-2.5 w-full max-w-[280px] sm:max-w-[300px] mt-1")}>
              <For each={["1", "2", "3", "4", "5", "6", "7", "8", "9"]}>
                {(num) => (
                  <button
                    type="button"
                    class={clsx(
                      "h-11 sm:h-12 min-h-[44px] sm:min-h-[48px] rounded-lg bg-white/[0.06] hover:bg-white/[0.14] active:bg-blue-600 active:scale-95",
                      "border border-white/10 hover:border-white/20 text-zinc-100 text-base sm:text-lg font-semibold cursor-pointer",
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
            </div>

            {/* Bottom action row — Clear | 0 | Backspace */}
            <div class={clsx("flex items-center justify-between gap-2 w-full max-w-[280px] sm:max-w-[300px] mt-2 sm:mt-2.5")}>
              <Tooltip content="Clear entered digits" placement="bottom">
                <button
                  type="button"
                  class={clsx(
                    "shrink-0 inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full",
                    "bg-white/[0.04] hover:bg-red-500/15 active:bg-red-500/25 active:scale-95",
                    "border border-white/15 hover:border-red-500/40 text-zinc-400 hover:text-red-400 cursor-pointer transition-all",
                    "disabled:opacity-40 disabled:pointer-events-none"
                  )}
                  disabled={props.isLockedOut || isSubmitting() || pin().length === 0}
                  onClick={handleClear}
                  aria-label="Clear PIN"
                >
                  <Eraser size={14} class="sm:size-[15px]" />
                </button>
              </Tooltip>

              <button
                type="button"
                class={clsx(
                  "flex-1 h-11 sm:h-12 min-h-[44px] sm:min-h-[48px] rounded-lg bg-white/[0.06] hover:bg-white/[0.14] active:bg-blue-600 active:scale-95",
                  "border border-white/10 hover:border-white/20 text-zinc-100 text-base sm:text-lg font-semibold cursor-pointer",
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
                    "shrink-0 inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full",
                    "bg-white/[0.04] hover:bg-blue-500/15 active:bg-blue-500/25 active:scale-95",
                    "border border-white/15 hover:border-blue-500/40 text-zinc-400 hover:text-blue-400 cursor-pointer transition-all",
                    "disabled:opacity-40 disabled:pointer-events-none"
                  )}
                  disabled={props.isLockedOut || isSubmitting() || pin().length === 0}
                  onClick={handleBackspace}
                  aria-label="Backspace"
                >
                  <Delete size={14} class="sm:size-[15px]" />
                </button>
              </Tooltip>
            </div>
          </Show>

          {/* Master Password Mode */}
          <Show when={useMasterPassword()}>
            <div class={clsx("w-full mt-1")}>
              <input
                type="password"
                class={clsx(
                  "w-full h-11 sm:h-12 px-3 sm:px-3.5 rounded-lg bg-slate-950/70 border border-white/15",
                  "focus:border-blue-500 focus:outline-none text-[13px] sm:text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors"
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
          <div class={clsx("w-full flex flex-col gap-2 sm:gap-2.5 mt-1")}>
            <button
              type="button"
              class={clsx(
                "w-full h-11 sm:h-12 min-h-[44px] sm:min-h-[48px] px-4 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 active:scale-[0.985]",
                "text-white text-[13px] sm:text-sm font-semibold tracking-tight shadow-lg shadow-blue-500/25 border border-blue-400/35 transition-all",
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
              <Lock size={14} class={clsx("sm:size-[15px]", isSubmitting() && "animate-pulse")} />
              <span>{isSubmitting() ? "Verifying..." : "Unlock"}</span>
            </button>

            <div class={clsx("grid grid-cols-2 gap-2 sm:gap-2.5 w-full")}>
              <Tooltip content="Unlock and hide to tray" placement="top">
                <button
                  type="button"
                  class={clsx(
                    "w-full h-10 sm:h-11 min-h-[40px] sm:min-h-[44px] px-2.5 sm:px-3 rounded-lg bg-slate-800/65 hover:bg-slate-700/85 border border-white/15 hover:border-white/25",
                    "text-slate-200 text-[11px] sm:text-xs font-medium cursor-pointer transition-all flex items-center justify-center gap-1.5 whitespace-nowrap",
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
                    "w-full h-10 sm:h-11 min-h-[40px] sm:min-h-[44px] px-2.5 sm:px-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 hover:border-red-500/50",
                    "text-red-400 text-[11px] sm:text-xs font-medium cursor-pointer transition-all flex items-center justify-center gap-1.5 whitespace-nowrap",
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
          <div class={clsx("flex items-center justify-center gap-2 mt-2.5 sm:mt-3 flex-wrap text-[11px] sm:text-xs")}>
            <button
              type="button"
              class={clsx(
                "px-1.5 sm:px-2 py-0.5 rounded-md bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]",
                "cursor-pointer transition-colors"
              )}
              onClick={() => {
                setUseMasterPassword(!useMasterPassword());
                setErrorMessage(null);
              }}
            >
              {useMasterPassword() ? "Use PIN" : "Use Master Password"}
            </button>
            <span class={clsx("text-zinc-600 text-[10px] select-none")}>•</span>
            <button
              type="button"
              class={clsx(
                "px-1.5 sm:px-2 py-0.5 rounded-md bg-transparent text-zinc-300 hover:text-white hover:bg-white/[0.06]",
                "font-medium cursor-pointer transition-colors"
              )}
              onClick={props.onRequestRecovery}
            >
              Forgot PIN?
            </button>
          </div>

          <Tooltip content="Dismiss modal" placement="top">
            <button
              type="button"
              class={clsx(
                "mt-1 sm:mt-1.5 px-2 py-0.5 rounded-md bg-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]",
                "text-[11px] sm:text-xs cursor-pointer transition-colors inline-flex items-center gap-1"
              )}
              onClick={props.onDismiss}
              aria-label="Keep Locked"
            >
              <X size={11} class="sm:size-3" />
              <span>Dismiss</span>
            </button>
          </Tooltip>
        </div>
      </div>
    </Show>
  );
};
