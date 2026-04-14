import { loadConfig, type AppConfig } from "./config";
import { initLogger, childLogger } from "./logger";
import { loadDotenv } from "./env";
import { registerShutdownHandlers, onShutdown } from "./shutdown";
import { openDatabase } from "../storage/db";
import { runMigrations } from "../storage/migrations";
import { createApiServer } from "../api/server";
import { createTelegramBot } from "../telegram/bot";
import { startPolling } from "../telegram/polling";
import { createAgentRuntime } from "../agent/runtime";
import { createToolRegistry } from "../agent/tool-registry";
import { createModelProvider } from "../agent/providers/openai-compatible";
import { createModelDiscovery } from "../agent/providers/discovery";
import { createSchedulerService } from "../scheduler/service";

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

  // 3. Data directory and database
  await ensureDataDir(config.app.dataDir);
  const db = openDatabase(config.app.dataDir);
  await runMigrations(db);
  onShutdown("database", () => db.close());

  // 4. Model provider and discovery
  const discovery = createModelDiscovery(config.models);
  const provider = createModelProvider(config.models, discovery);
  await discovery.start();
  onShutdown("model-discovery", () => discovery.stop());

  // 5. Tool registry
  const toolRegistry = createToolRegistry(config, db);

  // 6. Agent runtime
  const agentRuntime = createAgentRuntime({
    config,
    db,
    provider,
    discovery,
    toolRegistry,
  });

  // 7. Telegram bot
  const bot = createTelegramBot(config.telegram, agentRuntime, discovery, db);

  // 8. Local HTTP server (OAuth callback + healthz)
  const apiServer = createApiServer(config, db, bot);
  await apiServer.start();
  onShutdown("api-server", () => apiServer.stop());

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

  log.info("tdmClaw is ready");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDataDir(dataDir: string): Promise<void> {
  const { mkdir } = await import("fs/promises");
  await mkdir(dataDir, { recursive: true });
}
