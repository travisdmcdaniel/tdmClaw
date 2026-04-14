import type { Database } from "better-sqlite3";
import type { ScheduledJob, JobHandler } from "./types";
import { tryClaimJob, releaseJobClaim } from "./locks";
import { getNextRunAt } from "./timing";
import { saveJobRun } from "../storage/job-runs";
import { childLogger } from "../app/logger";
import { randomUUID } from "crypto";

const log = childLogger("scheduler");

/**
 * Attempts to execute a job if it can be claimed.
 * Records a run history entry regardless of success or failure.
 */
export async function runJob(
  db: Database,
  job: ScheduledJob,
  handler: JobHandler,
  onComplete?: (jobId: string, summary: string) => void,
  onFailure?: (jobId: string, error: string) => void
): Promise<void> {
  const claimToken = tryClaimJob(db, job.id);
  if (!claimToken) {
    log.debug({ jobId: job.id }, "Job already claimed or no longer due — skipping");
    return;
  }

  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  saveJobRun(db, {
    id: runId,
    jobId: job.id,
    startedAt,
    status: "running",
  });

  log.info({ jobId: job.id, name: job.name, type: job.type }, "Job started");

  let payload: unknown;
  try {
    payload = JSON.parse(job.payloadJson);
  } catch {
    payload = {};
  }

  try {
    const { summary } = await handler(job, payload);
    const finishedAt = new Date().toISOString();

    saveJobRun(db, {
      id: runId,
      jobId: job.id,
      startedAt,
      finishedAt,
      status: "success",
      resultSummary: summary,
    });

    const nextRunAt = getNextRunAt(job.cronExpr, job.timezone) ?? "";
    releaseJobClaim(db, job.id, claimToken, nextRunAt);

    log.info({ jobId: job.id, name: job.name }, "Job completed successfully");
    onComplete?.(job.id, summary);
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const errorText = err instanceof Error ? err.message : String(err);

    saveJobRun(db, {
      id: runId,
      jobId: job.id,
      startedAt,
      finishedAt,
      status: "failure",
      errorText,
    });

    const nextRunAt = getNextRunAt(job.cronExpr, job.timezone) ?? "";
    releaseJobClaim(db, job.id, claimToken, nextRunAt);

    log.error({ jobId: job.id, name: job.name, err }, "Job failed");
    onFailure?.(job.id, errorText);
  }
}
