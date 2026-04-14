/**
 * Determines if a message text is a bot command (starts with /).
 */
export function isCommand(text: string): boolean {
  return text.startsWith("/");
}

/**
 * Parses a command string into its name and arguments.
 * e.g. "/setmodel qwen2.5-coder" -> { command: "setmodel", args: ["qwen2.5-coder"] }
 */
export function parseCommand(text: string): {
  command: string;
  args: string[];
} {
  const parts = text.trim().split(/\s+/);
  const raw = parts[0] ?? "";
  // Strip leading slash and optional @botname suffix
  const command = raw.replace(/^\//, "").split("@")[0]?.toLowerCase() ?? "";
  const args = parts.slice(1);
  return { command, args };
}
