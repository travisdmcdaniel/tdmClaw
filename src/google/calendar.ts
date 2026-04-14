import { google } from "googleapis";
import type { OAuthManager } from "./oauth";
import type { CompactCalendarEvent } from "./types";
import { normalizeCalendarEvent } from "./normalize-calendar";
import { childLogger } from "../app/logger";

const log = childLogger("google");

export type CalendarClient = {
  listWindow(params: {
    startIso: string;
    endIso: string;
    calendarIds?: string[];
    maxResults?: number;
  }): Promise<CompactCalendarEvent[]>;
};

/**
 * Creates a Calendar client backed by an authenticated OAuth client.
 */
export function createCalendarClient(oauthManager: OAuthManager): CalendarClient {
  function getCalendarApi() {
    const auth = oauthManager.getAuthenticatedClient();
    if (!auth) throw new Error("Google account not authorized. Use /google-connect.");
    return google.calendar({ version: "v3", auth });
  }

  return {
    async listWindow({ startIso, endIso, calendarIds, maxResults = 20 }): Promise<CompactCalendarEvent[]> {
      await oauthManager.refreshIfNeeded();
      const calendar = getCalendarApi();

      const ids = calendarIds?.length ? calendarIds : ["primary"];
      log.debug({ ids, startIso, endIso }, "Calendar listWindow");

      const allEvents: CompactCalendarEvent[] = [];

      for (const calendarId of ids) {
        const res = await calendar.events.list({
          calendarId,
          timeMin: startIso,
          timeMax: endIso,
          maxResults,
          singleEvents: true,
          orderBy: "startTime",
        });
        const events = (res.data.items ?? []).map((e) =>
          normalizeCalendarEvent(e, calendarId)
        );
        allEvents.push(...events);
      }

      // Sort combined results by start time
      allEvents.sort((a, b) => a.start.localeCompare(b.start));

      return allEvents;
    },
  };
}
