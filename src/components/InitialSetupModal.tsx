import { Component, createSignal, For, Show } from "solid-js";
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
      <div class="modal-backdrop">
        <div class="setup-card" onClick={(e) => e.stopPropagation()}>
          <Show when={step() === 1}>
            <div class="setup-header">
              <div class="shield-badge-icon">🛡️</div>
              <h2 class="modal-heading">Set Up Shieldr</h2>
              <p class="modal-description">
                Configure your screen lock PIN and master password.
              </p>
            </div>

            <Show when={errorMsg()}>
              <div class="error-banner">{errorMsg()}</div>
            </Show>

            <form onSubmit={handleStep1Submit} class="setup-form">
              <div class="form-grid-2">
                <div class="form-group">
                  <label>Security PIN</label>
                  <input
                    type="password"
                    class="form-input"
                    maxLength={8}
                    placeholder="4-8 digits"
                    value={pin()}
                    onInput={(e) => setPin(e.currentTarget.value)}
                    required
                    autofocus
                  />
                </div>

                <div class="form-group">
                  <label>Confirm PIN</label>
                  <input
                    type="password"
                    class="form-input"
                    maxLength={8}
                    placeholder="Repeat PIN"
                    value={confirmPin()}
                    onInput={(e) => setConfirmPin(e.currentTarget.value)}
                    required
                  />
                </div>
              </div>
              <span class="field-hint">4-8 digit numeric PIN for quick unlock.</span>

              <div class="form-group">
                <label>Master Password</label>
                <input
                  type="password"
                  class="form-input"
                  placeholder="At least 6 characters..."
                  value={masterPassword()}
                  onInput={(e) => setMasterPassword(e.currentTarget.value)}
                  required
                />
                <span class="field-hint">
                  Fallback password to unlock or reset PIN.
                </span>
              </div>

              <div class="storage-notice-box">
                <p>
                  Credentials are encrypted in <strong>OS Keyring</strong>.
                </p>
              </div>

              <button
                type="submit"
                class="primary-btn full-width"
                disabled={isSubmitting() || pin().length < 4 || masterPassword().length < 6}
              >
                {isSubmitting() ? "Creating Vault..." : "Continue →"}
              </button>
            </form>
          </Show>

          <Show when={step() === 2}>
            <div class="setup-header">
              <div class="shield-badge-icon">📜</div>
              <h2 class="modal-heading">Recovery Phrase</h2>
              <p class="modal-description">
                Save this 12-word phrase to restore access if you forget your credentials.
              </p>
            </div>

            <Show when={errorMsg()}>
              <div class="error-banner">{errorMsg()}</div>
            </Show>

            <div class="mnemonic-grid">
              <For each={words()}>
                {(word, idx) => (
                  <div class="mnemonic-word-card">
                    <span class="word-idx">{idx() + 1}</span>
                    <span class="word-text">{word}</span>
                  </div>
                )}
              </For>
            </div>

            <div class="copy-bar">
              <Tooltip content="Copy 12-word recovery phrase" placement="top">
                <button
                  type="button"
                  class={`copy-phrase-btn ${hasCopiedPhrase() ? "copied-state" : "must-copy-pulse"}`}
                  onClick={copyToClipboard}
                  aria-label="Copy Recovery Phrase"
                >
                  {copied()
                    ? "✓ Copied to Clipboard!"
                    : hasCopiedPhrase()
                    ? "✓ Phrase Copied"
                    : "📋 Copy 12 Words"}
                </button>
              </Tooltip>
            </div>

            <label class="confirm-checkbox-row">
              <input
                type="checkbox"
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
            >
              <button
                type="button"
                class="primary-btn full-width"
                disabled={!hasCopiedPhrase() || !confirmedBackup()}
                onClick={handleFinish}
                aria-label="Finish Setup"
              >
                Finish Setup
              </button>
            </Tooltip>
          </Show>
        </div>
      </div>
    </Show>
  );
};
