import { statSync } from "fs";
import { resolve, isAbsolute, join } from "path";
import type { Database } from "better-sqlite3";
import type { AppConfig } from "../app/config";
import type { AgentRuntime } from "../agent/runtime";
import type { TelegramBot } from "../telegram/bot";
import { getDueJobs } from "./locks";
import { runJob } from "./runner";
import { loadJobsFromFile } from "./jobs-loader";
import { childLogger } from "../app/logger";

const log = childLogger("scheduler");

export type SchedulerService = {
  start(): void;
  stop(): void;
};

export type SchedulerDeps = {
  config: AppConfig;
  db: Database;
  agentRuntime: AgentRuntime;
  bot: TelegramBot;
  /** Called before each job's agent turn — use to pre-warm credentials. */
  preRunHook?: () => Promise<void>;
};

/**
 * Creates the in-process scheduler that polls for due jobs and executes them.
 * Each job is a prompt-driven agent turn: the scheduler reads the prompt from
 * the job's payloadJson, calls agentRuntime.runTurn(), and delivers the
 * response to the job's chatId via bot.sendMessage().
 *
 * jobs.json is the source of truth. On each poll tick the scheduler checks
 * the file's mtime; if it changed since the last reload, it calls
 * loadJobsFromFile() to reconcile the DB (upsert new/changed jobs, remove
 * deleted ones) before processing due jobs.
 */
export function createSchedulerService(deps: SchedulerDeps): SchedulerService {
  const { config, db, agentRuntime, bot, preRunHook } = deps;
  let timer: ReturnType<typeof setInterval> | null = null;

  const jobsFilePath = isAbsolute(config.scheduler.jobsFile)
    ? config.scheduler.jobsFile
    : resolve(join(config.workspace.root, config.scheduler.jobsFile));

  // Claim TTL must exceed the worst-case job runtime so the scheduler doesn't
  // re-execute a still-running job. Worst case: every tool iteration hits the
  // full request timeout, plus a 60-second safety buffer.
  const claimTtlMs =
    (config.models.requestTimeoutSeconds * config.models.maxToolIterations + 60) * 1000;

  let lastMtimeMs = 0;

  function reloadIfChanged(): void {
    try {
      const mtimeMs = statSync(jobsFilePath).mtimeMs;
      if (mtimeMs === lastMtimeMs) return;
      lastMtimeMs = mtimeMs;
      log.info({ path: jobsFilePath }, "jobs.json changed — reloading");
      loadJobsFromFile(db, config.scheduler.jobsFile, config.workspace.root);
    } catch {
      // File doesn't exist yet — nothing to reload
    }
  }

  async function sendMessage(chatId: string, text: string): Promise<void> {
    try {
      await bot.sendMessage(chatId, text);
    } catch (err) {
      log.error({ chatId, err }, "Failed to deliver job result to Telegram");
    }
  }

  async function tick(): Promise<void> {
    reloadIfChanged();

    const dueJobs = getDueJobs(db, claimTtlMs);
    if (dueJobs.length === 0) return;

    log.info({ count: dueJobs.length }, "Processing due jobs");

    for (const job of dueJobs) {
      // Fire and forget — each job runs independently
      void runJob(db, job, agentRuntime, sendMessage, claimTtlMs, preRunHook);
    }
  }

  return {
    start(): void {
      // Capture the mtime of the file as it existed at startup so the first
      // tick doesn't trigger a redundant reload (bootstrap already called
      // loadJobsFromFile).
      try {
        lastMtimeMs = statSync(jobsFilePath).mtimeMs;
      } catch {
        // File doesn't exist yet — first write will trigger a reload
      }

      log.info(
        { pollIntervalSeconds: config.scheduler.pollIntervalSeconds },
        "Scheduler started"
      );
      timer = setInterval(
        () => void tick(),
        config.scheduler.pollIntervalSeconds * 1000
      );
    },

    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
        log.info("Scheduler stopped");
      }
    },
  };
}
