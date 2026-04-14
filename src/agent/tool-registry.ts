import type { Database } from "better-sqlite3";
import type { AppConfig } from "../app/config";
import type { ToolDefinition } from "./types";
import type { AppLogger } from "../app/logger";

export type ToolContext = {
  sessionId: string;
  workspaceRoot: string;
  senderTelegramUserId: string;
  logger: AppLogger;
  db: Database;
};

export type ToolHandler = {
  definition: ToolDefinition;
  execute(args: unknown, ctx: ToolContext): Promise<unknown>;
};

export type ToolRegistry = {
  getDefinitions(): ToolDefinition[];
  execute(
    name: string,
    args: unknown,
    ctx: ToolContext
  ): Promise<{ result: unknown; error?: string }>;
};

/**
 * Creates the tool registry. Tools are registered based on what is enabled
 * in config and what backing subsystems are available.
 */
export function createToolRegistry(
  config: AppConfig,
  _db: Database
): ToolRegistry {
  const tools = new Map<string, ToolHandler>();

  function register(handler: ToolHandler): void {
    tools.set(handler.definition.name, handler);
  }

  // Workspace tools — always registered if workspace is configured
  // TODO (Phase 2): import and register file tools
  // register(createListFilesTool(config.workspace));
  // register(createReadFileTool(config.workspace));
  // register(createWriteFileTool(config.workspace));

  // Patch tool
  if (config.tools.applyPatch.enabled) {
    // TODO (Phase 2): register apply_patch tool
  }

  // Exec tool
  if (config.tools.exec.enabled) {
    // TODO (Phase 2): register exec tool
  }

  // Google tools — registered only if Google is enabled and credentials exist
  // TODO (Phase 3): register gmail and calendar tools conditionally

  return {
    getDefinitions(): ToolDefinition[] {
      return Array.from(tools.values()).map((h) => h.definition);
    },

    async execute(
      name: string,
      args: unknown,
      ctx: ToolContext
    ): Promise<{ result: unknown; error?: string }> {
      const handler = tools.get(name);
      if (!handler) {
        return { result: null, error: `Unknown tool: ${name}` };
      }
      try {
        const result = await handler.execute(args, ctx);
        return { result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.warn({ tool: name, err }, "Tool execution failed");
        return { result: null, error: message };
      }
    },
  };
}
