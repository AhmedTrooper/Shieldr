import { Component } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SiGithub, SiYoutube } from "solid-icons/si";
import { RefreshCw, Shield } from "lucide-solid";
import { tauriBridge } from "../services/tauriBridge";
import { sound } from "../services/sound";
import { updaterService } from "../services/updater";
import { Tooltip } from "./ui/tooltip";

interface TitleBarProps {
  isLocked: boolean;
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
    <header class="custom-titlebar" data-tauri-drag-region>
      <div class="titlebar-left" data-tauri-drag-region>
        <div class="window-controls">
          <Tooltip content="Close to tray" placement="bottom-start">
            <button
              type="button"
              class="win-btn win-close"
              aria-label="Close Window"
              onClick={handleClose}
            />
          </Tooltip>
          <Tooltip content="Minimize" placement="bottom">
            <button
              type="button"
              class="win-btn win-minimize"
              aria-label="Minimize Window"
              onClick={handleMinimize}
            />
          </Tooltip>
        </div>
        <div class="app-brand" data-tauri-drag-region>
          <Shield size={16} class="text-zinc-200 brand-icon" />
          <span class="brand-title">Shieldr</span>
          <span class="brand-pill">{props.isLocked ? "Armed" : "Ready"}</span>
        </div>
      </div>

      <div class="titlebar-center" data-tauri-drag-region>
        <span class="title-subtext">Screen Protection</span>
      </div>

      <div class="titlebar-right" data-tauri-drag-region>
        <div class="titlebar-actions">
          <Tooltip content="Check for updates" placement="bottom">
            <button
              type="button"
              class="titlebar-icon-btn"
              aria-label="Check for Updates"
              onClick={handleCheckUpdate}
              disabled={updaterService.state().isChecking}
            >
              <RefreshCw
                size={15}
                class={updaterService.state().isChecking ? "spin-animation text-zinc-300" : ""}
              />
            </button>
          </Tooltip>
          <Tooltip content="GitHub" placement="bottom">
            <button
              type="button"
              class="titlebar-icon-btn"
              aria-label="GitHub Repository"
              onClick={handleOpenGithub}
            >
              <SiGithub size={15} />
            </button>
          </Tooltip>
          <Tooltip content="YouTube" placement="bottom-end">
            <button
              type="button"
              class="titlebar-icon-btn"
              aria-label="YouTube Channel"
              onClick={handleOpenYoutube}
            >
              <SiYoutube size={15} />
            </button>
          </Tooltip>
        </div>
        <span class="security-chip">Encrypted</span>
      </div>
    </header>
  );
};
