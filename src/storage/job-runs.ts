import type { Database } from "better-sqlite3";
import type { JobRun } from "../scheduler/types";

export function saveJobRun(db: Database, run: Partial<JobRun> & Pick<JobRun, "id" | "jobId" | "startedAt" | "status">): void {
  db.prepare(
    `INSERT INTO job_runs (id, job_id, started_at, finished_at, status, result_summary, error_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       finished_at    = excluded.finished_at,
       status         = excluded.status,
       result_summary = excluded.result_summary,
       error_text     = excluded.error_text`
  ).run(
    run.id,
    run.jobId,
    run.startedAt,
    run.finishedAt ?? null,
    run.status,
    run.resultSummary ?? null,
    run.errorText ?? null
  );
}

export function getJobRuns(db: Database, jobId: string, limit = 20): JobRun[] {
  return db
    .prepare(
      `SELECT id, job_id as jobId, started_at as startedAt, finished_at as finishedAt,
              status, result_summary as resultSummary, error_text as errorText
       FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?`
    )
    .all(jobId, limit) as JobRun[];
}

/**
 * Returns the number of consecutive terminal failures at the end of a job's
 * run history. Only "failure" rows count; a "success" or "running" row resets
 * the streak to zero. Looks at the most recent `lookback` runs.
 */
export function countConsecutiveFailures(
  db: Database,
  jobId: string,
  lookback = 10
): number {
  const runs = getJobRuns(db, jobId, lookback);
  let count = 0;
  for (const run of runs) {
    if (run.status === "failure") {
      count++;
    } else {
      break;
    }
  }
  return count;
}
