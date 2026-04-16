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
  created_at: string;
};

export function saveMessage(db: Database, msg: StoredMessage): void {
  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, tool_name, tool_call_id, tool_calls_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    msg.id,
    msg.sessionId,
    msg.role,
    msg.content,
    msg.toolName ?? null,
    msg.toolCallId ?? null,
    msg.toolCallsJson ?? null,
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

function rowToRecord(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as StoredMessage["role"],
    content: row.content,
    toolName: row.tool_name ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    toolCallsJson: row.tool_calls_json ?? undefined,
    createdAt: row.created_at,
  };
}
