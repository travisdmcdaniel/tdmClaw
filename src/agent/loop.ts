import type { ModelProvider, ModelGenerateInput, ModelMessage } from "./providers/types";
import type { ToolDefinition } from "./types";
import type { ToolRegistry, ToolContext } from "./tool-registry";
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

export type LoopOutput = {
  text: string;
  toolCallCount: number;
  hitIterationLimit: boolean;
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
      return {
        text: output.text,
        toolCallCount,
        hitIterationLimit: false,
      };
    }

    // Tool call
    toolCallCount++;
    const { id, toolName, argumentsJson } = output;

    log.info({ tool: toolName, iteration }, "Executing tool call");

    // Append assistant message with tool call
    messages.push({
      role: "assistant",
      content: "",
      toolCalls: [{ id, toolName, argumentsJson }],
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
      : JSON.stringify(result, null, 2);

    // Append tool result
    messages.push({
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
  };
}
