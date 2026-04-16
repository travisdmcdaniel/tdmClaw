import type { Database } from "better-sqlite3";

type SessionRow = {
  id: string;
  transport: string;
  external_chat_id: string;
  external_user_id: string | null;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  created_at: string;
  updated_at: string;
};

export type SessionRecord = {
  id: string;
  transport: string;
  externalChatId: string;
  externalUserId?: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Returns the most recently created session for a given chat, or null if none exists.
 */
export function findCurrentSession(
  db: Database,
  chatId: string,
  transport: string
): SessionRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM sessions
       WHERE external_chat_id = ? AND transport = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(chatId, transport) as SessionRow | undefined;
  return row ? rowToRecord(row) : null;
}

/**
 * Inserts a new session row. Use for creating fresh sessions (e.g. /new command).
 */
export function insertSession(
  db: Database,
  session: Pick<SessionRecord, "id" | "transport" | "externalChatId" | "externalUserId">
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions
       (id, transport, external_chat_id, external_user_id,
        total_prompt_tokens, total_completion_tokens, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(
    session.id,
    session.transport,
    session.externalChatId,
    session.externalUserId ?? null,
    now,
    now
  );
}

/**
 * Upserts a session by ID. Kept for compatibility — prefer insertSession for new sessions.
 */
export function upsertSession(
  db: Database,
  session: Pick<SessionRecord, "id" | "transport" | "externalChatId" | "externalUserId">
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions
       (id, transport, external_chat_id, external_user_id,
        total_prompt_tokens, total_completion_tokens, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       external_user_id = excluded.external_user_id,
       updated_at       = excluded.updated_at`
  ).run(
    session.id,
    session.transport,
    session.externalChatId,
    session.externalUserId ?? null,
    now,
    now
  );
}

/**
 * Increments the running token totals for a session.
 * Uses COALESCE to handle rows created before the token columns were added.
 */
export function addSessionTokens(
  db: Database,
  sessionId: string,
  promptTokens: number,
  completionTokens: number
): void {
  db.prepare(
    `UPDATE sessions
     SET total_prompt_tokens     = COALESCE(total_prompt_tokens, 0) + ?,
         total_completion_tokens = COALESCE(total_completion_tokens, 0) + ?,
         updated_at              = ?
     WHERE id = ?`
  ).run(promptTokens, completionTokens, new Date().toISOString(), sessionId);
}

export function getSession(db: Database, id: string): SessionRecord | null {
  const row = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(id) as SessionRow | undefined;
  if (!row) return null;
  return rowToRecord(row);
}

function rowToRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    transport: row.transport,
    externalChatId: row.external_chat_id,
    externalUserId: row.external_user_id ?? undefined,
    totalPromptTokens: row.total_prompt_tokens ?? 0,
    totalCompletionTokens: row.total_completion_tokens ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
