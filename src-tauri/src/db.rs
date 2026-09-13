use std::{
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShieldProperties {
    pub overlay_opacity: f32,
    pub overlay_blur: u32,
    pub lock_icon_position: String,
    pub lock_icon_autohide_secs: u32,
    pub sound_enabled: bool,
    pub max_failed_attempts: u32,
    pub lockout_duration_secs: u32,
    pub has_pin_configured: bool,
    pub has_master_password: bool,
    pub has_reset_phrase: bool,
    pub keep_awake: bool,
}

impl Default for ShieldProperties {
    fn default() -> Self {
        Self {
            overlay_opacity: 0.02,
            overlay_blur: 0,
            lock_icon_position: "floating".to_string(),
            lock_icon_autohide_secs: 3,
            sound_enabled: true,
            max_failed_attempts: 5,
            lockout_duration_secs: 30,
            has_pin_configured: false,
            has_master_password: false,
            has_reset_phrase: false,
            keep_awake: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub id: i64,
    pub event_type: String,
    pub details: String,
    pub timestamp: String,
}

#[derive(Clone)]
pub struct SqliteStore {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteStore {
    /// B-069: Acquire the SQLite mutex, recovering from poisoning so a
    /// panic in one accessor doesn't permanently break the database for
    /// the rest of the process. The poison error is logged and the inner
    /// lock state is preserved.
    fn lock_conn(&self) -> AppResult<MutexGuard<'_, Connection>> {
        match self.conn.lock() {
            Ok(g) => Ok(g),
            Err(p) => {
                eprintln!("WARN: SQLite mutex was poisoned, recovering.");
                Ok(p.into_inner())
            }
        }
    }

    pub fn new<P: AsRef<Path>>(db_path: P) -> AppResult<Self> {
        if let Some(parent) = db_path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(db_path)?;

        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        store.init_schema()?;
        Ok(store)
    }

    fn init_schema(&self) -> AppResult<()> {
        let conn = self.lock_conn()?;

        // 1. Properties table (strictly non-secret metadata & UI preferences)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS properties (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
            [],
        )?;

        // 2. Security Audit Log table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                details TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );",
            [],
        )?;

        // 3. Rate limiter state
        conn.execute(
            "CREATE TABLE IF NOT EXISTS rate_limiter (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                failed_attempts INTEGER NOT NULL DEFAULT 0,
                locked_until TEXT
            );",
            [],
        )?;

        // Seed rate limiter row if missing
        conn.execute(
            "INSERT OR IGNORE INTO rate_limiter (id, failed_attempts, locked_until)
             VALUES (1, 0, NULL);",
            [],
        )?;

        Ok(())
    }

    pub fn get_property(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT value FROM properties WHERE key = ?1;")?;
        let mut rows = stmt.query(params![key])?;

        if let Some(row) = rows.next()? {
            let val: String = row.get(0)?;
            Ok(Some(val))
        } else {
            Ok(None)
        }
    }

    pub fn set_property(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.lock_conn()?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO properties (key, value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;",
            params![key, value, now],
        )?;
        Ok(())
    }

    pub fn get_all_properties(&self) -> AppResult<ShieldProperties> {
        let mut props = ShieldProperties::default();

        if let Some(v) = self.get_property("overlay_opacity")? {
            if let Ok(num) = v.parse::<f32>() {
                props.overlay_opacity = num;
            }
        }
        if let Some(v) = self.get_property("overlay_blur")? {
            if let Ok(num) = v.parse::<u32>() {
                props.overlay_blur = num;
            }
        }
        if let Some(v) = self.get_property("lock_icon_position")? {
            props.lock_icon_position = v;
        }
        if let Some(v) = self.get_property("lock_icon_autohide_secs")? {
            if let Ok(num) = v.parse::<u32>() {
                props.lock_icon_autohide_secs = num;
            }
        }
        if let Some(v) = self.get_property("sound_enabled")? {
            props.sound_enabled = v == "true" || v == "1";
        }
        if let Some(v) = self.get_property("max_failed_attempts")? {
            if let Ok(num) = v.parse::<u32>() {
                props.max_failed_attempts = num;
            }
        }
        if let Some(v) = self.get_property("lockout_duration_secs")? {
            if let Ok(num) = v.parse::<u32>() {
                props.lockout_duration_secs = num;
            }
        }
        if let Some(v) = self.get_property("has_pin_configured")? {
            props.has_pin_configured = v == "true" || v == "1";
        }
        if let Some(v) = self.get_property("has_master_password")? {
            props.has_master_password = v == "true" || v == "1";
        }
        if let Some(v) = self.get_property("has_reset_phrase")? {
            props.has_reset_phrase = v == "true" || v == "1";
        }
        if let Some(v) = self.get_property("keep_awake")? {
            props.keep_awake = v == "true" || v == "1";
        }

        Ok(props)
    }

    pub fn save_all_properties(&self, props: &ShieldProperties) -> AppResult<()> {
        self.set_property("overlay_opacity", &props.overlay_opacity.to_string())?;
        self.set_property("overlay_blur", &props.overlay_blur.to_string())?;
        self.set_property("lock_icon_position", &props.lock_icon_position)?;
        self.set_property(
            "lock_icon_autohide_secs",
            &props.lock_icon_autohide_secs.to_string(),
        )?;
        self.set_property("sound_enabled", if props.sound_enabled { "1" } else { "0" })?;
        self.set_property(
            "max_failed_attempts",
            &props.max_failed_attempts.to_string(),
        )?;
        self.set_property(
            "lockout_duration_secs",
            &props.lockout_duration_secs.to_string(),
        )?;
        self.set_property(
            "has_pin_configured",
            if props.has_pin_configured { "1" } else { "0" },
        )?;
        self.set_property(
            "has_master_password",
            if props.has_master_password { "1" } else { "0" },
        )?;
        self.set_property(
            "has_reset_phrase",
            if props.has_reset_phrase { "1" } else { "0" },
        )?;
        self.set_property("keep_awake", if props.keep_awake { "1" } else { "0" })?;
        Ok(())
    }

    pub fn record_audit_event(&self, event_type: &str, details: &str) -> AppResult<()> {
        let conn = self.lock_conn()?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO audit_logs (event_type, details, timestamp) VALUES (?1, ?2, ?3);",
            params![event_type, details, now],
        )?;
        Ok(())
    }

    /// B-064: Best-effort audit logging. Returns `()` regardless of outcome.
    /// Use this in non-critical paths where audit failure must not break the
    /// user-facing operation (e.g. setup_security, change_pin, lock/unlock).
    pub fn audit_log_best_effort(&self, event_type: &str, details: &str) {
        if let Err(e) = self.record_audit_event(event_type, details) {
            eprintln!("Audit log failure for {event_type}: {e}");
        }
    }

    pub fn get_audit_logs(&self, limit: u32) -> AppResult<Vec<AuditLogEntry>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, event_type, details, timestamp
             FROM audit_logs
             ORDER BY id DESC
             LIMIT ?1;",
        )?;

        let rows = stmt.query_map(params![limit], |row| {
            Ok(AuditLogEntry {
                id: row.get(0)?,
                event_type: row.get(1)?,
                details: row.get(2)?,
                timestamp: row.get(3)?,
            })
        })?;

        let mut logs = Vec::new();
        for item in rows {
            logs.push(item?);
        }

        Ok(logs)
    }

    /// Checks if the system is currently locked out.
    /// Returns Some(remaining_seconds) if locked out, None otherwise.
    pub fn check_lockout(&self) -> AppResult<Option<u64>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT locked_until FROM rate_limiter WHERE id = 1;")?;
        let mut rows = stmt.query([])?;

        if let Some(row) = rows.next()? {
            let locked_until: Option<String> = row.get(0)?;
            if let Some(lock_str) = locked_until {
                if let Ok(until_dt) = chrono::DateTime::parse_from_rfc3339(&lock_str) {
                    let until_utc = until_dt.with_timezone(&Utc);
                    let now = Utc::now();
                    if until_utc > now {
                        // B-066: Use saturating arithmetic so a corrupted
                        // `locked_until` written by another process (or a
                        // wildly-future clock) cannot panic with i64
                        // overflow. Clamp to 1 second minimum so the UI
                        // doesn't display "0s" right before expiring.
                        let diff = (until_utc - now).num_seconds();
                        let clamped = diff.clamp(1, i64::from(u32::MAX)) as u64;
                        return Ok(Some(clamped));
                    }
                }
            }
        }

        Ok(None)
    }

    /// Records a failed unlock attempt and triggers lockout if max attempts reached.
    pub fn record_failed_attempt(
        &self,
        max_attempts: u32,
        lockout_duration_secs: u32,
    ) -> AppResult<(u32, bool, Option<u64>)> {
        let conn = self.lock_conn()?;
        let mut stmt =
            conn.prepare("SELECT failed_attempts, locked_until FROM rate_limiter WHERE id = 1;")?;
        let mut rows = stmt.query([])?;

        let mut current_attempts: u32 = 0;
        if let Some(row) = rows.next()? {
            current_attempts = row.get(0)?;
        }
        drop(rows);
        drop(stmt);

        let new_attempts = current_attempts + 1;
        let is_locked_out = new_attempts >= max_attempts;

        if is_locked_out {
            let lock_until =
                (Utc::now() + chrono::Duration::seconds(lockout_duration_secs as i64)).to_rfc3339();
            conn.execute(
                "UPDATE rate_limiter SET failed_attempts = ?1, locked_until = ?2 WHERE id = 1;",
                params![new_attempts, lock_until],
            )?;
            Ok((new_attempts, true, Some(lockout_duration_secs as u64)))
        } else {
            conn.execute(
                "UPDATE rate_limiter SET failed_attempts = ?1 WHERE id = 1;",
                params![new_attempts],
            )?;
            Ok((new_attempts, false, None))
        }
    }

    /// Clears failed attempts and removes lockout on successful unlock.
    pub fn reset_rate_limiter(&self) -> AppResult<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE rate_limiter SET failed_attempts = 0, locked_until = NULL WHERE id = 1;",
            [],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sqlite_properties_and_audit() {
        let store = SqliteStore::new(":memory:").expect("In-memory SQLite should initialize");

        let mut props = store
            .get_all_properties()
            .expect("Should read default properties");
        assert_eq!(props.overlay_opacity, 0.02);
        assert_eq!(props.sound_enabled, true);
        assert_eq!(props.keep_awake, true);

        props.overlay_opacity = 0.15;
        props.sound_enabled = false;
        props.has_pin_configured = true;
        props.keep_awake = false;
        store
            .save_all_properties(&props)
            .expect("Should save properties");

        let updated = store
            .get_all_properties()
            .expect("Should read updated properties");
        assert_eq!(updated.overlay_opacity, 0.15);
        assert_eq!(updated.sound_enabled, false);
        assert_eq!(updated.has_pin_configured, true);
        assert_eq!(updated.keep_awake, false);

        // Audit log test
        store
            .record_audit_event("TEST_EVENT", "Sample detail")
            .expect("Audit logging should work");
        let logs = store.get_audit_logs(10).expect("Should query audit logs");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].event_type, "TEST_EVENT");
        assert_eq!(logs[0].details, "Sample detail");

        // Rate limiter test
        let (attempts, is_locked, _) = store.record_failed_attempt(3, 10).expect("Record attempt");
        assert_eq!(attempts, 1);
        assert!(!is_locked);

        store.record_failed_attempt(3, 10).unwrap();
        let (attempts3, is_locked3, secs) = store.record_failed_attempt(3, 10).unwrap();
        assert_eq!(attempts3, 3);
        assert!(is_locked3);
        assert!(secs.is_some());
        assert!(store.check_lockout().unwrap().is_some());

        store.reset_rate_limiter().unwrap();
        assert!(store.check_lockout().unwrap().is_none());
    }
}
