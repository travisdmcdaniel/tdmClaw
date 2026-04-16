import type { ToolHandler } from "../agent/tool-registry";
import type { CalendarClient } from "../google/calendar";

type CalendarCreateEventArgs = {
  title: string;
  startIso: string;
  endIso: string;
  calendarId?: string;
  description?: string;
  location?: string;
  timeZone?: string;
};

/**
 * Creates a Google Calendar event.
 *
 * @param defaultTimezone - The app's configured timezone (config.app.timezone),
 *   used when the caller does not supply an explicit timeZone argument.
 */
export function createCalendarCreateEventTool(
  calendar: CalendarClient,
  defaultTimezone: string
): ToolHandler {
  return {
    definition: {
      name: "calendar_create_event",
      description:
        "Create a new Google Calendar event. " +
        "startIso and endIso are local datetime strings in ISO 8601 format " +
        `(e.g. 2025-06-01T14:00:00). Times are interpreted in ${defaultTimezone} ` +
        "unless timeZone is explicitly supplied.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Event title.",
          },
          startIso: {
            type: "string",
            description: "Start time as ISO 8601 datetime (e.g. 2025-06-01T14:00:00).",
          },
          endIso: {
            type: "string",
            description: "End time as ISO 8601 datetime (e.g. 2025-06-01T15:00:00).",
          },
          calendarId: {
            type: "string",
            description: "Calendar to add the event to. Omit to use the primary calendar.",
          },
          description: {
            type: "string",
            description: "Optional event description / notes.",
          },
          location: {
            type: "string",
            description: "Optional event location.",
          },
          timeZone: {
            type: "string",
            description:
              `IANA timezone name (e.g. America/Chicago). Defaults to ${defaultTimezone}.`,
          },
        },
        required: ["title", "startIso", "endIso"],
      },
    },

    async execute(args: unknown): Promise<unknown> {
      const {
        title,
        startIso,
        endIso,
        calendarId,
        description,
        location,
        timeZone,
      } = args as CalendarCreateEventArgs;

      const created = await calendar.createEvent({
        title,
        startIso,
        endIso,
        calendarId,
        description,
        location,
        timeZone: timeZone ?? defaultTimezone,
      });

      return (
        `Event created: "${created.title}"\n` +
        `Start: ${created.start}\n` +
        `End:   ${created.end}\n` +
        `Calendar: ${created.calendarId}\n` +
        `ID: ${created.id}`
      );
    },
  };
}
