import { Component } from "solid-js";
import { clsx } from "clsx";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SiGithub, SiYoutube } from "solid-icons/si";
import { RefreshCw, Shield } from "lucide-solid";
import { tauriBridge } from "../services/tauriBridge";
import { sound } from "../services/sound";
import { updaterService } from "../services/updater";
import { Tooltip } from "./ui/tooltip";

interface TitleBarProps {
  onRequestClose: () => void;
}

export const TitleBar: Component<TitleBarProps> = (props) => {
  const handleMinimize = async () => {
    sound.playKeypadBeep();
    try {
      await tauriBridge.minimizeWindow();
    } catch (e) {
      console.error("Failed to minimize window:", e);
    }
  };

  const handleClose = () => {
    sound.playKeypadBeep();
    props.onRequestClose();
  };

  const handleOpenGithub = async () => {
    sound.playKeypadBeep();
    try {
      await openUrl("https://github.com/AhmedTrooper/Shieldr");
    } catch (e) {
      console.error("Failed to open GitHub:", e);
    }
  };

  const handleOpenYoutube = async () => {
    sound.playKeypadBeep();
    try {
      await openUrl("https://www.youtube.com/@AhmedTrooper");
    } catch (e) {
      console.error("Failed to open YouTube:", e);
    }
  };

  const handleCheckUpdate = async () => {
    sound.playKeypadBeep();
    await updaterService.checkForUpdates(false);
  };

  return (
    <header
      class={clsx(
        "h-10 min-h-[40px] flex items-center justify-between px-2.5 sm:px-4 md:px-5 lg:px-6 gap-2",
        "bg-slate-950/80 backdrop-blur-xl border-b border-white/10 select-none relative z-50 transition-all"
      )}
      data-tauri-drag-region
    >
      <div class={clsx("flex items-center gap-2 sm:gap-3 min-w-0")} data-tauri-drag-region>
        <div class={clsx("flex items-center gap-1.5 pr-1 shrink-0")}>
          <Tooltip content="Close to tray" placement="bottom-start">
            <button
              type="button"
              class={clsx(
                "w-3 h-3 rounded-full border-none cursor-pointer p-0 flex items-center justify-center transition-all",
                "bg-[#ff5f56] shadow-[0_0_6px_rgba(255,95,86,0.6),inset_0_1px_0_rgba(255,255,255,0.35)] hover:scale-110 hover:brightness-125"
              )}
              aria-label="Close Window"
              onClick={handleClose}
            />
          </Tooltip>
          <Tooltip content="Minimize" placement="bottom">
            <button
              type="button"
              class={clsx(
                "w-3 h-3 rounded-full border-none cursor-pointer p-0 flex items-center justify-center transition-all",
                "bg-[#ffbd2e] shadow-[0_0_6px_rgba(255,189,46,0.6),inset_0_1px_0_rgba(255,255,255,0.35)] hover:scale-110 hover:brightness-125"
              )}
              aria-label="Minimize Window"
              onClick={handleMinimize}
            />
          </Tooltip>
        </div>
        <div class={clsx("flex items-center gap-1.5 min-w-0")} data-tauri-drag-region>
          <Shield size={15} class={clsx("text-blue-400 shrink-0")} />
          <span class={clsx("text-[13px] font-bold text-slate-200 tracking-tight truncate")}>Shieldr</span>
        </div>
      </div>

      <div class={clsx("hidden md:block text-xs text-slate-400 font-medium tracking-tight whitespace-nowrap overflow-hidden text-ellipsis")} data-tauri-drag-region>
        <span>Screen Protection</span>
      </div>

      <div class={clsx("flex items-center shrink-0 gap-1.5")} data-tauri-drag-region>
        <div class={clsx("flex items-center gap-1")}>
          <Tooltip content="Check for updates" placement="bottom">
            <button
              type="button"
              class={clsx(
                "inline-flex items-center justify-center w-7 h-7 rounded-md border border-transparent hover:border-white/15",
                "bg-transparent hover:bg-white/[0.08] text-slate-400 hover:text-slate-100 cursor-pointer transition-all",
                "disabled:opacity-40 disabled:pointer-events-none"
              )}
              aria-label="Check for Updates"
              onClick={handleCheckUpdate}
              disabled={updaterService.state().isChecking}
            >
              <RefreshCw
                size={14}
                class={clsx(updaterService.state().isChecking && "animate-spin text-zinc-300")}
              />
            </button>
          </Tooltip>
          <Tooltip content="GitHub" placement="bottom">
            <button
              type="button"
              class={clsx(
                "inline-flex items-center justify-center w-7 h-7 rounded-md border border-transparent hover:border-white/15",
                "bg-transparent hover:bg-white/[0.08] text-slate-400 hover:text-slate-100 cursor-pointer transition-all"
              )}
              aria-label="GitHub Repository"
              onClick={handleOpenGithub}
            >
              <SiGithub size={14} />
            </button>
          </Tooltip>
          <Tooltip content="YouTube" placement="bottom-end">
            <button
              type="button"
              class={clsx(
                "inline-flex items-center justify-center w-7 h-7 rounded-md border border-transparent hover:border-white/15",
                "bg-transparent hover:bg-white/[0.08] text-slate-400 hover:text-slate-100 cursor-pointer transition-all"
              )}
              aria-label="YouTube Channel"
              onClick={handleOpenYoutube}
            >
              <SiYoutube size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
    </header>
  );
};