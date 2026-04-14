import type { TelegramBot } from "./bot";
import { childLogger } from "../app/logger";

const log = childLogger("telegram");

const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

/**
 * Starts long-polling for Telegram updates.
 * Retries with backoff on failure; does not throw unless retries are exhausted.
 */
export async function startPolling(telegramBot: TelegramBot): Promise<void> {
  const { bot } = telegramBot;

  log.info("Starting Telegram polling");

  let attempt = 0;

  const start = (): void => {
    bot.start({
      onStart: () => {
        attempt = 0;
        log.info("Telegram polling active");
      },
    }).catch((err: unknown) => {
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 30000;
      attempt++;
      log.error({ err, attempt, retryInMs: delay }, "Telegram polling error — retrying");
      setTimeout(start, delay);
    });
  };

  start();
}
