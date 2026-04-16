import type { StoredMessage } from "./types";
import type { ModelMessage } from "./providers/types";

/**
 * Loads the most recent N messages from a session and converts them
 * to the format expected by the model provider.
 *
 * Only user, assistant, and tool messages are included — system messages
 * are handled separately in prompt.ts.
 */
export function buildHistoryMessages(
  messages: StoredMessage[],
  maxTurns: number
): ModelMessage[] {
  // A "turn" is one user + one assistant exchange; tool messages attach to assistant turns.
  // We take the last maxTurns*2 non-system messages as a simple approximation.
  const relevant = messages
    .filter((m) => m.role !== "system")
    .slice(-maxTurns * 2);

  return relevant.map((m): ModelMessage => {
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content,
        toolCallId: m.toolCallId ?? "",
        toolName: m.toolName ?? "",
      };
    }
    if (m.role === "assistant" && m.toolCallsJson) {
      let toolCalls: import("./providers/types").ToolCallRequest[] = [];
      try {
        toolCalls = JSON.parse(m.toolCallsJson) as import("./providers/types").ToolCallRequest[];
      } catch {
        // malformed stored JSON — fall through to plain assistant message
      }
      if (toolCalls.length > 0) {
        return { role: "assistant", content: m.content, toolCalls };
      }
    }
    if (m.role === "assistant") {
      return { role: "assistant", content: m.content };
    }
    return { role: "user", content: m.content };
  });
}
