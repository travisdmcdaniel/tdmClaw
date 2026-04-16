import type { Database } from "better-sqlite3";
import type { AppConfig } from "../app/config";
import type { ToolDefinition } from "./types";
import type { AppLogger } from "../app/logger";
import type { GoogleTokenStore } from "../google/token-store";
import type { GmailClient } from "../google/gmail";
import type { CalendarClient } from "../google/calendar";
import { createListFilesTool } from "../tools/list-files";
import { createReadFileTool } from "../tools/read-file";
import { createWriteFileTool } from "../tools/write-file";
import { createApplyPatchTool } from "../tools/apply-patch";
import { createExecTool } from "../tools/exec";
import { createGmailListRecentTool } from "../tools/gmail-list-recent";
import { createGmailGetMessageTool } from "../tools/gmail-get-message";
import { createCalendarListTodayTool } from "../tools/calendar-list-today";
import { createCalendarListTomorrowTool } from "../tools/calendar-list-tomorrow";
import { createCalendarCreateEventTool } from "../tools/calendar-create-event";

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

export type GoogleToolDeps = {
  tokenStore: GoogleTokenStore;
  gmail: GmailClient;
  calendar: CalendarClient;
  config: AppConfig["google"];
};

/**
 * Creates the tool registry. Tools are registered based on what is enabled
 * in config and what backing subsystems are available.
 *
 * Google tools are registered dynamically per call to getDefinitions() so
 * that authorization completed via /google-connect takes effect on the very
 * next agent turn without a service restart.
 */
export function createToolRegistry(
  config: AppConfig,
  _db: Database,
  googleDeps?: GoogleToolDeps
): ToolRegistry {
  const staticTools = new Map<string, ToolHandler>();

  function register(handler: ToolHandler): void {
    staticTools.set(handler.definition.name, handler);
  }

  // Workspace tools — always registered
  register(createListFilesTool(config.workspace.root));
  register(createReadFileTool(config.workspace.root));
  register(createWriteFileTool(config.workspace.root));

  if (config.tools.applyPatch.enabled) {
    register(createApplyPatchTool(config.workspace.root));
  }

  if (config.tools.exec.enabled) {
    register(createExecTool(config.tools.exec));
  }

  // Build the Google tools map once (handlers are stateless wrt credentials)
  const googleTools = buildGoogleTools(config, googleDeps);

  return {
    getDefinitions(): ToolDefinition[] {
      const defs = Array.from(staticTools.values()).map((h) => h.definition);

      // Include Google tools only when credentials exist
      if (
        googleDeps &&
        config.google.enabled &&
        googleDeps.tokenStore.hasCredential()
      ) {
        for (const handler of googleTools.values()) {
          defs.push(handler.definition);
        }
      }

      return defs;
    },

    async execute(
      name: string,
      args: unknown,
      ctx: ToolContext
    ): Promise<{ result: unknown; error?: string }> {
      const handler = staticTools.get(name) ?? googleTools.get(name);
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

function buildGoogleTools(
  config: AppConfig,
  deps?: GoogleToolDeps
): Map<string, ToolHandler> {
  const tools = new Map<string, ToolHandler>();
  if (!deps || !config.google.enabled) return tools;

  const { gmail, calendar } = deps;
  const { gmailRead, calendarRead, calendarWrite } = config.google.scopes;

  if (gmailRead) {
    const listRecent = createGmailListRecentTool(gmail);
    const getMessage = createGmailGetMessageTool(gmail);
    tools.set(listRecent.definition.name, listRecent);
    tools.set(getMessage.definition.name, getMessage);
  }

  if (calendarRead) {
    const today = createCalendarListTodayTool(calendar);
    const tomorrow = createCalendarListTomorrowTool(calendar);
    tools.set(today.definition.name, today);
    tools.set(tomorrow.definition.name, tomorrow);
  }

  if (calendarWrite) {
    const createEvent = createCalendarCreateEventTool(calendar);
    tools.set(createEvent.definition.name, createEvent);
  }

  return tools;
}
