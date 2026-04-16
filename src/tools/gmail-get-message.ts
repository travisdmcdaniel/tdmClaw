import type { ToolHandler } from "../agent/tool-registry";
import type { GmailClient } from "../google/gmail";

type GmailGetMessageArgs = {
  id: string;
};

export function createGmailGetMessageTool(gmail: GmailClient): ToolHandler {
  return {
    definition: {
      name: "gmail_get_message",
      description:
        "Fetch the full body of a specific Gmail message by ID. " +
        "Use gmail_list_recent first to find message IDs.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Gmail message ID from gmail_list_recent.",
          },
        },
        required: ["id"],
      },
    },

    async execute(args: unknown): Promise<unknown> {
      const { id } = args as GmailGetMessageArgs;
      const m = await gmail.getMessage({ id });

      if (!m) return `Message ${id} not found or could not be fetched.`;

      const parts: string[] = [
        `From: ${m.from}`,
        `Subject: ${m.subject}`,
        `Date: ${m.receivedAt}`,
      ];

      if (m.labels && m.labels.length > 0) {
        const filtered = m.labels.filter((l) => l !== "INBOX");
        if (filtered.length > 0) parts.push(`Labels: ${filtered.join(", ")}`);
      }

      parts.push("", m.excerpt || "(No readable body)");

      return parts.join("\n");
    },
  };
}
