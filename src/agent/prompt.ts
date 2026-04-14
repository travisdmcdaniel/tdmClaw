import type { AppConfig } from "../app/config";
import type { ToolDefinition } from "./types";

/**
 * Builds the compact system prompt for a standard agent turn.
 * Intentionally minimal — no large file injections or skill inventories.
 */
export function buildSystemPrompt(
  config: AppConfig,
  tools: ToolDefinition[]
): string {
  const toolList =
    tools.length > 0
      ? `Available tools:\n${tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`
      : "No tools available.";

  return [
    "You are tdmClaw, a self-hosted assistant running on a Raspberry Pi.",
    "",
    "Rules:",
    "- Keep responses concise.",
    "- Use tools when needed to complete tasks.",
    "- Do not access files outside the workspace.",
    "- Prefer small, targeted reads over large ones.",
    "- If command output is large, summarize it rather than repeating it verbatim.",
    "- Never expose secrets, tokens, or credentials in responses.",
    "",
    `Workspace root: ${config.workspace.root}`,
    "",
    toolList,
  ].join("\n");
}
