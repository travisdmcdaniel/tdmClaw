const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;

/**
 * Truncates a message to fit within Telegram's character limit.
 * Appends a truncation notice if content was cut.
 */
export function truncateForTelegram(text: string): string {
  if (text.length <= MAX_TELEGRAM_MESSAGE_LENGTH) return text;
  const notice = "\n\n[...truncated]";
  return text.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH - notice.length) + notice;
}

/**
 * Formats an error for safe display in Telegram.
 * Never exposes raw stack traces or secrets.
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return "An unexpected error occurred.";
}

/**
 * Wraps text in a code block for Telegram HTML parse mode.
 */
export function codeBlock(text: string): string {
  return `<pre>${escapeHtml(text)}</pre>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
