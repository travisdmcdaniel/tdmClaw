import { loadConfig, type AppConfig } from "./config";
import { initLogger, childLogger } from "./logger";
import { loadDotenv } from "./env";
import { registerShutdownHandlers, onShutdown } from "./shutdown";
import { openDatabase } from "../storage/db";
import { runMigrations } from "../storage/migrations";
import { createTelegramBot } from "../telegram/bot";
import { startPolling } from "../telegram/polling";
import { createAgentRuntime } from "../agent/runtime";
import { createToolRegistry } from "../agent/tool-registry";
import { createModelProvider } from "../agent/providers/openai-compatible";
import { createModelDiscovery } from "../agent/providers/discovery";
import { createSchedulerService } from "../scheduler/service";
import { GoogleClientStore } from "../google/client-store";
import { OAuthStateManager } from "../google/state";
import { GoogleOAuth } from "../google/oauth";
import { GoogleTokenStore } from "../google/token-store";
import { createGmailClient } from "../google/gmail";
import { createCalendarClient } from "../google/calendar";

/**
 * Main application bootstrap sequence.
 * Initializes all subsystems in dependency order and registers shutdown handlers.
 */
export async function bootstrap(): Promise<void> {
  // 1. Environment and config
  loadDotenv();
  const config = loadConfig();

  // 2. Logger
  const logger = initLogger(config.app.logLevel);
  const log = childLogger("app");
  log.info("Starting tdmClaw");

  registerShutdownHandlers();

  // 3. Data directory, workspace root, and database
  await ensureDir(config.app.dataDir);
  await ensureDir(config.workspace.root);

  const db = openDatabase(config.app.dataDir);
  await runMigrations(db);
  onShutdown("database", () => { db.close(); });

  // 4. Model provider and discovery
  const discovery = createModelDiscovery(config.models);
  const provider = createModelProvider(config.models, discovery);
  await discovery.start();
  onShutdown("model-discovery", () => discovery.stop());

  // 5. Google subsystem (optional — only fully active when google.enabled = true)
  const clientStore = new GoogleClientStore(db);
  const stateMgr = new OAuthStateManager(db);
  const oauth = new GoogleOAuth();
  const tokenStore = new GoogleTokenStore(db, oauth, clientStore, logger);
  const gmailClient = createGmailClient(tokenStore);
  const calendarClient = createCalendarClient(tokenStore);

  // Purge any expired OAuth state records left by prior processes
  const purged = stateMgr.purgeExpired();
  if (purged > 0) {
    log.info({ purged }, "Purged expired OAuth state records");
  }

  const googleCommandDeps = {
    clientStore,
    stateMgr,
    oauth,
    tokenStore,
    scopeConfig: config.google.scopes,
    isOwner: makeOwnerGuard(config),
    botToken: config.telegram.botToken,
    logger,
  };

  const googleToolDeps = config.google.enabled
    ? {
        tokenStore,
        gmail: gmailClient,
        calendar: calendarClient,
        config: config.google,
      }
    : undefined;

  // 6. Tool registry
  const toolRegistry = createToolRegistry(config, db, googleToolDeps);

  // 7. Agent runtime
  const agentRuntime = createAgentRuntime({
    config,
    db,
    provider,
    discovery,
    toolRegistry,
  });

  // 8. Telegram bot
  const bot = createTelegramBot(
    config.telegram,
    config.workspace.root,
    agentRuntime,
    discovery,
    db,
    googleCommandDeps
  );

  // 9. Scheduler
  if (config.scheduler.enabled) {
    const scheduler = createSchedulerService({
      config,
      db,
      agentRuntime,
      bot,
    });
    scheduler.start();
    onShutdown("scheduler", () => scheduler.stop());
  }

  // 10. Telegram polling (last — starts accepting messages)
  if (config.telegram.polling.enabled) {
    await startPolling(bot);
    onShutdown("telegram", () => bot.stop());
  }

  log.info(
    {
      googleEnabled: config.google.enabled,
      googleAuthorized: tokenStore.hasCredential(),
    },
    "tdmClaw is ready"
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
  const { mkdir } = await import("fs/promises");
  await mkdir(dir, { recursive: true });
}

/**
 * Returns a guard function that returns true only for the configured allowedUserIds.
 * Used to restrict Google commands to the owner.
 */
function makeOwnerGuard(config: AppConfig): (ctx: { from?: { id?: number } }) => boolean {
  const allowed = new Set(config.telegram.allowedUserIds);
  return (ctx) => {
    const userId = String(ctx.from?.id ?? "");
    return allowed.has(userId);
  };
}
