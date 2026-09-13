import { Component } from "solid-js";
import { clsx } from "clsx";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SiGithub, SiYoutube } from "solid-icons/si";
import { RefreshCw, Shield, Minus, X } from "lucide-solid";
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
        "h-10 min-h-[40px] flex items-center justify-between gap-2 sm:gap-3",
        "px-2.5 sm:px-4 md:px-5 lg:px-6",
        "bg-slate-950/85 backdrop-blur-xl border-b border-white/10 select-none relative z-50 transition-all"
      )}
      data-tauri-drag-region
    >
      {/* LEFT — window controls + brand */}
      <div class={clsx("flex items-center gap-2 sm:gap-3 min-w-0")} data-tauri-drag-region>
        <div class={clsx("flex items-center gap-1 sm:gap-1.5 pr-1 sm:pr-2 shrink-0 border-r border-white/10 mr-0.5 sm:mr-1")}>
          <Tooltip content="Close to tray" placement="bottom-start">
            {/* Buttons stop propagation so clicks don't trigger drag. */}
            <button
              type="button"
              data-tauri-no-drag
              class={clsx(
                "inline-flex items-center justify-center w-7 h-7 rounded-md cursor-pointer transition-all",
                "border border-transparent text-slate-400 hover:text-red-400",
                "hover:bg-red-500/10 hover:border-red-500/25"
              )}
              aria-label="Close to Tray"
              onClick={handleClose}
            >
              <X size={14} />
            </button>
          </Tooltip>
          <Tooltip content="Minimize" placement="bottom">
            <button
              type="button"
              data-tauri-no-drag
              class={clsx(
                "inline-flex items-center justify-center w-7 h-7 rounded-md cursor-pointer transition-all",
                "border border-transparent text-slate-400 hover:text-amber-400",
                "hover:bg-amber-500/10 hover:border-amber-500/25"
              )}
              aria-label="Minimize Window"
              onClick={handleMinimize}
            >
              <Minus size={14} />
            </button>
          </Tooltip>
        </div>
        <div class={clsx("flex items-center gap-1.5 min-w-0")} data-tauri-drag-region>
          <div class={clsx(
            "inline-flex items-center justify-center w-5 h-5 rounded-md shrink-0",
            "bg-gradient-to-br from-blue-500/25 to-blue-600/15 border border-blue-400/25",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
          )}
          data-tauri-drag-region
          >
            <Shield size={12} class={clsx("text-blue-300")} />
          </div>
          <span class={clsx("text-[13px] font-bold text-slate-100 tracking-tight truncate")} data-tauri-drag-region>Shieldr</span>
        </div>
      </div>

      {/* CENTER — context label (desktop only) */}
      <div
        class={clsx(
          "hidden md:flex items-center gap-1.5 text-[11.5px] text-slate-400 font-medium tracking-tight whitespace-nowrap",
          "px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08]"
        )}
        data-tauri-drag-region
      >
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.6)] shrink-0" />
        <span>Screen Protection</span>
      </div>

      {/* RIGHT — utility actions */}
      <div class={clsx("flex items-center shrink-0 gap-1 sm:gap-1.5")}>
        <Tooltip content="Check for updates" placement="bottom">
          <button
            type="button"
            data-tauri-no-drag
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
              size={13}
              class={clsx("sm:size-[14px]", updaterService.state().isChecking && "animate-spin text-zinc-300")}
            />
          </button>
        </Tooltip>

        {/* Divider */}
        <div class={clsx("hidden sm:block w-px h-4 bg-white/10 mx-0.5")} aria-hidden="true" />

        <Tooltip content="GitHub" placement="bottom">
          <button
            type="button"
            data-tauri-no-drag
            class={clsx(
              "inline-flex items-center justify-center w-7 h-7 rounded-md border border-transparent hover:border-white/15",
              "bg-transparent hover:bg-white/[0.08] text-slate-400 hover:text-white cursor-pointer transition-all"
            )}
            aria-label="GitHub Repository"
            onClick={handleOpenGithub}
          >
            <SiGithub size={13} class="sm:size-[14px]" />
          </button>
        </Tooltip>

        <Tooltip content="YouTube" placement="bottom-end">
          <button
            type="button"
            data-tauri-no-drag
            class={clsx(
              "inline-flex items-center justify-center w-7 h-7 rounded-md border border-transparent hover:border-white/15",
              "bg-transparent hover:bg-white/[0.08] text-slate-400 hover:text-red-400 cursor-pointer transition-all"
            )}
            aria-label="YouTube Channel"
            onClick={handleOpenYoutube}
          >
            <SiYoutube size={13} class="sm:size-[14px]" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
};
