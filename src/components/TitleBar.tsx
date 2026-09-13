import { Component } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SiGithub, SiYoutube } from "solid-icons/si";
import { RefreshCw, Shield } from "lucide-solid";
import { tauriBridge } from "../services/tauriBridge";
import { sound } from "../services/sound";
import { updaterService } from "../services/updater";

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
      await openUrl("https://www.youtube.com");
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
          <button
            type="button"
            class="win-btn win-close"
            title="Close Window"
            onClick={handleClose}
          />
          <button
            type="button"
            class="win-btn win-minimize"
            title="Minimize Window"
            onClick={handleMinimize}
          />
        </div>
        <div class="app-brand" data-tauri-drag-region>
          <Shield size={16} class="text-blue-400" />
          <span class="brand-title">Shieldr</span>
          <span class="brand-pill">{props.isLocked ? "Armed" : "Standby"}</span>
        </div>
      </div>

      <div class="titlebar-center" data-tauri-drag-region>
        <span class="title-subtext">Toddler & Touch Protection</span>
      </div>

      <div class="titlebar-right" data-tauri-drag-region>
        <div class="titlebar-actions">
          <button
            type="button"
            class="titlebar-icon-btn"
            title="Check for Updates"
            onClick={handleCheckUpdate}
            disabled={updaterService.state().isChecking}
          >
            <RefreshCw
              size={13}
              class={updaterService.state().isChecking ? "spin-animation text-blue-400" : ""}
            />
          </button>
          <button
            type="button"
            class="titlebar-icon-btn"
            title="GitHub Repository"
            onClick={handleOpenGithub}
          >
            <SiGithub size={13} />
          </button>
          <button
            type="button"
            class="titlebar-icon-btn"
            title="YouTube Demos & Guides"
            onClick={handleOpenYoutube}
          >
            <SiYoutube size={13} />
          </button>
        </div>
        <span class="security-chip">Encrypted Vault</span>
      </div>
    </header>
  );
};

