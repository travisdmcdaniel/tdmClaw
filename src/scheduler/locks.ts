import type { Database } from "better-sqlite3";
import type { ScheduledJob } from "./types";
import { randomUUID } from "crypto";

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

/**
 * Attempts to atomically claim a job for execution.
 * Returns the claim token if successful, or null if the job was already claimed
 * or is no longer due.
 *
 * claimTtlMs controls how long a claim is considered valid before the scheduler
 * will re-attempt the job. It must be longer than the maximum expected job
 * runtime (requestTimeoutSeconds * maxToolIterations) to prevent concurrent
 * duplicate executions.
 */
export function tryClaimJob(db: Database, jobId: string, claimTtlMs: number): string | null {
  const claimToken = randomUUID();
  const now = new Date();

  const result = db
    .prepare(
      `UPDATE scheduled_jobs
       SET claimed_at = ?, claim_token = ?
       WHERE id = ?
         AND enabled = 1
         AND next_run_at <= ?
         AND (claimed_at IS NULL OR claimed_at < ?)`
    )
    .run(
      now.toISOString(),
      claimToken,
      jobId,
      now.toISOString(),
      new Date(now.getTime() - claimTtlMs).toISOString()
    );

  if ((result.changes ?? 0) === 0) return null;

  return claimToken;
}

/**
 * Releases a job claim after execution, setting the last run time and next run time.
 */
export function releaseJobClaim(
  db: Database,
  jobId: string,
  claimToken: string,
  nextRunAt: string
): void {
  db.prepare(
    `UPDATE scheduled_jobs
     SET claimed_at   = NULL,
         claim_token  = NULL,
         last_run_at  = ?,
         next_run_at  = ?,
         updated_at   = ?
     WHERE id = ? AND claim_token = ?`
  ).run(
    new Date().toISOString(),
    nextRunAt,
    new Date().toISOString(),
    jobId,
    claimToken
  );
}

/**
 * Returns all jobs that are due and unclaimed (or whose claim has expired).
 * Uses the same claimTtlMs as tryClaimJob so expiry semantics are consistent.
 */
export function getDueJobs(db: Database, claimTtlMs: number): ScheduledJob[] {
  const now = new Date();
  const claimExpiry = new Date(now.getTime() - claimTtlMs);

  return db
    .prepare(
      `SELECT ${JOB_COLUMNS} FROM scheduled_jobs
       WHERE enabled = 1
         AND next_run_at <= ?
         AND (claimed_at IS NULL OR claimed_at < ?)`
    )
    .all(now.toISOString(), claimExpiry.toISOString()) as ScheduledJob[];
}
