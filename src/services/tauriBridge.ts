import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { AppErrorPayload, PaginatedAuditLogs, ShieldProperties, ShieldStatus } from "../types";
import { PaginatedAuditLogsSchema, ShieldStatusSchema } from "../schemas";

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
  if (err instanceof TauriError) {
    throw err;
  }
  if (err instanceof z.ZodError) {
    const issues = (err as z.ZodError).issues;
    const detail = issues && Array.isArray(issues)
      ? issues.map((i) => `${i.path ? i.path.join(".") : "field"}: ${i.message}`).join("; ")
      : err.message;
    throw new TauriError({
      code: "VALIDATION_ERROR",
      message: `Invalid backend payload schema: ${detail}`,
    });
  }
  if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
    throw new TauriError(err as AppErrorPayload);
  }
  if (typeof err === "string") {
    // B-055: The previous implementation nested the JSON.parse try/catch
    // around the throw, causing the throw to be silently swallowed by the
    // catch and downgraded to a generic GENERAL_ERROR. Separate the two
    // concerns so a thrown TauriError propagates correctly.
    let parsed: AppErrorPayload | null = null;
    try {
      const raw = JSON.parse(err);
      if (raw && typeof raw === "object" && "code" in raw && "message" in raw) {
        parsed = raw as AppErrorPayload;
      }
    } catch {
      // Not a JSON string; fall through to the generic error case below.
    }
    if (parsed) {
      throw new TauriError(parsed);
    }
    throw new TauriError({ code: "GENERAL_ERROR", message: err });
  }
  throw new TauriError({ code: "UNKNOWN", message: String(err) });
}

export const tauriBridge = {
  // B-013: Validate all backend payloads at runtime via Zod
  async getShieldStatus(): Promise<ShieldStatus> {
    try {
      const raw = await invoke<unknown>("get_shield_status");
      return ShieldStatusSchema.parse(raw);
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async setupSecurity(pin: string, masterPassword: string): Promise<string> {
    try {
      const raw = await invoke<unknown>("setup_security", { pin, masterPassword });
      return z.string().parse(raw);
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async lockShield(): Promise<ShieldStatus> {
    try {
      const raw = await invoke<unknown>("lock_shield");
      return ShieldStatusSchema.parse(raw);
    } catch (e) {
      return handleInvokeError(e);
    }
  },

  async unlockShield(credential: string): Promise<ShieldStatus> {
    try {
      const raw = await invoke<unknown>("unlock_shield", { credential });
      return ShieldStatusSchema.parse(raw);
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

  // B-033: PIN rotation requires the master password (not the current PIN).
  // The Rust `change_pin` command verifies only against the master hash.
  async changePin(currentMaster: string, newPin: string): Promise<void> {
    try {
      return await invoke<void>("change_pin", { currentMaster, newPin });
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
      const raw = await invoke<unknown>("reveal_recovery_phrase", { masterPassword });
      return z.string().parse(raw);
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

  async getAuditLogs(page: number = 1, pageSize: number = 10): Promise<PaginatedAuditLogs> {
    try {
      const raw = await invoke<unknown>("get_audit_logs", { page, pageSize });
      return PaginatedAuditLogsSchema.parse(raw);
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

  async requestHideWindowUnlocked(): Promise<void> {
    try {
      return await invoke<void>("request_hide_window_unlocked");
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

  async closeSplashscreen(): Promise<void> {
    try {
      return await invoke<void>("close_splashscreen");
    } catch (e) {
      return handleInvokeError(e);
    }
  },
};
