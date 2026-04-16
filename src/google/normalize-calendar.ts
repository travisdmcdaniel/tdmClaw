import type { CompactCalendarEvent } from "./types";

const DESCRIPTION_MAX = 500;

/**
 * Normalizes a raw Google Calendar event item into a compact representation.
 * Returns null if the input is malformed.
 */
export function normalizeCalendarEvent(
  raw: unknown,
  calendarId?: string
): CompactCalendarEvent | null {
  try {
    const event = raw as {
      id?: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      location?: string;
      description?: string;
    };

    return {
      id: event.id ?? "",
      title: event.summary ?? "(No title)",
      start: event.start?.dateTime ?? event.start?.date ?? "",
      end: event.end?.dateTime ?? event.end?.date ?? undefined,
      location: event.location ? String(event.location).slice(0, 200) : undefined,
      descriptionExcerpt: event.description
        ? stripHtml(String(event.description)).slice(0, DESCRIPTION_MAX)
        : undefined,
      calendarId,
    };
  } catch {
    return null;
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
