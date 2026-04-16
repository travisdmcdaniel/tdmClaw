import type { ToolHandler } from "../agent/tool-registry";
import type { CalendarClient } from "../google/calendar";
import type { CompactCalendarEvent } from "../google/types";

type CalendarListEventsArgs = {
  date?: string;
  calendarIds?: string[];
};

/**
 * Replaces the separate calendar_list_today / calendar_list_tomorrow tools.
 * Accepts "today", "tomorrow", or a YYYY-MM-DD date string.
 */
export function createCalendarListEventsTool(
  calendar: CalendarClient,
  timezone: string
): ToolHandler {
  return {
    definition: {
      name: "calendar_list_events",
      description:
        "List Google Calendar events for a given day. " +
        'date: "today" (default), "tomorrow", or a YYYY-MM-DD string. ' +
        "Returns events sorted by start time.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: '"today", "tomorrow", or a specific date as YYYY-MM-DD.',
          },
          calendarIds: {
            type: "array",
            items: { type: "string" },
            description: "Calendar IDs to query. Omit to use the primary calendar.",
          },
        },
      },
    },

    async execute(args: unknown): Promise<unknown> {
      const { date = "today", calendarIds } = (args ?? {}) as CalendarListEventsArgs;

      const { startIso, endIso, label } = resolveDateBounds(date, timezone);

      const events = await calendar.listWindow({ startIso, endIso, calendarIds, maxResults: 25 });

      if (events.length === 0) return `No events on ${label}.`;

      return `Events on ${label}:\n\n` + events.map(formatEvent).join("\n");
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDateBounds(
  dateInput: string,
  tz: string
): { startIso: string; endIso: string; label: string } {
  let dateStr: string;
  let label: string;

  const lower = dateInput.trim().toLowerCase();
  if (lower === "today" || lower === "") {
    dateStr = dateInTz(new Date(), tz);
    label = "today";
  } else if (lower === "tomorrow") {
    dateStr = dateInTz(new Date(Date.now() + 86_400_000), tz);
    label = "tomorrow";
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    dateStr = dateInput;
    label = dateInput;
  } else {
    // Unrecognized — fall back to today
    dateStr = dateInTz(new Date(), tz);
    label = "today";
  }

  const { startIso, endIso } = midnightBoundsUtc(dateStr, tz);
  return { startIso, endIso, label };
}

/**
 * Returns the calendar date string (YYYY-MM-DD) for a given Date in the
 * target timezone. Uses the sv-SE locale which reliably produces YYYY-MM-DD.
 */
function dateInTz(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(date);
}

/**
 * Computes start-of-day and end-of-day UTC ISO strings for a given date in a
 * given timezone — without any external library.
 *
 * Strategy: probe the UTC equivalent of noon on the target date, then ask the
 * Intl API what clock time that maps to in the target timezone. Since we know
 * the probe is "noon UTC", the difference between that displayed time and noon
 * gives us the UTC offset at that moment. Subtracting the displayed time from
 * the probe yields UTC midnight for the target day.
 *
 * Using noon UTC as the probe point avoids ambiguity from DST transitions,
 * which almost always occur near 01:00–03:00 local time.
 */
function midnightBoundsUtc(
  dateStr: string,
  tz: string
): { startIso: string; endIso: string } {
  const [year, month, day] = dateStr.split("-").map(Number);

  // Probe: noon UTC on the target date
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  // Ask Intl what time noonUtc appears as in the target timezone
  const timeParts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(noonUtc); // "HH:MM:SS"

  const [h, m, s] = timeParts.split(":").map(Number);

  // noonUtc = midnight_in_tz + h:m:s  →  midnight_in_tz = noonUtc − h:m:s
  const midnightMs = noonUtc.getTime() - (h * 3600 + m * 60 + s) * 1000;

  return {
    startIso: new Date(midnightMs).toISOString(),
    // End of day: midnight + 24h − 1ms (stays within same calendar day)
    endIso: new Date(midnightMs + 86_400_000 - 1).toISOString(),
  };
}

function formatEvent(e: CompactCalendarEvent): string {
  const time =
    e.end ? `${formatTime(e.start)} – ${formatTime(e.end)}` : formatTime(e.start);
  const loc = e.location ? ` @ ${e.location}` : "";
  const desc = e.descriptionExcerpt ? `\n  ${e.descriptionExcerpt}` : "";
  return `${time} | ${e.title}${loc}${desc}`;
}

/** Strips the date portion from a full ISO datetime to show only the time. */
function formatTime(iso: string): string {
  // All-day events use date-only strings (YYYY-MM-DD), not datetimes
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "all day";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}
