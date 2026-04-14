import type { Database } from "better-sqlite3";
import type { ScheduledJob } from "./types";
import { randomUUID } from "crypto";

const CLAIM_TTL_MINUTES = 5;

/**
 * Attempts to atomically claim a job for execution.
 * Returns the claim token if successful, or null if the job was already claimed
 * or is no longer due.
 */
export function tryClaimJob(db: Database, jobId: string): string | null {
  const claimToken = randomUUID();
  const now = new Date();
  const claimExpiry = new Date(now.getTime() + CLAIM_TTL_MINUTES * 60 * 1000);

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
      new Date(now.getTime() - CLAIM_TTL_MINUTES * 60 * 1000).toISOString()
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
 */
export function getDueJobs(db: Database): ScheduledJob[] {
  const now = new Date();
  const claimExpiry = new Date(now.getTime() - CLAIM_TTL_MINUTES * 60 * 1000);

  return db
    .prepare(
      `SELECT * FROM scheduled_jobs
       WHERE enabled = 1
         AND next_run_at <= ?
         AND (claimed_at IS NULL OR claimed_at < ?)`
    )
    .all(now.toISOString(), claimExpiry.toISOString()) as ScheduledJob[];
}
