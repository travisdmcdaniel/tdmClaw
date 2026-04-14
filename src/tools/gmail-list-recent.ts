import type { ToolHandler } from "../agent/tool-registry";
import type { GmailClient } from "../google/gmail";

type GmailListRecentArgs = {
  newerThanHours?: number;
  maxResults?: number;
  query?: string;
};

export function createGmailListRecentTool(gmail: GmailClient): ToolHandler {
  return {
    definition: {
      name: "gmail_list_recent",
      description: "List recent emails from Gmail. Returns compact email summaries.",
      parameters: {
        type: "object",
        properties: {
          newerThanHours: {
            type: "number",
            description: "Return emails newer than this many hours. Default 24.",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of emails to return. Default 10.",
          },
          query: {
            type: "string",
            description: "Optional Gmail search query (e.g. 'from:boss@example.com').",
          },
        },
      },
    },

    async execute(args: unknown): Promise<unknown> {
      const { newerThanHours = 24, maxResults = 10, query } = args as GmailListRecentArgs;
      return gmail.listRecent({ newerThanHours, maxResults, query });
    },
  };
}
