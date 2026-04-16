import { randomUUID } from "crypto";
import type { Database } from "better-sqlite3";
import { findCurrentSession, insertSession } from "../storage/sessions";
import { getMessagesBySession } from "../storage/messages";
import type { StoredMessage } from "./types";

export type SessionContext = {
  sessionId: string;
  telegramChatId: string;
  telegramUserId: string;
  recentMessages: StoredMessage[];
};

/**
 * Resolves the current session for a Telegram chat.
 * Finds the most recently created session for the chat; creates one if none exists.
 * Returns the session ID and recent message history.
 */
export function loadSessionContext(
  db: Database,
  chatId: string,
  userId: string,
  maxMessages: number
): SessionContext {
  const existing = findCurrentSession(db, chatId, "telegram");

  let sessionId: string;
  if (existing) {
    sessionId = existing.id;
  } else {
    sessionId = buildSessionId(chatId);
    insertSession(db, {
      id: sessionId,
      transport: "telegram",
      externalChatId: chatId,
      externalUserId: userId,
    });
  }

  const recentMessages = getMessagesBySession(db, sessionId, maxMessages * 2);

  return {
    sessionId,
    telegramChatId: chatId,
    telegramUserId: userId,
    recentMessages,
  };
}

/**
 * Creates a new session for a Telegram chat (e.g. on /new) and returns its ID.
 * Does not affect or close the previous session.
 */
export function createNewSession(db: Database, chatId: string, userId: string): string {
  const sessionId = buildSessionId(chatId);
  insertSession(db, {
    id: sessionId,
    transport: "telegram",
    externalChatId: chatId,
    externalUserId: userId,
  });
  return sessionId;
}

function buildSessionId(chatId: string): string {
  return `telegram:${chatId}:${randomUUID().slice(0, 8)}`;
}
