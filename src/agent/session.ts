import type { Database } from "better-sqlite3";
import { upsertSession, getSession } from "../storage/sessions";
import { getMessagesBySession } from "../storage/messages";
import type { StoredMessage } from "./types";

export type SessionContext = {
  sessionId: string;
  telegramChatId: string;
  telegramUserId: string;
  recentMessages: StoredMessage[];
};

/**
 * Loads or creates a session and returns its recent message history.
 */
export function loadSessionContext(
  db: Database,
  sessionId: string,
  chatId: string,
  userId: string,
  maxMessages: number
): SessionContext {
  upsertSession(db, {
    id: sessionId,
    transport: "telegram",
    externalChatId: chatId,
    externalUserId: userId,
  });

  const recentMessages = getMessagesBySession(db, sessionId, maxMessages * 2);

  return {
    sessionId,
    telegramChatId: chatId,
    telegramUserId: userId,
    recentMessages,
  };
}
