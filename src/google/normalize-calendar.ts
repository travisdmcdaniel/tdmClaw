import type { CompactCalendarEvent } from "./types";

const MAX_DESCRIPTION_LENGTH = 300;

type CalendarEventResource = {
  id?: string | null;
  summary?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  location?: string | null;
  description?: string | null;
};

/**
 * Normalizes a raw Google Calendar event into a compact representation.
 */
export function normalizeCalendarEvent(
  event: CalendarEventResource,
  calendarId?: string
): CompactCalendarEvent {
  const start =
    event.start?.dateTime ?? event.start?.date ?? "";
  const end =
    event.end?.dateTime ?? event.end?.date ?? undefined;

  const descriptionExcerpt = event.description
    ? event.description.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION_LENGTH)
    : undefined;

  return {
    id: event.id ?? "",
    title: event.summary ?? "(no title)",
    start,
    end,
    location: event.location ?? undefined,
    descriptionExcerpt,
    calendarId,
  };
}
