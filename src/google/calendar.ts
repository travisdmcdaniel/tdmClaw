import type { GoogleTokenStore } from "./token-store";
import type { CompactCalendarEvent } from "./types";
import { normalizeCalendarEvent } from "./normalize-calendar";
import { childLogger } from "../app/logger";

const log = childLogger("google");
const CAL_BASE = "https://www.googleapis.com/calendar/v3";

export type CreatedEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  calendarId: string;
};

export type CalendarClient = {
  listWindow(params: {
    startIso: string;
    endIso: string;
    calendarIds?: string[];
    maxResults?: number;
  }): Promise<CompactCalendarEvent[]>;
  createEvent(params: {
    calendarId?: string;
    title: string;
    startIso: string;
    endIso: string;
    description?: string;
    location?: string;
    timeZone?: string;
  }): Promise<CreatedEvent>;
};

/**
 * Google Calendar API client using plain fetch. Reads the access token from
 * GoogleTokenStore on each call (auto-refreshes if near expiry).
 */
export class CalendarClientImpl implements CalendarClient {
  constructor(private readonly tokens: GoogleTokenStore) {}

  private async authHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.tokens.getAccessToken()}`,
      "Content-Type": "application/json",
    };
  }

  async listWindow({
    startIso,
    endIso,
    calendarIds,
    maxResults = 20,
  }: {
    startIso: string;
    endIso: string;
    calendarIds?: string[];
    maxResults?: number;
  }): Promise<CompactCalendarEvent[]> {
    const cals = calendarIds?.length ? calendarIds : ["primary"];
    const cap = Math.min(maxResults, 50);

    log.debug({ cals, startIso, endIso }, "Calendar listWindow");

    const perCal = await Promise.all(
      cals.map((cid) => this.listOne(cid, startIso, endIso, cap))
    );

    return perCal
      .flat()
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, cap);
  }

  async createEvent({
    calendarId = "primary",
    title,
    startIso,
    endIso,
    description,
    location,
    timeZone,
  }: {
    calendarId?: string;
    title: string;
    startIso: string;
    endIso: string;
    description?: string;
    location?: string;
    timeZone?: string;
  }): Promise<CreatedEvent> {
    const body: Record<string, unknown> = {
      summary: title,
      start: timeZone ? { dateTime: startIso, timeZone } : { dateTime: startIso },
      end: timeZone ? { dateTime: endIso, timeZone } : { dateTime: endIso },
    };
    if (description) body.description = description;
    if (location) body.location = location;

    const url = `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
    const r = await fetch(url, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      throw new Error(`Calendar createEvent failed (${r.status}): ${await r.text()}`);
    }

    const data = (await r.json()) as {
      id: string;
      summary?: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
    };

    log.info({ id: data.id, calendarId }, "Calendar event created");

    return {
      id: data.id,
      title: data.summary ?? title,
      start: data.start.dateTime ?? data.start.date ?? startIso,
      end: data.end.dateTime ?? data.end.date ?? endIso,
      calendarId,
    };
  }

  private async listOne(
    calendarId: string,
    timeMin: string,
    timeMax: string,
    max: number
  ): Promise<CompactCalendarEvent[]> {
    const url = new URL(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("maxResults", String(max));
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");

    const r = await fetch(url, { headers: await this.authHeaders() });
    if (!r.ok) return []; // Non-fatal: failing calendar returns empty, others still served

    const data = (await r.json()) as { items?: unknown[] };
    return (data.items ?? [])
      .map((it) => normalizeCalendarEvent(it, calendarId))
      .filter((e): e is CompactCalendarEvent => e !== null);
  }
}

export function createCalendarClient(tokens: GoogleTokenStore): CalendarClient {
  return new CalendarClientImpl(tokens);
}
