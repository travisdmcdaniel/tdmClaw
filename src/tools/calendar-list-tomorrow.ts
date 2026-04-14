import type { ToolHandler } from "../agent/tool-registry";
import type { CalendarClient } from "../google/calendar";

type CalendarListTomorrowArgs = {
  calendarIds?: string[];
};

export function createCalendarListTomorrowTool(calendar: CalendarClient): ToolHandler {
  return {
    definition: {
      name: "calendar_list_tomorrow",
      description: "List Google Calendar events for tomorrow.",
      parameters: {
        type: "object",
        properties: {
          calendarIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of calendar IDs to query. Defaults to primary.",
          },
        },
      },
    },

    async execute(args: unknown): Promise<unknown> {
      const { calendarIds } = (args ?? {}) as CalendarListTomorrowArgs;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const startOfDay = new Date(tomorrow);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(tomorrow);
      endOfDay.setHours(23, 59, 59, 999);

      return calendar.listWindow({
        startIso: startOfDay.toISOString(),
        endIso: endOfDay.toISOString(),
        calendarIds,
      });
    },
  };
}
