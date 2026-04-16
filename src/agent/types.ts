export type AgentTurnInput = {
  /** If omitted the runtime resolves the active session for sender.chatId. */
  sessionId?: string;
  userMessage: string;
  sender: {
    telegramUserId: string;
    chatId: string;
    username?: string;
  };
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
