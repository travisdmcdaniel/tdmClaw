import { Bot } from "grammy";
import type { AppConfig } from "../app/config";
import type { AgentRuntime } from "../agent/runtime";
import type { ModelDiscovery } from "../agent/providers/discovery";
import type { Database } from "better-sqlite3";
import { childLogger } from "../app/logger";
import { buildMessageHandler } from "./handler";
import { truncateForTelegram, toMarkdownV2 } from "./format";
import type { TelegramSendOptions } from "./types";
import type { GoogleCommandDeps } from "./commands/google";

export type TelegramBot = {
  bot: Bot;
  sendMessage(chatId: string, text: string, options?: TelegramSendOptions): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Creates and wires up the Telegram bot with all command and message handlers.
 */
export function createTelegramBot(
  config: AppConfig["telegram"],
  workspaceRoot: string,
  agentRuntime: AgentRuntime,
  discovery: ModelDiscovery,
  db: Database,
  googleDeps?: GoogleCommandDeps,
  jobsFilePath?: string
): TelegramBot {
  const log = childLogger("telegram");
  const bot = new Bot(config.botToken);

  const handler = buildMessageHandler(
    config,
    workspaceRoot,
    agentRuntime,
    discovery,
    db,
    googleDeps,
    jobsFilePath
  );

  // Route all messages through the unified handler so document uploads are handled.
  bot.on("message", (ctx) => handler(ctx));

  bot.catch((err) => {
    log.error({ err: err.error }, "Telegram bot error");
  });

  return {
    bot,

    async sendMessage(chatId: string, text: string, options?: TelegramSendOptions): Promise<void> {
      try {
        const parseMode = options?.parseMode ?? "MarkdownV2";
        const finalText =
          parseMode === "MarkdownV2"
            ? truncateForTelegram(toMarkdownV2(text))
            : truncateForTelegram(text);
        const replyParameters =
          options?.replyToMessageId !== undefined
            ? { reply_parameters: { message_id: options.replyToMessageId } }
            : {};
        await bot.api.sendMessage(chatId, finalText, {
          parse_mode: parseMode,
          ...replyParameters,
        });
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
