import { z } from "zod";

/**
 * Zod schema for Shield UI properties and configuration
 */
export const ShieldPropertiesSchema = z.object({
  overlay_opacity: z.number().min(0).max(1).default(0.02),
  overlay_blur: z.number().min(0).max(50).default(0),
  lock_icon_position: z.enum(["floating", "center", "top-right", "bottom-right"]).default("floating"),
  lock_icon_autohide_secs: z.number().min(1).max(60).default(3),
  sound_enabled: z.boolean().default(true),
  max_failed_attempts: z.number().int().min(1).max(20).default(5),
  lockout_duration_secs: z.number().int().min(5).max(3600).default(30),
  has_pin_configured: z.boolean().default(false),
  has_master_password: z.boolean().default(false),
  has_reset_phrase: z.boolean().default(false),
  keep_awake: z.boolean().default(true),
});

export type ShieldProperties = z.infer<typeof ShieldPropertiesSchema>;

/**
 * Zod schema for Shield runtime status
 */
export const ShieldStatusSchema = z.object({
  is_locked: z.boolean().default(false),
  is_configured: z.boolean().default(false),
  is_locked_out: z.boolean().default(false),
  lockout_remaining_secs: z.number().nullish().transform((val) => val ?? null),
  properties: ShieldPropertiesSchema,
});

export type ShieldStatus = z.infer<typeof ShieldStatusSchema>;

/**
 * Zod schema for SQLite audit log entries
 */
export const AuditLogEntrySchema = z.object({
  id: z.number(),
  event_type: z.string(),
  details: z.string(),
  timestamp: z.string(),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

/**
 * Zod schema for paginated SQLite audit log entries
 */
export const PaginatedAuditLogsSchema = z.object({
  entries: z.array(AuditLogEntrySchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
});

export type PaginatedAuditLogs = z.infer<typeof PaginatedAuditLogsSchema>;

/**
 * Zod schema for backend error payloads
 */
export const AppErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  remaining_seconds: z.number().optional(),
});

export type AppErrorPayload = z.infer<typeof AppErrorPayloadSchema>;

/**
 * Zod schema for Initial Security Setup
 */
export const SetupSecuritySchema = z
  .object({
    pin: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, "PIN must be between 4 and 8 digits"),
    confirmPin: z.string().trim(),
    masterPassword: z
      .string()
      .min(6, "Master password must be at least 6 characters"),
    confirmMasterPassword: z.string().optional(),
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: "PIN and confirmation PIN do not match",
    path: ["confirmPin"],
  })
  .refine(
    (data) =>
      !data.confirmMasterPassword ||
      data.masterPassword === data.confirmMasterPassword,
    {
      message: "Master password and confirmation do not match",
      path: ["confirmMasterPassword"],
    }
  );

export type SetupSecurityInput = z.infer<typeof SetupSecuritySchema>;

/**
 * Zod schema for changing PIN.
 *
 * B-033: Pin rotation is now an explicit privileged action that requires the
 * Master Password — not the current PIN. This removes the ambiguity where
 * `change_pin` would accept either credential.
 */
export const ChangePinSchema = z.object({
  currentMaster: z.string().min(1, "Current master password is required"),
  newPin: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "New PIN must be between 4 and 8 digits"),
});

export type ChangePinInput = z.infer<typeof ChangePinSchema>;

/**
 * Zod schema for changing Master Password
 */
export const ChangeMasterPasswordSchema = z.object({
  currentMaster: z.string().min(1, "Current master password is required"),
  newMaster: z
    .string()
    .min(8, "New master password must be at least 8 characters"),
});

export type ChangeMasterPasswordInput = z.infer<typeof ChangeMasterPasswordSchema>;

/**
 * Zod schema for BIP-39 recovery phrase validation
 */
export const RecoveryPhraseResetSchema = z
  .object({
    recoveryPhrase: z
      .string()
      .trim()
      .refine(
        (val) => val.split(/\s+/).filter(Boolean).length === 12,
        "Recovery phrase must be exactly 12 words"
      ),
    newPin: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, "New PIN must be between 4 and 8 digits"),
    confirmPin: z.string().trim(),
  })
  .refine((data) => data.newPin === data.confirmPin, {
    message: "PIN and confirmation PIN do not match",
    path: ["confirmPin"],
  });

export type RecoveryPhraseResetInput = z.infer<typeof RecoveryPhraseResetSchema>;
