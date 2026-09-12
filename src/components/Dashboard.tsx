import { Component, createSignal, For, onMount, Show } from "solid-js";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { AuditLogEntry, ShieldProperties } from "../types";
import { tauriBridge } from "../services/tauriBridge";
import { sound } from "../services/sound";
import {
  ChangePinSchema,
  ChangeMasterPasswordSchema,
  ShieldPropertiesSchema,
} from "../schemas";

interface DashboardProps {
  properties: ShieldProperties;
  onLockNow: () => Promise<void>;
  onPropertiesUpdated: (props: ShieldProperties) => void;
}

export const Dashboard: Component<DashboardProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<"control" | "security" | "display" | "audit">("control");

  // Countdown locking state
  const [countdown, setCountdown] = createSignal<number | null>(null);
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  // Security Form States
  const [currentCred, setCurrentCred] = createSignal("");
  const [newPin, setNewPin] = createSignal("");
  const [pinChangeMsg, setPinChangeMsg] = createSignal<{ type: "success" | "error"; text: string } | null>(null);

  // Master Password Form States
  const [currentMaster, setCurrentMaster] = createSignal("");
  const [newMaster, setNewMaster] = createSignal("");
  const [masterChangeMsg, setMasterChangeMsg] = createSignal<{ type: "success" | "error"; text: string } | null>(null);

  // Recovery Phrase Reveal State
  const [revealMasterPass, setRevealMasterPass] = createSignal("");
  const [revealedPhrase, setRevealedPhrase] = createSignal<string | null>(null);
  const [revealMsg, setRevealMsg] = createSignal<string | null>(null);

  // Display Settings
  const [opacity, setOpacity] = createSignal(props.properties.overlay_opacity);
  const [blur, setBlur] = createSignal(props.properties.overlay_blur);
  const [position, setPosition] = createSignal(props.properties.lock_icon_position);
  const [autohide, setAutohide] = createSignal(props.properties.lock_icon_autohide_secs);
  const [soundEnabled, setSoundEnabled] = createSignal(props.properties.sound_enabled);
  const [saveDisplayMsg, setSaveDisplayMsg] = createSignal<string | null>(null);

  // Audit Logs State
  const [logs, setLogs] = createSignal<AuditLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = createSignal(false);

  const startCountdownLock = () => {
    sound.playKeypadBeep();
    setCountdown(3);
    countdownTimer = setInterval(() => {
      const current = countdown();
      if (current === null || current <= 1) {
        clearInterval(countdownTimer!);
        countdownTimer = null;
        setCountdown(null);
        props.onLockNow();
      } else {
        sound.playKeypadBeep();
        setCountdown(current - 1);
      }
    }, 1000);
  };

  const cancelCountdown = () => {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    setCountdown(null);
  };

  const handleChangePin = async (e: Event) => {
    e.preventDefault();
    setPinChangeMsg(null);

    const validation = ChangePinSchema.safeParse({
      currentCredential: currentCred(),
      newPin: newPin(),
    });

    if (!validation.success) {
      setPinChangeMsg({
        type: "error",
        text: validation.error.issues[0]?.message || "Invalid PIN input.",
      });
      sound.playErrorBuzz();
      return;
    }

    try {
      await tauriBridge.changePin(validation.data.currentCredential, validation.data.newPin);
      sound.playUnlockSound();
      setPinChangeMsg({ type: "success", text: "PIN updated successfully!" });
      setCurrentCred("");
      setNewPin("");
    } catch (err: unknown) {
      sound.playErrorBuzz();
      setPinChangeMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to change PIN",
      });
    }
  };

  const handleChangeMasterPassword = async (e: Event) => {
    e.preventDefault();
    setMasterChangeMsg(null);

    const validation = ChangeMasterPasswordSchema.safeParse({
      currentMaster: currentMaster(),
      newMaster: newMaster(),
    });

    if (!validation.success) {
      setMasterChangeMsg({
        type: "error",
        text: validation.error.issues[0]?.message || "Invalid Master Password input.",
      });
      sound.playErrorBuzz();
      return;
    }

    try {
      await tauriBridge.changeMasterPassword(validation.data.currentMaster, validation.data.newMaster);
      sound.playUnlockSound();
      setMasterChangeMsg({ type: "success", text: "Master Password updated successfully!" });
      setCurrentMaster("");
      setNewMaster("");
    } catch (err: unknown) {
      sound.playErrorBuzz();
      setMasterChangeMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to change Master Password",
      });
    }
  };


  const handleRevealPhrase = async (e: Event) => {
    e.preventDefault();
    setRevealMsg(null);

    try {
      const phrase = await tauriBridge.revealRecoveryPhrase(revealMasterPass());
      setRevealedPhrase(phrase);
      sound.playUnlockSound();
    } catch (err: unknown) {
      sound.playErrorBuzz();
      setRevealMsg(err instanceof Error ? err.message : "Incorrect Master Password");
    }
  };

  const handleSaveDisplayProperties = async () => {
    const rawUpdated = {
      ...props.properties,
      overlay_opacity: opacity(),
      overlay_blur: blur(),
      lock_icon_position: position() as "floating" | "center" | "top-right" | "bottom-right",
      lock_icon_autohide_secs: autohide(),
      sound_enabled: soundEnabled(),
    };

    const parsed = ShieldPropertiesSchema.safeParse(rawUpdated);
    if (!parsed.success) {
      sound.playErrorBuzz();
      setSaveDisplayMsg(parsed.error.issues[0]?.message || "Invalid settings");
      return;
    }

    const updated = parsed.data;
    sound.setEnabled(soundEnabled());
    try {
      await tauriBridge.saveProperties(updated);
      props.onPropertiesUpdated(updated);
      sound.playUnlockSound();
      setSaveDisplayMsg("Display & Behavior settings saved to SQLite!");
      setTimeout(() => setSaveDisplayMsg(null), 2500);
    } catch (err: unknown) {
      sound.playErrorBuzz();
      setSaveDisplayMsg(err instanceof Error ? err.message : "Failed to save settings");
    }
  };


  const loadAuditLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const entries = await tauriBridge.getAuditLogs(30);
      setLogs(entries);
    } catch (e) {
      console.error("Failed to load audit logs:", e);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  onMount(() => {
    loadAuditLogs();
  });

  return (
    <div class="dashboard-shell">
      {/* Tab Navigation */}
      <nav class="dashboard-tabs">
        <button
          type="button"
          class={`tab-btn ${activeTab() === "control" ? "active" : ""}`}
          onClick={() => setActiveTab("control")}
        >
          🛡️ Control Center
        </button>
        <button
          type="button"
          class={`tab-btn ${activeTab() === "display" ? "active" : ""}`}
          onClick={() => setActiveTab("display")}
        >
          🎨 Display & Overlay
        </button>
        <button
          type="button"
          class={`tab-btn ${activeTab() === "security" ? "active" : ""}`}
          onClick={() => setActiveTab("security")}
        >
          🔑 Security & Vault
        </button>
        <button
          type="button"
          class={`tab-btn ${activeTab() === "audit" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("audit");
            loadAuditLogs();
          }}
        >
          📜 SQLite Audit Log
        </button>
      </nav>

      {/* Tab 1: Control Center */}
      <Show when={activeTab() === "control"}>
        <div class="tab-content control-tab">
          <div class="hero-card">
            <div class="hero-left">
              <span class="status-indicator-pill">Ready to Guard</span>
              <h1 class="hero-title">Shield Your Screen</h1>
              <p class="hero-description">
                Locks all clicks, touches, and keyboard shortcuts behind a transparent barrier.
                Videos, cartoons, presentations, or dashboards underneath continue playing unobstructed.
              </p>

              <Show
                when={countdown() !== null}
                fallback={
                  <div class="lock-actions-cluster">
                    <button
                      type="button"
                      class="big-lock-btn"
                      onClick={() => props.onLockNow()}
                    >
                      🔒 Lock Screen Now
                    </button>
                    <button
                      type="button"
                      class="countdown-lock-btn"
                      onClick={startCountdownLock}
                      title="Gives you 3 seconds to switch windows before locking"
                    >
                      ⏳ Lock in 3s Delay
                    </button>
                  </div>
                }
              >
                <div class="countdown-active-box">
                  <div class="countdown-digits">{countdown()}</div>
                  <p class="countdown-hint">
                    Switch to your video or app! Locking screen...
                  </p>
                  <button
                    type="button"
                    class="cancel-countdown-btn"
                    onClick={cancelCountdown}
                  >
                    Cancel
                  </button>
                </div>
              </Show>
            </div>

            <div class="hero-right">
              <div class="spec-card">
                <div class="spec-item">
                  <span class="spec-label">Protection</span>
                  <span class="spec-val">Clicks & Keystrokes Blocked</span>
                </div>
                <div class="spec-item">
                  <span class="spec-label">Overlay Layer</span>
                  <span class="spec-val">
                    {Math.round((1 - props.properties.overlay_opacity) * 100)}% Transparent
                  </span>
                </div>
                <div class="spec-item">
                  <span class="spec-label">Unlock Requirement</span>
                  <span class="spec-val">4-8 Digit PIN or Master Pass</span>
                </div>
                <div class="spec-item">
                  <span class="spec-label">Vault Storage</span>
                  <span class="spec-val text-accent">OS Keyring + Stronghold</span>
                </div>
              </div>
            </div>
          </div>

          <div class="features-grid">
            <div class="feature-tile">
              <div class="tile-icon">👶</div>
              <h3>Toddler & Pet Safe</h3>
              <p>
                All mouse clicks, taps, and drag gestures are intercepted. Pressing Escape, Alt+Tab,
                or Super/Win keys is blocked.
              </p>
            </div>
            <div class="feature-tile">
              <div class="tile-icon">🔒</div>
              <h3>Password to Close</h3>
              <p>
                Neither toddlers nor unauthorized users can close or hide the fullscreen overlay
                without entering the security PIN.
              </p>
            </div>
            <div class="feature-tile">
              <div class="tile-icon">⚡</div>
              <h3>Minimal Lock Widget</h3>
              <p>
                Only a discreet lock icon is visible. It can auto-fade after a few seconds of
                inactivity so your media is completely unobstructed.
              </p>
            </div>
          </div>
        </div>
      </Show>

      {/* Tab 2: Display & Overlay Settings */}
      <Show when={activeTab() === "display"}>
        <div class="tab-content settings-tab">
          <div class="settings-card">
            <div class="card-header">
              <h2>Overlay Transparency & Appearance</h2>
              <p>Configure how transparent the screen guard is and customize the lock icon.</p>
            </div>

            <Show when={saveDisplayMsg()}>
              <div class="success-banner">{saveDisplayMsg()}</div>
            </Show>

            <div class="setting-row">
              <div class="setting-info">
                <label>Screen Transparency Tint</label>
                <span>
                  Lower = completely transparent. Higher = darker tinted frost (Current:{" "}
                  {Math.round(opacity() * 100)}% tint)
                </span>
              </div>
              <div class="setting-control slider-control">
                <input
                  type="range"
                  min="0"
                  max="0.40"
                  step="0.01"
                  value={opacity()}
                  onInput={(e) => setOpacity(parseFloat(e.currentTarget.value))}
                />
                <span class="slider-badge">{Math.round(opacity() * 100)}%</span>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <label>Background Backdrop Blur</label>
                <span>Optional frosted glass effect (0px = zero blur, crystal clear)</span>
              </div>
              <div class="setting-control slider-control">
                <input
                  type="range"
                  min="0"
                  max="12"
                  step="1"
                  value={blur()}
                  onInput={(e) => setBlur(parseInt(e.currentTarget.value, 10))}
                />
                <span class="slider-badge">{blur()}px</span>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <label>Lock Icon Position</label>
                <span>Where the floating padlock should sit when screen is locked</span>
              </div>
              <div class="setting-control">
                <select
                  class="select-input"
                  value={position()}
                  onChange={(e) => setPosition(e.currentTarget.value as any)}
                >
                  <option value="floating">Floating (Top Right Float)</option>
                  <option value="top-right">Top Right Corner</option>
                  <option value="bottom-right">Bottom Right Corner</option>
                  <option value="center">Screen Center</option>
                </select>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <label>Lock Icon Auto-Fade On Idle</label>
                <span>Fades the lock icon to invisible/ghost mode when mouse is stationary</span>
              </div>
              <div class="setting-control">
                <select
                  class="select-input"
                  value={autohide()}
                  onChange={(e) => setAutohide(parseInt(e.currentTarget.value, 10))}
                >
                  <option value="0">Never (Always Visible)</option>
                  <option value="2">After 2 Seconds</option>
                  <option value="3">After 3 Seconds (Recommended)</option>
                  <option value="5">After 5 Seconds</option>
                </select>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <label>Sound Effects</label>
                <span>Mechanical click, unlock arpeggio, and blocked tap feedback</span>
              </div>
              <div class="setting-control">
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    checked={soundEnabled()}
                    onChange={(e) => setSoundEnabled(e.currentTarget.checked)}
                  />
                  <span class="toggle-slider" />
                </label>
              </div>
            </div>

            <div class="card-footer">
              <button
                type="button"
                class="primary-btn"
                onClick={handleSaveDisplayProperties}
              >
                Save Display Settings
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Tab 3: Security & Vault */}
      <Show when={activeTab() === "security"}>
        <div class="tab-content security-tab">
          <div class="two-column-cards">
            {/* Change PIN Card */}
            <div class="settings-card">
              <div class="card-header">
                <h3>Change Security PIN</h3>
                <p>Update your 4-8 digit quick-unlock code.</p>
              </div>

              <Show when={pinChangeMsg()}>
                <div
                  class={
                    pinChangeMsg()?.type === "success"
                      ? "success-banner"
                      : "error-banner"
                  }
                >
                  {pinChangeMsg()?.text}
                </div>
              </Show>

              <form onSubmit={handleChangePin} class="compact-form">
                <div class="form-group">
                  <label>Current PIN or Master Password</label>
                  <input
                    type="password"
                    class="form-input"
                    value={currentCred()}
                    onInput={(e) => setCurrentCred(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="form-group">
                  <label>New PIN (4-8 digits)</label>
                  <input
                    type="password"
                    class="form-input"
                    maxLength={8}
                    value={newPin()}
                    onInput={(e) => setNewPin(e.currentTarget.value)}
                    required
                  />
                </div>
                <button type="submit" class="secondary-btn">
                  Update PIN
                </button>
              </form>
            </div>

            {/* Change Master Password Card */}
            <div class="settings-card">
              <div class="card-header">
                <h3>Change Master Password</h3>
                <p>Emergency alphanumeric key for password resets.</p>
              </div>

              <Show when={masterChangeMsg()}>
                <div
                  class={
                    masterChangeMsg()?.type === "success"
                      ? "success-banner"
                      : "error-banner"
                  }
                >
                  {masterChangeMsg()?.text}
                </div>
              </Show>

              <form onSubmit={handleChangeMasterPassword} class="compact-form">
                <div class="form-group">
                  <label>Current Master Password</label>
                  <input
                    type="password"
                    class="form-input"
                    value={currentMaster()}
                    onInput={(e) => setCurrentMaster(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="form-group">
                  <label>New Master Password (6+ characters)</label>
                  <input
                    type="password"
                    class="form-input"
                    value={newMaster()}
                    onInput={(e) => setNewMaster(e.currentTarget.value)}
                    required
                  />
                </div>
                <button type="submit" class="secondary-btn">
                  Update Master Password
                </button>
              </form>
            </div>
          </div>

          {/* Backup Recovery Phrase Card */}
          <div class="settings-card full-width-card">
            <div class="card-header">
              <h3>Backup 12-Word BIP-39 Recovery Phrase</h3>
              <p>
                To view your seed phrase, confirm your Master Password. Secrets are never stored in SQLite.
              </p>
            </div>

            <Show when={!revealedPhrase()}>
              <form onSubmit={handleRevealPhrase} class="reveal-form">
                <div class="form-group flex-1">
                  <input
                    type="password"
                    class="form-input"
                    placeholder="Enter Master Password to reveal phrase..."
                    value={revealMasterPass()}
                    onInput={(e) => setRevealMasterPass(e.currentTarget.value)}
                    required
                  />
                </div>
                <button type="submit" class="primary-btn">
                  Reveal Recovery Phrase
                </button>
              </form>
              <Show when={revealMsg()}>
                <div class="error-banner">{revealMsg()}</div>
              </Show>
            </Show>

            <Show when={revealedPhrase()}>
              <div class="revealed-phrase-box">
                <div class="mnemonic-grid">
                  <For each={revealedPhrase()?.split(/\s+/) || []}>
                    {(word, idx) => (
                      <div class="mnemonic-word-card">
                        <span class="word-idx">{idx() + 1}</span>
                        <span class="word-text">{word}</span>
                      </div>
                    )}
                  </For>
                </div>
                <button
                  type="button"
                  class="copy-phrase-btn"
                  onClick={async () => {
                    const phrase = revealedPhrase() || "";
                    try {
                      await writeText(phrase);
                    } catch {
                      await navigator.clipboard.writeText(phrase);
                    }
                    sound.playKeypadBeep();
                  }}
                >
                  📋 Copy 12 Words
                </button>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Tab 4: SQLite Audit Log & Metadata */}
      <Show when={activeTab() === "audit"}>
        <div class="tab-content audit-tab">
          <div class="settings-card">
            <div class="card-header flex-between">
              <div>
                <h2>SQLite Security & Audit Logs</h2>
                <p>
                  Demonstrating zero-knowledge property separation: SQLite stores only event logs
                  and properties, never secret values!
                </p>
              </div>
              <button
                type="button"
                class="refresh-btn"
                onClick={loadAuditLogs}
                disabled={isLoadingLogs()}
              >
                🔄 Refresh Logs
              </button>
            </div>

            <div class="audit-table-wrapper">
              <table class="audit-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Event Type</th>
                    <th>Details</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={logs()}>
                    {(entry) => (
                      <tr>
                        <td class="id-col">#{entry.id}</td>
                        <td>
                          <span
                            class={`event-tag ${
                              entry.event_type.includes("SUCCESS") || entry.event_type.includes("UNLOCKED")
                                ? "tag-green"
                                : entry.event_type.includes("FAILED") || entry.event_type.includes("DENIED")
                                ? "tag-red"
                                : "tag-blue"
                            }`}
                          >
                            {entry.event_type}
                          </span>
                        </td>
                        <td class="details-col">{entry.details}</td>
                        <td class="time-col">{new Date(entry.timestamp).toLocaleString()}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
