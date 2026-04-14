import type { ToolHandler } from "../agent/tool-registry";
import type { CalendarClient } from "../google/calendar";

type CalendarListTodayArgs = {
  calendarIds?: string[];
};

export function createCalendarListTodayTool(calendar: CalendarClient): ToolHandler {
  return {
    definition: {
      name: "calendar_list_today",
      description: "List Google Calendar events for today.",
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
      const { calendarIds } = (args ?? {}) as CalendarListTodayArgs;
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
    },
  };
}
