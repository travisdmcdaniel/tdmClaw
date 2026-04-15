# tdmClaw — Google OAuth Implementation Plan

## Document Metadata

- Project: tdmClaw
- Document Type: Implementation Plan — Google OAuth Subsystem
- Version: 0.1
- Status: Active
- Related Documents: `tdmClaw_TDD.md`, `tdmClaw_IP.md`, `tdmClaw_GoogleOAuth_TDD.md`

---

## Overview

This plan covers the implementation of Phase 3 from `tdmClaw_IP.md` in full detail. Phase 3 is the Google OAuth subsystem: authorizing a Google account from a LAN device via Telegram, exchanging the authorization code on the Pi's HTTP server, storing the resulting tokens, and exposing Gmail and Calendar data through agent tools.

The tasks below are sequenced so that each task is independently runnable and testable before the next begins. They follow the order:

```
OAuth infrastructure → Callback server → Token storage → Gmail → Calendar → Tool registration → Telegram command
```

---

## Prerequisites

Before starting Phase 3, the following must be in place (from Phases 1 and 2):

- `src/app/bootstrap.ts` wires all dependencies
- `src/storage/db.ts` provides a `better-sqlite3` `Database` instance
- `src/storage/migrations.ts` migration runner is in place
- `src/app/logger.ts` exports `AppLogger` (pino)
- `src/app/config.ts` exports a validated `AppConfig` with a `google` block
- Telegram bot instance available as `bot: Bot` from grammy
- Graceful shutdown hooks available in `src/app/shutdown.ts`

---

## Phase 3 Tasks

---

### Task 3.1 — Add Google OAuth migrations

**Goal:** Add the `oauth_states` table (if not already present) and the `credentials` table to the migration runner.

**Key files:** `src/storage/migrations.ts`

#### What to do

In `migrations.ts`, add a new migration entry. The migration runner applies each migration exactly once in order, tracked by a `schema_version` or `migrations` table.

```typescript
// In the migrations array inside src/storage/migrations.ts

{
  version: 3,
  name: "google_oauth",
  up(db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_states (
        state            TEXT PRIMARY KEY,
        provider         TEXT NOT NULL,
        telegram_chat_id TEXT NOT NULL,
        telegram_user_id TEXT NOT NULL,
        created_at       TEXT NOT NULL,
        expires_at       TEXT NOT NULL,
        consumed_at      TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at
        ON oauth_states (expires_at);

      CREATE TABLE IF NOT EXISTS credentials (
        provider      TEXT PRIMARY KEY,
        account_label TEXT,
        scopes_json   TEXT NOT NULL,
        token_json    TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
    `);
  },
},
```

**Exit criteria:** Running the app against a fresh database creates both tables. Running it again (on an existing database at version ≥ 3) skips this migration. Verify with `sqlite3 data/tdmclaw.db ".tables"`.

---

### Task 3.2 — Scope constants (`src/google/scopes.ts`)

**Goal:** Define all Google OAuth scopes as named constants and a `buildScopes()` factory.

**Key files:** `src/google/scopes.ts`

```typescript
// src/google/scopes.ts

export const SCOPES = {
  openid:          "openid",
  email:           "email",
  userinfoEmail:   "https://www.googleapis.com/auth/userinfo.email",
  gmailReadonly:   "https://www.googleapis.com/auth/gmail.readonly",
  calendarReadonly:"https://www.googleapis.com/auth/calendar.readonly",
} as const;

export type ScopeConfig = {
  gmailRead:     boolean;
  calendarRead:  boolean;
};

/**
 * Build the complete list of OAuth scopes to request based on feature config.
 * OIDC scopes are always included.
 */
export function buildScopes(config: ScopeConfig): string[] {
  const scopes: string[] = [
    SCOPES.openid,
    SCOPES.email,
    SCOPES.userinfoEmail,
  ];
  if (config.gmailRead)    scopes.push(SCOPES.gmailReadonly);
  if (config.calendarRead) scopes.push(SCOPES.calendarReadonly);
  return scopes;
}
```

**Exit criteria:** Unit test: `buildScopes({ gmailRead: true, calendarRead: false })` returns 4 scopes including `gmail.readonly` but not `calendar.readonly`. `buildScopes({ gmailRead: false, calendarRead: false })` returns exactly the 3 OIDC scopes.

---

### Task 3.3 — Shared types (`src/google/types.ts`)

**Goal:** Define all shared types for the Google subsystem. No logic — types only.

**Key files:** `src/google/types.ts`

```typescript
// src/google/types.ts

export type TokenSet = {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number;   // Unix timestamp ms
  scopes:       string[];
};

export type OAuthStateRecord = {
  state:           string;
  provider:        "google";
  telegramChatId:  string;
  telegramUserId:  string;
  createdAt:       string;
  expiresAt:       string;
  consumedAt:      string | null;
};

export type CompactEmail = {
  id:         string;
  threadId:   string;
  from:       string;
  subject:    string;
  receivedAt: string;
  snippet:    string;
  labels?:    string[];
};

export type CompactEmailDetail = CompactEmail & {
  excerpt: string;
};

export type CompactCalendarEvent = {
  id:                   string;
  title:                string;
  start:                string;
  end?:                 string;
  location?:            string;
  descriptionExcerpt?:  string;
  calendarId?:          string;
};
```

**Exit criteria:** TypeScript compiles cleanly. No logic to test.

---

### Task 3.4 — OAuth state manager (`src/google/state.ts`)

**Goal:** Implement the full lifecycle for OAuth state tokens: generate, validate-and-consume, and purge-expired.

**Key files:** `src/google/state.ts`

```typescript
// src/google/state.ts

import * as crypto from "crypto";
import type { Database } from "better-sqlite3";

export const STATE_TTL_MINUTES = 10;

export type ConsumedState = {
  telegramChatId: string;
  telegramUserId: string;
};

export class OAuthStateManager {
  constructor(private readonly db: Database) {}

  /**
   * Generate a new state token for a Telegram-initiated auth flow.
   * Returns the state string to embed in the auth URL.
   */
  generate(telegramChatId: string, telegramUserId: string): string {
    const state    = crypto.randomBytes(32).toString("base64url");
    const now      = new Date();
    const expiresAt = new Date(now.getTime() + STATE_TTL_MINUTES * 60 * 1000);

    this.db.prepare(`
      INSERT INTO oauth_states
        (state, provider, telegram_chat_id, telegram_user_id, created_at, expires_at, consumed_at)
      VALUES (?, 'google', ?, ?, ?, ?, NULL)
    `).run(state, telegramChatId, telegramUserId, now.toISOString(), expiresAt.toISOString());

    return state;
  }

  /**
   * Atomically validate and consume a state token.
   *
   * Returns the associated Telegram chat/user IDs on success.
   * Returns null if the state is unknown, expired, or already consumed.
   *
   * The UPDATE-before-SELECT pattern ensures only one concurrent caller
   * can consume a given state (SQLite serializes writes).
   */
  validateAndConsume(state: string): ConsumedState | null {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE oauth_states
      SET consumed_at = ?
      WHERE state       = ?
        AND expires_at  > ?
        AND consumed_at IS NULL
    `).run(now, state, now);

    if (result.changes === 0) return null;

    const row = this.db.prepare(`
      SELECT telegram_chat_id, telegram_user_id
      FROM oauth_states
      WHERE state = ?
    `).get(state) as { telegram_chat_id: string; telegram_user_id: string } | undefined;

    if (!row) return null;

    return {
      telegramChatId: row.telegram_chat_id,
      telegramUserId: row.telegram_user_id,
    };
  }

  /**
   * Delete state records older than 1 hour.
   * Call on startup and periodically (hourly is sufficient).
   */
  purgeExpired(): number {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const result = this.db.prepare(
      `DELETE FROM oauth_states WHERE expires_at < ?`
    ).run(cutoff);
    return result.changes;
  }
}
```

**Unit tests to write (`src/google/state.test.ts`):**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { OAuthStateManager } from "./state.ts";

// Use an in-memory SQLite database for tests
function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE oauth_states (
      state TEXT PRIMARY KEY, provider TEXT NOT NULL,
      telegram_chat_id TEXT NOT NULL, telegram_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT
    );
  `);
  return db;
}

describe("OAuthStateManager", () => {
  let manager: OAuthStateManager;

  beforeEach(() => {
    manager = new OAuthStateManager(makeDb());
  });

  it("generates a 43-character base64url state", () => {
    const state = manager.generate("chat1", "user1");
    // 32 bytes base64url = 43 chars (no padding)
    expect(state).toHaveLength(43);
    expect(state).toMatch(/^[A-Za-z0-9_\-]+$/);
  });

  it("generates unique states", () => {
    const a = manager.generate("chat1", "user1");
    const b = manager.generate("chat1", "user1");
    expect(a).not.toBe(b);
  });

  it("returns ConsumedState on valid state", () => {
    const state = manager.generate("chat1", "user1");
    const result = manager.validateAndConsume(state);
    expect(result).toEqual({ telegramChatId: "chat1", telegramUserId: "user1" });
  });

  it("returns null on second consume attempt (single-use)", () => {
    const state = manager.generate("chat1", "user1");
    manager.validateAndConsume(state);
    expect(manager.validateAndConsume(state)).toBeNull();
  });

  it("returns null for unknown state", () => {
    expect(manager.validateAndConsume("notexist")).toBeNull();
  });

  it("returns null for expired state", () => {
    const db = makeDb();
    const m = new OAuthStateManager(db);
    const state = m.generate("chat1", "user1");
    // Manually expire the row
    db.prepare(`UPDATE oauth_states SET expires_at = ? WHERE state = ?`)
      .run(new Date(Date.now() - 1000).toISOString(), state);
    expect(m.validateAndConsume(state)).toBeNull();
  });

  it("purgeExpired removes old records", () => {
    const db = makeDb();
    const m = new OAuthStateManager(db);
    m.generate("chat1", "user1");
    // Manually age it beyond 1 hour
    db.prepare(`UPDATE oauth_states SET expires_at = ?`)
      .run(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    const removed = m.purgeExpired();
    expect(removed).toBe(1);
  });
});
```

**Exit criteria:** All unit tests pass. `generate()` + `validateAndConsume()` + second-consume = null is the critical path.

---

### Task 3.5 — OAuth core (`src/google/oauth.ts`)

**Goal:** Implement `buildAuthUrl()`, `exchangeCode()`, `refreshAccessToken()`, and `fetchUserEmail()`.

**Key files:** `src/google/oauth.ts`

```typescript
// src/google/oauth.ts

import type { TokenSet } from "./types.ts";

export type OAuthConfig = {
  clientId:     string;
  clientSecret: string;
  redirectUri:  string;
  scopes:       string[];
};

const TOKEN_ENDPOINT    = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT     = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v1/userinfo";

export class GoogleOAuth {
  constructor(private readonly config: OAuthConfig) {}

  /**
   * Build the Google authorization URL.
   *
   * Key parameters:
   * - access_type=offline   → Google returns a refresh_token
   * - prompt=consent        → Google always re-issues a refresh_token (prevents "no refresh_token"
   *                           bug when user previously authorized the same client)
   * - include_granted_scopes=true → Accumulates scopes across incremental authorization requests
   */
  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      response_type:           "code",
      client_id:               this.config.clientId,
      redirect_uri:            this.config.redirectUri,
      scope:                   this.config.scopes.join(" "),
      state,
      access_type:             "offline",
      prompt:                  "consent",
      include_granted_scopes:  "true",
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for a token set.
   *
   * IMPORTANT: The redirect_uri passed here must match EXACTLY the one used
   * in buildAuthUrl(). Google validates this and returns redirect_uri_mismatch
   * if they differ.
   *
   * Throws if no refresh_token is returned. This should not happen with
   * prompt=consent but is caught defensively.
   */
  async exchangeCode(code: string): Promise<TokenSet> {
    const resp = await fetch(TOKEN_ENDPOINT, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        redirect_uri:  this.config.redirectUri,
        client_id:     this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Token exchange failed (${resp.status}): ${body}`);
    }

    const data = await resp.json() as {
      access_token:   string;
      refresh_token?: string;
      expires_in:     number;
      scope:          string;
    };

    if (!data.refresh_token) {
      throw new Error(
        "Google did not return a refresh_token. " +
        "Revoke app access at https://myaccount.google.com/permissions and try again."
      );
    }

    return {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    Date.now() + data.expires_in * 1000,
      scopes:       data.scope.split(" "),
    };
  }

  /**
   * Use a stored refresh token to get a new access token.
   *
   * Google does NOT rotate the refresh token on each refresh (unless the user
   * has revoked access or the token has been idle for 6 months). If Google
   * does return a new refresh_token, it is used; otherwise the original is kept.
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
    const resp = await fetch(TOKEN_ENDPOINT, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
        client_id:     this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Token refresh failed (${resp.status}): ${body}`);
    }

    const data = await resp.json() as {
      access_token:   string;
      refresh_token?: string;
      expires_in:     number;
      scope:          string;
    };

    return {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt:    Date.now() + data.expires_in * 1000,
      scopes:       data.scope.split(" "),
    };
  }

  /**
   * Fetch the email address of the authorized user.
   * Non-fatal — returns null on failure.
   */
  async fetchUserEmail(accessToken: string): Promise<string | null> {
    try {
      const resp = await fetch(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!resp.ok) return null;
      const data = await resp.json() as { email?: string };
      return data.email ?? null;
    } catch {
      return null;
    }
  }
}
```

**Unit tests to write (`src/google/oauth.test.ts`):**

```typescript
import { describe, it, expect, vi } from "vitest";
import { GoogleOAuth } from "./oauth.ts";

const config = {
  clientId:     "test-client-id",
  clientSecret: "test-secret",
  redirectUri:  "https://pi-auth.local/oauth/google/callback",
  scopes:       ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
};

describe("GoogleOAuth.buildAuthUrl", () => {
  const oauth = new GoogleOAuth(config);

  it("includes all required parameters", () => {
    const url = new URL(oauth.buildAuthUrl("my-state-token"));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("state")).toBe("my-state-token");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("joins scopes with spaces", () => {
    const url = new URL(oauth.buildAuthUrl("s"));
    expect(url.searchParams.get("scope")).toBe(config.scopes.join(" "));
  });
});

describe("GoogleOAuth.exchangeCode", () => {
  it("returns a TokenSet on success", async () => {
    const oauth = new GoogleOAuth(config);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token:  "ya29.test",
        refresh_token: "1//testrefresh",
        expires_in:    3600,
        scope:         "openid email",
      }), { status: 200 }),
    );
    const token = await oauth.exchangeCode("test-code");
    expect(token.accessToken).toBe("ya29.test");
    expect(token.refreshToken).toBe("1//testrefresh");
    expect(token.expiresAt).toBeGreaterThan(Date.now());
  });

  it("throws if refresh_token is absent", async () => {
    const oauth = new GoogleOAuth(config);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: "ya29.test",
        expires_in:   3600,
        scope:        "openid email",
      }), { status: 200 }),
    );
    await expect(oauth.exchangeCode("code")).rejects.toThrow("refresh_token");
  });

  it("throws on non-2xx response", async () => {
    const oauth = new GoogleOAuth(config);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("invalid_grant", { status: 400 }),
    );
    await expect(oauth.exchangeCode("badcode")).rejects.toThrow("400");
  });
});
```

**Exit criteria:** All unit tests pass. `buildAuthUrl()` produces a valid URL with all required params. `exchangeCode()` correctly throws when `refresh_token` is missing.

---

### Task 3.6 — Token store (`src/google/token-store.ts`)

**Goal:** Implement durable token read/write with automatic on-demand refresh.

**Key files:** `src/google/token-store.ts`

```typescript
// src/google/token-store.ts

import type { Database } from "better-sqlite3";
import type { TokenSet } from "./types.ts";
import type { GoogleOAuth } from "./oauth.ts";
import type { AppLogger } from "../app/logger.ts";

// Refresh the access token 5 minutes before it actually expires.
// This prevents races where the token is valid when checked but expires
// before the HTTP request to Google completes.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class GoogleTokenStore {
  constructor(
    private readonly db:     Database,
    private readonly oauth:  GoogleOAuth,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Persist a token set. Overwrites any existing Google credential.
   * Call this after a successful code exchange or token refresh.
   */
  upsert(tokenSet: TokenSet, accountLabel: string | null = null): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO credentials
        (provider, account_label, scopes_json, token_json, created_at, updated_at)
      VALUES ('google', ?, ?, ?, ?, ?)
      ON CONFLICT (provider) DO UPDATE SET
        account_label = excluded.account_label,
        scopes_json   = excluded.scopes_json,
        token_json    = excluded.token_json,
        updated_at    = excluded.updated_at
    `).run(
      accountLabel,
      JSON.stringify(tokenSet.scopes),
      JSON.stringify(tokenSet),
      now,
      now,
    );
  }

  /** True if a Google credential record exists. */
  hasCredential(): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM credentials WHERE provider = 'google' LIMIT 1`
    ).get();
    return row !== undefined;
  }

  /** Delete the stored Google credential. */
  delete(): void {
    this.db.prepare(`DELETE FROM credentials WHERE provider = 'google'`).run();
  }

  /**
   * Get a valid access token.
   *
   * If the stored access token is within EXPIRY_BUFFER_MS of expiry, this method
   * transparently calls Google's token endpoint to get a new one and persists it
   * before returning.
   *
   * Throws if no credential is stored or if refresh fails.
   */
  async getAccessToken(): Promise<string> {
    const stored = this.readStored();
    if (!stored) {
      throw new Error(
        "No Google credentials stored. Send /google-connect to authorize."
      );
    }

    if (Date.now() < stored.expiresAt - EXPIRY_BUFFER_MS) {
      return stored.accessToken;
    }

    this.logger.info(
      { subsystem: "google", event: "token_refresh_start" },
      "Access token near expiry — refreshing"
    );

    const refreshed = await this.oauth.refreshAccessToken(stored.refreshToken);
    this.upsert(refreshed);   // Persist before returning to avoid re-fetching on next call

    this.logger.info(
      { subsystem: "google", event: "token_refresh_ok" },
      "Access token refreshed"
    );

    return refreshed.accessToken;
  }

  private readStored(): TokenSet | null {
    const row = this.db.prepare(
      `SELECT token_json FROM credentials WHERE provider = 'google'`
    ).get() as { token_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.token_json) as TokenSet;
  }
}
```

**Unit tests to write (`src/google/token-store.test.ts`):**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { GoogleTokenStore } from "./token-store.ts";
import type { GoogleOAuth } from "./oauth.ts";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE credentials (
      provider TEXT PRIMARY KEY, account_label TEXT,
      scopes_json TEXT NOT NULL, token_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

const freshToken = (offsetMs = 60 * 60 * 1000): import("./types.ts").TokenSet => ({
  accessToken:  "ya29.fresh",
  refreshToken: "1//refresh",
  expiresAt:    Date.now() + offsetMs,
  scopes:       ["openid"],
});

describe("GoogleTokenStore", () => {
  let store: GoogleTokenStore;
  let mockOAuth: GoogleOAuth;

  beforeEach(() => {
    const db = makeDb();
    mockOAuth = { refreshAccessToken: vi.fn() } as any;
    store = new GoogleTokenStore(db, mockOAuth, makeLogger());
  });

  it("returns false for hasCredential when empty", () => {
    expect(store.hasCredential()).toBe(false);
  });

  it("returns true for hasCredential after upsert", () => {
    store.upsert(freshToken());
    expect(store.hasCredential()).toBe(true);
  });

  it("returns stored access token when not near expiry", async () => {
    store.upsert(freshToken(60 * 60 * 1000)); // 1 hour from now
    const token = await store.getAccessToken();
    expect(token).toBe("ya29.fresh");
    expect(mockOAuth.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes when within EXPIRY_BUFFER_MS", async () => {
    store.upsert(freshToken(2 * 60 * 1000)); // 2 minutes — within 5-min buffer
    const refreshed = freshToken(60 * 60 * 1000);
    refreshed.accessToken = "ya29.refreshed";
    (mockOAuth.refreshAccessToken as any).mockResolvedValueOnce(refreshed);

    const token = await store.getAccessToken();
    expect(token).toBe("ya29.refreshed");
    expect(mockOAuth.refreshAccessToken).toHaveBeenCalledWith("1//refresh");
  });

  it("throws when no credential is stored", async () => {
    await expect(store.getAccessToken()).rejects.toThrow("No Google credentials");
  });

  it("delete removes the credential", () => {
    store.upsert(freshToken());
    store.delete();
    expect(store.hasCredential()).toBe(false);
  });
});
```

**Exit criteria:** All tests pass. Specifically: token is not refreshed when fresh; is refreshed when within the 5-minute buffer; refresh result is persisted.

---

### Task 3.7 — Token redaction utility (`src/security/redact.ts`)

**Goal:** Provide utilities for stripping tokens and secrets from log strings and URLs.

**Key files:** `src/security/redact.ts`

```typescript
// src/security/redact.ts

// Google access tokens start with "ya29."
const ACCESS_TOKEN_RE  = /ya29\.[A-Za-z0-9_\-]+/g;
// Google refresh tokens start with "1//"
const REFRESH_TOKEN_RE = /1\/\/[A-Za-z0-9_\-]+/g;
// Bearer headers
const BEARER_RE        = /Bearer\s+[A-Za-z0-9_\-\.]+/gi;

/**
 * Redact any recognizable Google token patterns from a string.
 */
export function redact(value: string): string {
  return value
    .replace(ACCESS_TOKEN_RE,  "[ACCESS_TOKEN]")
    .replace(REFRESH_TOKEN_RE, "[REFRESH_TOKEN]")
    .replace(BEARER_RE,        "Bearer [REDACTED]");
}

/**
 * Return a copy of the URL with sensitive query parameters redacted.
 * Use this before logging incoming OAuth callback URLs.
 */
export function redactQueryParams(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ["code", "access_token", "refresh_token", "token", "state"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "[REDACTED]");
    }
    return u.toString();
  } catch {
    return "[invalid url]";
  }
}
```

**Exit criteria:** Unit test: `redact("Bearer ya29.abc123")` returns `"Bearer [REDACTED]"`. `redactQueryParams("https://host/cb?code=abc&state=xyz")` returns a URL with both params redacted.

---

### Task 3.8 — Hono API server (`src/api/server.ts` and `src/api/health.ts`)

**Goal:** Set up the Hono server that will host the OAuth callback route. The server wires routes and provides start/stop lifecycle methods.

**Key files:** `src/api/server.ts`, `src/api/health.ts`

```typescript
// src/api/health.ts

import type { Context } from "hono";

export function healthHandler(c: Context) {
  return c.json({ ok: true });
}
```

```typescript
// src/api/server.ts

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { IncomingMessage, ServerResponse } from "http";
import { healthHandler } from "./health.ts";
import type { GoogleCallbackDeps } from "./google-callback.ts";
import { makeGoogleCallbackHandler } from "./google-callback.ts";
import type { AppLogger } from "../app/logger.ts";

export type ApiServerConfig = {
  host: string;
  port: number;
};

export type ApiServer = {
  start(): void;
  stop(): Promise<void>;
};

export function createApiServer(
  config: ApiServerConfig,
  googleCallback: GoogleCallbackDeps,
  logger: AppLogger,
): ApiServer {
  const app = new Hono();

  app.get("/healthz", healthHandler);
  app.get("/oauth/google/callback", makeGoogleCallbackHandler(googleCallback));
  app.all("*", (c) => c.text("Not found", 404));

  let server: ReturnType<typeof serve> | null = null;

  return {
    start() {
      server = serve(
        { fetch: app.fetch, hostname: config.host, port: config.port },
        (info) => {
          logger.info(
            { subsystem: "api", event: "server_start", port: info.port },
            `API server listening on ${config.host}:${info.port}`
          );
        },
      );
    },
    async stop() {
      await new Promise<void>((resolve, reject) => {
        if (!server) return resolve();
        server.close((err) => (err ? reject(err) : resolve()));
      });
      logger.info({ subsystem: "api", event: "server_stop" }, "API server stopped");
    },
  };
}
```

**Exit criteria:** `GET /healthz` returns `{"ok":true}`. `GET /some/other/path` returns 404. Server stops cleanly when `stop()` is called.

---

### Task 3.9 — OAuth callback route handler (`src/api/google-callback.ts`)

**Goal:** Implement the Hono route handler for `GET /oauth/google/callback`. This is the join point: it receives the authorization code from Google, validates the CSRF state, exchanges the code, stores the token, and notifies Telegram.

**Key files:** `src/api/google-callback.ts`

```typescript
// src/api/google-callback.ts

import type { Context } from "hono";
import type { OAuthStateManager } from "../google/state.ts";
import type { GoogleOAuth } from "../google/oauth.ts";
import type { GoogleTokenStore } from "../google/token-store.ts";
import type { AppLogger } from "../app/logger.ts";
import type { Bot } from "grammy";
import { redactQueryParams } from "../security/redact.ts";

export type GoogleCallbackDeps = {
  stateManager: OAuthStateManager;
  oauth:        GoogleOAuth;
  tokenStore:   GoogleTokenStore;
  bot:          Bot;
  logger:       AppLogger;
};

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connected</title>
  <style>
    body { font-family: sans-serif; max-width: 480px; margin: 4rem auto; text-align: center; color: #333; }
    h1 { color: #2a9d8f; }
  </style>
</head>
<body>
  <h1>Google account connected</h1>
  <p>You can close this tab and return to Telegram.</p>
</body>
</html>`;

function errorHtml(reason: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorization Failed</title>
  <style>
    body { font-family: sans-serif; max-width: 480px; margin: 4rem auto; text-align: center; color: #333; }
    h1 { color: #e63946; }
    code { background: #f1f1f1; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Authorization failed</h1>
  <p>${reason}</p>
  <p>Return to Telegram and run <code>/google-connect</code> to try again.</p>
</body>
</html>`;
}

export function makeGoogleCallbackHandler(deps: GoogleCallbackDeps) {
  return async (c: Context) => {
    const { stateManager, oauth, tokenStore, bot, logger } = deps;

    // Log the incoming request URL with sensitive params redacted
    logger.info(
      { subsystem: "google", event: "oauth_callback", url: redactQueryParams(c.req.url) },
      "OAuth callback received"
    );

    // 1. Check if Google returned an error (user denied consent)
    const error = c.req.query("error");
    if (error) {
      logger.warn(
        { subsystem: "google", event: "oauth_denied", error },
        "User denied Google authorization"
      );
      return c.html(errorHtml("Authorization was denied."), 400);
    }

    // 2. Validate required parameters
    const code  = c.req.query("code");
    const state = c.req.query("state");

    if (!code || !state) {
      logger.warn({ subsystem: "google", event: "oauth_missing_params" }, "Missing code or state");
      return c.html(errorHtml("Missing required parameters."), 400);
    }

    // 3. Validate and consume CSRF state token
    //    This is the single-use check. If it returns null, the token is expired,
    //    unknown, or already consumed. In all cases, the user must restart.
    const stateData = stateManager.validateAndConsume(state);
    if (!stateData) {
      logger.warn(
        { subsystem: "google", event: "oauth_state_invalid" },
        "OAuth state invalid, expired, or already consumed"
      );
      return c.html(
        errorHtml("This authorization link has expired or has already been used."),
        400,
      );
    }

    // 4. Exchange authorization code for tokens
    let tokenSet;
    try {
      tokenSet = await oauth.exchangeCode(code);
    } catch (err) {
      logger.error(
        { subsystem: "google", event: "oauth_exchange_failed", err },
        "Token exchange failed"
      );
      return c.html(errorHtml("Failed to complete authorization. Please try again."), 500);
    }

    // 5. Best-effort: fetch the authorized email address for labeling
    let accountLabel: string | null = null;
    try {
      accountLabel = await oauth.fetchUserEmail(tokenSet.accessToken);
    } catch {
      // Non-fatal — the credential is still stored without a label
    }

    // 6. Persist the token set
    tokenStore.upsert(tokenSet, accountLabel);

    logger.info(
      { subsystem: "google", event: "oauth_complete", accountLabel: accountLabel ?? "unknown" },
      "Google OAuth completed and credentials stored"
    );

    // 7. Notify Telegram (fire-and-forget — failure must not fail the HTTP response)
    const label = accountLabel ? ` (${accountLabel})` : "";
    bot.api
      .sendMessage(
        stateData.telegramChatId,
        `✓ Google account${label} connected. Gmail and Calendar tools are now available.`,
      )
      .catch((notifyErr) => {
        logger.warn(
          { subsystem: "google", event: "telegram_notify_failed", err: notifyErr },
          "Failed to send Telegram confirmation after OAuth"
        );
      });

    // 8. Return success page to the browser
    return c.html(SUCCESS_HTML, 200);
  };
}
```

**Integration test outline (`tests/google-callback.test.ts`):**

```typescript
// tests/google-callback.test.ts
// Tests the callback handler in isolation by calling it directly with a mock context.
// Requires an in-memory DB, a real OAuthStateManager, and a mock GoogleOAuth + bot.

import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { OAuthStateManager } from "../src/google/state.ts";
import { makeGoogleCallbackHandler } from "../src/api/google-callback.ts";

// ... setup helpers ...

it("returns 200 HTML and stores token on valid flow", async () => {
  // arrange: insert a valid state, mock exchangeCode to return a TokenSet
  // act: call handler with ?code=x&state=<validState>
  // assert: response.status === 200, token stored in DB, Telegram bot.api.sendMessage called
});

it("returns 400 on expired state", async () => {
  // arrange: insert a state with past expires_at
  // act: call handler
  // assert: response.status === 400, HTML contains error text
});

it("returns 400 on already-consumed state", async () => {
  // arrange: generate and consume state, then attempt second use
  // assert: 400
});

it("returns 400 when ?error=access_denied", async () => {
  // arrange: no state needed
  // act: call handler with ?error=access_denied
  // assert: 400
});

it("returns 500 when exchangeCode throws", async () => {
  // arrange: valid state, mock exchangeCode to throw
  // assert: 500, state IS consumed (cannot be reused even on failure)
});
```

**Exit criteria:** All integration tests pass. The callback correctly handles all error paths without crashing the process.

---

### Task 3.10 — Gmail normalizer (`src/google/normalize-gmail.ts`)

**Goal:** Implement the pure normalization functions that convert raw Gmail API JSON into `CompactEmail` and `CompactEmailDetail`.

**Key files:** `src/google/normalize-gmail.ts`

Full implementation: see TDD §6.10. Key decisions:

- Parse `internalDate` (Unix ms string) to ISO 8601
- MIME tree traversal: depth-first, prefer `text/plain`, fall back to `text/html` with tag stripping
- Body decoded from base64url (`Buffer.from(encoded.replace(/-/g,"+").replace(/_/g,"/"), "base64").toString("utf-8")`)
- Excerpt capped at 2000 characters
- Snippet capped at 300 characters
- Returns `null` (not throws) if the raw object is malformed

**Unit tests to write (`src/google/normalize-gmail.test.ts`):**

```typescript
it("extracts From, Subject, and receivedAt from headers");
it("prefers text/plain part over text/html");
it("falls back to stripped HTML when no plain text exists");
it("caps excerpt at 2000 chars");
it("caps snippet at 300 chars");
it("returns null on malformed input without throwing");
it("handles multipart/mixed with nested multipart/alternative");
```

**Exit criteria:** All normalizer unit tests pass. No test should require network access.

---

### Task 3.11 — Gmail API client (`src/google/gmail.ts`)

**Goal:** Implement `GmailClient` with `listRecent()` and `getMessage()`. All Google API calls go through `tokenStore.getAccessToken()` which handles refresh transparently.

**Key files:** `src/google/gmail.ts`

Full implementation: see TDD §6.9. Key implementation notes:

- `listRecent()` first calls `GET /gmail/v1/users/me/messages?q=...&maxResults=N` to get message IDs
- Then fetches each message's metadata (headers only, `format=metadata`) in parallel with `Promise.all`
- `getMessage()` fetches `format=full` and delegates body extraction to the normalizer
- `maxResults` is clamped to 50 to avoid runaway API usage
- Per-message header fetch requests include only the headers we care about: `From`, `Subject`, `Date`

**Exit criteria:** With mocked `fetch`, `listRecent()` returns a `CompactEmail[]` and `getMessage()` returns a `CompactEmailDetail | null`. Verify the `Authorization: Bearer {token}` header is included on all requests.

---

### Task 3.12 — Calendar normalizer (`src/google/normalize-calendar.ts`)

**Goal:** Implement the normalizer for raw Google Calendar event objects.

**Key files:** `src/google/normalize-calendar.ts`

Full implementation: see TDD §6.12. Key decisions:

- Calendar events have either `start.dateTime` (timed event, ISO 8601 with timezone) or `start.date` (all-day event, `YYYY-MM-DD`)
- Both should be preserved as-is — no timezone conversion in the normalizer; the tool layer handles user-facing formatting if needed
- Description capped at 500 characters after HTML tag stripping
- Returns `null` on malformed input

**Unit tests:**

```typescript
it("handles timed events with dateTime");
it("handles all-day events with date only");
it("caps descriptionExcerpt at 500 chars");
it("strips HTML from description");
it("returns null on malformed input without throwing");
```

---

### Task 3.13 — Calendar API client (`src/google/calendar.ts`)

**Goal:** Implement `CalendarClient` with `listWindow()` supporting multiple calendar IDs.

**Key files:** `src/google/calendar.ts`

Full implementation: see TDD §6.11. Key implementation notes:

- Fetches all requested `calendarIds` in parallel; uses `["primary"]` if none specified
- Merges results from all calendars, sorts by start time, caps total at `maxResults`
- A failure for one calendar (e.g., calendar not found) returns an empty list for that calendar rather than throwing — other calendars still succeed
- Always requests `singleEvents=true` and `orderBy=startTime` to handle recurring events correctly

**Exit criteria:** With mocked `fetch`, `listWindow()` merges and sorts events from multiple calendars. A failing calendar does not prevent results from others.

---

### Task 3.14 — Agent tools (Gmail + Calendar)

**Goal:** Implement the four agent tools and wire them into the tool registry.

**Key files:**
- `src/tools/gmail-list-recent.ts`
- `src/tools/gmail-get-message.ts`
- `src/tools/calendar-list-today.ts`
- `src/tools/calendar-list-tomorrow.ts`

#### `gmail_list_recent`

Full implementation: see TDD §6.13. The tool formats its output as a compact text block:

```
[<id>] <receivedAt> | From: <from> | Subject: <subject>
  <snippet>
```

One email per paragraph block, separated by blank lines.

#### `gmail_get_message`

Returns:
```
From: ...
Subject: ...
Date: ...

<excerpt or "(No readable body)">
```

#### `calendar_list_today` and `calendar_list_tomorrow`

```typescript
// Helper — compute start/end of a day in the configured timezone
function dayWindow(offsetDays: number, timezone: string): { startIso: string; endIso: string } {
  const now = new Date();
  const targetDate = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  const dateStr = targetDate.toLocaleDateString("en-CA", { timeZone: timezone }); // "YYYY-MM-DD"
  const start = new Date(`${dateStr}T00:00:00`);
  const end   = new Date(`${dateStr}T23:59:59`);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
```

`calendar_list_today` uses `offsetDays = 0`, `calendar_list_tomorrow` uses `offsetDays = 1`.

Output format — one event per line:
```
<start>[ – <end>] | <title>[ @ <location>]
```

**Exit criteria:** Each tool returns a non-empty string with at least one recognizable field from the test fixture. Tool descriptions are concise enough that four tools together add fewer than 200 tokens to the context.

---

### Task 3.15 — Conditional tool registration in tool registry

**Goal:** Register Gmail and Calendar tools in the tool registry only when Google credentials are configured and present.

**Key files:** `src/agent/tool-registry.ts`

```typescript
// In the tool registry setup (called from bootstrap.ts)

export function buildToolRegistry(
  config: AppConfig,
  tokenStore: GoogleTokenStore,
  gmail:    GmailClient,
  calendar: CalendarClient,
  timezone: string,
  // ... other tool deps
): ToolRegistry {
  const registry = new ToolRegistry();

  // Always-registered tools
  registry.register(makeListFilesTool(config.workspace.root));
  registry.register(makeReadFileTool(config.workspace.root));
  registry.register(makeWriteFileTool(config.workspace.root));
  registry.register(makeApplyPatchTool(config.workspace.root));
  if (config.tools.exec.enabled) {
    registry.register(makeExecTool(config.tools.exec));
  }

  // Google tools — registered only when Google is enabled and credentials exist
  if (config.google.enabled && tokenStore.hasCredential()) {
    registry.register(makeGmailListRecentTool(gmail));
    registry.register(makeGmailGetMessageTool(gmail));
    registry.register(makeCalendarListTodayTool(calendar, timezone));
    registry.register(makeCalendarListTomorrowTool(calendar, timezone));
  }

  return registry;
}
```

**Design note:** The check `tokenStore.hasCredential()` is evaluated at startup. If the user runs `/google-connect` while the service is running, the new tools will not be available until the next agent turn that rebuilds the registry, OR the registry is made to re-evaluate on each turn. For v1, the simpler approach is to rebuild the tool registry reference on each agent turn (it is cheap — just reads one DB row). The agent runtime calls `buildToolRegistry()` each time it constructs a prompt.

**Exit criteria:** `gmail_list_recent` appears in tool schemas when credentials are present. It does not appear when `tokenStore.hasCredential()` returns false.

---

### Task 3.16 — Telegram `/google-connect` command

**Goal:** Handle the `/google-connect` Telegram command by generating a state token and sending the authorization URL.

**Key files:** `src/telegram/handler.ts`

```typescript
// In the Telegram command router

bot.command("google-connect", async (ctx) => {
  if (!isAllowedUser(ctx)) return;

  if (!config.google.enabled) {
    await ctx.reply("Google integration is not configured.");
    return;
  }

  const chatId  = String(ctx.chat.id);
  const userId  = String(ctx.from?.id ?? "unknown");

  const state   = stateManager.generate(chatId, userId);
  const authUrl = googleOAuth.buildAuthUrl(state);

  await ctx.reply(
    `To connect your Google account, open this link on a device on your local network:\n\n${authUrl}\n\nThis link expires in 10 minutes.`,
    { parse_mode: undefined }, // plain text — URL must not be markdown-formatted
  );
});
```

**Exit criteria:** Sending `/google-connect` results in a Telegram message containing a valid `accounts.google.com` authorization URL with all required parameters. A new `oauth_states` row is created in the DB.

---

### Task 3.17 — Wire everything in bootstrap

**Goal:** Instantiate and connect all Google subsystem dependencies in the application bootstrap.

**Key files:** `src/app/bootstrap.ts`

The additions to the bootstrap sequence (after DB and config are initialized):

```typescript
// 1. Build OAuth config
const oauthConfig: OAuthConfig = {
  clientId:     config.google.clientId,
  clientSecret: config.google.clientSecret,
  redirectUri:  `${config.google.redirectBaseUrl}/oauth/google/callback`,
  scopes:       buildScopes(config.google.scopes),
};

// 2. Instantiate Google subsystem
const googleOAuth    = new GoogleOAuth(oauthConfig);
const stateManager   = new OAuthStateManager(db);
const tokenStore     = new GoogleTokenStore(db, googleOAuth, logger);
const gmailClient    = new GmailClient(tokenStore);
const calendarClient = new CalendarClient(tokenStore);

// 3. Purge expired OAuth states on startup
stateManager.purgeExpired();

// 4. Create API server
const apiServer = createApiServer(
  { host: config.auth.callbackHost, port: config.auth.callbackPort },
  { stateManager, oauth: googleOAuth, tokenStore, bot, logger },
  logger,
);

// 5. Start server (before Telegram polling)
apiServer.start();

// 6. Register shutdown hook
registerShutdownHook(async () => {
  await apiServer.stop();
});
```

**Exit criteria:** `node dist/index.js` starts cleanly, logs `API server listening`, and `GET /healthz` returns `{"ok":true}`. `/google-connect` in Telegram sends an authorization URL.

---

## Key Design Decisions

### OAuth Credential Type: Web Application (not Desktop/Installed)

The gogcli CLI uses **Desktop/Installed** credentials which allow `http://localhost` redirect URIs with any port. This works because the CLI process and the browser run on the same machine.

tdmClaw uses **Web Application** credentials because the redirect URI is a LAN-hosted server, not `localhost`. Web Application credentials support HTTPS redirect URIs on any hostname. The tradeoff is that the redirect URI must be registered exactly in the Google Cloud Console — there is no wildcard port flexibility.

**How to apply:** When setting up Google Cloud credentials, select "Web Application" and register `https://{your-pi-hostname}/oauth/google/callback` as an Authorized Redirect URI.

### No Ephemeral Local Server

gogcli binds `127.0.0.1:0`, reads the OS-assigned port, and uses that as the redirect URI. The whole server exists only for the duration of the OAuth flow.

tdmClaw's server is **persistent** — it runs for the lifetime of the process and handles callbacks whenever they arrive. The tradeoff is that the redirect URI is fixed (not dynamic), but the server is already running and does not need to be started on demand.

### State Storage: SQLite, Not Memory

OAuth state in gogcli is held in memory (in a Go channel or map). This is fine for a CLI tool where the process exists only for the duration of one flow.

tdmClaw stores state in the `oauth_states` SQLite table. This means:
- State survives a process restart between the time the user opens the link and the time they complete authorization (unlikely but possible).
- State can be inspected and cleaned up without killing the process.
- No in-memory state that can cause issues if the process restarts mid-flow.

### Single-Account v1

The `credentials` table uses `provider TEXT PRIMARY KEY`, which means there can only be one set of Google credentials at a time. Running `/google-connect` twice will overwrite the first credential. Multi-account support would require changing the primary key to `(provider, account_label)` and adding account selection logic to the tools.

### On-Demand Token Refresh

Tokens are not proactively refreshed on a background timer. Instead, `getAccessToken()` checks the expiry on every call and refreshes if needed. The 5-minute buffer ensures that an expiring token is refreshed before it actually expires, eliminating the race condition where the token is checked, valid, but expires before the API call arrives at Google.

### `prompt=consent` Always Set

This forces Google to always issue a new `refresh_token` during the authorization flow, even if one was previously issued for the same client/user pair. Without this, if the user previously connected Google and the token was deleted from the DB, a new authorization would return an access token but no refresh token — making the credential unusable after the access token expires (~1 hour). Including `prompt=consent` costs one extra user interaction (they must explicitly approve on every connect) but eliminates this class of bug.

---

## Acceptance Criteria for Phase 3

Phase 3 is complete when all of the following are true:

1. Running the app creates `oauth_states` and `credentials` tables without errors.
2. Sending `/google-connect` in Telegram produces an authorization URL with `access_type=offline`, `prompt=consent`, and a valid `state` parameter.
3. Opening the URL in a LAN browser completes the consent screen and redirects to the Pi's callback URL.
4. The callback route validates the state, exchanges the code, and stores credentials in the `credentials` table.
5. Telegram receives a confirmation message after the flow completes.
6. After connecting, the agent has access to `gmail_list_recent`, `gmail_get_message`, `calendar_list_today`, and `calendar_list_tomorrow` tools.
7. `gmail_list_recent` returns at least one email when the connected account has received mail in the past 24 hours.
8. Tokens are never logged in plain text.
9. An expired or already-used state returns a user-friendly HTML error page, not a crash.
10. All unit and integration tests for Phase 3 pass.
