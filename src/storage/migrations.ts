import type { Database } from "better-sqlite3";
import { childLogger } from "../app/logger";

const log = childLogger("db");

type Migration = { version: number; sql: string };

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id                TEXT PRIMARY KEY,
        transport         TEXT NOT NULL,
        external_chat_id  TEXT NOT NULL,
        external_user_id  TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL,
        role          TEXT NOT NULL,
        content       TEXT NOT NULL,
        tool_name     TEXT,
        tool_call_id  TEXT,
        created_at    TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_id
        ON messages(session_id, created_at);

      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        type          TEXT NOT NULL,
        cron_expr     TEXT NOT NULL,
        timezone      TEXT NOT NULL,
        enabled       INTEGER NOT NULL DEFAULT 1,
        payload_json  TEXT NOT NULL DEFAULT '{}',
        last_run_at   TEXT,
        next_run_at   TEXT NOT NULL,
        claimed_at    TEXT,
        claim_token   TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_runs (
        id              TEXT PRIMARY KEY,
        job_id          TEXT NOT NULL,
        started_at      TEXT NOT NULL,
        finished_at     TEXT,
        status          TEXT NOT NULL,
        result_summary  TEXT,
        error_text      TEXT,
        FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_job_runs_job_id
        ON job_runs(job_id, started_at);

      CREATE TABLE IF NOT EXISTS oauth_states (
        state             TEXT PRIMARY KEY,
        provider          TEXT NOT NULL,
        telegram_chat_id  TEXT NOT NULL,
        telegram_user_id  TEXT NOT NULL,
        created_at        TEXT NOT NULL,
        expires_at        TEXT NOT NULL,
        consumed_at       TEXT
      );

      CREATE TABLE IF NOT EXISTS credentials (
        provider       TEXT PRIMARY KEY,
        account_label  TEXT,
        scopes_json    TEXT NOT NULL,
        token_json     TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE messages ADD COLUMN tool_calls_json TEXT;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER;
      ALTER TABLE messages ADD COLUMN completion_tokens INTEGER;
      ALTER TABLE sessions ADD COLUMN total_prompt_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN total_completion_tokens INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 4,
    sql: `
      -- Singleton table for user-uploaded Google OAuth client credentials
      CREATE TABLE IF NOT EXISTS google_client (
        id            INTEGER PRIMARY KEY CHECK (id = 1),
        client_id     TEXT NOT NULL,
        client_secret TEXT NOT NULL,
        project_id    TEXT,
        updated_at    TEXT NOT NULL
      );

      -- Add redirect_uri and hint_email to oauth_states (manual loopback flow)
      ALTER TABLE oauth_states ADD COLUMN redirect_uri TEXT NOT NULL DEFAULT '';
      ALTER TABLE oauth_states ADD COLUMN hint_email   TEXT;

      CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states (expires_at);
      CREATE INDEX IF NOT EXISTS idx_oauth_states_chat       ON oauth_states (telegram_chat_id);
    `,
  },
  {
    version: 5,
    sql: `
      -- Recreate job_runs with ON DELETE CASCADE so removing a job from
      -- jobs.json also removes its run history without a FK violation.
      -- SQLite requires a full table rebuild to change FK constraints.
      -- No PRAGMA foreign_keys toggle needed: DROP TABLE ignores FK constraints,
      -- and the INSERT copies existing data which is already referentially valid.
      CREATE TABLE job_runs_new (
        id              TEXT PRIMARY KEY,
        job_id          TEXT NOT NULL,
        started_at      TEXT NOT NULL,
        finished_at     TEXT,
        status          TEXT NOT NULL,
        result_summary  TEXT,
        error_text      TEXT,
        FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id) ON DELETE CASCADE
      );

      INSERT INTO job_runs_new SELECT * FROM job_runs;
      DROP TABLE job_runs;
      ALTER TABLE job_runs_new RENAME TO job_runs;

      CREATE INDEX IF NOT EXISTS idx_job_runs_job_id
        ON job_runs(job_id, started_at);
    `,
  },
];

/**
 * Runs all pending migrations against the database.
 * Uses a simple user_version pragma as the schema version tracker.
 */
export function runMigrations(db: Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  log.info({ currentVersion }, "Running migrations");

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);
  if (pending.length === 0) {
    log.info("Schema is up to date");
    return;
  }

  for (const migration of pending) {
    log.info({ version: migration.version }, "Applying migration");
    db.exec(migration.sql);
    db.pragma(`user_version = ${migration.version}`);
  }

  log.info({ appliedCount: pending.length }, "Migrations complete");
}
