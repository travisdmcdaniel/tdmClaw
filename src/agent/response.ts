/**
 * Post-processes the raw model output before sending to Telegram.
 * Keeps output clean and appropriately bounded.
 */
export function formatAgentResponse(text: string): string {
  return text.trim();
}
