import type { AppConfig } from "../app/config";

/**
 * Checks whether a command is permitted under the current exec policy.
 * Throws with a descriptive message if the command is blocked.
 *
 * Two modes:
 *   Denylist (default): any command matching blockedCommands or blockedPatterns
 *     is rejected; all others are permitted.
 *   Allowlist (allowlistMode = true): a command is ONLY permitted if it
 *     matches an entry in allowedCommands (exact) or allowedPatterns (regex).
 *     blockedCommands / blockedPatterns are ignored in this mode.
 */
export function checkExecPolicy(
  config: AppConfig["tools"]["exec"],
  command: string,
  senderUserId: string
): void {
  if (!config.enabled) {
    throw new Error("Command execution is disabled in configuration.");
  }

  if (config.allowlistMode) {
    const permitted =
      config.allowedCommands.some((c) => command.trim() === c.trim()) ||
      config.allowedPatterns.some((p) => new RegExp(p).test(command));

    if (!permitted) {
      throw new Error(
        "Command is not in the exec allowlist. " +
          "Add it to tools.exec.allowedCommands or tools.exec.allowedPatterns to permit it."
      );
    }
    return;
  }

  // Denylist mode: check blocked exact commands
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
  void senderUserId;
}
