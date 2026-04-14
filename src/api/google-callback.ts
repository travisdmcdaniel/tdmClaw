import type { Context } from "hono";
import type { Database } from "better-sqlite3";
import type { OAuthManager } from "../google/oauth";
import type { TelegramBot } from "../telegram/bot";
import { consumeOAuthState } from "../google/state";
import { childLogger } from "../app/logger";

const log = childLogger("api");

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authorization Complete</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:4rem auto;text-align:center">
  <h2>Authorization complete</h2>
  <p>You can close this window and return to Telegram.</p>
</body>
</html>`;

const ERROR_HTML = (message: string) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authorization Failed</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:4rem auto;text-align:center">
  <h2>Authorization failed</h2>
  <p>${message}</p>
</body>
</html>`;

/**
 * Handles the Google OAuth callback.
 * Validates state, exchanges the authorization code, and notifies Telegram.
 */
export function buildGoogleCallbackHandler(
  db: Database,
  oauthManager: OAuthManager,
  bot: TelegramBot
) {
  return async (c: Context): Promise<Response> => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      log.warn({ error }, "Google OAuth callback returned error");
      return c.html(ERROR_HTML(`Google returned: ${error}`), 400);
    }

    if (!code || !state) {
      return c.html(ERROR_HTML("Missing code or state parameter."), 400);
    }

    const telegramCtx = consumeOAuthState(db, state);
    if (!telegramCtx) {
      return c.html(ERROR_HTML("Invalid or expired authorization session. Please try again from Telegram."), 400);
    }

    try {
      await oauthManager.exchangeCode(code);
      log.info({ chatId: telegramCtx.telegramChatId }, "Google authorization complete");

      // Notify the user in Telegram asynchronously
      void bot.sendMessage(
        telegramCtx.telegramChatId,
        "Google account authorized successfully. Gmail and Calendar tools are now available."
      );

      return c.html(SUCCESS_HTML);
    } catch (err) {
      log.error({ err }, "Failed to exchange Google authorization code");
      return c.html(ERROR_HTML("Failed to complete authorization. Please try again."), 500);
    }
  };
}
