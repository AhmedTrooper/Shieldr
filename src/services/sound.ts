class SoundService {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Crisp mechanical padlock snap sound when locked.
   */
  public playLockSound() {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Metallic click
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.09);

    // Subtle resonance ring
    const ring = ctx.createOscillator();
    const ringGain = ctx.createGain();

    ring.type = "sine";
    ring.frequency.setValueAtTime(880, now + 0.02);
    ringGain.gain.setValueAtTime(0.15, now + 0.02);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    ring.connect(ringGain);
    ringGain.connect(ctx.destination);

    ring.start(now + 0.02);
    ring.stop(now + 0.18);
  }

  /**
   * Gentle, delightful harmonic chord when successfully unlocked.
   */
  public playUnlockSound() {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 arpeggio

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const startTime = now + idx * 0.045;
      const duration = 0.35;

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.2, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    });
  }

  /**
   * Subtle soft click for keypad / keyboard touches.
   */
  public playKeypadBeep(digit?: string | number) {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const num = typeof digit === "number" ? digit : (digit ? parseInt(digit, 10) : NaN);
    const baseFreq = Number.isFinite(num) ? 440 + (num % 10) * 35 : 580;
    osc.type = "sine";
    osc.frequency.setValueAtTime(baseFreq, now);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.04);
  }

  /**
   * Error buzz / shake feedback for wrong password.
   */
  public playErrorBuzz() {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.18);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.19);
  }

  /**
   * Soft feedback when a toddler clicks on the locked screen.
   */
  public playBlockedClickThud() {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.07);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  }
}

export const sound = new SoundService();
