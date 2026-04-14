import { Bot } from "grammy";
import type { AppConfig } from "../app/config";
import type { AgentRuntime } from "../agent/runtime";
import type { ModelDiscovery } from "../agent/providers/discovery";
import type { Database } from "better-sqlite3";
import { childLogger } from "../app/logger";
import { buildMessageHandler } from "./handler";
import { truncateForTelegram } from "./format";

export type TelegramBot = {
  bot: Bot;
  sendMessage(chatId: string, text: string): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Creates and wires up the Telegram bot with all command and message handlers.
 */
export function createTelegramBot(
  config: AppConfig["telegram"],
  agentRuntime: AgentRuntime,
  discovery: ModelDiscovery,
  db: Database
): TelegramBot {
  const log = childLogger("telegram");
  const bot = new Bot(config.botToken);

  const handler = buildMessageHandler(config, agentRuntime, discovery, db);

  // Route all text messages and commands through the unified handler
  bot.on("message:text", (ctx) => handler(ctx));

  bot.catch((err) => {
    log.error({ err: err.error }, "Telegram bot error");
  });

  return {
    bot,

    async sendMessage(chatId: string, text: string): Promise<void> {
      try {
        await bot.api.sendMessage(chatId, truncateForTelegram(text));
      } catch (err) {
        log.error({ chatId, err }, "Failed to send Telegram message");
      }
    },

    async stop(): Promise<void> {
      log.info("Stopping Telegram bot");
      bot.stop();
    },
  };
}
