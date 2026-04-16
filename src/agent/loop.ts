import type { ModelProvider, ModelGenerateInput, ModelMessage } from "./providers/types";
import type { ToolDefinition } from "./types";
import type { ToolRegistry, ToolContext } from "./tool-registry";
import { formatToolResult } from "../tools/common";
import { childLogger } from "../app/logger";

const log = childLogger("agent");

export type LoopInput = {
  systemPrompt: string;
  history: ModelMessage[];
  userMessage: string;
  model: string;
  tools: ToolDefinition[];
  maxIterations: number;
  provider: ModelProvider;
  toolRegistry: ToolRegistry;
  toolCtx: ToolContext;
};

/** A single message generated during the loop (tool-call assistant turn or tool result). */
export type LoopMessage = {
  role: "assistant" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolCallsJson?: string;
  promptTokens?: number;
  completionTokens?: number;
};

export type LoopOutput = {
  text: string;
  toolCallCount: number;
  hitIterationLimit: boolean;
  /** Intermediate messages produced during the loop (assistant tool calls + tool results). */
  intermediateMessages: LoopMessage[];
  /** Tokens used for the final model call that produced the response text. */
  finalPromptTokens: number;
  finalCompletionTokens: number;
  /** Total tokens across all model calls in this loop. */
  totalPromptTokens: number;
  totalCompletionTokens: number;
};

/**
 * Runs the agent tool loop.
 * Sends the prompt to the model, executes any tool calls, and repeats
 * until the model returns a final message or the iteration limit is hit.
 */
export async function runAgentLoop(input: LoopInput): Promise<LoopOutput> {
  const messages: ModelMessage[] = [
    ...input.history,
    { role: "user", content: input.userMessage },
  ];

  let toolCallCount = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const intermediateMessages: LoopMessage[] = [];

  for (let iteration = 0; iteration < input.maxIterations; iteration++) {
    const generateInput: ModelGenerateInput = {
      systemPrompt: input.systemPrompt,
      messages,
      tools: input.tools,
      model: input.model,
    };

    log.debug(
      { model: input.model, iteration, messageCount: messages.length },
      "Agent loop iteration"
    );

    const output = await input.provider.generate(generateInput);

    if (output.kind === "message") {
      const pt = output.usage?.promptTokens ?? 0;
      const ct = output.usage?.completionTokens ?? 0;
      totalPromptTokens += pt;
      totalCompletionTokens += ct;
      return {
        text: output.text,
        toolCallCount,
        hitIterationLimit: false,
        intermediateMessages,
        finalPromptTokens: pt,
        finalCompletionTokens: ct,
        totalPromptTokens,
        totalCompletionTokens,
      };
    }

    // Tool call
    toolCallCount++;
    const { id, toolName, argumentsJson } = output;
    const pt = output.usage?.promptTokens ?? 0;
    const ct = output.usage?.completionTokens ?? 0;
    totalPromptTokens += pt;
    totalCompletionTokens += ct;

    log.info({ tool: toolName, iteration }, "Executing tool call");

    // Append assistant message with tool call
    messages.push({
      role: "assistant",
      content: "",
      toolCalls: [{ id, toolName, argumentsJson }],
    });
    intermediateMessages.push({
      role: "assistant",
      content: "",
      toolCallsJson: JSON.stringify([{ id, toolName, argumentsJson }]),
      promptTokens: pt || undefined,
      completionTokens: ct || undefined,
    });

    // Execute tool
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(argumentsJson);
    } catch {
      parsedArgs = {};
    }

    const { result, error } = await input.toolRegistry.execute(
      toolName,
      parsedArgs,
      input.toolCtx
    );

    const toolResultContent = error
      ? `Error: ${error}`
      : formatToolResult(result);

    // Append tool result
    messages.push({
      role: "tool",
      content: toolResultContent,
      toolCallId: id,
      toolName,
    });
    intermediateMessages.push({
      role: "tool",
      content: toolResultContent,
      toolCallId: id,
      toolName,
    });
  }

  // Hit iteration limit
  log.warn({ maxIterations: input.maxIterations }, "Agent loop hit iteration limit");
  return {
    text: "I reached the tool-call limit for this turn. Please try a more focused request.",
    toolCallCount,
    hitIterationLimit: true,
    intermediateMessages,
    finalPromptTokens: 0,
    finalCompletionTokens: 0,
    totalPromptTokens,
    totalCompletionTokens,
  };
}
