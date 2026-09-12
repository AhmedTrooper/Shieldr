import { Component, createSignal, For, Show } from "solid-js";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sound } from "../services/sound";
import { SetupSecuritySchema } from "../schemas";

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
              <h2 class="modal-heading">Welcome to Shieldr</h2>
              <p class="modal-description">
                Configure your screen lock credentials. Stored in <strong>OS Keyring</strong> & <strong>Stronghold Vault</strong>.
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
              <span class="field-hint">Numeric PIN used for quick touch and numpad unlocking.</span>

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
                  Emergency fallback password to unlock or reset credentials.
                </span>
              </div>

              <div class="storage-notice-box">
                <div class="notice-title">🔐 Zero-Knowledge Vault</div>
                <p>
                  Keys stored in <strong>OS Keyring</strong> & <strong>Stronghold</strong>. SQLite holds settings & audit logs only.
                </p>
              </div>

              <button
                type="submit"
                class="primary-btn full-width"
                disabled={isSubmitting() || pin().length < 4 || masterPassword().length < 6}
              >
                {isSubmitting() ? "Creating Security Vault..." : "Next: Generate Recovery Phrase →"}
              </button>
            </form>
          </Show>

          <Show when={step() === 2}>
            <div class="setup-header">
              <div class="shield-badge-icon">📜</div>
              <h2 class="modal-heading">Backup Recovery Phrase</h2>
              <p class="modal-description">
                You <strong>must copy</strong> this 12-word BIP-39 recovery phrase before you can enter the app.
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
              <button
                type="button"
                class={`copy-phrase-btn ${hasCopiedPhrase() ? "copied-state" : "must-copy-pulse"}`}
                onClick={copyToClipboard}
              >
                {copied()
                  ? "✓ Copied to Clipboard!"
                  : hasCopiedPhrase()
                  ? "✓ Phrase Copied (Click to Copy Again)"
                  : "📋 Step 1: Copy All 12 Words (Required)"}
              </button>
            </div>

            <label class="confirm-checkbox-row">
              <input
                type="checkbox"
                checked={confirmedBackup()}
                onChange={(e) => setConfirmedBackup(e.currentTarget.checked)}
              />
              <span>I have safely written down or stored my recovery phrase.</span>
            </label>

            <button
              type="button"
              class="primary-btn full-width"
              disabled={!hasCopiedPhrase() || !confirmedBackup()}
              onClick={handleFinish}
            >
              {!hasCopiedPhrase()
                ? "⚠️ Copy Phrase to Clipboard to Continue"
                : !confirmedBackup()
                ? "Check Confirmation Box to Continue"
                : "Finish Setup & Launch Shieldr →"}
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
};
