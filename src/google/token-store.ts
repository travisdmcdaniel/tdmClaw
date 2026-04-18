import type { Database } from "better-sqlite3";
import type { TokenSet } from "./types";
import type { GoogleOAuth } from "./oauth";
import type { GoogleClientStore } from "./client-store";
import type { AppLogger } from "../app/logger";

const EXPIRY_BUFFER_MS = 5 * 60_000; // refresh if within 5 minutes of expiry

type CredentialsRow = {
  token_json: string;
  account_label: string | null;
};

/**
 * Persists Google OAuth tokens to the `credentials` table and handles on-demand
 * refresh. Takes GoogleClientStore as a dep so it can load the current
 * user-uploaded credentials when refreshing (they are dynamic, not config).
 */
export class GoogleTokenStore {
  constructor(
    private readonly db: Database,
    private readonly oauth: GoogleOAuth,
    private readonly clientStore: GoogleClientStore,
    private readonly logger: AppLogger
  ) {}

  upsert(tokenSet: TokenSet, accountLabel: string | null = null): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO credentials
           (provider, account_label, scopes_json, token_json, created_at, updated_at)
         VALUES ('google', ?, ?, ?, ?, ?)
         ON CONFLICT (provider) DO UPDATE SET
           account_label = excluded.account_label,
           scopes_json   = excluded.scopes_json,
           token_json    = excluded.token_json,
           updated_at    = excluded.updated_at`
      )
      .run(
        accountLabel,
        JSON.stringify(tokenSet.scopes),
        JSON.stringify(tokenSet),
        now,
        now
      );
  }

  hasCredential(): boolean {
    return (
      this.db
        .prepare(`SELECT 1 FROM credentials WHERE provider = 'google' LIMIT 1`)
        .get() !== undefined
    );
  }

  accountLabel(): string | null {
    const row = this.db
      .prepare(`SELECT account_label FROM credentials WHERE provider = 'google'`)
      .get() as Pick<CredentialsRow, "account_label"> | undefined;
    return row?.account_label ?? null;
  }

  delete(): void {
    this.db.prepare(`DELETE FROM credentials WHERE provider = 'google'`).run();
  }

  /**
   * Returns a valid access token, refreshing automatically if needed.
   * Throws if no credentials are stored or if the client credentials are missing
   * when a refresh is required.
   */
  async getAccessToken(): Promise<string> {
    const stored = this.readStored();
    if (!stored) {
      throw new Error("No Google credentials. Run /google_connect to authorize.");
    }

    // Return the stored token if it isn't near expiry
    if (Date.now() < stored.expiresAt - EXPIRY_BUFFER_MS) {
      return stored.accessToken;
    }

    const creds = this.clientStore.read();
    if (!creds) {
      throw new Error(
        "Google client credentials missing. Re-upload client_secret.json with /google_setup."
      );
    }

    this.logger.info({ subsystem: "google", event: "token_refresh_start" }, "Refreshing Google token");
    const fresh = await this.oauth.refreshAccessToken(creds, stored.refreshToken);
    this.upsert(fresh, this.accountLabel());
    this.logger.info({ subsystem: "google", event: "token_refresh_ok" }, "Google token refreshed");

    return fresh.accessToken;
  }

  private readStored(): TokenSet | null {
    const row = this.db
      .prepare(`SELECT token_json FROM credentials WHERE provider = 'google'`)
      .get() as Pick<CredentialsRow, "token_json"> | undefined;
    return row ? (JSON.parse(row.token_json) as TokenSet) : null;
  }
}
