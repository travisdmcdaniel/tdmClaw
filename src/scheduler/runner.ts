import type { Database } from "better-sqlite3";
import type { AgentRuntime } from "../agent/runtime";
import type { ScheduledJob, PromptJobPayload } from "./types";
import { tryClaimJob, releaseJobClaim } from "./locks";
import { getNextRunAt } from "./timing";
import { saveJobRun } from "../storage/job-runs";
import { childLogger } from "../app/logger";
import { randomUUID } from "crypto";

const log = childLogger("scheduler");

/**
 * Attempts to claim and execute a prompt-driven job.
 * Calls agentRuntime.runTurn() with the job's prompt and delivers the response
 * via the provided sendMessage callback.
 *
 * claimTtlMs must be long enough to cover the worst-case job runtime
 * (requestTimeoutSeconds * maxToolIterations). If the job is still running
 * when the TTL expires the scheduler will treat it as stalled and re-run it.
 */
export async function runJob(
  db: Database,
  job: ScheduledJob,
  agentRuntime: AgentRuntime,
  sendMessage: (chatId: string, text: string) => Promise<void>,
  claimTtlMs: number
): Promise<void> {
  const claimToken = tryClaimJob(db, job.id, claimTtlMs);
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

  log.info({ jobId: job.id, name: job.name }, "Job started");

  let payload: PromptJobPayload;
  try {
    payload = JSON.parse(job.payloadJson) as PromptJobPayload;
  } catch {
    const errorText = "Invalid payloadJson — could not parse";
    log.error({ jobId: job.id }, errorText);
    saveJobRun(db, { id: runId, jobId: job.id, startedAt, finishedAt: new Date().toISOString(), status: "failure", errorText });
    const nextRunAt = getNextRunAt(job.cronExpr, job.timezone) ?? "";
    releaseJobClaim(db, job.id, claimToken, nextRunAt);
    return;
  }

  if (!payload.prompt || !payload.chatId) {
    const errorText = "Job payload missing prompt or chatId";
    log.error({ jobId: job.id, payload }, errorText);
    saveJobRun(db, { id: runId, jobId: job.id, startedAt, finishedAt: new Date().toISOString(), status: "failure", errorText });
    const nextRunAt = getNextRunAt(job.cronExpr, job.timezone) ?? "";
    releaseJobClaim(db, job.id, claimToken, nextRunAt);
    return;
  }

  try {
    const result = await agentRuntime.runTurn({
      userMessage: payload.prompt,
      sender: {
        telegramUserId: "scheduler",
        chatId: payload.chatId,
      },
    });

    const finishedAt = new Date().toISOString();
    saveJobRun(db, {
      id: runId,
      jobId: job.id,
      startedAt,
      finishedAt,
      status: "success",
      resultSummary: result.text.slice(0, 500),
    });

    const nextRunAt = getNextRunAt(job.cronExpr, job.timezone) ?? "";
    releaseJobClaim(db, job.id, claimToken, nextRunAt);

    log.info({ jobId: job.id, name: job.name }, "Job completed successfully");
    await sendMessage(payload.chatId, result.text);
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
    await sendMessage(payload.chatId, `Scheduled job "${job.name}" failed: ${errorText}`);
  }
}
