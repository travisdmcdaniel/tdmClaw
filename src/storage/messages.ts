import type { Database } from "better-sqlite3";
import type { StoredMessage } from "../agent/types";

type MessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  tool_call_id: string | null;
  tool_calls_json: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: string;
};

export function saveMessage(db: Database, msg: StoredMessage): void {
  db.prepare(
    `INSERT INTO messages
       (id, session_id, role, content, tool_name, tool_call_id, tool_calls_json,
        prompt_tokens, completion_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    msg.id,
    msg.sessionId,
    msg.role,
    msg.content,
    msg.toolName ?? null,
    msg.toolCallId ?? null,
    msg.toolCallsJson ?? null,
    msg.promptTokens ?? null,
    msg.completionTokens ?? null,
    msg.createdAt
  );
}

export function getMessagesBySession(
  db: Database,
  sessionId: string,
  limit: number
): StoredMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(sessionId, limit) as MessageRow[];

  // Reverse to chronological order
  return rows.reverse().map(rowToRecord);
}

/**
 * Deletes all messages with created_at before the given ISO timestamp.
 * Returns the number of rows deleted.
 */
export function deleteMessagesOlderThan(db: Database, cutoffIso: string): number {
  const result = db.prepare(`DELETE FROM messages WHERE created_at < ?`).run(cutoffIso);
  return result.changes;
}

function rowToRecord(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as StoredMessage["role"],
    content: row.content,
    toolName: row.tool_name ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    toolCallsJson: row.tool_calls_json ?? undefined,
    promptTokens: row.prompt_tokens ?? undefined,
    completionTokens: row.completion_tokens ?? undefined,
    createdAt: row.created_at,
  };
}
