import type { Database } from "better-sqlite3";
import type { ScheduledJob } from "../scheduler/types";

export function getJob(db: Database, id: string): ScheduledJob | null {
  return (
    (db.prepare(`SELECT * FROM scheduled_jobs WHERE id = ?`).get(id) as ScheduledJob | undefined) ?? null
  );
}

export function getAllJobs(db: Database): ScheduledJob[] {
  return db.prepare(`SELECT * FROM scheduled_jobs ORDER BY name`).all() as ScheduledJob[];
}

export function upsertJob(db: Database, job: ScheduledJob): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO scheduled_jobs
       (id, name, type, cron_expr, timezone, enabled, payload_json, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name         = excluded.name,
       cron_expr    = excluded.cron_expr,
       timezone     = excluded.timezone,
       enabled      = excluded.enabled,
       payload_json = excluded.payload_json,
       next_run_at  = excluded.next_run_at,
       updated_at   = excluded.updated_at`
  ).run(
    job.id,
    job.name,
    job.type,
    job.cronExpr,
    job.timezone,
    job.enabled ? 1 : 0,
    job.payloadJson,
    job.nextRunAt,
    job.createdAt ?? now,
    now
  );
}
