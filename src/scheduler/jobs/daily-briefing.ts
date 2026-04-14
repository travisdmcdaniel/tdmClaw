import type { ScheduledJob, JobHandler } from "../types";

type DailyBriefingPayload = {
  telegramChatId: string;
  lookbackHours?: number;
  maxEmails?: number;
  calendarIds?: string[];
};

/**
 * Produces a morning briefing combining Gmail and Calendar data.
 * TODO (Phase 4): wire up BriefingService and AgentRuntime.
 */
export const dailyBriefingHandler: JobHandler = async (
  _job: ScheduledJob,
  payload: unknown
): Promise<{ summary: string }> => {
  const { lookbackHours = 24, maxEmails = 10 } = payload as DailyBriefingPayload;

  // TODO (Phase 4):
  // 1. briefingService.createDailyBriefing({ lookbackHours, maxEmails, calendarIds })
  // 2. agentRuntime.runTurn(...) with the briefing prompt
  // 3. return the agent response as summary

  void lookbackHours;
  void maxEmails;

  return { summary: "Daily briefing handler not yet implemented." };
};
