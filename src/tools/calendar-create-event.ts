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

export function createCalendarCreateEventTool(calendar: CalendarClient): ToolHandler {
  return {
    definition: {
      name: "calendar_create_event",
      description:
        "Create a new event on Google Calendar. " +
        "startIso and endIso must be ISO 8601 datetime strings (e.g. 2025-06-01T14:00:00). " +
        "Provide timeZone (e.g. America/Chicago) when the user's local time is known.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Event title / summary.",
          },
          startIso: {
            type: "string",
            description: "Start datetime in ISO 8601 format.",
          },
          endIso: {
            type: "string",
            description: "End datetime in ISO 8601 format.",
          },
          calendarId: {
            type: "string",
            description: "Calendar ID to add the event to. Defaults to primary.",
          },
          description: {
            type: "string",
            description: "Optional event description.",
          },
          location: {
            type: "string",
            description: "Optional event location.",
          },
          timeZone: {
            type: "string",
            description: "IANA timezone name (e.g. America/Chicago). Recommended.",
          },
        },
        required: ["title", "startIso", "endIso"],
      },
    },

    async execute(args: unknown): Promise<unknown> {
      const { title, startIso, endIso, calendarId, description, location, timeZone } =
        args as CalendarCreateEventArgs;

      const created = await calendar.createEvent({
        title,
        startIso,
        endIso,
        calendarId,
        description,
        location,
        timeZone,
      });

      return `Event created: "${created.title}" from ${created.start} to ${created.end} (id: ${created.id})`;
    },
  };
}
