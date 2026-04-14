import type { Database } from "better-sqlite3";
import type { GoogleTokenSet } from "./types";
import { childLogger } from "../app/logger";

const log = childLogger("google");
const PROVIDER = "google";

type CredentialsRow = {
  scopes_json: string;
  token_json: string;
  updated_at: string;
};

export type TokenStore = {
  save(tokens: GoogleTokenSet, scopes: string[]): void;
  load(): { tokens: GoogleTokenSet; scopes: string[] } | null;
  clear(): void;
  hasValidTokens(): boolean;
};

/**
 * Persists and retrieves Google OAuth tokens from the SQLite credentials table.
 */
export function createTokenStore(db: Database): TokenStore {
  return {
    save(tokens: GoogleTokenSet, scopes: string[]): void {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO credentials (provider, scopes_json, token_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
           scopes_json = excluded.scopes_json,
           token_json  = excluded.token_json,
           updated_at  = excluded.updated_at`
      ).run(PROVIDER, JSON.stringify(scopes), JSON.stringify(tokens), now, now);
      log.info("Google tokens saved");
    },

    load(): { tokens: GoogleTokenSet; scopes: string[] } | null {
      const row = db
        .prepare(`SELECT scopes_json, token_json FROM credentials WHERE provider = ?`)
        .get(PROVIDER) as CredentialsRow | undefined;

      if (!row) return null;

      return {
        tokens: JSON.parse(row.token_json) as GoogleTokenSet,
        scopes: JSON.parse(row.scopes_json) as string[],
      };
    },

    clear(): void {
      db.prepare(`DELETE FROM credentials WHERE provider = ?`).run(PROVIDER);
      log.info("Google tokens cleared");
    },

    hasValidTokens(): boolean {
      const stored = this.load();
      if (!stored) return false;
      // Consider expired if within 60 seconds of expiry
      if (stored.tokens.expiryDate) {
        return stored.tokens.expiryDate > Date.now() + 60_000;
      }
      // If no expiry info, assume valid (refresh will handle it)
      return true;
    },
  };
}
