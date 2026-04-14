import type { Database } from "better-sqlite3";

type SessionRow = {
  id: string;
  transport: string;
  external_chat_id: string;
  external_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SessionRecord = {
  id: string;
  transport: string;
  externalChatId: string;
  externalUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export function upsertSession(
  db: Database,
  session: Pick<SessionRecord, "id" | "transport" | "externalChatId" | "externalUserId">
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, transport, external_chat_id, external_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       external_user_id = excluded.external_user_id,
       updated_at       = excluded.updated_at`
  ).run(session.id, session.transport, session.externalChatId, session.externalUserId ?? null, now, now);
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
