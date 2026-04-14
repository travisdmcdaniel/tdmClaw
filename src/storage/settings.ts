import type { Database } from "better-sqlite3";

export type SettingsStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
};

/**
 * A simple key-value store backed by the settings table.
 * Used for runtime-mutable config like the active model selection.
 */
export function createSettingsStore(db: Database): SettingsStore {
  return {
    get(key: string): string | null {
      const row = db
        .prepare(`SELECT value FROM settings WHERE key = ?`)
        .get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },

    set(key: string, value: string): void {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(key, value, now);
    },

    delete(key: string): void {
      db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
    },
  };
}
