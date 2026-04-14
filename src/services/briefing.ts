import type { GmailClient } from "../google/gmail";
import type { CalendarClient } from "../google/calendar";
import type { CompactEmail, CompactCalendarEvent } from "../google/types";

export type BriefingService = {
  createDailyBriefing(params: {
    lookbackHours: number;
    calendarIds?: string[];
    maxEmails: number;
  }): Promise<{
    prompt: string;
    source: {
      emails: CompactEmail[];
      events: CompactCalendarEvent[];
    };
  }>;
};

/**
 * Creates the briefing service that combines Gmail and Calendar data
 * into a compact model prompt for daily briefings.
 */
export function createBriefingService(
  gmail: GmailClient,
  calendar: CalendarClient
): BriefingService {
  return {
    async createDailyBriefing({ lookbackHours, calendarIds, maxEmails }) {
      const [emails, events] = await Promise.all([
        gmail.listRecent({ newerThanHours: lookbackHours, maxResults: maxEmails }),
        (() => {
          const now = new Date();
          const startOfDay = new Date(now);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(now);
          endOfDay.setHours(23, 59, 59, 999);
          return calendar.listWindow({
            startIso: startOfDay.toISOString(),
            endIso: endOfDay.toISOString(),
            calendarIds,
          });
        })(),
      ]);

      const prompt = buildBriefingPrompt(emails, events);
      return { prompt, source: { emails, events } };
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildBriefingPrompt(
  emails: CompactEmail[],
  events: CompactCalendarEvent[]
): string {
  const eventLines =
    events.length > 0
      ? events
          .map((e) => `- ${e.start}${e.end ? ` → ${e.end}` : ""}: ${e.title}${e.location ? ` @ ${e.location}` : ""}`)
          .join("\n")
      : "No events today.";

  const emailLines =
    emails.length > 0
      ? emails
          .map((e) => `- From: ${e.from} | Subject: ${e.subject} | ${e.snippet}`)
          .join("\n")
      : "No new emails.";

  return [
    "Create a concise morning briefing based on the following data.",
    "",
    "Sections to include:",
    "- Today's schedule",
    "- Important emails",
    "- Action items or deadlines",
    "",
    "Keep under 250 words. Be direct and practical.",
    "",
    "=== CALENDAR EVENTS ===",
    eventLines,
    "",
    "=== EMAILS ===",
    emailLines,
  ].join("\n");
}
