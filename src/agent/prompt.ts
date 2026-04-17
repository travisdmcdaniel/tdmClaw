import type { AppConfig } from "../app/config";
import type { ToolDefinition } from "./types";

export type SenderContext = {
  chatId: string;
  telegramUserId: string;
  username?: string;
};

/**
 * Builds the compact system prompt for a standard agent turn.
 * Intentionally minimal — no large file injections or skill inventories.
 */
export function buildSystemPrompt(
  config: AppConfig,
  tools: ToolDefinition[],
  sender: SenderContext
): string {
  const toolList =
    tools.length > 0
      ? `Available tools:\n${tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`
      : "No tools available.";

  const now = new Date().toLocaleString("en-US", {
    timeZone: config.app.timezone,
    dateStyle: "full",
    timeStyle: "short",
  });

  return [
    "You are tdmClaw, a self-hosted assistant running on a Raspberry Pi.",
    "",
    "Rules:",
    "- Keep responses concise.",
    "- Use tools when needed to complete tasks.",
    "- Do not access files outside the workspace.",
    "- Always use the list_files tool before reading, writing, or patching files, to the proper file path.",
    "- Prefer small, targeted reads over large ones.",
    "- If command output is large, summarize it rather than repeating it verbatim.",
    "- Never expose secrets, authentication tokens, or credentials in responses.",
    "",
    `Current time: ${now} (${config.app.timezone})`,
    `Workspace root: ${config.workspace.root}`,
    `Chat ID: ${sender.chatId}`,
    `User ID: ${sender.telegramUserId}`,
    "",
    toolList,
  ].join("\n");
}
