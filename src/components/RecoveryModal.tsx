import { Component, createSignal, Show } from "solid-js";
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
      <div class="modal-backdrop" onClick={props.onClose}>
        <div class="recovery-card" onClick={(e) => e.stopPropagation()}>
          <div class="recovery-badge">Recovery</div>
          <h2 class="modal-heading">Reset PIN</h2>
          <p class="modal-description">
            Enter your 12-word recovery phrase to set a new PIN.
          </p>

          <Show when={errorMsg()}>
            <div class="error-banner">{errorMsg()}</div>
          </Show>

          <Show when={isSuccess()}>
            <div class="success-banner">✓ PIN reset! Restoring access...</div>
          </Show>

          <form onSubmit={handleReset} class="recovery-form">
            <div class="form-group">
              <div class="label-row">
                <label>12-Word Recovery Phrase</label>
                <span class={`word-counter ${wordCount() === 12 ? "valid" : ""}`}>
                  {wordCount()}/12 words
                </span>
              </div>
              <textarea
                class="recovery-textarea"
                rows={3}
                placeholder="Enter 12 words separated by spaces..."
                value={phraseInput()}
                onInput={(e) => setPhraseInput(e.currentTarget.value)}
                required
              />
            </div>

            <div class="form-grid-2">
              <div class="form-group">
                <label>New PIN (4-8 digits)</label>
                <input
                  type="password"
                  class="form-input"
                  maxLength={8}
                  placeholder="••••"
                  value={newPin()}
                  onInput={(e) => setNewPin(e.currentTarget.value)}
                  required
                />
              </div>

              <div class="form-group">
                <label>Confirm PIN</label>
                <input
                  type="password"
                  class="form-input"
                  maxLength={8}
                  placeholder="••••"
                  value={confirmPin()}
                  onInput={(e) => setConfirmPin(e.currentTarget.value)}
                  required
                />
              </div>
            </div>

            <div class="modal-actions-row">
              <button
                type="button"
                class="secondary-btn"
                onClick={props.onClose}
                disabled={isSubmitting()}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="primary-btn"
                disabled={isSubmitting() || wordCount() !== 12 || newPin().length < 4}
              >
                {isSubmitting() ? "Verifying..." : "Reset PIN & Unlock"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
