import { Component, createSignal, Show } from "solid-js";
import { clsx } from "clsx";
import { KeyRound } from "lucide-solid";
import { sound } from "../services/sound";
import { RecoveryPhraseResetSchema } from "../schemas";

interface RecoveryModalProps {
  isOpen: boolean;
  onReset: (recoveryPhrase: string, newPin: string) => Promise<void>;
  onClose: () => void;
}

export const RecoveryModal: Component<RecoveryModalProps> = (props) => {
  const [phraseInput, setPhraseInput] = createSignal("");
  const [newPin, setNewPin] = createSignal("");
  const [confirmPin, setConfirmPin] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [isSuccess, setIsSuccess] = createSignal(false);

  const wordCount = () => {
    const trimmed = phraseInput().trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  };

  const handleReset = async (e: Event) => {
    e.preventDefault();
    setErrorMsg(null);

    const validation = RecoveryPhraseResetSchema.safeParse({
      recoveryPhrase: phraseInput().trim(),
      newPin: newPin().trim(),
      confirmPin: confirmPin().trim(),
    });

    if (!validation.success) {
      setErrorMsg(validation.error.issues[0]?.message || "Invalid input");
      sound.playErrorBuzz();
      return;
    }

    setIsSubmitting(true);
    try {
      await props.onReset(validation.data.recoveryPhrase, validation.data.newPin);
      setIsSuccess(true);
      sound.playUnlockSound();
      setTimeout(() => {
        setIsSuccess(false);
        props.onClose();
      }, 1200);
    } catch (err: unknown) {
      sound.playErrorBuzz();
      const msg = err instanceof Error ? err.message : "Invalid recovery phrase or reset failed.";
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Show when={props.isOpen}>
      <div
        class={clsx(
          "fixed inset-0 w-full h-full bg-black/80 backdrop-blur-md z-[1100]",
          "flex justify-center items-start overflow-y-auto overflow-x-hidden p-2 sm:p-4 box-border animate-[fadeIn_0.2s_ease-out]"
        )}
        onClick={props.onClose}
      >
        <div
          class={clsx(
            "my-auto w-full max-w-[400px] sm:max-w-[420px] max-h-[calc(100vh-16px)] min-h-0",
            "flex flex-col items-center overflow-y-auto overflow-x-hidden box-border",
            "bg-slate-900/95 border border-white/15 rounded-2xl shadow-2xl shadow-black/80 p-4 sm:p-5 md:p-6 relative",
            "animate-[cardPop_0.22s_cubic-bezier(0.16,1,0.3,1)] transition-all",
            isSuccess() && "border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.35)]"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 class={clsx("text-base font-bold text-zinc-100 mb-0.5 text-center tracking-tight")}>Reset PIN</h2>
          <p class={clsx("text-xs text-zinc-400 mb-3 text-center leading-relaxed")}>
            Enter your 12-word recovery phrase to set a new PIN.
          </p>

          <Show when={errorMsg()}>
            <div class={clsx("w-full bg-red-500/15 border border-red-500/30 text-red-300 py-2 px-3 rounded-lg text-xs mb-3 text-center")}>
              {errorMsg()}
            </div>
          </Show>

          <Show when={isSuccess()}>
            <div class={clsx("w-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 py-2 px-3 rounded-lg text-xs mb-3 text-center font-medium")}>
              ✓ PIN reset! Restoring access...
            </div>
          </Show>

          <form onSubmit={handleReset} class={clsx("w-full flex flex-col gap-2.5")}>
            <div class={clsx("flex flex-col gap-1.5")}>
              <div class={clsx("flex items-center justify-between")}>
                <label class={clsx("text-xs font-semibold text-slate-200")}>12-Word Recovery Phrase</label>
                <span
                  class={clsx(
                    "text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/[0.06] text-zinc-400 border border-white/10 transition-colors",
                    wordCount() === 12 && "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  )}
                >
                  {wordCount()}/12 words
                </span>
              </div>
              <textarea
                class={clsx(
                  "w-full p-3 rounded-lg bg-slate-950/70 border border-white/15 hover:border-white/25 focus:border-blue-500 focus:outline-none",
                  "text-xs font-mono text-zinc-100 placeholder:text-zinc-500 min-h-[85px] resize-y transition-colors"
                )}
                rows={3}
                placeholder="Enter 12 words separated by spaces..."
                value={phraseInput()}
                onInput={(e) => setPhraseInput(e.currentTarget.value)}
                required
              />
            </div>

            <div class={clsx("grid grid-cols-1 sm:grid-cols-2 gap-2 w-full")}>
              <div class={clsx("flex flex-col gap-1.5")}>
                <label class={clsx("text-xs font-semibold text-slate-200")}>New PIN (4-8 digits)</label>
                <input
                  type="password"
                  class={clsx(
                    "w-full h-10 min-h-[40px] px-3 rounded-lg bg-slate-950/70 border border-white/15 hover:border-white/25 focus:border-blue-500 focus:outline-none",
                    "text-xs text-zinc-100 placeholder:text-zinc-500 tracking-widest text-center transition-colors"
                  )}
                  maxLength={8}
                  minLength={4}
                  pattern="[0-9]{4,8}"
                  inputMode="numeric"
                  placeholder="4-8 digits"
                  value={newPin()}
                  onInput={(e) => setNewPin(e.currentTarget.value)}
                  required
                />
              </div>

              <div class={clsx("flex flex-col gap-1.5")}>
                <label class={clsx("text-xs font-semibold text-slate-200")}>Confirm PIN</label>
                <input
                  type="password"
                  class={clsx(
                    "w-full h-10 min-h-[40px] px-3 rounded-lg bg-slate-950/70 border border-white/15 hover:border-white/25 focus:border-blue-500 focus:outline-none",
                    "text-xs text-zinc-100 placeholder:text-zinc-500 tracking-widest text-center transition-colors"
                  )}
                  maxLength={8}
                  minLength={4}
                  pattern="[0-9]{4,8}"
                  inputMode="numeric"
                  placeholder="Repeat PIN"
                  value={confirmPin()}
                  onInput={(e) => setConfirmPin(e.currentTarget.value)}
                  required
                />
              </div>
            </div>

            <div class={clsx("grid grid-cols-2 gap-2 w-full mt-0.5")}>
              <button
                type="button"
                class={clsx(
                  "w-full h-10 min-h-[40px] px-3 rounded-lg bg-slate-800/65 hover:bg-slate-700/85 border border-white/15 hover:border-white/25",
                  "text-slate-200 text-xs font-semibold cursor-pointer transition-all flex items-center justify-center disabled:opacity-45 disabled:pointer-events-none"
                )}
                onClick={props.onClose}
                disabled={isSubmitting()}
              >
                Cancel
              </button>
              <button
                type="submit"
                class={clsx(
                  "w-full h-10 min-h-[40px] px-3 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 active:scale-[0.985]",
                  "text-white text-xs font-semibold tracking-tight shadow-lg shadow-blue-500/25 border border-blue-400/35 transition-all",
                  "flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:pointer-events-none disabled:shadow-none"
                )}
                disabled={isSubmitting() || wordCount() !== 12 || newPin().length < 4}
              >
                <KeyRound size={14} />
                <span>{isSubmitting() ? "Verifying..." : "Reset & Unlock"}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
