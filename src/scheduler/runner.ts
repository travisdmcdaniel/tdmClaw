import type { Database } from "better-sqlite3";
import type { AgentRuntime } from "../agent/runtime";
import type { ScheduledJob, PromptJobPayload } from "./types";
import { tryClaimJob, releaseJobClaim } from "./locks";
import { getNextRunAt } from "./timing";
import { saveJobRun, countConsecutiveFailures } from "../storage/job-runs";
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
 *
 * preRunHook, if provided, is awaited before the agent turn. Use it to
 * pre-warm credentials (e.g. refresh an OAuth token) so the first tool call
 * doesn't pay the refresh cost mid-execution.
 */
export async function runJob(
  db: Database,
  job: ScheduledJob,
  agentRuntime: AgentRuntime,
  sendMessage: (chatId: string, text: string) => Promise<void>,
  claimTtlMs: number,
  consecutiveFailureAlertThreshold: number,
  preRunHook?: () => Promise<void>
): Promise<void> {
  const claimToken = tryClaimJob(db, job.id, claimTtlMs);
  if (!claimToken) {
    log.debug({ jobId: job.id }, "Job already claimed or no longer due — skipping");
    return;
  }

  // Parse payload before claiming/saving so chatId is always available for
  // error reporting and the claim is never taken if the payload is malformed.
  let payload: PromptJobPayload;
  try {
    payload = JSON.parse(job.payloadJson) as PromptJobPayload;
  } catch {
    log.error({ jobId: job.id }, "Invalid payloadJson — could not parse");
    const nextRunAt = getNextRunAt(job.cronExpr, job.timezone) ?? "";
    releaseJobClaim(db, job.id, claimToken, nextRunAt);
    return;
  }

  if (!payload.prompt || !payload.chatId) {
    log.error({ jobId: job.id }, "Job payload missing prompt or chatId");
    const nextRunAt = getNextRunAt(job.cronExpr, job.timezone) ?? "";
    releaseJobClaim(db, job.id, claimToken, nextRunAt);
    return;
  }

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  // Track whether the "running" job_run row was saved so the catch block
  // knows whether to update it to "failure" or skip.
  let jobRunSaved = false;

  try {
    saveJobRun(db, { id: runId, jobId: job.id, startedAt, status: "running" });
    jobRunSaved = true;

    log.info({ jobId: job.id, name: job.name }, "Job started");

    if (preRunHook) {
      await preRunHook();
    }

    const result = await agentRuntime.runTurn({
      userMessage: payload.prompt,
      sender: {
        telegramUserId: "scheduler",
        chatId: payload.chatId,
      },
      isolatedSession: true,
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

    if (jobRunSaved) {
      saveJobRun(db, { id: runId, jobId: job.id, startedAt, finishedAt, status: "failure", errorText });
    }

    // Always release the claim so the job can be retried on the next run.
    const nextRunAt = getNextRunAt(job.cronExpr, job.timezone) ?? "";
    releaseJobClaim(db, job.id, claimToken, nextRunAt);

    log.error({ jobId: job.id, name: job.name, err }, "Job failed");

    // Count consecutive failures (including the one just saved) and escalate
    // once the threshold is reached. Below the threshold send a plain notice.
    const consecutiveFailures = countConsecutiveFailures(db, job.id);
    if (consecutiveFailures >= consecutiveFailureAlertThreshold) {
      await sendMessage(
        payload.chatId,
        `⚠️ Scheduled job "${job.name}" has failed ${consecutiveFailures} consecutive times.\n` +
          `Last error: ${errorText}`
      );
    } else {
      await sendMessage(
        payload.chatId,
        `Scheduled job "${job.name}" failed: ${errorText}`
      );
    }
  }
}
