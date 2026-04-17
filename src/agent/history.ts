import type { StoredMessage } from "./types";
import type { ModelMessage } from "./providers/types";

/**
 * Builds history messages from a session's stored messages, taking the last
 * `maxTurns` complete exchanges.
 *
 * A "turn" is one user message plus all the assistant and tool messages that
 * follow it before the next user message. Grouping by turn ensures we never
 * send a partial tool-call sequence (e.g. an assistant tool-call message
 * without its tool result), which some models reject.
 *
 * System messages are excluded — they are injected separately by the prompt builder.
 */
export function buildHistoryMessages(
  messages: StoredMessage[],
  maxTurns: number
): ModelMessage[] {
  const nonSystem = messages.filter((m) => m.role !== "system");

  // Group into turns: each turn starts at a user message and includes all
  // subsequent assistant/tool messages until the next user message.
  const turns: StoredMessage[][] = [];
  let current: StoredMessage[] = [];

  for (const msg of nonSystem) {
    if (msg.role === "user" && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) {
    turns.push(current);
  }

  // Keep only the most recent maxTurns complete turns.
  const selected = turns.slice(-maxTurns);

  return selected.flatMap((turn) =>
    turn.map((m): ModelMessage => {
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
    })
  );
}
