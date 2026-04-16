import type { AppConfig } from "../../app/config";
import type { ModelProvider, ModelGenerateInput, ModelGenerateOutput } from "./types";
import type { ModelDiscovery } from "./discovery";
import { childLogger } from "../../app/logger";

const log = childLogger("model-provider");

type OpenAIMessage = {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OpenAIResponse = {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

/**
 * Creates an OpenAI-compatible model provider.
 * Uses the ModelDiscovery instance to resolve the active model name at call time.
 */
export function createModelProvider(
  config: AppConfig["models"],
  discovery: ModelDiscovery
): ModelProvider {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  return {
    async generate(input: ModelGenerateInput): Promise<ModelGenerateOutput> {
      const model = input.model || discovery.getActive()?.name;
      if (!model) {
        throw new Error("No model available. Check Ollama is running and has models pulled.");
      }

      const messages = buildMessages(input);
      const tools = buildTools(input);

      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: input.temperature ?? 0.2,
        stream: false,
      };
      if (tools.length > 0) {
        body["tools"] = tools;
        body["tool_choice"] = "auto";
      }

      log.debug({ model, messageCount: messages.length, toolCount: tools.length }, "Calling model");

      const timeoutMs = config.requestTimeoutSeconds * 1000;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: abort.signal,
        });
      } catch (err) {
        if (abort.signal.aborted) {
          throw new Error(
            `Model provider request timed out after ${config.requestTimeoutSeconds}s`
          );
        }
        throw new Error(`Model provider request failed: ${String(err)}`);
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => "(unreadable)");
        throw new Error(`Model provider returned ${res.status}: ${errBody}`);
      }

      const data = (await res.json()) as OpenAIResponse;
      const choice = data.choices[0];
      if (!choice) throw new Error("Model returned no choices");

      const msg = choice.message;
      const usage = data.usage
        ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
        : undefined;

      // Tool call takes priority over text content
      const toolCall = msg.tool_calls?.[0];
      if (toolCall) {
        return {
          kind: "tool_call",
          id: toolCall.id,
          toolName: toolCall.function.name,
          argumentsJson: toolCall.function.arguments,
          usage,
        };
      }

      return {
        kind: "message",
        text: msg.content ?? "",
        usage,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMessages(input: ModelGenerateInput): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (input.systemPrompt) {
    out.push({ role: "system", content: input.systemPrompt });
  }
  for (const msg of input.messages) {
    if (msg.role === "tool") {
      out.push({
        role: "tool",
        content: msg.content,
        tool_call_id: msg.toolCallId,
        name: msg.toolName,
      });
    } else if (msg.role === "assistant" && msg.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.toolName, arguments: tc.argumentsJson },
        })),
      });
    } else {
      out.push({ role: msg.role, content: msg.content });
    }
  }
  return out;
}

function buildTools(input: ModelGenerateInput): OpenAITool[] {
  return input.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
