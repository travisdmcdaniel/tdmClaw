import type { ScheduledJob, JobHandler } from "../types";

type EmailDigestPayload = {
  telegramChatId: string;
  maxEmails?: number;
  query?: string;
};

/**
 * Produces a summarized email digest.
 * TODO (Phase 4): wire up GmailClient and summarization service.
 */
export const emailDigestHandler: JobHandler = async (
  _job: ScheduledJob,
  _payload: unknown
): Promise<{ summary: string }> => {
  void (_payload as EmailDigestPayload);
  // TODO (Phase 4): fetch and summarize emails
  return { summary: "Email digest handler not yet implemented." };
};
