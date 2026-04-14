import type { Database } from "better-sqlite3";
import type { AppConfig } from "../app/config";
import type { AgentTurnInput, AgentTurnOutput } from "./types";
import type { ModelProvider } from "./providers/types";
import type { ModelDiscovery } from "./providers/discovery";
import type { ToolRegistry } from "./tool-registry";
import { buildSystemPrompt } from "./prompt";
import { buildHistoryMessages } from "./history";
import { loadSessionContext } from "./session";
import { runAgentLoop } from "./loop";
import { formatAgentResponse } from "./response";
import { saveMessage } from "../storage/messages";
import { childLogger } from "../app/logger";
import { randomUUID } from "crypto";

const log = childLogger("agent");

export type AgentRuntime = {
  runTurn(input: AgentTurnInput): Promise<AgentTurnOutput>;
};

export type AgentRuntimeDeps = {
  config: AppConfig;
  db: Database;
  provider: ModelProvider;
  discovery: ModelDiscovery;
  toolRegistry: ToolRegistry;
};

/**
 * Creates the agent runtime that orchestrates sessions, prompt building,
 * the tool loop, and message persistence.
 */
export function createAgentRuntime(deps: AgentRuntimeDeps): AgentRuntime {
  const { config, db, provider, discovery, toolRegistry } = deps;

  return {
    async runTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
      const { sessionId, userMessage, sender } = input;

      log.info({ sessionId, userId: sender.telegramUserId }, "Agent turn start");

      // Load or create session + recent history
      const session = loadSessionContext(
        db,
        sessionId,
        sender.chatId,
        sender.telegramUserId,
        config.models.maxHistoryTurns
      );

      // Build prompt and tool list
      const toolDefs = toolRegistry.getDefinitions();
      const systemPrompt = buildSystemPrompt(config, toolDefs);
      const history = buildHistoryMessages(
        session.recentMessages,
        config.models.maxHistoryTurns
      );

      // Resolve active model
      const model = discovery.getActive()?.name;
      if (!model) {
        throw new Error(
          "No model available. Check that Ollama is running and has at least one model pulled."
        );
      }

      const toolCtx = {
        sessionId,
        workspaceRoot: config.workspace.root,
        senderTelegramUserId: sender.telegramUserId,
        logger: log,
        db,
      };

      // Persist user message
      saveMessage(db, {
        id: randomUUID(),
        sessionId,
        role: "user",
        content: userMessage,
        createdAt: new Date().toISOString(),
      });

      // Run tool loop
      const loopOutput = await runAgentLoop({
        systemPrompt,
        history,
        userMessage,
        model,
        tools: toolDefs,
        maxIterations: config.models.maxToolIterations,
        provider,
        toolRegistry,
        toolCtx,
      });

      const responseText = formatAgentResponse(loopOutput.text);

      // Persist assistant response
      saveMessage(db, {
        id: randomUUID(),
        sessionId,
        role: "assistant",
        content: responseText,
        createdAt: new Date().toISOString(),
      });

      log.info(
        {
          sessionId,
          toolCallCount: loopOutput.toolCallCount,
          hitLimit: loopOutput.hitIterationLimit,
        },
        "Agent turn complete"
      );

      return {
        text: responseText,
        toolCallCount: loopOutput.toolCallCount,
        hitIterationLimit: loopOutput.hitIterationLimit,
      };
    },
  };
}
