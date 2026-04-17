/**
 * Integration tests for runAgentLoop.
 * Uses an in-process mock ModelProvider — no real model or DB required.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initLogger } from "../src/app/logger";
import { runAgentLoop } from "../src/agent/loop";
import type { ModelProvider, ModelGenerateOutput } from "../src/agent/providers/types";
import type { ToolRegistry } from "../src/agent/tool-registry";

beforeAll(() => {
  initLogger("error"); // suppress log output during tests
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(responses: ModelGenerateOutput[]): ModelProvider {
  let call = 0;
  return {
    async generate() {
      const out = responses[call++];
      if (!out) throw new Error("Mock provider ran out of responses");
      return out;
    },
  };
}

function makeRegistry(
  toolResult: unknown = { files: ["a.txt"] }
): ToolRegistry {
  return {
    getDefinitions: () => [
      {
        name: "list_files",
        description: "List files",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ],
    execute: vi.fn().mockResolvedValue({ result: toolResult }),
  };
}

const baseInput = {
  systemPrompt: "You are a test assistant.",
  history: [],
  userMessage: "List the files.",
  model: "test-model",
  tools: [
    {
      name: "list_files",
      description: "List files",
      parameters: { type: "object", properties: {} },
    },
  ],
  maxIterations: 5,
} as const;

const toolCtx = {
  sessionId: "sess-1",
  workspaceRoot: "/workspace",
  senderTelegramUserId: "42",
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any,
  db: null as any,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAgentLoop — plain message path", () => {
  it("returns the model text directly when no tool call is made", async () => {
    const provider = makeProvider([
      { kind: "message", text: "Here is your answer." },
    ]);
    const registry = makeRegistry();

    const result = await runAgentLoop({
      ...baseInput,
      provider,
      toolRegistry: registry,
      toolCtx,
    });

    expect(result.text).toBe("Here is your answer.");
    expect(result.toolCallCount).toBe(0);
    expect(result.hitIterationLimit).toBe(false);
  });
});

describe("runAgentLoop — tool call path", () => {
  it("executes a tool call and returns the follow-up message", async () => {
    const provider = makeProvider([
      {
        kind: "tool_call",
        id: "tc-1",
        toolName: "list_files",
        argumentsJson: JSON.stringify({ path: "/" }),
      },
      { kind: "message", text: "Found: a.txt" },
    ]);
    const registry = makeRegistry({ files: ["a.txt"] });

    const result = await runAgentLoop({
      ...baseInput,
      provider,
      toolRegistry: registry,
      toolCtx,
    });

    expect(result.text).toBe("Found: a.txt");
    expect(result.toolCallCount).toBe(1);
    expect(result.hitIterationLimit).toBe(false);
    expect(registry.execute).toHaveBeenCalledWith(
      "list_files",
      { path: "/" },
      toolCtx
    );
  });

  it("accumulates intermediate messages for all tool call steps", async () => {
    const provider = makeProvider([
      { kind: "tool_call", id: "tc-1", toolName: "list_files", argumentsJson: "{}" },
      { kind: "tool_call", id: "tc-2", toolName: "list_files", argumentsJson: "{}" },
      { kind: "message", text: "Done." },
    ]);
    const registry = makeRegistry();

    const result = await runAgentLoop({
      ...baseInput,
      provider,
      toolRegistry: registry,
      toolCtx,
    });

    expect(result.toolCallCount).toBe(2);
    // 2 assistant tool-call messages + 2 tool result messages = 4 intermediates
    expect(result.intermediateMessages).toHaveLength(4);
  });
});

describe("runAgentLoop — iteration limit", () => {
  it("stops and returns a limit message when maxIterations is reached", async () => {
    // Always return a tool call — the loop must stop at maxIterations
    const provider: ModelProvider = {
      generate: vi.fn().mockResolvedValue({
        kind: "tool_call",
        id: "tc-x",
        toolName: "list_files",
        argumentsJson: "{}",
      }),
    };
    const registry = makeRegistry();

    const result = await runAgentLoop({
      ...baseInput,
      maxIterations: 3,
      provider,
      toolRegistry: registry,
      toolCtx,
    });

    expect(result.hitIterationLimit).toBe(true);
    expect(result.toolCallCount).toBe(3);
    expect(result.text).toMatch(/tool-call limit/i);
  });
});

describe("runAgentLoop — tool error handling", () => {
  it("continues the loop when a tool returns an error", async () => {
    const provider = makeProvider([
      { kind: "tool_call", id: "tc-1", toolName: "list_files", argumentsJson: "{}" },
      { kind: "message", text: "I encountered an error but recovered." },
    ]);
    const errorRegistry: ToolRegistry = {
      getDefinitions: () => [],
      execute: vi.fn().mockResolvedValue({ result: null, error: "Permission denied" }),
    };

    const result = await runAgentLoop({
      ...baseInput,
      provider,
      toolRegistry: errorRegistry,
      toolCtx,
    });

    expect(result.text).toContain("recovered");
    expect(result.hitIterationLimit).toBe(false);
    // The tool result message should contain the error text
    const toolResultMsg = result.intermediateMessages.find((m) => m.role === "tool");
    expect(toolResultMsg?.content).toContain("Permission denied");
  });
});
