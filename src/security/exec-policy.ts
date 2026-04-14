import type { AppConfig } from "../app/config";

/**
 * Checks whether a command is permitted under the current exec policy.
 * Throws with a descriptive message if the command is blocked.
 */
export function checkExecPolicy(
  config: AppConfig["tools"]["exec"],
  command: string,
  senderUserId: string
): void {
  if (!config.enabled) {
    throw new Error("Command execution is disabled in configuration.");
  }

  // Check blocked exact commands
  for (const blocked of config.blockedCommands) {
    if (command.trim() === blocked.trim() || command.includes(blocked)) {
      throw new Error(`Command is blocked by policy: "${blocked}"`);
    }
  }

  // Check blocked regex patterns
  for (const pattern of config.blockedPatterns) {
    const re = new RegExp(pattern);
    if (re.test(command)) {
      throw new Error(`Command matches a blocked pattern: "${pattern}"`);
    }
  }

  // Owner-only mode: no additional check needed at this layer —
  // the Telegram guard already ensures only allowed users can message the bot.
  // If a per-command approval flow is added in Phase 5, it would plug in here.
  void senderUserId;
}
