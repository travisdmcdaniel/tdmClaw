import type { Database } from "better-sqlite3";
import type { AppConfig } from "../app/config";
import type { AgentTurnInput, AgentTurnOutput } from "./types";
import type { ModelProvider } from "./providers/types";
import type { ModelDiscovery } from "./providers/discovery";
import type { ToolRegistry } from "./tool-registry";
import { buildSystemPrompt, type SenderContext } from "./prompt";
import { buildHistoryMessages } from "./history";
import { loadSessionContext } from "./session";
import { runAgentLoop } from "./loop";
import { formatAgentResponse } from "./response";
import { saveMessage } from "../storage/messages";
import { addSessionTokens } from "../storage/sessions";
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
      const { userMessage, sender } = input;

      // Resolve the active session for this chat (creates one if none exists).
      const session = loadSessionContext(
        db,
        sender.chatId,
        sender.telegramUserId,
        config.models.maxHistoryTurns
      );
      const sessionId = session.sessionId;

      log.info({ sessionId, userId: sender.telegramUserId }, "Agent turn start");

      // Build prompt and tool list
      const toolDefs = toolRegistry.getDefinitions();
      const senderCtx: SenderContext = {
        chatId: sender.chatId,
        telegramUserId: sender.telegramUserId,
        username: sender.username,
      };
      const systemPrompt = buildSystemPrompt(config, toolDefs, senderCtx);
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

      // Persist intermediate messages (assistant tool calls + tool results)
      for (const msg of loopOutput.intermediateMessages) {
        saveMessage(db, {
          id: randomUUID(),
          sessionId,
          role: msg.role,
          content: msg.content,
          toolName: msg.toolName,
          toolCallId: msg.toolCallId,
          toolCallsJson: msg.toolCallsJson,
          promptTokens: msg.promptTokens,
          completionTokens: msg.completionTokens,
          createdAt: new Date().toISOString(),
        });
      }

      const responseText = formatAgentResponse(loopOutput.text);

      // Persist final assistant response with its token counts
      saveMessage(db, {
        id: randomUUID(),
        sessionId,
        role: "assistant",
        content: responseText,
        promptTokens: loopOutput.finalPromptTokens || undefined,
        completionTokens: loopOutput.finalCompletionTokens || undefined,
        createdAt: new Date().toISOString(),
      });

      // Update session-level token totals
      if (loopOutput.totalPromptTokens > 0 || loopOutput.totalCompletionTokens > 0) {
        addSessionTokens(
          db,
          sessionId,
          loopOutput.totalPromptTokens,
          loopOutput.totalCompletionTokens
        );
      }

      log.info(
        {
          sessionId,
          toolCallCount: loopOutput.toolCallCount,
          hitLimit: loopOutput.hitIterationLimit,
          promptTokens: loopOutput.totalPromptTokens,
          completionTokens: loopOutput.totalCompletionTokens,
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
