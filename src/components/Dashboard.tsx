import { Component, createSignal, For, onMount, Show } from "solid-js";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Motion } from "@motionone/solid";
import {
  Shield,
  Lock,
  Sliders,
  KeyRound,
  FileText,
  Clock,
  RefreshCw,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  Download,
  ExternalLink,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  Layers,
  Database,
} from "lucide-solid";
import { SiGithub, SiYoutube } from "solid-icons/si";
import { AuditLogEntry, ShieldProperties, ShieldStatus } from "../types";
import { tauriBridge } from "../services/tauriBridge";
import { sound } from "../services/sound";
import { updaterService } from "../services/updater";
import {
  ChangePinSchema,
  ChangeMasterPasswordSchema,
  ShieldPropertiesSchema,
} from "../schemas";
import { Tooltip } from "./ui/tooltip";
import { clsx } from "clsx";

interface DashboardProps {
  status?: ShieldStatus;
  isLocked?: boolean;
  properties: ShieldProperties;
  onLockNow: () => Promise<void>;
  onPropertiesUpdated: (props: ShieldProperties) => void;
}

export const Dashboard: Component<DashboardProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<"control" | "security" | "display" | "audit">("control");

  // Dynamic system status
  const statusLabel = () => {
    if (props.status?.is_locked_out) return "Locked Out";
    if (props.isLocked || props.status?.is_locked) return "Armed";
    if (props.status && !props.status.is_configured) return "Setup Needed";
    return "Ready";
  };

  const statusBadgeClasses = () =>
    clsx(
      "self-start inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider transition-all mb-2.5",
      {
        "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400":
          !props.status?.is_locked_out &&
          !(props.isLocked || props.status?.is_locked) &&
          (props.status?.is_configured ?? true),
        "bg-blue-500/15 border border-blue-500/35 text-blue-400":
          (props.isLocked || props.status?.is_locked) && !props.status?.is_locked_out,
        "bg-red-500/15 border border-red-500/35 text-red-400":
          props.status?.is_locked_out,
        "bg-amber-500/15 border border-amber-500/35 text-amber-400":
          props.status && !props.status.is_configured,
      }
    );

  const statusDotClasses = () =>
    clsx("w-1.5 h-1.5 rounded-full animate-pulse", {
      "bg-emerald-500 shadow-[0_0_8px_#10b981]":
        !props.status?.is_locked_out &&
        !(props.isLocked || props.status?.is_locked) &&
        (props.status?.is_configured ?? true),
      "bg-blue-500 shadow-[0_0_8px_#3b82f6]":
        (props.isLocked || props.status?.is_locked) && !props.status?.is_locked_out,
      "bg-red-500 shadow-[0_0_8px_#ef4444]":
        props.status?.is_locked_out,
      "bg-amber-500 shadow-[0_0_8px_#f59e0b]":
        props.status && !props.status.is_configured,
    });

  const tabBtnClasses = (tab: "control" | "display" | "security" | "audit") =>
    clsx(
      "w-full h-9 sm:h-10 px-2 sm:px-3.5 rounded-lg text-xs sm:text-[13px] font-semibold tracking-tight",
      "inline-flex flex-row items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap cursor-pointer transition-all duration-150 select-none",
      {
        "bg-blue-600 text-white shadow-md shadow-blue-600/30 border border-blue-400/40":
          activeTab() === tab,
        "bg-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] border border-transparent":
          activeTab() !== tab,
      }
    );

  // Countdown locking state (in-memory, never stored)
  const [countdown, setCountdown] = createSignal<number | null>(null);
  const [delaySeconds, setDelaySeconds] = createSignal<number>(5);
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
  const [copiedPhrase, setCopiedPhrase] = createSignal(false);

  // Display Settings
  const [opacity, setOpacity] = createSignal(props.properties.overlay_opacity);
  const [blur, setBlur] = createSignal(props.properties.overlay_blur);
  const [position, setPosition] = createSignal(props.properties.lock_icon_position);
  const [autohide, setAutohide] = createSignal(props.properties.lock_icon_autohide_secs);
  const [soundEnabled, setSoundEnabled] = createSignal(props.properties.sound_enabled);
  const [keepAwake, setKeepAwake] = createSignal(props.properties.keep_awake ?? true);
  const [saveDisplayMsg, setSaveDisplayMsg] = createSignal<string | null>(null);

  // Audit Logs State
  const [logs, setLogs] = createSignal<AuditLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = createSignal(false);

  const startCountdownLock = () => {
    sound.playKeypadBeep();
    const secs = Math.max(1, delaySeconds() || 5);
    setCountdown(secs);
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
      keep_awake: keepAwake(),
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
    <div class={clsx("flex flex-col flex-1 w-full max-w-5xl mx-auto p-3 sm:p-4 md:p-5 gap-3 sm:gap-4 overflow-y-auto min-h-0")}>
      {/* Tab Navigation */}
      <nav class={clsx("flex items-center gap-1 p-1 rounded-xl bg-slate-900/80 border border-white/10 shadow-lg backdrop-blur-md w-full shrink-0")}>
        <Tooltip content="Control center" placement="bottom" class={clsx("flex-1 min-w-0 flex")}>
          <button
            type="button"
            class={tabBtnClasses("control")}
            onClick={() => setActiveTab("control")}
            aria-label="Control Center"
          >
            <Shield size={18} class={clsx("flex-shrink-0")} />
            <span class={clsx("hidden sm:inline")}>Control Center</span>
            <span class={clsx("inline sm:hidden text-[11px]")}>Control</span>
          </button>
        </Tooltip>
        <Tooltip content="Display & overlay" placement="bottom" class={clsx("flex-1 min-w-0 flex")}>
          <button
            type="button"
            class={tabBtnClasses("display")}
            onClick={() => setActiveTab("display")}
            aria-label="Display & Overlay"
          >
            <Sliders size={18} class={clsx("flex-shrink-0")} />
            <span class={clsx("hidden sm:inline")}>Display & Overlay</span>
            <span class={clsx("inline sm:hidden text-[11px]")}>Display</span>
          </button>
        </Tooltip>
        <Tooltip content="Security & vault" placement="bottom" class={clsx("flex-1 min-w-0 flex")}>
          <button
            type="button"
            class={tabBtnClasses("security")}
            onClick={() => setActiveTab("security")}
            aria-label="Security & Vault"
          >
            <KeyRound size={18} class={clsx("flex-shrink-0")} />
            <span class={clsx("hidden sm:inline")}>Security & Vault</span>
            <span class={clsx("inline sm:hidden text-[11px]")}>Security</span>
          </button>
        </Tooltip>
        <Tooltip content="Audit logs" placement="bottom" class={clsx("flex-1 min-w-0 flex")}>
          <button
            type="button"
            class={tabBtnClasses("audit")}
            onClick={() => {
              setActiveTab("audit");
              loadAuditLogs();
            }}
            aria-label="Audit Log"
          >
            <FileText size={18} class={clsx("flex-shrink-0")} />
            <span class={clsx("hidden sm:inline")}>Audit Log</span>
            <span class={clsx("inline sm:hidden text-[11px]")}>Audit</span>
          </button>
        </Tooltip>
      </nav>

      {/* Tab 1: Control Center */}
      <Show when={activeTab() === "control"}>
        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          class={clsx("flex flex-1 flex-col gap-4 min-h-0 pb-6")}
        >
          {/* Screen Protection Card */}
          <div
            class={clsx(
              "flex flex-col md:flex-row gap-4 md:gap-5 p-4 sm:p-5 rounded-xl",
              "bg-slate-900/80 border border-white/10 shadow-xl backdrop-blur-md transition-all"
            )}
          >
            <div class={clsx("flex flex-1 md:flex-[1.35] flex-col justify-between w-full")}>
              <div>
                <span class={statusBadgeClasses()}>
                  <span class={statusDotClasses()} />
                  {statusLabel()}
                </span>
                <h1 class={clsx("text-lg sm:text-xl font-bold tracking-tight text-white mb-1 leading-snug")}>
                  Screen Protection
                </h1>
                <p class={clsx("text-xs text-slate-400 leading-relaxed mb-3.5")}>
                  Blocks clicks, touches, and keystrokes while media continues playing.
                </p>
              </div>

              <Show
                when={countdown() !== null}
                fallback={
                  <div class={clsx("flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-2.5 w-full")}>
                    <Tooltip
                      content="Lock screen immediately"
                      placement="top"
                      class={clsx("w-full sm:flex-1 sm:min-w-0 flex")}
                    >
                      <button
                        type="button"
                        class={clsx(
                          "w-full h-10 min-h-[40px] px-4 rounded-lg font-bold text-xs sm:text-[13px] tracking-tight text-white",
                          "inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer",
                          "transition-all duration-150 active:scale-[0.985]",
                          "bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600",
                          "border border-blue-400/40 shadow-md shadow-blue-600/25 hover:shadow-blue-500/40 hover:-translate-y-0.5"
                        )}
                        onClick={() => props.onLockNow()}
                        aria-label="Lock Screen Now"
                      >
                        <Lock size={16} />
                        <span>Lock Screen Now</span>
                      </button>
                    </Tooltip>

                    <div class={clsx("flex items-center gap-2 w-full sm:flex-[1.25] sm:min-w-0")}>
                      <Tooltip
                        content={`Lock screen after ${delaySeconds()}s delay`}
                        placement="top"
                        class={clsx("flex-1 min-w-0 flex")}
                      >
                        <button
                          type="button"
                          class={clsx(
                            "w-full h-10 min-h-[40px] px-3.5 rounded-lg font-semibold text-xs sm:text-[13px] text-slate-200",
                            "inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer",
                            "transition-all duration-150 active:scale-[0.985]",
                            "bg-slate-800/80 hover:bg-slate-700/90 border border-white/15 hover:border-blue-400/40",
                            "hover:text-white hover:-translate-y-0.5"
                          )}
                          onClick={startCountdownLock}
                          aria-label={`Lock in ${delaySeconds()}s Delay`}
                        >
                          <Clock size={15} />
                          <span>Lock in {delaySeconds()}s</span>
                        </button>
                      </Tooltip>

                      <Tooltip
                        content="Adjust delay (1-60s, session only)"
                        placement="top"
                        class={clsx("flex flex-shrink-0")}
                      >
                        <div
                          class={clsx(
                            "inline-flex items-center gap-1 px-1.5 h-10 min-h-[40px] flex-shrink-0 rounded-lg",
                            "bg-slate-800/80 border border-white/15 hover:border-blue-500",
                            "focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/50 transition-all"
                          )}
                          role="group"
                          aria-label="Delay duration adjuster"
                        >
                          <button
                            type="button"
                            class={clsx(
                              "w-6 h-6 rounded-md flex items-center justify-center",
                              "bg-white/10 hover:bg-blue-600 text-slate-200 hover:text-white font-bold text-sm",
                              "cursor-pointer transition-all active:scale-95",
                              "disabled:opacity-30 disabled:pointer-events-none"
                            )}
                            onClick={() => setDelaySeconds((prev) => Math.max(1, prev - 1))}
                            aria-label="Decrease delay by 1 second"
                            disabled={delaySeconds() <= 1}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            max="60"
                            value={delaySeconds()}
                            onInput={(e) => {
                              const val = parseInt(e.currentTarget.value, 10);
                              if (!isNaN(val)) {
                                setDelaySeconds(Math.max(1, Math.min(60, val)));
                              }
                            }}
                            class={clsx(
                              "w-7 text-center bg-transparent border-0 text-blue-400 font-bold text-xs p-0 outline-none",
                              "select-text [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            )}
                            aria-label="Delay duration in seconds"
                          />
                          <span class={clsx("text-[10.5px] font-semibold text-slate-400 mr-0.5 select-none")}>
                            s
                          </span>
                          <button
                            type="button"
                            class={clsx(
                              "w-6 h-6 rounded-md flex items-center justify-center",
                              "bg-white/10 hover:bg-blue-600 text-slate-200 hover:text-white font-bold text-sm",
                              "cursor-pointer transition-all active:scale-95",
                              "disabled:opacity-30 disabled:pointer-events-none"
                            )}
                            onClick={() => setDelaySeconds((prev) => Math.min(60, prev + 1))}
                            aria-label="Increase delay by 1 second"
                            disabled={delaySeconds() >= 60}
                          >
                            +
                          </button>
                        </div>
                      </Tooltip>
                    </div>
                  </div>
                }
              >
                <div
                  class={clsx(
                    "flex items-center gap-3 w-full h-10 min-h-[40px] px-3.5 rounded-lg",
                    "bg-slate-800/90 border border-white/20 shadow-lg shadow-blue-500/10"
                  )}
                >
                  <div class={clsx("text-lg font-bold text-blue-400 min-w-[22px] leading-none")}>
                    {countdown()}
                  </div>
                  <p class={clsx("flex-1 text-xs font-medium text-blue-200 leading-tight m-0")}>
                    Locking in {countdown()}s...
                  </p>
                  <Tooltip content="Cancel countdown" placement="bottom" class={clsx("flex flex-shrink-0")}>
                    <button
                      type="button"
                      class={clsx(
                        "h-7 px-2.5 rounded-md text-[11px] font-semibold text-red-300",
                        "bg-red-500/20 hover:bg-red-500/35 border border-red-500/40 hover:text-white",
                        "cursor-pointer transition-all whitespace-nowrap active:scale-95"
                      )}
                      onClick={cancelCountdown}
                      aria-label="Cancel Countdown"
                    >
                      Cancel
                    </button>
                  </Tooltip>
                </div>
              </Show>
            </div>

            <div class={clsx("flex flex-1 items-stretch w-full mt-2 md:mt-0")}>
              <div
                class={clsx(
                  "w-full flex flex-col justify-around gap-2 p-3 sm:p-3.5 rounded-lg",
                  "bg-slate-950/60 border border-white/10"
                )}
              >
                <Tooltip
                  content="Keyboard, mouse, and touch inputs blocked"
                  placement="left"
                  class={clsx("w-full flex")}
                >
                  <div class={clsx("w-full flex justify-between items-center text-xs py-1.5 px-2 rounded hover:bg-white/[0.04] transition-colors")}>
                    <div class={clsx("flex items-center gap-2")}>
                      <ShieldCheck size={14} class={clsx("text-blue-400")} />
                      <span class={clsx("text-slate-400 font-medium")}>Protection</span>
                    </div>
                    <span class={clsx("font-semibold text-slate-200 text-right")}>Input Blocked</span>
                  </div>
                </Tooltip>

                <Tooltip
                  content="Overlay transparency level"
                  placement="left"
                  class={clsx("w-full flex")}
                >
                  <div class={clsx("w-full flex justify-between items-center text-xs py-1.5 px-2 rounded hover:bg-white/[0.04] transition-colors")}>
                    <div class={clsx("flex items-center gap-2")}>
                      <Layers size={14} class={clsx("text-indigo-400")} />
                      <span class={clsx("text-slate-400 font-medium")}>Overlay</span>
                    </div>
                    <span class={clsx("font-semibold text-slate-200 text-right")}>
                      {Math.round((1 - props.properties.overlay_opacity) * 100)}% Transparent
                    </span>
                  </div>
                </Tooltip>

                <Tooltip
                  content="Quick unlock credentials"
                  placement="left"
                  class={clsx("w-full flex")}
                >
                  <div class={clsx("w-full flex justify-between items-center text-xs py-1.5 px-2 rounded hover:bg-white/[0.04] transition-colors")}>
                    <div class={clsx("flex items-center gap-2")}>
                      <KeyRound size={14} class={clsx("text-amber-400")} />
                      <span class={clsx("text-slate-400 font-medium")}>Unlock</span>
                    </div>
                    <span class={clsx("font-semibold text-slate-200 text-right")}>PIN / Password</span>
                  </div>
                </Tooltip>

                <Tooltip
                  content="Hardware-backed OS vault storage"
                  placement="left"
                  class={clsx("w-full flex")}
                >
                  <div class={clsx("w-full flex justify-between items-center text-xs py-1.5 px-2 rounded hover:bg-white/[0.04] transition-colors")}>
                    <div class={clsx("flex items-center gap-2")}>
                      <Database size={14} class={clsx("text-emerald-400")} />
                      <span class={clsx("text-slate-400 font-medium")}>Vault</span>
                    </div>
                    <span class={clsx("font-semibold text-sky-400 text-right")}>OS Keyring</span>
                  </div>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* Software Updates Card */}
          <div
            class={clsx(
              "flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 p-4 md:px-5 md:py-4 rounded-xl",
              "bg-slate-900/70 border border-white/10 shadow-xl backdrop-blur-md transition-colors hover:border-white/20"
            )}
          >
            <div class={clsx("flex-1 min-w-0")}>
              <div class={clsx("flex items-center gap-2 mb-1")}>
                <RefreshCw
                  size={18}
                  class={clsx("text-blue-400", { "animate-spin": updaterService.state().isChecking })}
                />
                <h3 class={clsx("text-[15px] font-semibold text-white m-0")}>Software Updates</h3>
                <span class={clsx("text-[11px] font-semibold font-mono px-2 py-0.5 rounded-full bg-white/10 text-slate-200 border border-white/15")}>
                  v{updaterService.state().currentVersion}
                </span>
              </div>
              <p class={clsx("text-[12.5px] text-slate-400 mb-2 leading-relaxed")}>
                Checks official signed releases from GitHub.
              </p>

              <Show when={updaterService.state().updateAvailable && updaterService.state().updateInfo}>
                <div class={clsx("p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 mt-2")}>
                  <div class={clsx("flex items-center gap-1.5 text-[13px] text-emerald-300 font-bold mb-1")}>
                    <CheckCircle2 size={16} class={clsx("text-emerald-400")} />
                    <strong>New version {updaterService.state().updateInfo?.version} is available!</strong>
                  </div>
                  <Show when={updaterService.state().updateInfo?.body}>
                    <p class={clsx("text-xs text-slate-200 mb-2")}>{updaterService.state().updateInfo?.body}</p>
                  </Show>
                  <Show when={!updaterService.state().isDownloaded}>
                    <button
                      type="button"
                      class={clsx(
                        "inline-flex items-center justify-center gap-1.5 h-9 min-h-[36px] px-3.5 rounded-lg text-xs font-semibold text-white",
                        "bg-blue-600 hover:bg-blue-500 transition-colors cursor-pointer"
                      )}
                      onClick={() => updaterService.downloadAndInstallUpdate()}
                      disabled={updaterService.state().isDownloading}
                    >
                      <Download size={14} />
                      <span>
                        {updaterService.state().isDownloading
                          ? `Downloading (${updaterService.state().progressPercent}%)...`
                          : "Download & Install Now"}
                      </span>
                    </button>
                  </Show>
                  <Show when={updaterService.state().isDownloaded}>
                    <div class={clsx("flex items-center gap-1.5 text-xs text-emerald-400")}>
                      <Check size={16} class={clsx("text-emerald-400")} />
                      <span>Update downloaded! Restart Shieldr to complete installation.</span>
                    </div>
                  </Show>
                </div>
              </Show>

              <Show
                when={
                  !updaterService.state().updateAvailable &&
                  !updaterService.state().isChecking &&
                  !updaterService.state().error
                }
              >
                <div class={clsx("inline-flex items-center gap-1.5 text-xs text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20")}>
                  <CheckCircle2 size={14} class={clsx("text-emerald-400")} />
                  <span>Latest version installed</span>
                </div>
              </Show>

              <Show when={updaterService.state().error}>
                <div class={clsx("inline-flex items-center gap-1.5 text-xs text-amber-400 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20")}>
                  <AlertCircle size={14} class={clsx("text-amber-400")} />
                  <span>{updaterService.state().error}</span>
                </div>
              </Show>
            </div>

            <div class={clsx("flex flex-col items-stretch md:items-end gap-2 flex-shrink-0 w-full md:w-auto")}>
              <Tooltip content="Check for updates" placement="top" class={clsx("w-full md:w-auto flex")}>
                <button
                  type="button"
                  class={clsx(
                    "w-full md:w-auto h-9 min-h-[36px] px-3.5 rounded-lg text-xs font-semibold text-slate-200",
                    "inline-flex items-center justify-center gap-2 bg-white/[0.07] hover:bg-white/[0.12]",
                    "border border-white/15 hover:border-blue-400/40 transition-all cursor-pointer",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                  onClick={() => updaterService.checkForUpdates(false)}
                  disabled={updaterService.state().isChecking}
                  aria-label="Check for Updates"
                >
                  <RefreshCw
                    size={14}
                    class={clsx({ "animate-spin": updaterService.state().isChecking })}
                  />
                  <span>{updaterService.state().isChecking ? "Checking..." : "Check Updates"}</span>
                </button>
              </Tooltip>

              <div class={clsx("grid grid-cols-2 md:flex items-center gap-2 w-full md:w-auto")}>
                <Tooltip content="GitHub repository" placement="top" class={clsx("w-full md:w-auto flex")}>
                  <button
                    type="button"
                    class={clsx(
                      "w-full md:w-auto h-9 min-h-[36px] px-3 rounded-lg text-xs font-medium text-slate-400 hover:text-white",
                      "inline-flex items-center justify-center gap-1.5 bg-slate-950/60 hover:bg-slate-900",
                      "border border-white/10 hover:border-white/20 transition-all cursor-pointer whitespace-nowrap"
                    )}
                    onClick={() => openUrl("https://github.com/AhmedTrooper/Shieldr")}
                    aria-label="GitHub Repository"
                  >
                    <SiGithub size={15} />
                    <span>GitHub</span>
                    <ExternalLink size={12} class={clsx("opacity-60")} />
                  </button>
                </Tooltip>
                <Tooltip content="YouTube tutorials" placement="top" class={clsx("w-full md:w-auto flex")}>
                  <button
                    type="button"
                    class={clsx(
                      "w-full md:w-auto h-9 min-h-[36px] px-3 rounded-lg text-xs font-medium text-slate-400 hover:text-red-400",
                      "inline-flex items-center justify-center gap-1.5 bg-slate-950/60 hover:bg-slate-900",
                      "border border-white/10 hover:border-white/20 transition-all cursor-pointer whitespace-nowrap"
                    )}
                    onClick={() => openUrl("https://www.youtube.com/@AhmedTrooper")}
                    aria-label="YouTube Channel"
                  >
                    <SiYoutube size={15} />
                    <span>YouTube</span>
                    <ExternalLink size={12} class={clsx("opacity-60")} />
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* Features Grid */}
          <div class={clsx("grid grid-cols-1 sm:grid-cols-3 gap-3 w-full")}>
            <Tooltip
              content="Blocks mouse clicks, taps, drag gestures, and system hotkeys"
              placement="top"
              class={clsx("w-full flex")}
            >
              <div
                class={clsx(
                  "w-full h-12 min-h-[48px] px-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800/90",
                  "border border-white/10 hover:border-blue-400/40 shadow-md shadow-black/30 hover:shadow-blue-500/10",
                  "flex items-center gap-2.5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer group"
                )}
              >
                <div class={clsx("w-7 h-7 rounded-lg flex items-center justify-center bg-white/[0.05] border border-white/10 group-hover:border-blue-400/40 group-hover:scale-105 transition-all flex-shrink-0 text-blue-400")}>
                  <MousePointerClick size={16} />
                </div>
                <h3 class={clsx("text-xs font-semibold text-slate-200 group-hover:text-white m-0 tracking-tight whitespace-nowrap")}>
                  Input Shield
                </h3>
              </div>
            </Tooltip>

            <Tooltip
              content="Requires security PIN to dismiss, minimize, or close"
              placement="top"
              class={clsx("w-full flex")}
            >
              <div
                class={clsx(
                  "w-full h-12 min-h-[48px] px-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800/90",
                  "border border-white/10 hover:border-emerald-400/40 shadow-md shadow-black/30 hover:shadow-emerald-500/10",
                  "flex items-center gap-2.5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer group"
                )}
              >
                <div class={clsx("w-7 h-7 rounded-lg flex items-center justify-center bg-white/[0.05] border border-white/10 group-hover:border-emerald-400/40 group-hover:scale-105 transition-all flex-shrink-0 text-emerald-400")}>
                  <ShieldCheck size={16} />
                </div>
                <h3 class={clsx("text-xs font-semibold text-slate-200 group-hover:text-white m-0 tracking-tight whitespace-nowrap")}>
                  PIN Protected
                </h3>
              </div>
            </Tooltip>

            <Tooltip
              content="Discreet floating padlock fades away during inactivity"
              placement="top"
              class={clsx("w-full flex")}
            >
              <div
                class={clsx(
                  "w-full h-12 min-h-[48px] px-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800/90",
                  "border border-white/10 hover:border-purple-400/40 shadow-md shadow-black/30 hover:shadow-purple-500/10",
                  "flex items-center gap-2.5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer group"
                )}
              >
                <div class={clsx("w-7 h-7 rounded-lg flex items-center justify-center bg-white/[0.05] border border-white/10 group-hover:border-purple-400/40 group-hover:scale-105 transition-all flex-shrink-0 text-purple-400")}>
                  <Sparkles size={16} />
                </div>
                <h3 class={clsx("text-xs font-semibold text-slate-200 group-hover:text-white m-0 tracking-tight whitespace-nowrap")}>
                  Auto-Fade
                </h3>
              </div>
            </Tooltip>
          </div>
        </Motion.div>
      </Show>


      {/* Tab 2: Display & Overlay Settings */}
      <Show when={activeTab() === "display"}>
        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          class={clsx("flex flex-1 flex-col gap-3 sm:gap-4 min-h-0 pb-4")}
        >
          <div class={clsx("flex flex-col gap-3.5 p-4 sm:p-5 rounded-xl bg-slate-900/80 border border-white/10 shadow-xl backdrop-blur-md")}>
            <div class={clsx("flex flex-col gap-1 pb-2 border-b border-white/10")}>
              <h2 class={clsx("text-base sm:text-lg font-bold tracking-tight text-white m-0")}>Display & Overlay</h2>
              <p class={clsx("text-xs text-slate-400 m-0")}>Configure transparency, blur, and lock icon behavior.</p>
            </div>

            <Show when={saveDisplayMsg()}>
              <div class={clsx("p-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center gap-2")}>
                <CheckCircle2 size={14} class={clsx("text-emerald-400")} />
                <span>{saveDisplayMsg()}</span>
              </div>
            </Show>

            <div class={clsx("flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 border-b border-white/[0.07]")}>
              <div class={clsx("flex flex-col gap-0.5 sm:max-w-[65%]")}>
                <label class={clsx("text-[13px] font-semibold text-slate-200")}>Overlay Tint</label>
                <span class={clsx("text-xs text-slate-400 leading-relaxed")}>
                  Darkness level of the transparent screen guard ({Math.round(opacity() * 100)}%)
                </span>
              </div>
              <div class={clsx("flex items-center gap-3 w-full sm:w-auto")}>
                <input
                  type="range"
                  min="0"
                  max="0.40"
                  step="0.01"
                  value={opacity()}
                  onInput={(e) => setOpacity(parseFloat(e.currentTarget.value))}
                  class={clsx("w-full sm:w-36 h-2 rounded-lg bg-slate-800 accent-blue-500 cursor-pointer")}
                />
                <span class={clsx("min-w-[44px] text-right font-mono font-bold text-xs text-blue-400 px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10")}>
                  {Math.round(opacity() * 100)}%
                </span>
              </div>
            </div>

            <div class={clsx("flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 border-b border-white/[0.07]")}>
              <div class={clsx("flex flex-col gap-0.5 sm:max-w-[65%]")}>
                <label class={clsx("text-[13px] font-semibold text-slate-200")}>Background Blur</label>
                <span class={clsx("text-xs text-slate-400 leading-relaxed")}>
                  Frosted glass blur effect ({blur()}px)
                </span>
              </div>
              <div class={clsx("flex items-center gap-3 w-full sm:w-auto")}>
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  value={blur()}
                  onInput={(e) => setBlur(parseInt(e.currentTarget.value))}
                  class={clsx("w-full sm:w-36 h-2 rounded-lg bg-slate-800 accent-blue-500 cursor-pointer")}
                />
                <span class={clsx("min-w-[44px] text-right font-mono font-bold text-xs text-blue-400 px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/10")}>
                  {blur()}px
                </span>
              </div>
            </div>

            <div class={clsx("flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 border-b border-white/[0.07]")}>
              <div class={clsx("flex flex-col gap-0.5 sm:max-w-[65%]")}>
                <label class={clsx("text-[13px] font-semibold text-slate-200")}>Unlock Icon Position</label>
                <span class={clsx("text-xs text-slate-400 leading-relaxed")}>Placement of the click-to-unlock trigger</span>
              </div>
              <div class={clsx("w-full sm:w-auto")}>
                <select
                  class={clsx("w-full sm:w-44 h-9 px-3 rounded-lg bg-slate-800 border border-white/15 text-slate-200 text-xs font-semibold outline-none hover:border-blue-400/50 focus:border-blue-500 transition-colors cursor-pointer")}
                  value={position()}
                  onChange={(e) =>
                    setPosition(e.currentTarget.value as ShieldProperties["lock_icon_position"])
                  }
                >
                  <option value="floating">Floating</option>
                  <option value="center">Center</option>
                  <option value="top-right">Top Right</option>
                  <option value="bottom-right">Bottom Right</option>
                </select>
              </div>
            </div>

            <div class={clsx("flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 border-b border-white/[0.07]")}>
              <div class={clsx("flex flex-col gap-0.5 sm:max-w-[65%]")}>
                <label class={clsx("text-[13px] font-semibold text-slate-200")}>Auto-Hide Timeout</label>
                <span class={clsx("text-xs text-slate-400 leading-relaxed")}>Hide lock icon after mouse inactivity</span>
              </div>
              <div class={clsx("w-full sm:w-auto")}>
                <select
                  class={clsx("w-full sm:w-44 h-9 px-3 rounded-lg bg-slate-800 border border-white/15 text-slate-200 text-xs font-semibold outline-none hover:border-blue-400/50 focus:border-blue-500 transition-colors cursor-pointer")}
                  value={autohide()}
                  onChange={(e) => setAutohide(parseInt(e.currentTarget.value))}
                >
                  <option value="0">Never</option>
                  <option value="2">2 seconds</option>
                  <option value="3">3 seconds</option>
                  <option value="5">5 seconds</option>
                  <option value="10">10 seconds</option>
                </select>
              </div>
            </div>

            <div class={clsx("flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 border-b border-white/[0.07]")}>
              <div class={clsx("flex flex-col gap-0.5 sm:max-w-[65%]")}>
                <label class={clsx("text-[13px] font-semibold text-slate-200")}>Sound Feedback</label>
                <span class={clsx("text-xs text-slate-400 leading-relaxed")}>Audio tones for keypad and unlock actions</span>
              </div>
              <div class={clsx("w-full sm:w-auto flex justify-start sm:justify-end")}>
                <Tooltip content={soundEnabled() ? "Sound enabled" : "Sound disabled"} placement="left">
                  <label class={clsx("relative inline-flex items-center cursor-pointer")}>
                    <input
                      type="checkbox"
                      checked={soundEnabled()}
                      onChange={(e) => setSoundEnabled(e.currentTarget.checked)}
                      aria-label="Sound Feedback"
                      class={clsx("sr-only peer")}
                    />
                    <div class={clsx(
                      "w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer",
                      "peer-checked:after:translate-x-full peer-checked:after:border-white",
                      "after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all",
                      "peer-checked:bg-blue-600 border border-white/20"
                    )} />
                  </label>
                </Tooltip>
              </div>
            </div>

            <div class={clsx("flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 border-b border-white/[0.07]")}>
              <div class={clsx("flex flex-col gap-0.5 sm:max-w-[65%]")}>
                <label class={clsx("text-[13px] font-semibold text-slate-200")}>Keep Awake</label>
                <span class={clsx("text-xs text-slate-400 leading-relaxed")}>
                  Prevent sleep and display turn-off while locked
                </span>
              </div>
              <div class={clsx("w-full sm:w-auto flex justify-start sm:justify-end")}>
                <Tooltip content={keepAwake() ? "Keep awake enabled" : "Keep awake disabled"} placement="left">
                  <label class={clsx("relative inline-flex items-center cursor-pointer")}>
                    <input
                      type="checkbox"
                      checked={keepAwake()}
                      onChange={(e) => setKeepAwake(e.currentTarget.checked)}
                      aria-label="Keep Awake"
                      class={clsx("sr-only peer")}
                    />
                    <div class={clsx(
                      "w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer",
                      "peer-checked:after:translate-x-full peer-checked:after:border-white",
                      "after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all",
                      "peer-checked:bg-blue-600 border border-white/20"
                    )} />
                  </label>
                </Tooltip>
              </div>
            </div>

            <div class={clsx("flex justify-end pt-2")}>
              <Tooltip content="Save display settings" placement="top">
                <button
                  type="button"
                  class={clsx(
                    "h-10 min-h-[40px] px-5 rounded-lg text-xs sm:text-[13px] font-bold text-white",
                    "bg-blue-600 hover:bg-blue-500 active:scale-[0.985] shadow-lg shadow-blue-600/30",
                    "border border-blue-400/40 transition-all cursor-pointer inline-flex items-center justify-center gap-2"
                  )}
                  onClick={handleSaveDisplayProperties}
                  aria-label="Save Settings"
                >
                  Save Settings
                </button>
              </Tooltip>
            </div>
          </div>
        </Motion.div>
      </Show>

      {/* Tab 3: Security & Vault */}
      <Show when={activeTab() === "security"}>
        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          class={clsx("flex flex-1 flex-col gap-4 min-h-0 pb-4")}
        >
          <div class={clsx("grid grid-cols-1 md:grid-cols-2 gap-4")}>
            {/* Change PIN Card */}
            <div class={clsx("flex flex-col gap-3 p-4 sm:p-5 rounded-xl bg-slate-900/80 border border-white/10 shadow-xl backdrop-blur-md")}>
              <div class={clsx("flex flex-col gap-1 pb-2 border-b border-white/10")}>
                <h3 class={clsx("text-base font-bold tracking-tight text-white m-0")}>Change PIN</h3>
                <p class={clsx("text-xs text-slate-400 m-0")}>Update your 4-8 digit quick-unlock code.</p>
              </div>

              <Show when={pinChangeMsg()}>
                <div
                  class={clsx("p-2.5 rounded-lg text-xs font-semibold flex items-center gap-2", {
                    "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400":
                      pinChangeMsg()?.type === "success",
                    "bg-red-500/15 border border-red-500/30 text-red-400":
                      pinChangeMsg()?.type !== "success",
                  })}
                >
                  {pinChangeMsg()?.text}
                </div>
              </Show>

              <form onSubmit={handleChangePin} class={clsx("flex flex-col gap-3 mt-1")}>
                <div class={clsx("flex flex-col gap-1")}>
                  <label class={clsx("text-xs font-semibold text-slate-300")}>Current PIN or Password</label>
                  <input
                    type="password"
                    class={clsx("w-full h-10 px-3 rounded-lg bg-slate-950/80 border border-white/15 text-white text-xs sm:text-[13px] font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-slate-600")}
                    value={currentCred()}
                    onInput={(e) => setCurrentCred(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class={clsx("flex flex-col gap-1")}>
                  <label class={clsx("text-xs font-semibold text-slate-300")}>New PIN (4-8 digits)</label>
                  <input
                    type="password"
                    class={clsx("w-full h-10 px-3 rounded-lg bg-slate-950/80 border border-white/15 text-white text-xs sm:text-[13px] font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-slate-600")}
                    maxLength={8}
                    value={newPin()}
                    onInput={(e) => setNewPin(e.currentTarget.value)}
                    required
                  />
                </div>
                <button
                  type="submit"
                  class={clsx("w-full h-10 min-h-[40px] px-4 rounded-lg text-xs font-semibold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700/90 border border-white/15 hover:border-blue-400/40 transition-all cursor-pointer inline-flex items-center justify-center gap-2 active:scale-[0.985]")}
                >
                  Update PIN
                </button>
              </form>
            </div>

            {/* Change Master Password Card */}
            <div class={clsx("flex flex-col gap-3 p-4 sm:p-5 rounded-xl bg-slate-900/80 border border-white/10 shadow-xl backdrop-blur-md")}>
              <div class={clsx("flex flex-col gap-1 pb-2 border-b border-white/10")}>
                <h3 class={clsx("text-base font-bold tracking-tight text-white m-0")}>Change Master Password</h3>
                <p class={clsx("text-xs text-slate-400 m-0")}>Emergency recovery password.</p>
              </div>

              <Show when={masterChangeMsg()}>
                <div
                  class={clsx("p-2.5 rounded-lg text-xs font-semibold flex items-center gap-2", {
                    "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400":
                      masterChangeMsg()?.type === "success",
                    "bg-red-500/15 border border-red-500/30 text-red-400":
                      masterChangeMsg()?.type !== "success",
                  })}
                >
                  {masterChangeMsg()?.text}
                </div>
              </Show>

              <form onSubmit={handleChangeMasterPassword} class={clsx("flex flex-col gap-3 mt-1")}>
                <div class={clsx("flex flex-col gap-1")}>
                  <label class={clsx("text-xs font-semibold text-slate-300")}>Current Master Password</label>
                  <input
                    type="password"
                    class={clsx("w-full h-10 px-3 rounded-lg bg-slate-950/80 border border-white/15 text-white text-xs sm:text-[13px] font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-slate-600")}
                    value={currentMaster()}
                    onInput={(e) => setCurrentMaster(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class={clsx("flex flex-col gap-1")}>
                  <label class={clsx("text-xs font-semibold text-slate-300")}>New Master Password (6+ chars)</label>
                  <input
                    type="password"
                    class={clsx("w-full h-10 px-3 rounded-lg bg-slate-950/80 border border-white/15 text-white text-xs sm:text-[13px] font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-slate-600")}
                    value={newMaster()}
                    onInput={(e) => setNewMaster(e.currentTarget.value)}
                    required
                  />
                </div>
                <button
                  type="submit"
                  class={clsx("w-full h-10 min-h-[40px] px-4 rounded-lg text-xs font-semibold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700/90 border border-white/15 hover:border-blue-400/40 transition-all cursor-pointer inline-flex items-center justify-center gap-2 active:scale-[0.985]")}
                >
                  Update Password
                </button>
              </form>
            </div>
          </div>

          {/* Backup Recovery Phrase Card */}
          <div class={clsx("flex flex-col gap-3 p-4 sm:p-5 rounded-xl bg-slate-900/80 border border-white/10 shadow-xl backdrop-blur-md")}>
            <div class={clsx("flex flex-col gap-1 pb-2 border-b border-white/10")}>
              <h3 class={clsx("text-base font-bold tracking-tight text-white m-0")}>12-Word Recovery Phrase</h3>
              <p class={clsx("text-xs text-slate-400 m-0")}>
                Enter your master password to view your backup phrase.
              </p>
            </div>

            <Show when={!revealedPhrase()}>
              <form onSubmit={handleRevealPhrase} class={clsx("flex flex-col sm:flex-row gap-2 mt-1")}>
                <div class={clsx("flex-1")}>
                  <input
                    type="password"
                    class={clsx("w-full h-10 px-3 rounded-lg bg-slate-950/80 border border-white/15 text-white text-xs sm:text-[13px] font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-slate-500")}
                    placeholder="Enter Master Password..."
                    value={revealMasterPass()}
                    onInput={(e) => setRevealMasterPass(e.currentTarget.value)}
                    required
                  />
                </div>
                <button
                  type="submit"
                  class={clsx(
                    "h-10 min-h-[40px] px-4 rounded-lg text-xs font-bold text-white",
                    "bg-blue-600 hover:bg-blue-500 border border-blue-400/40 shadow-md shadow-blue-600/30",
                    "transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-[0.985]"
                  )}
                >
                  <KeyRound size={15} />
                  <span>Reveal Phrase</span>
                </button>
              </form>
              <Show when={revealMsg()}>
                <div class={clsx("p-2.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-semibold mt-2")}>
                  {revealMsg()}
                </div>
              </Show>
            </Show>

            <Show when={revealedPhrase()}>
              <div class={clsx("flex flex-col gap-3 mt-2")}>
                <div class={clsx("grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2")}>
                  <For each={revealedPhrase()?.split(/\s+/) || []}>
                    {(word, idx) => (
                      <div class={clsx("flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-white/10 text-xs font-mono select-text")}>
                        <span class={clsx("text-slate-500 font-bold select-none text-[10.5px]")}>{idx() + 1}</span>
                        <span class={clsx("text-emerald-400 font-semibold")}>{word}</span>
                      </div>
                    )}
                  </For>
                </div>
                <Tooltip content={copiedPhrase() ? "Copied to clipboard" : "Copy 12-word phrase"} placement="top">
                  <button
                    type="button"
                    class={clsx(
                      "self-start h-9 min-h-[36px] px-3.5 rounded-lg text-xs font-semibold text-slate-200 hover:text-white",
                      "bg-slate-800 hover:bg-slate-700 border border-white/15 hover:border-blue-400/40",
                      "transition-all cursor-pointer inline-flex items-center gap-1.5 active:scale-[0.985]"
                    )}
                    onClick={async () => {
                      const phrase = revealedPhrase() || "";
                      try {
                        await writeText(phrase);
                      } catch {
                        await navigator.clipboard.writeText(phrase);
                      }
                      setCopiedPhrase(true);
                      setTimeout(() => setCopiedPhrase(false), 2500);
                      sound.playKeypadBeep();
                    }}
                    aria-label="Copy Recovery Phrase"
                  >
                    {copiedPhrase() ? <Check size={16} class={clsx("text-emerald-400")} /> : <Copy size={16} />}
                    <span>{copiedPhrase() ? "Copied!" : "Copy 12 Words"}</span>
                  </button>
                </Tooltip>
              </div>
            </Show>
          </div>
        </Motion.div>
      </Show>

      {/* Tab 4: SQLite Audit Log & Metadata */}
      <Show when={activeTab() === "audit"}>
        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          class={clsx("flex flex-1 flex-col gap-4 min-h-0 pb-4")}
        >
          <div class={clsx("flex flex-col gap-4 p-4 sm:p-5 rounded-xl bg-slate-900/80 border border-white/10 shadow-xl backdrop-blur-md")}>
            <div class={clsx("flex items-center justify-between gap-4 pb-2 border-b border-white/10")}>
              <div>
                <h2 class={clsx("text-base sm:text-lg font-bold tracking-tight text-white m-0")}>Audit Log</h2>
                <p class={clsx("text-xs text-slate-400 m-0")}>
                  Security events and access history.
                </p>
              </div>
              <Tooltip content="Refresh audit log" placement="left">
                <button
                  type="button"
                  class={clsx(
                    "h-8 px-3 rounded-lg text-xs font-semibold text-slate-300 hover:text-white",
                    "bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 transition-all cursor-pointer",
                    "inline-flex items-center gap-1.5 disabled:opacity-50"
                  )}
                  onClick={loadAuditLogs}
                  disabled={isLoadingLogs()}
                  aria-label="Refresh Audit Logs"
                >
                  <RefreshCw size={15} class={clsx({ "animate-spin": isLoadingLogs() })} />
                  <span>Refresh</span>
                </button>
              </Tooltip>
            </div>

            <div class={clsx("w-full overflow-x-auto rounded-lg border border-white/10 bg-slate-950/60")}>
              <table class={clsx("w-full text-left text-xs border-collapse")}>
                <thead>
                  <tr class={clsx("border-b border-white/10 bg-slate-900/90 text-slate-400 font-semibold")}>
                    <th class={clsx("py-2.5 px-3 whitespace-nowrap")}>ID</th>
                    <th class={clsx("py-2.5 px-3 whitespace-nowrap")}>Event Type</th>
                    <th class={clsx("py-2.5 px-3 whitespace-nowrap")}>Details</th>
                    <th class={clsx("py-2.5 px-3 whitespace-nowrap")}>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={logs()}>
                    {(entry) => (
                      <tr class={clsx("border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors")}>
                        <td class={clsx("py-2 px-3 text-slate-400 font-mono")}>#{entry.id}</td>
                        <td class={clsx("py-2 px-3 whitespace-nowrap")}>
                          <span
                            class={clsx(
                              "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
                              {
                                "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400":
                                  entry.event_type.includes("SUCCESS") || entry.event_type.includes("UNLOCKED"),
                                "bg-red-500/15 border border-red-500/30 text-red-400":
                                  entry.event_type.includes("FAILED") || entry.event_type.includes("DENIED"),
                                "bg-blue-500/15 border border-blue-500/30 text-blue-400":
                                  !entry.event_type.includes("SUCCESS") &&
                                  !entry.event_type.includes("UNLOCKED") &&
                                  !entry.event_type.includes("FAILED") &&
                                  !entry.event_type.includes("DENIED"),
                              }
                            )}
                          >
                            {entry.event_type}
                          </span>
                        </td>
                        <td class={clsx("py-2 px-3 text-slate-300 font-mono")}>{entry.details}</td>
                        <td class={clsx("py-2 px-3 text-slate-400 whitespace-nowrap font-mono text-[11px]")}>
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </Motion.div>
      </Show>
    </div>
  );
};
