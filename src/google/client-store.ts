import type { Database } from "better-sqlite3";
import type { GoogleClientCredentials } from "./types";

type ClientRow = {
  client_id: string;
  client_secret: string;
  project_id: string | null;
};

/**
 * Persists the user-uploaded Google OAuth client credentials (client_secret.json)
 * to the singleton `google_client` SQLite table.
 */
export class GoogleClientStore {
  constructor(private readonly db: Database) {}

  upsert(creds: GoogleClientCredentials): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO google_client (id, client_id, client_secret, project_id, updated_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           client_id     = excluded.client_id,
           client_secret = excluded.client_secret,
           project_id    = excluded.project_id,
           updated_at    = excluded.updated_at`
      )
      .run(creds.clientId, creds.clientSecret, creds.projectId ?? null, now);
  }

  read(): GoogleClientCredentials | null {
    const row = this.db
      .prepare(`SELECT client_id, client_secret, project_id FROM google_client WHERE id = 1`)
      .get() as ClientRow | undefined;

    if (!row) return null;
    return {
      clientId: row.client_id,
      clientSecret: row.client_secret,
      projectId: row.project_id ?? undefined,
    };
  }

  delete(): void {
    this.db.prepare(`DELETE FROM google_client WHERE id = 1`).run();
  }

  has(): boolean {
    return this.read() !== null;
  }
}
