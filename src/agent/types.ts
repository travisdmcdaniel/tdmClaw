export type AgentTurnInput = {
  /** If omitted the runtime resolves the active session for sender.chatId. */
  sessionId?: string;
  userMessage: string;
  sender: {
    telegramUserId: string;
    chatId: string;
    username?: string;
  };
  /**
   * When true the runtime resolves a separate session namespace for this turn
   * (keyed as "scheduler:<chatId>") so it never inherits the user's chat
   * history. Use for scheduled jobs and other non-interactive callers.
   */
  isolatedSession?: boolean;
};

export type AgentTurnOutput = {
  text: string;
  toolCallCount: number;
  hitIterationLimit: boolean;
};

export type StoredMessage = {
  id: string;
  sessionId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
  /** JSON-serialised ToolCallRequest[] stored on assistant messages that make tool calls. */
  toolCallsJson?: string;
  /** Prompt tokens consumed by the model call that produced this assistant message. */
  promptTokens?: number;
  /** Completion tokens produced by the model call that produced this assistant message. */
  completionTokens?: number;
  createdAt: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
