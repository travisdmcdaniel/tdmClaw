import type { ToolHandler } from "../agent/tool-registry";
import type { GmailClient } from "../google/gmail";
import type { CompactEmail } from "../google/types";

type GmailListRecentArgs = {
  newerThanHours?: number;
  maxResults?: number;
  query?: string;
};

export function createGmailListRecentTool(gmail: GmailClient, defaultMaxResults = 10): ToolHandler {
  return {
    definition: {
      name: "gmail_list_recent",
      description:
        "List recent emails from Gmail. Returns sender, subject, timestamp, and a short snippet. " +
        "Use gmail_get_message with a specific ID to read the full body. " +
        "newerThanHours accepts: 1, 3, 6, 12, 24, 48, 72, or 168 (7 days). Default: 24.",
      parameters: {
        type: "object",
        properties: {
          newerThanHours: {
            type: "number",
            description: "Return emails received within this many hours. Allowed: 1, 3, 6, 12, 24, 48, 72, 168.",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of emails to return. Range 1-50. Default: 10.",
          },
          query: {
            type: "string",
            description:
              "Optional Gmail search query. Examples: 'from:boss@example.com', 'is:unread', 'subject:invoice'.",
          },
        },
      },
    },

    async execute(args: unknown): Promise<unknown> {
      const raw = (args ?? {}) as GmailListRecentArgs;

      const ALLOWED_HOURS = [1, 3, 6, 12, 24, 48, 72, 168];
      const newerThanHours = ALLOWED_HOURS.includes(raw.newerThanHours ?? 0)
        ? (raw.newerThanHours as number)
        : 24;
      const maxResults = Math.min(Math.max(1, Math.round(raw.maxResults ?? defaultMaxResults)), 50);

      const emails = await gmail.listRecent({ newerThanHours, maxResults, query: raw.query });

      if (emails.length === 0) {
        return `No emails found in the last ${newerThanHours}h${raw.query ? ` matching "${raw.query}"` : ""}.`;
      }

      return emails.map(formatEmail).join("\n\n");
    },
  };
}

function formatEmail(e: CompactEmail): string {
  const labels =
    e.labels && e.labels.length > 0
      ? ` [${e.labels.filter((l) => l !== "INBOX").join(", ")}]`
      : "";
  return `ID: ${e.id}\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.receivedAt}${labels}\n${e.snippet}`;
}
