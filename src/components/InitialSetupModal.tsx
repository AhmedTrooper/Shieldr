import { Component, createEffect, createSignal, For, Show } from "solid-js";
import { clsx } from "clsx";
import { ArrowRight, Check, Copy, KeyRound, ScrollText, ShieldCheck } from "lucide-solid";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sound } from "../services/sound";
import { SetupSecuritySchema } from "../schemas";
import { Tooltip } from "./ui/tooltip";

interface InitialSetupModalProps {
  isOpen: boolean;
  onComplete: (pin: string, masterPassword: string) => Promise<string>;
  onDismiss: () => void;
}

export const InitialSetupModal: Component<InitialSetupModalProps> = (props) => {
  const [step, setStep] = createSignal<1 | 2>(1);
  const [pin, setPin] = createSignal("");
  const [confirmPin, setConfirmPin] = createSignal("");
  const [masterPassword, setMasterPassword] = createSignal("");
  const [recoveryPhrase, setRecoveryPhrase] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const [hasCopiedPhrase, setHasCopiedPhrase] = createSignal(false);
  const [confirmedBackup, setConfirmedBackup] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);

  // B-024: Clear phrase and sensitive credentials when modal closes
  createEffect(() => {
    if (!props.isOpen) {
      setPin("");
      setConfirmPin("");
      setMasterPassword("");
      setRecoveryPhrase("");
      setCopied(false);
      setHasCopiedPhrase(false);
      setConfirmedBackup(false);
      setErrorMsg(null);
      setStep(1);
    }
  });

  const handleStep1Submit = async (e: Event) => {
    e.preventDefault();
    setErrorMsg(null);

    const validation = SetupSecuritySchema.safeParse({
      pin: pin(),
      confirmPin: confirmPin(),
      masterPassword: masterPassword(),
    });

    if (!validation.success) {
      setErrorMsg(validation.error.issues[0]?.message || "Validation failed");
      sound.playErrorBuzz();
      return;
    }

    setIsSubmitting(true);
    try {
      const phrase = await props.onComplete(pin(), masterPassword());
      setRecoveryPhrase(phrase);
      setStep(2);
      sound.playLockSound();
    } catch (err: unknown) {
      sound.playErrorBuzz();
      setErrorMsg(err instanceof Error ? err.message : "Failed to initialize security vault");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = async () => {
    const phrase = recoveryPhrase().trim();
    if (!phrase) return;

    try {
      await writeText(phrase);
    } catch (e) {
      console.warn("Tauri clipboard plugin error, using navigator.clipboard fallback", e);
      await navigator.clipboard.writeText(phrase);
    }

    setHasCopiedPhrase(true);
    setCopied(true);
    setErrorMsg(null);
    sound.playKeypadBeep();
    setTimeout(() => setCopied(false), 2500);
  };

  const handleFinish = () => {
    if (!hasCopiedPhrase()) {
      sound.playErrorBuzz();
      setErrorMsg("Security Requirement: You must copy your 12-word recovery phrase to clipboard before proceeding.");
      return;
    }

    if (!confirmedBackup()) {
      sound.playErrorBuzz();
      setErrorMsg("Please check the confirmation box acknowledging you saved your phrase.");
      return;
    }

    sound.playUnlockSound();
    props.onDismiss();
  };

  const words = () => recoveryPhrase().split(/\s+/).filter(Boolean);

  return (
    <Show when={props.isOpen}>
      <div
        class={clsx(
          "fixed inset-0 w-full h-full bg-black/80 backdrop-blur-md z-[1100]",
          "flex justify-center items-start overflow-y-auto overflow-x-hidden p-2 sm:p-4 box-border animate-[fadeIn_0.2s_ease-out]"
        )}
      >
        <div
          class={clsx(
            "my-auto w-full max-w-[400px] sm:max-w-[420px] max-h-[calc(100vh-16px)] min-h-0",
            "flex flex-col items-center overflow-y-auto overflow-x-hidden box-border",
            "bg-slate-900/95 border border-white/15 rounded-2xl shadow-2xl shadow-black/80 p-4 sm:p-5 md:p-6 relative",
            "animate-[cardPop_0.22s_cubic-bezier(0.16,1,0.3,1)]"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Show when={step() === 1}>
            <div class={clsx("flex flex-col items-center text-center mb-3.5")}>
              <div class={clsx("w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-2 shadow-inner")}>
                <ShieldCheck size={22} class={clsx("text-blue-400")} />
              </div>
              <h2 class={clsx("text-base sm:text-lg font-bold text-zinc-100 mb-0.5 tracking-tight")}>Set Up Shieldr</h2>
              <p class={clsx("text-xs text-zinc-400 max-w-[320px] leading-relaxed")}>
                Configure your screen lock PIN and master password.
              </p>
            </div>

            <Show when={errorMsg()}>
              <div class={clsx("w-full bg-red-500/15 border border-red-500/30 text-red-300 py-2 px-3 rounded-lg text-xs mb-3 text-center")}>
                {errorMsg()}
              </div>
            </Show>

            <form onSubmit={handleStep1Submit} class={clsx("w-full flex flex-col gap-2.5")}>
              <div class={clsx("grid grid-cols-1 sm:grid-cols-2 gap-2 w-full")}>
                <div class={clsx("flex flex-col gap-1.5")}>
                  <label class={clsx("text-xs font-semibold text-slate-200")}>Security PIN</label>
                  <input
                    type="password"
                    class={clsx(
                      "w-full h-10 min-h-[40px] px-3 rounded-lg bg-slate-950/70 border border-white/15 hover:border-white/25 focus:border-blue-500 focus:outline-none",
                      "text-xs text-zinc-100 placeholder:text-zinc-500 tracking-widest text-center transition-colors"
                    )}
                    maxLength={8}
                    placeholder="4-8 digits"
                    value={pin()}
                    onInput={(e) => setPin(e.currentTarget.value)}
                    required
                    autofocus
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
                    placeholder="Repeat PIN"
                    value={confirmPin()}
                    onInput={(e) => setConfirmPin(e.currentTarget.value)}
                    required
                  />
                </div>
              </div>
              <span class={clsx("text-[11px] text-zinc-400 -mt-1")}>4-8 digit numeric PIN for quick unlock.</span>

              <div class={clsx("flex flex-col gap-1.5")}>
                <label class={clsx("text-xs font-semibold text-slate-200")}>Master Password</label>
                <input
                  type="password"
                  class={clsx(
                    "w-full h-10 min-h-[40px] px-3 rounded-lg bg-slate-950/70 border border-white/15 hover:border-white/25 focus:border-blue-500 focus:outline-none",
                    "text-xs text-zinc-100 placeholder:text-zinc-500 transition-colors"
                  )}
                  placeholder="At least 6 characters..."
                  value={masterPassword()}
                  onInput={(e) => setMasterPassword(e.currentTarget.value)}
                  required
                />
                <span class={clsx("text-[11px] text-zinc-400 -mt-0.5")}>
                  Fallback password to unlock or reset PIN.
                </span>
              </div>

              <div class={clsx("w-full p-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-zinc-300 flex items-center gap-2")}>
                <KeyRound size={14} class={clsx("text-emerald-400 shrink-0")} />
                <span>
                  Credentials are encrypted in <strong>OS Keyring</strong>.
                </span>
              </div>

              <button
                type="submit"
                class={clsx(
                  "w-full h-10 min-h-[40px] px-4 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 active:scale-[0.985]",
                  "text-white text-xs font-semibold tracking-tight shadow-lg shadow-blue-500/25 border border-blue-400/35 transition-all",
                  "flex items-center justify-center gap-2 cursor-pointer disabled:opacity-45 disabled:pointer-events-none disabled:shadow-none mt-1"
                )}
                disabled={isSubmitting() || pin().length < 4 || masterPassword().length < 6}
              >
                <span>{isSubmitting() ? "Creating Vault..." : "Continue"}</span>
                <ArrowRight size={14} />
              </button>
            </form>
          </Show>

          <Show when={step() === 2}>
            <div class={clsx("flex flex-col items-center text-center mb-3")}>
              <div class={clsx("w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-2 shadow-inner")}>
                <ScrollText size={22} class={clsx("text-amber-400")} />
              </div>
              <h2 class={clsx("text-base sm:text-lg font-bold text-zinc-100 mb-0.5 tracking-tight")}>Recovery Phrase</h2>
              <p class={clsx("text-xs text-zinc-400 max-w-[320px] leading-relaxed")}>
                Save this 12-word phrase to restore access if you forget your credentials.
              </p>
            </div>

            <Show when={errorMsg()}>
              <div class={clsx("w-full bg-red-500/15 border border-red-500/30 text-red-300 py-2 px-3 rounded-lg text-xs mb-3 text-center")}>
                {errorMsg()}
              </div>
            </Show>

            <div class={clsx("grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2 w-full mb-3")}>
              <For each={words()}>
                {(word, idx) => (
                  <div class={clsx("flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-slate-950/70 border border-white/10 shadow-sm")}>
                    <span class={clsx("text-[11px] font-mono font-bold text-slate-400 w-5 text-right")}>{idx() + 1}.</span>
                    <span class={clsx("text-xs font-mono font-medium text-slate-200 truncate")}>{word}</span>
                  </div>
                )}
              </For>
            </div>

            <div class={clsx("w-full flex justify-center mb-3")}>
              <Tooltip content="Copy 12-word recovery phrase" placement="top" class={clsx("w-full flex")}>
                <button
                  type="button"
                  class={clsx(
                    "w-full h-9 min-h-[36px] px-3 rounded-lg border text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer",
                    copied()
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                      : hasCopiedPhrase()
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                      : "border-white/20 bg-white/[0.08] hover:bg-white/[0.15] text-zinc-200 shadow-[0_0_12px_rgba(255,255,255,0.06)]"
                  )}
                  onClick={copyToClipboard}
                  aria-label="Copy Recovery Phrase"
                >
                  {copied() ? (
                    <>
                      <Check size={14} class={clsx("text-emerald-400")} />
                      <span>Copied to Clipboard!</span>
                    </>
                  ) : hasCopiedPhrase() ? (
                    <>
                      <Check size={14} class={clsx("text-emerald-400")} />
                      <span>Phrase Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={14} />
                      <span>Copy 12 Words</span>
                    </>
                  )}
                </button>
              </Tooltip>
            </div>

            <label class={clsx("flex items-start gap-2.5 text-xs text-zinc-400 mb-3.5 cursor-pointer leading-snug select-none")}>
              <input
                type="checkbox"
                class={clsx("mt-0.5 rounded border-white/20 text-blue-600 bg-slate-950 cursor-pointer")}
                checked={confirmedBackup()}
                onChange={(e) => setConfirmedBackup(e.currentTarget.checked)}
              />
              <span>I have safely written down or stored my recovery phrase.</span>
            </label>

            <Tooltip
              content={
                !hasCopiedPhrase()
                  ? "Copy the recovery phrase first"
                  : !confirmedBackup()
                  ? "Check the confirmation box"
                  : "Complete setup and launch Shieldr"
              }
              placement="top"
              class={clsx("w-full flex")}
            >
              <button
                type="button"
                class={clsx(
                  "w-full h-10 min-h-[40px] px-4 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 active:scale-[0.985]",
                  "text-white text-xs font-semibold tracking-tight shadow-lg shadow-blue-500/25 border border-blue-400/35 transition-all",
                  "flex items-center justify-center gap-2 cursor-pointer disabled:opacity-45 disabled:pointer-events-none disabled:shadow-none"
                )}
                disabled={!hasCopiedPhrase() || !confirmedBackup()}
                onClick={handleFinish}
                aria-label="Finish Setup"
              >
                <span>Finish Setup</span>
                <Check size={14} />
              </button>
            </Tooltip>
          </Show>
        </div>
      </div>
    </Show>
  );
};
