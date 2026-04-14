/**
 * Shared tool output helpers used across all tool implementations.
 */

const DEFAULT_MAX_CHARS = 16_000;

/**
 * Truncates a string to a maximum character count.
 * Appends a truncation notice if content was cut.
 */
export function truncateOutput(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const notice = `\n[...truncated to ${maxChars} chars]`;
  return text.slice(0, maxChars - notice.length) + notice;
}

/**
 * Formats a tool result as a plain string for inclusion in the prompt.
 */
export function formatToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}
