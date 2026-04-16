import { randomBytes } from "crypto";
import type { Database } from "better-sqlite3";
import { childLogger } from "../app/logger";

const log = childLogger("google");

export const STATE_TTL_MINUTES = 10;

export type ConsumedState = {
  telegramChatId: string;
  telegramUserId: string;
  redirectUri: string;
  hintEmail: string | null;
};

type StateRow = {
  telegram_chat_id: string;
  telegram_user_id: string;
  redirect_uri: string;
  hint_email: string | null;
};

/**
 * Manages OAuth state tokens for the Google loopback manual flow.
 *
 * Each token is 32 random bytes (base64url), stored in oauth_states with a
 * 10-minute TTL. Tokens are single-use: validateAndConsume() atomically marks
 * the row consumed and returns it; a second call for the same state returns null.
 */
export class OAuthStateManager {
  constructor(private readonly db: Database) {}

  /**
   * Generate and persist a new state token for this chat/user/redirectUri.
   */
  generate(
    chatId: string,
    userId: string,
    redirectUri: string,
    hintEmail: string | null = null
  ): string {
    const state = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + STATE_TTL_MINUTES * 60_000);

    this.db
      .prepare(
        `INSERT INTO oauth_states
           (state, provider, telegram_chat_id, telegram_user_id, redirect_uri,
            hint_email, created_at, expires_at, consumed_at)
         VALUES (?, 'google', ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        state,
        chatId,
        userId,
        redirectUri,
        hintEmail,
        now.toISOString(),
        expiresAt.toISOString()
      );

    return state;
  }

  /**
   * Atomically validate and consume a state token.
   * Returns the associated metadata, or null if the token is unknown,
   * expired, or already consumed.
   */
  validateAndConsume(state: string): ConsumedState | null {
    const now = new Date().toISOString();

    // Atomically mark consumed only if valid
    const r = this.db
      .prepare(
        `UPDATE oauth_states SET consumed_at = ?
         WHERE state = ? AND expires_at > ? AND consumed_at IS NULL`
      )
      .run(now, state, now);

    if (r.changes === 0) {
      log.warn({ event: "state_invalid" }, "OAuth state not found, expired, or already consumed");
      return null;
    }

    const row = this.db
      .prepare(
        `SELECT telegram_chat_id, telegram_user_id, redirect_uri, hint_email
         FROM oauth_states WHERE state = ?`
      )
      .get(state) as StateRow | undefined;

    if (!row) return null;

    return {
      telegramChatId: row.telegram_chat_id,
      telegramUserId: row.telegram_user_id,
      redirectUri: row.redirect_uri,
      hintEmail: row.hint_email,
    };
  }

  /**
   * Returns the most-recent unused pending flow for a chat, if any.
   * Used for the optional auto-detect UX path.
   */
  findPendingForChat(chatId: string): { state: string; redirectUri: string } | null {
    const now = new Date().toISOString();
    const row = this.db
      .prepare(
        `SELECT state, redirect_uri FROM oauth_states
         WHERE telegram_chat_id = ? AND provider = 'google'
           AND expires_at > ? AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(chatId, now) as { state: string; redirect_uri: string } | undefined;

    if (!row) return null;
    return { state: row.state, redirectUri: row.redirect_uri };
  }

  /**
   * Purge expired state records older than 1 hour.
   * Call on startup to clean up any records left by crashed processes.
   */
  purgeExpired(): number {
    const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
    return this.db
      .prepare(`DELETE FROM oauth_states WHERE expires_at < ?`)
      .run(cutoff).changes;
  }
}
