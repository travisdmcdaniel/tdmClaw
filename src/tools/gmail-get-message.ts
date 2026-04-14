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
        "Retrieve the compact details of a specific Gmail message by ID. " +
        "Use gmail_list_recent first to get message IDs.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Gmail message ID.",
          },
        },
        required: ["id"],
      },
    },

    async execute(args: unknown): Promise<unknown> {
      const { id } = args as GmailGetMessageArgs;
      return gmail.getMessage({ id });
    },
  };
}
