import type { Database } from "better-sqlite3";
import { randomBytes } from "crypto";
import { childLogger } from "../app/logger";

const log = childLogger("google");

export type OAuthStateRecord = {
  state: string;
  provider: "google";
  telegramChatId: string;
  telegramUserId: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
};

const TTL_MINUTES = 10;

/**
 * Creates and persists a new OAuth state token.
 * The state is a cryptographically random string used to match callbacks to Telegram sessions.
 */
export function createOAuthState(
  db: Database,
  telegramChatId: string,
  telegramUserId: string
): string {
  const state = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MINUTES * 60 * 1000);

  db.prepare(
    `INSERT INTO oauth_states (state, provider, telegram_chat_id, telegram_user_id, created_at, expires_at)
     VALUES (?, 'google', ?, ?, ?, ?)`
  ).run(state, telegramChatId, telegramUserId, now.toISOString(), expiresAt.toISOString());

  return state;
}

/**
 * Validates and consumes an OAuth state token.
 * Returns the associated Telegram context or null if invalid/expired/already consumed.
 */
export function consumeOAuthState(
  db: Database,
  state: string
): Pick<OAuthStateRecord, "telegramChatId" | "telegramUserId"> | null {
  const row = db
    .prepare(
      `SELECT telegram_chat_id, telegram_user_id, expires_at, consumed_at
       FROM oauth_states WHERE state = ?`
    )
    .get(state) as
    | { telegram_chat_id: string; telegram_user_id: string; expires_at: string; consumed_at: string | null }
    | undefined;

  if (!row) {
    log.warn({ state: "[redacted]" }, "OAuth state not found");
    return null;
  }

  if (row.consumed_at) {
    log.warn("OAuth state already consumed");
    return null;
  }

  if (new Date(row.expires_at) < new Date()) {
    log.warn("OAuth state expired");
    return null;
  }

  db.prepare(
    `UPDATE oauth_states SET consumed_at = ? WHERE state = ?`
  ).run(new Date().toISOString(), state);

  return {
    telegramChatId: row.telegram_chat_id,
    telegramUserId: row.telegram_user_id,
  };
}
