import { check, Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { createSignal } from "solid-js";

export interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

export interface UpdaterState {
  currentVersion: string;
  isChecking: boolean;
  updateAvailable: boolean;
  updateInfo: UpdateInfo | null;
  isDownloading: boolean;
  progressPercent: number;
  isDownloaded: boolean;
  error: string | null;
}

const [updaterState, setUpdaterState] = createSignal<UpdaterState>({
  currentVersion: "",
  isChecking: false,
  updateAvailable: false,
  updateInfo: null,
  isDownloading: false,
  progressPercent: 0,
  isDownloaded: false,
  error: null,
});

// Dynamically fetch application version from native host via Tauri getVersion API
const initAppVersion = async () => {
  try {
    const v = await getVersion();
    if (v) {
      setUpdaterState((s) => ({ ...s, currentVersion: v }));
      return v;
    }
  } catch (err) {
    console.warn("Unable to fetch app version from Tauri API:", err);
  }
  return "";
};

void initAppVersion();

let pendingUpdate: Update | null = null;

export const updaterService = {
  state: updaterState,
  getAppVersion: initAppVersion,

  async checkForUpdates(silent = false): Promise<UpdateInfo | null> {
    setUpdaterState((s) => ({
      ...s,
      isChecking: true,
      error: null,
    }));

    try {
      const update = await check();
      if (update) {
        pendingUpdate = update;
        const info: UpdateInfo = {
          version: update.version,
          date: update.date,
          body: update.body,
        };

        setUpdaterState((s) => ({
          ...s,
          isChecking: false,
          updateAvailable: true,
          updateInfo: info,
          error: null,
        }));
        return info;
      } else {
        pendingUpdate = null;
        setUpdaterState((s) => ({
          ...s,
          isChecking: false,
          updateAvailable: false,
          updateInfo: null,
          error: null,
        }));
        return null;
      }
    } catch (err: unknown) {
      pendingUpdate = null;
      const errorMsg =
        err instanceof Error ? err.message : String(err) || "Failed to check for updates.";
      console.warn("Updater check error:", errorMsg);
      setUpdaterState((s) => ({
        ...s,
        isChecking: false,
        updateAvailable: false,
        updateInfo: null,
        error: silent ? null : errorMsg,
      }));
      return null;
    }
  },

  async downloadAndInstallUpdate(onDone?: () => void): Promise<void> {
    if (!pendingUpdate) {
      const info = await this.checkForUpdates(false);
      if (!info || !pendingUpdate) {
        throw new Error("No update currently available to download.");
      }
    }

    setUpdaterState((s) => ({
      ...s,
      isDownloading: true,
      progressPercent: 0,
      error: null,
    }));

    try {
      let downloadedBytes = 0;
      let totalBytes = 0;

      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength || 0;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            setUpdaterState((s) => ({ ...s, progressPercent: percent }));
          }
        } else if (event.event === "Finished") {
          setUpdaterState((s) => ({
            ...s,
            isDownloading: false,
            isDownloaded: true,
            progressPercent: 100,
          }));
        }
      });

      setUpdaterState((s) => ({
        ...s,
        isDownloading: false,
        isDownloaded: true,
        progressPercent: 100,
      }));

      if (onDone) onDone();
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to download and install update.";
      setUpdaterState((s) => ({
        ...s,
        isDownloading: false,
        error: errorMsg,
      }));
      throw err;
    }
  },
};
