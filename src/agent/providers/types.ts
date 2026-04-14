import type { ToolDefinition } from "../types";

export type ModelProvider = {
  generate(input: ModelGenerateInput): Promise<ModelGenerateOutput>;
};

export type ModelGenerateInput = {
  systemPrompt: string;
  messages: Array<ModelMessage>;
  tools: ToolDefinition[];
  model: string;
  temperature?: number;
};

export type ModelMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRequest[] }
  | { role: "tool"; content: string; toolCallId: string; toolName: string };

export type ToolCallRequest = {
  id: string;
  toolName: string;
  argumentsJson: string;
};

export type ModelGenerateOutput =
  | { kind: "message"; text: string }
  | {
      kind: "tool_call";
      id: string;
      toolName: string;
      argumentsJson: string;
    };
