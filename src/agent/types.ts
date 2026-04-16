export type AgentTurnInput = {
  sessionId: string;
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
  createdAt: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
