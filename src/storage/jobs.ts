import type { Database } from "better-sqlite3";
import type { ScheduledJob } from "../scheduler/types";

// Column list with snake_case→camelCase aliases so better-sqlite3 rows
// can be cast directly to ScheduledJob without manual mapping.
const JOB_COLUMNS = `
  id,
  name,
  type,
  cron_expr     AS cronExpr,
  timezone,
  enabled,
  payload_json  AS payloadJson,
  last_run_at   AS lastRunAt,
  next_run_at   AS nextRunAt,
  claimed_at    AS claimedAt,
  claim_token   AS claimToken,
  created_at    AS createdAt,
  updated_at    AS updatedAt
`.trim();

export function getJob(db: Database, id: string): ScheduledJob | null {
  return (
    (db
      .prepare(`SELECT ${JOB_COLUMNS} FROM scheduled_jobs WHERE id = ?`)
      .get(id) as ScheduledJob | undefined) ?? null
  );
}

export function getAllJobs(db: Database): ScheduledJob[] {
  return db
    .prepare(`SELECT ${JOB_COLUMNS} FROM scheduled_jobs ORDER BY name`)
    .all() as ScheduledJob[];
}

/**
 * Deletes all jobs whose IDs are not in the provided set.
 * Used to reconcile the DB with jobs.json when the file changes.
 * Jobs that are currently claimed (running) are left alone — they will
 * simply not be rescheduled after they finish.
 */
export function deleteJobsNotIn(db: Database, keepIds: Set<string>): number {
  if (keepIds.size === 0) {
    const result = db
      .prepare(`DELETE FROM scheduled_jobs WHERE claimed_at IS NULL`)
      .run();
    return result.changes;
  }
  const placeholders = Array.from(keepIds).map(() => "?").join(", ");
  const result = db
    .prepare(
      `DELETE FROM scheduled_jobs
       WHERE id NOT IN (${placeholders})
         AND claimed_at IS NULL`
    )
    .run(...keepIds);
  return result.changes;
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
       next_run_at  = CASE
                        WHEN excluded.cron_expr != scheduled_jobs.cron_expr
                        THEN excluded.next_run_at
                        ELSE scheduled_jobs.next_run_at
                      END,
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
