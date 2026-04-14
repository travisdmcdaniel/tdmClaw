import type { Database } from "better-sqlite3";
import type { AppConfig } from "../app/config";
import type { AgentRuntime } from "../agent/runtime";
import type { TelegramBot } from "../telegram/bot";
import type { JobHandler } from "./types";
import { getDueJobs } from "./locks";
import { runJob } from "./runner";
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
};

/**
 * Creates the in-process scheduler that polls for due jobs and executes them.
 */
export function createSchedulerService(deps: SchedulerDeps): SchedulerService {
  const { config, db, bot } = deps;
  let timer: ReturnType<typeof setInterval> | null = null;

  // TODO (Phase 4): register built-in job handlers
  const handlers = new Map<string, JobHandler>();

  async function tick(): Promise<void> {
    const dueJobs = getDueJobs(db);
    if (dueJobs.length === 0) return;

    log.info({ count: dueJobs.length }, "Processing due jobs");

    for (const job of dueJobs) {
      const handler = handlers.get(job.type);
      if (!handler) {
        log.warn({ jobId: job.id, type: job.type }, "No handler registered for job type");
        continue;
      }

      // Fire and forget — each job runs independently
      void runJob(
        db,
        job,
        handler,
        (_jobId, summary) => {
          const payload = JSON.parse(job.payloadJson) as { telegramChatId?: string };
          if (payload.telegramChatId) {
            void bot.sendMessage(payload.telegramChatId, summary);
          }
        },
        (_jobId, error) => {
          const payload = JSON.parse(job.payloadJson) as { telegramChatId?: string };
          if (payload.telegramChatId) {
            void bot.sendMessage(
              payload.telegramChatId,
              `Scheduled job "${job.name}" failed: ${error}`
            );
          }
        }
      );
    }
  }

  return {
    start(): void {
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
