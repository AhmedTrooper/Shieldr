import { invoke } from "@tauri-apps/api/core";
import { AppErrorPayload, AuditLogEntry, ShieldProperties, ShieldStatus } from "../types";

export class TauriError extends Error {
  public code: string;
  public remainingSeconds?: number;

  constructor(payload: AppErrorPayload) {
    super(payload.message || "An unknown error occurred");
    this.name = "TauriError";
    this.code = payload.code || "UNKNOWN";
    this.remainingSeconds = payload.remaining_seconds;
  }
}

function handleInvokeError(err: unknown): never {
  if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
    throw new TauriError(err as AppErrorPayload);
  }
  if (typeof err === "string") {
    try {
      const parsed = JSON.parse(err);
      if (parsed.code && parsed.message) {
        throw new TauriError(parsed);
      }
    } catch {
      // not JSON string
    }
    throw new TauriError({ code: "GENERAL_ERROR", message: err });
  }
  throw new TauriError({ code: "UNKNOWN", message: String(err) });
}

export const tauriBridge = {
  async getShieldStatus(): Promise<ShieldStatus> {
    try {
      return await invoke<ShieldStatus>("get_shield_status");
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async setupSecurity(pin: string, masterPassword: string): Promise<string> {
    try {
      return await invoke<string>("setup_security", { pin, masterPassword });
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async lockShield(): Promise<ShieldStatus> {
    try {
      return await invoke<ShieldStatus>("lock_shield");
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async unlockShield(credential: string): Promise<ShieldStatus> {
    try {
      return await invoke<ShieldStatus>("unlock_shield", { credential });
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async resetPinWithPhrase(recoveryPhrase: string, newPin: string): Promise<void> {
    try {
      return await invoke<void>("reset_pin_with_phrase", { recoveryPhrase, newPin });
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async changePin(currentCredential: string, newPin: string): Promise<void> {
    try {
      return await invoke<void>("change_pin", { currentCredential, newPin });
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async changeMasterPassword(currentMaster: string, newMaster: string): Promise<void> {
    try {
      return await invoke<void>("change_master_password", { currentMaster, newMaster });
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async revealRecoveryPhrase(masterPassword: string): Promise<string> {
    try {
      return await invoke<string>("reveal_recovery_phrase", { masterPassword });
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async saveProperties(properties: ShieldProperties): Promise<void> {
    try {
      return await invoke<void>("save_properties", { properties });
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async getAuditLogs(limit?: number): Promise<AuditLogEntry[]> {
    try {
      return await invoke<AuditLogEntry[]>("get_audit_logs", { limit });
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async requestCloseWindow(credential?: string): Promise<void> {
    try {
      return await invoke<void>("request_close_window", { credential });
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async requestHideWindow(credential?: string): Promise<void> {
    try {
      return await invoke<void>("request_hide_window", { credential });
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async minimizeWindow(): Promise<void> {
    try {
      return await invoke<void>("minimize_window");
    } catch (e) {
      return handleInvokeError(e);
    }
  },
};
