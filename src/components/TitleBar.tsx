import { Component } from "solid-js";
import { tauriBridge } from "../services/tauriBridge";
import { sound } from "../services/sound";

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
          <span class="brand-icon">🛡️</span>
          <span class="brand-title">Shieldr</span>
          <span class="brand-pill">{props.isLocked ? "Armed" : "Standby"}</span>
        </div>
      </div>

      <div class="titlebar-center" data-tauri-drag-region>
        <span class="title-subtext">Toddler & Touch Protection</span>
      </div>

      <div class="titlebar-right" data-tauri-drag-region>
        <span class="security-chip">Encrypted Vault</span>
      </div>
    </header>
  );
};
