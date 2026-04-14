import type { AppConfig } from "../app/config";

/**
 * Returns true if the sender is on the allowed list.
 * Checks both allowedUserIds and allowedChatIds (if configured).
 */
export function isSenderAllowed(
  config: AppConfig["telegram"],
  userId: string,
  chatId: string
): boolean {
  const userAllowed = config.allowedUserIds.includes(userId);
  if (!userAllowed) return false;

  if (config.allowedChatIds && config.allowedChatIds.length > 0) {
    return config.allowedChatIds.includes(chatId);
  }

  return true;
}
