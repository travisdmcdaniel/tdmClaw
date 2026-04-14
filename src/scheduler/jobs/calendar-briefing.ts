import type { ScheduledJob, JobHandler } from "../types";

type CalendarBriefingPayload = {
  telegramChatId: string;
  dayWindow?: number;
  calendarIds?: string[];
};

/**
 * Produces a calendar event summary.
 * TODO (Phase 4): wire up CalendarClient and summarization service.
 */
export const calendarBriefingHandler: JobHandler = async (
  _job: ScheduledJob,
  _payload: unknown
): Promise<{ summary: string }> => {
  void (_payload as CalendarBriefingPayload);
  // TODO (Phase 4): fetch and summarize calendar events
  return { summary: "Calendar briefing handler not yet implemented." };
};
