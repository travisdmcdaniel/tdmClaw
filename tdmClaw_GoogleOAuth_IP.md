# tdmClaw — Google OAuth Implementation Plan

## Document Metadata

- Project: tdmClaw
- Document Type: Implementation Plan — Google OAuth Subsystem
- Version: 0.2
- Status: Active
- Related Documents: `tdmClaw_TDD.md`, `tdmClaw_IP.md`, `tdmClaw_GoogleOAuth_TDD.md`

---

## Overview

This plan covers the implementation of Phase 3 from `tdmClaw_IP.md`: Google OAuth using the **loopback manual flow** (same approach as gogcli's `--manual` mode). No HTTP server is used for OAuth. The user uploads `client_secret.json` via Telegram, runs `/google-connect`, opens the auth URL in any browser, and pastes the failed redirect URL back with `/google-complete`.

Tasks are sequenced so each can be implemented and tested before the next.

```
DB migration → client upload → state/URI → OAuth core → parser → token store
    → Telegram commands → Gmail/Calendar clients → tools → tool registry
```

---

## Prerequisites

From Phases 1 and 2:

- `src/app/bootstrap.ts` wires dependencies
- `src/storage/db.ts` provides a `better-sqlite3` `Database`
- `src/storage/migrations.ts` migration runner
- `src/app/logger.ts` exports `AppLogger` (pino)
- `src/app/config.ts` exports `AppConfig` (see §Config Changes below)
- Telegram bot available (`grammy`)
- Owner guard: `isOwner(ctx: Context): boolean`

---

## Config Changes (before starting)

The previous design had `google.clientId`, `google.clientSecret`, `google.redirectBaseUrl`, and `auth.callbackHost/Port` in config. **Remove those.** The client credentials now come from the user's uploaded `client_secret.json` and are stored in SQLite. The only Google-related config fields remaining are feature flags for which scopes to request.

```ts
// src/app/config.ts — reduced Google block
google: {
  enabled:   boolean;          // master on/off
  scopes: {
    gmailRead:    boolean;
    calendarRead: boolean;
  };
};
```

---

## Phase 3 Tasks

---

### Task 3.1 — DB migration

**Goal:** Add `google_client`, `oauth_states`, and `credentials` tables.

**Key files:** `src/storage/migrations.ts`

```typescript
{
  version: 3,
  name: "google_oauth_manual_flow",
  up(db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS google_client (
        id            INTEGER PRIMARY KEY CHECK (id = 1),
        client_id     TEXT NOT NULL,
        client_secret TEXT NOT NULL,
        project_id    TEXT,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_states (
        state            TEXT PRIMARY KEY,
        provider         TEXT NOT NULL,
        telegram_chat_id TEXT NOT NULL,
        telegram_user_id TEXT NOT NULL,
        redirect_uri     TEXT NOT NULL,
        hint_email       TEXT,
        created_at       TEXT NOT NULL,
        expires_at       TEXT NOT NULL,
        consumed_at      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states (expires_at);
      CREATE INDEX IF NOT EXISTS idx_oauth_states_chat       ON oauth_states (telegram_chat_id);

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

**Exit criteria:** `sqlite3 data/tdmclaw.db ".schema"` shows all three tables. Re-running startup does not re-apply this migration.

---

### Task 3.2 — Scope constants

**Goal:** Named scope constants with a builder.

**Key files:** `src/google/scopes.ts`

```typescript
export const SCOPES = {
  openid:           "openid",
  email:            "email",
  userinfoEmail:    "https://www.googleapis.com/auth/userinfo.email",
  gmailReadonly:    "https://www.googleapis.com/auth/gmail.readonly",
  calendarReadonly: "https://www.googleapis.com/auth/calendar.readonly",
} as const;

export type ScopeConfig = { gmailRead: boolean; calendarRead: boolean };

export function buildScopes(cfg: ScopeConfig): string[] {
  const s = [SCOPES.openid, SCOPES.email, SCOPES.userinfoEmail];
  if (cfg.gmailRead)    s.push(SCOPES.gmailReadonly);
  if (cfg.calendarRead) s.push(SCOPES.calendarReadonly);
  return s;
}
```

**Exit criteria:** `buildScopes({ gmailRead: true, calendarRead: false })` returns 4 items. `buildScopes({ gmailRead: false, calendarRead: false })` returns 3.

---

### Task 3.3 — Shared types

**Goal:** Type declarations for the subsystem.

**Key files:** `src/google/types.ts`

```typescript
export type GoogleClientCredentials = {
  clientId:     string;
  clientSecret: string;
  projectId?:   string;
};

export type TokenSet = {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number;
  scopes:       string[];
};

export type ParsedRedirect = {
  code:        string;
  state:       string;
  redirectUri: string;
};

export type CompactEmail = {
  id: string; threadId: string; from: string; subject: string;
  receivedAt: string; snippet: string; labels?: string[];
};
export type CompactEmailDetail = CompactEmail & { excerpt: string };

export type CompactCalendarEvent = {
  id: string; title: string; start: string; end?: string;
  location?: string; descriptionExcerpt?: string; calendarId?: string;
};
```

**Exit criteria:** `tsc --noEmit` passes.

---

### Task 3.4 — client_secret.json parser

**Goal:** Parse and validate an uploaded `client_secret.json`.

**Key files:** `src/google/parse-client-secret.ts`

```typescript
import type { GoogleClientCredentials } from "./types.ts";

export class InvalidClientSecretError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidClientSecretError"; }
}

export function parseClientSecret(buf: Buffer): GoogleClientCredentials {
  let json: any;
  try { json = JSON.parse(buf.toString("utf-8")); }
  catch { throw new InvalidClientSecretError("File is not valid JSON."); }

  const block = json.installed;
  if (!block) {
    if (json.web) {
      throw new InvalidClientSecretError(
        "This is a Web application credential. tdmClaw requires a Desktop credential. " +
        'In Google Cloud Console, create a new OAuth Client ID of type "Desktop app" ' +
        "and upload that JSON instead."
      );
    }
    throw new InvalidClientSecretError(
      'Missing "installed" key. This does not look like a Desktop credential file.'
    );
  }

  const clientId     = typeof block.client_id     === "string" ? block.client_id.trim()     : "";
  const clientSecret = typeof block.client_secret === "string" ? block.client_secret.trim() : "";
  if (!clientId || !clientSecret) {
    throw new InvalidClientSecretError("Missing client_id or client_secret in installed credential.");
  }

  return {
    clientId, clientSecret,
    projectId: typeof block.project_id === "string" ? block.project_id : undefined,
  };
}
```

**Unit tests (`parse-client-secret.test.ts`):**

```typescript
import { describe, it, expect } from "vitest";
import { parseClientSecret, InvalidClientSecretError } from "./parse-client-secret.ts";

const desktopOk = Buffer.from(JSON.stringify({
  installed: {
    client_id: "abc.apps.googleusercontent.com",
    client_secret: "GOCSPX-xxx",
    project_id: "my-project",
  },
}));

describe("parseClientSecret", () => {
  it("parses a valid Desktop credential", () => {
    const creds = parseClientSecret(desktopOk);
    expect(creds.clientId).toBe("abc.apps.googleusercontent.com");
    expect(creds.clientSecret).toBe("GOCSPX-xxx");
    expect(creds.projectId).toBe("my-project");
  });

  it("rejects non-JSON", () => {
    expect(() => parseClientSecret(Buffer.from("not json")))
      .toThrow(InvalidClientSecretError);
  });

  it("rejects Web credential with helpful message", () => {
    const web = Buffer.from(JSON.stringify({ web: { client_id: "x", client_secret: "y" } }));
    expect(() => parseClientSecret(web)).toThrow(/Desktop/);
  });

  it("rejects missing client_id", () => {
    const bad = Buffer.from(JSON.stringify({ installed: { client_secret: "x" } }));
    expect(() => parseClientSecret(bad)).toThrow(/client_id/);
  });

  it("rejects missing client_secret", () => {
    const bad = Buffer.from(JSON.stringify({ installed: { client_id: "x" } }));
    expect(() => parseClientSecret(bad)).toThrow(/client_secret/);
  });
});
```

**Exit criteria:** All five tests pass.

---

### Task 3.5 — Client credentials store

**Goal:** Persist and retrieve the user's uploaded client credentials.

**Key files:** `src/google/client-store.ts`

```typescript
import type { Database } from "better-sqlite3";
import type { GoogleClientCredentials } from "./types.ts";

export class GoogleClientStore {
  constructor(private readonly db: Database) {}

  upsert(creds: GoogleClientCredentials): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO google_client (id, client_id, client_secret, project_id, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        client_id     = excluded.client_id,
        client_secret = excluded.client_secret,
        project_id    = excluded.project_id,
        updated_at    = excluded.updated_at
    `).run(creds.clientId, creds.clientSecret, creds.projectId ?? null, now);
  }

  read(): GoogleClientCredentials | null {
    const row = this.db.prepare(
      `SELECT client_id, client_secret, project_id FROM google_client WHERE id = 1`
    ).get() as { client_id: string; client_secret: string; project_id: string | null } | undefined;
    if (!row) return null;
    return {
      clientId:     row.client_id,
      clientSecret: row.client_secret,
      projectId:    row.project_id ?? undefined,
    };
  }

  delete(): void { this.db.prepare(`DELETE FROM google_client WHERE id = 1`).run(); }
  has(): boolean { return this.read() !== null; }
}
```

**Unit tests:** upsert-then-read round-trips; second upsert overwrites; delete removes; has() reflects state.

**Exit criteria:** All round-trip tests pass.

---

### Task 3.6 — Redirect URI generator

**Goal:** Produce an ephemeral loopback redirect URI.

**Key files:** `src/google/redirect-uri.ts`

```typescript
import * as crypto from "crypto";

const CALLBACK_PATH = "/oauth2/callback";

/**
 * Generate an ephemeral loopback redirect URI in the dynamic port range.
 * Nothing listens on this port; the URI exists only to format the auth URL
 * and to produce a predictable "connection refused" in the user's browser
 * so the code and state remain visible in the address bar.
 */
export function makeRedirectUri(): string {
  const port = 49152 + crypto.randomInt(0, 65535 - 49152 + 1);
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}
```

**Unit tests:** URI is parseable; port is in dynamic range (49152–65535); repeated calls produce different ports.

**Exit criteria:** All tests pass.

---

### Task 3.7 — Redirect URL parser

**Goal:** Parse a pasted URL to extract `code`, `state`, and base `redirectUri`.

**Key files:** `src/google/parse-redirect.ts`

```typescript
import type { ParsedRedirect } from "./types.ts";

export class InvalidRedirectError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidRedirectError"; }
}

export function parseRedirectUrl(raw: string): ParsedRedirect {
  const trimmed = raw.trim();
  let parsed: URL;
  try { parsed = new URL(trimmed); }
  catch { throw new InvalidRedirectError("Not a valid URL."); }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidRedirectError("URL must start with http:// or https://");
  }

  const oauthError = parsed.searchParams.get("error");
  if (oauthError) {
    throw new InvalidRedirectError(`Google returned error: ${oauthError}`);
  }

  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new InvalidRedirectError(
      "URL does not contain a `code` parameter. Make sure you copied the full URL " +
      "from your browser's address bar AFTER Google redirected you."
    );
  }

  const state = parsed.searchParams.get("state") ?? "";
  // Reconstruct base URI: scheme + host (includes port) + path, no query, no fragment
  const redirectUri = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;

  return { code, state, redirectUri };
}
```

**Unit tests (`parse-redirect.test.ts`):**

```typescript
import { describe, it, expect } from "vitest";
import { parseRedirectUrl, InvalidRedirectError } from "./parse-redirect.ts";

describe("parseRedirectUrl", () => {
  it("parses a valid loopback redirect", () => {
    const r = parseRedirectUrl("http://127.0.0.1:54321/oauth2/callback?code=4/abc&state=xyz");
    expect(r.code).toBe("4/abc");
    expect(r.state).toBe("xyz");
    expect(r.redirectUri).toBe("http://127.0.0.1:54321/oauth2/callback");
  });

  it("preserves non-default port in base URI", () => {
    const r = parseRedirectUrl("http://127.0.0.1:12345/x?code=c&state=s");
    expect(r.redirectUri).toBe("http://127.0.0.1:12345/x");
  });

  it("throws on missing code", () => {
    expect(() => parseRedirectUrl("http://127.0.0.1:1/?state=s"))
      .toThrow(InvalidRedirectError);
  });

  it("throws on ?error=access_denied", () => {
    expect(() => parseRedirectUrl("http://127.0.0.1:1/?error=access_denied"))
      .toThrow(/access_denied/);
  });

  it("throws on non-http URL", () => {
    expect(() => parseRedirectUrl("ftp://host/?code=c"))
      .toThrow(/http/);
  });

  it("throws on garbage input", () => {
    expect(() => parseRedirectUrl("not a url")).toThrow(InvalidRedirectError);
  });

  it("returns empty string state when absent (caller decides to accept)", () => {
    const r = parseRedirectUrl("http://127.0.0.1:1/?code=c");
    expect(r.state).toBe("");
  });
});
```

**Exit criteria:** All seven tests pass.

---

### Task 3.8 — OAuth state manager

**Goal:** Generate, validate-and-consume, find-pending, and purge-expired for OAuth state tokens.

**Key files:** `src/google/state.ts`

```typescript
import * as crypto from "crypto";
import type { Database } from "better-sqlite3";

export const STATE_TTL_MINUTES = 10;

export type ConsumedState = {
  telegramChatId: string;
  telegramUserId: string;
  redirectUri:    string;
  hintEmail:      string | null;
};

export class OAuthStateManager {
  constructor(private readonly db: Database) {}

  generate(chatId: string, userId: string, redirectUri: string, hintEmail: string | null = null): string {
    const state     = crypto.randomBytes(32).toString("base64url");
    const now       = new Date();
    const expiresAt = new Date(now.getTime() + STATE_TTL_MINUTES * 60_000);
    this.db.prepare(`
      INSERT INTO oauth_states
        (state, provider, telegram_chat_id, telegram_user_id, redirect_uri,
         hint_email, created_at, expires_at, consumed_at)
      VALUES (?, 'google', ?, ?, ?, ?, ?, ?, NULL)
    `).run(state, chatId, userId, redirectUri, hintEmail,
           now.toISOString(), expiresAt.toISOString());
    return state;
  }

  validateAndConsume(state: string): ConsumedState | null {
    const now = new Date().toISOString();
    const r = this.db.prepare(`
      UPDATE oauth_states SET consumed_at = ?
      WHERE state = ? AND expires_at > ? AND consumed_at IS NULL
    `).run(now, state, now);
    if (r.changes === 0) return null;
    const row = this.db.prepare(`
      SELECT telegram_chat_id, telegram_user_id, redirect_uri, hint_email
      FROM oauth_states WHERE state = ?
    `).get(state) as {
      telegram_chat_id: string; telegram_user_id: string; redirect_uri: string;
      hint_email: string | null;
    } | undefined;
    if (!row) return null;
    return {
      telegramChatId: row.telegram_chat_id,
      telegramUserId: row.telegram_user_id,
      redirectUri:    row.redirect_uri,
      hintEmail:      row.hint_email,
    };
  }

  findPendingForChat(chatId: string): { state: string; redirectUri: string } | null {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      SELECT state, redirect_uri FROM oauth_states
      WHERE telegram_chat_id = ? AND provider = 'google'
        AND expires_at > ? AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(chatId, now) as { state: string; redirect_uri: string } | undefined;
    if (!row) return null;
    return { state: row.state, redirectUri: row.redirect_uri };
  }

  purgeExpired(): number {
    const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
    return this.db.prepare(
      `DELETE FROM oauth_states WHERE expires_at < ?`
    ).run(cutoff).changes;
  }
}
```

**Unit tests (`state.test.ts`):** use `:memory:` SQLite.

```typescript
it("generates a 43-char base64url state");
it("stores redirect_uri and hint_email with the state");
it("validateAndConsume returns redirectUri and hintEmail alongside chat/user");
it("second consume returns null");
it("consume returns null for unknown state");
it("consume returns null for expired state");
it("findPendingForChat returns most-recent unused state");
it("findPendingForChat returns null when no pending");
it("purgeExpired removes records older than 1 hour");
```

**Exit criteria:** All tests pass. The atomic consume (single winner under concurrent attempts) is the critical property.

---

### Task 3.9 — OAuth core

**Goal:** Build auth URL, exchange code, refresh tokens, fetch user email.

**Key files:** `src/google/oauth.ts`

Full code: see TDD §6.8. The class exposes four methods:

- `buildAuthUrl(params)` — returns URL string
- `exchangeCode(creds, code, redirectUri)` — returns `TokenSet`; throws on non-2xx or missing `refresh_token`
- `refreshAccessToken(creds, refreshToken)` — returns new `TokenSet`
- `fetchUserEmail(accessToken)` — returns email string or null (best-effort)

**Unit tests (`oauth.test.ts`):**

```typescript
describe("GoogleOAuth.buildAuthUrl", () => {
  it("includes response_type, client_id, redirect_uri, scope, state, access_type=offline, prompt=consent");
  it("joins scopes with spaces");
  it("includes login_hint when loginHint is provided");
  it("omits login_hint when loginHint is absent");
});

describe("GoogleOAuth.exchangeCode", () => {
  it("returns a TokenSet on success (mock fetch)");
  it("throws if refresh_token is missing");
  it("throws on non-2xx response");
  it("sends redirect_uri in the form body");
});

describe("GoogleOAuth.refreshAccessToken", () => {
  it("returns a fresh TokenSet");
  it("preserves the original refresh token if Google does not rotate");
  it("uses a new refresh token if Google rotates");
});

describe("GoogleOAuth.fetchUserEmail", () => {
  it("returns email on 200");
  it("returns null on non-2xx");
  it("returns null on network error");
});
```

**Exit criteria:** All tests pass.

---

### Task 3.10 — Token store

**Goal:** Persist tokens and refresh on-demand.

**Key files:** `src/google/token-store.ts`

Full code: see TDD §6.9. Takes `GoogleClientStore` as a constructor dep (not a static config) so it can pull the current user-uploaded client credentials when refreshing.

**Unit tests (`token-store.test.ts`):**

```typescript
it("hasCredential returns false initially");
it("upsert then hasCredential returns true");
it("getAccessToken returns stored token when fresh");
it("getAccessToken refreshes when within 5-min buffer");
it("refreshed token is persisted");
it("throws when no credential is stored");
it("throws when refresh is needed but client credentials are missing");
it("delete clears the credential");
it("accountLabel returns stored email");
```

**Exit criteria:** All tests pass.

---

### Task 3.11 — Token redaction

**Goal:** Strip tokens, bearer headers, auth codes, and URL params from log strings.

**Key files:** `src/security/redact.ts`

Full code: see TDD §6.14.

**Unit tests:**

```typescript
it("redacts ya29. access tokens");
it("redacts 1// refresh tokens");
it("redacts Bearer headers");
it("redacts 4/ auth codes");
it("redacts sensitive query params");
```

**Exit criteria:** All tests pass.

---

### Task 3.12 — Telegram commands: /google-setup

**Goal:** Accept uploaded `client_secret.json`, parse, store.

**Key files:** `src/telegram/commands/google.ts`

```typescript
import type { Bot, Context } from "grammy";
import { parseClientSecret, InvalidClientSecretError } from "../../google/parse-client-secret.ts";
import type { GoogleClientStore } from "../../google/client-store.ts";
import type { AppLogger } from "../../app/logger.ts";

const MAX_UPLOAD_BYTES = 64 * 1024;

export function registerGoogleSetup(deps: {
  bot:         Bot;
  clientStore: GoogleClientStore;
  isOwner:     (ctx: Context) => boolean;
  logger:      AppLogger;
}) {
  const { bot, clientStore, isOwner, logger } = deps;

  bot.command("google-setup", async (ctx) => {
    if (!isOwner(ctx)) return;

    const doc = ctx.message?.document;
    if (!doc) {
      await ctx.reply(
        "Please attach your client_secret.json file.\n\n" +
        "To get this file: Google Cloud Console → APIs & Services → Credentials → " +
        "your Desktop OAuth Client ID → Download JSON."
      );
      return;
    }

    if (doc.file_size && doc.file_size > MAX_UPLOAD_BYTES) {
      await ctx.reply("That file is too large to be a client_secret.json. Aborting.");
      return;
    }

    let buf: Buffer;
    try {
      const file    = await ctx.api.getFile(doc.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
      const resp    = await fetch(fileUrl);
      if (!resp.ok) throw new Error(`download ${resp.status}`);
      buf = Buffer.from(await resp.arrayBuffer());
    } catch (err) {
      logger.error({ subsystem: "google", event: "file_download_failed", err }, "Download failed");
      await ctx.reply("Could not download the attached file.");
      return;
    }

    try {
      const creds = parseClientSecret(buf);
      clientStore.upsert(creds);
      await ctx.reply(
        `✓ Saved Google client credentials${creds.projectId ? ` (project: ${creds.projectId})` : ""}.\n\n` +
        "Now run /google-connect to authorize your Google account."
      );
      logger.info({ subsystem: "google", event: "client_setup" }, "Client credentials uploaded");
    } catch (err) {
      if (err instanceof InvalidClientSecretError) {
        await ctx.reply(`✗ ${err.message}`);
      } else {
        logger.error({ subsystem: "google", event: "setup_failed", err }, "Setup failed");
        await ctx.reply("Unexpected error parsing the file.");
      }
    }
  });
}
```

**Exit criteria:** Uploading a valid Desktop `client_secret.json` produces a "Saved" reply and populates `google_client`. Uploading a Web credential produces a helpful rejection. No attachment produces usage instructions.

---

### Task 3.13 — Telegram commands: /google-connect

**Goal:** Accept the user's Google email address, generate state, build auth URL with `login_hint`, send to user.

**Usage:** `/google-connect your@gmail.com`

**Key files:** `src/telegram/commands/google.ts`

```typescript
import { makeRedirectUri } from "../../google/redirect-uri.ts";
import { buildScopes, ScopeConfig } from "../../google/scopes.ts";
import type { GoogleOAuth } from "../../google/oauth.ts";
import type { OAuthStateManager } from "../../google/state.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerGoogleConnect(deps: {
  bot:         Bot;
  clientStore: GoogleClientStore;
  stateMgr:    OAuthStateManager;
  oauth:       GoogleOAuth;
  scopeConfig: ScopeConfig;
  isOwner:     (ctx: Context) => boolean;
}) {
  const { bot, clientStore, stateMgr, oauth, scopeConfig, isOwner } = deps;

  bot.command("google-connect", async (ctx) => {
    if (!isOwner(ctx)) return;

    const hintEmail = (ctx.match as string | undefined)?.trim() ?? "";
    if (!hintEmail || !EMAIL_RE.test(hintEmail)) {
      await ctx.reply(
        "Usage: /google-connect your@gmail.com\n\n" +
        "Provide the email address of the Google account you want to connect."
      );
      return;
    }

    const creds = clientStore.read();
    if (!creds) {
      await ctx.reply(
        "No Google client credentials. Run /google-setup first with " +
        "your client_secret.json attached."
      );
      return;
    }

    const chatId      = String(ctx.chat!.id);
    const userId      = String(ctx.from!.id);
    const redirectUri = makeRedirectUri();
    const state       = stateMgr.generate(chatId, userId, redirectUri, hintEmail);
    const authUrl     = oauth.buildAuthUrl({
      clientId: creds.clientId,
      redirectUri,
      scopes: buildScopes(scopeConfig),
      state,
      loginHint: hintEmail,
    });

    await ctx.reply(
      `Connecting Google account: ${hintEmail}\n\n` +
      "1. Open the URL below in any browser.\n" +
      "2. Approve the Google consent screen.\n" +
      "3. Your browser will fail to load a page at 127.0.0.1 — this is expected.\n" +
      "4. Copy the full URL from your browser's address bar.\n" +
      "5. Send it back with: `/google-complete <paste URL>`\n\n" +
      "Link expires in 10 minutes.",
      { parse_mode: "Markdown" },
    );
    await ctx.reply(authUrl);
  });
}
```

**Exit criteria:** Running `/google-connect` without an email produces usage instructions. Running `/google-connect user@example.com` produces (a) a confirmation line with the email, (b) a valid Google auth URL with `client_id`, `redirect_uri`, `state`, `scope`, `access_type=offline`, `prompt=consent`, `login_hint`, and (c) a new row in `oauth_states` with `hint_email` populated.

---

### Task 3.14 — Telegram commands: /google-complete

**Goal:** Accept pasted URL, validate state, exchange code, store tokens.

**Key files:** `src/telegram/commands/google.ts`

```typescript
import { parseRedirectUrl, InvalidRedirectError } from "../../google/parse-redirect.ts";
import type { GoogleTokenStore } from "../../google/token-store.ts";

export function registerGoogleComplete(deps: {
  bot:         Bot;
  clientStore: GoogleClientStore;
  stateMgr:    OAuthStateManager;
  oauth:       GoogleOAuth;
  tokenStore:  GoogleTokenStore;
  isOwner:     (ctx: Context) => boolean;
  logger:      AppLogger;
}) {
  const { bot, clientStore, stateMgr, oauth, tokenStore, isOwner, logger } = deps;

  bot.command("google-complete", async (ctx) => {
    if (!isOwner(ctx)) return;

    const raw = (ctx.match as string | undefined)?.trim();
    if (!raw) {
      await ctx.reply("Usage: /google-complete <URL copied from browser address bar>");
      return;
    }

    let parsed;
    try { parsed = parseRedirectUrl(raw); }
    catch (err) {
      await ctx.reply(`✗ ${(err as Error).message}`);
      return;
    }

    const consumed = stateMgr.validateAndConsume(parsed.state);
    if (!consumed) {
      await ctx.reply(
        "✗ This link is expired, already used, or wasn't generated by this bot. " +
        "Run /google-connect to start over."
      );
      return;
    }

    if (consumed.redirectUri !== parsed.redirectUri) {
      logger.warn(
        { subsystem: "google", event: "redirect_uri_mismatch",
          expected: consumed.redirectUri, got: parsed.redirectUri },
        "Redirect URI mismatch"
      );
      await ctx.reply(
        "✗ The URL you pasted doesn't match the one I generated. " +
        "Run /google-connect to start over."
      );
      return;
    }

    const creds = clientStore.read();
    if (!creds) {
      await ctx.reply("✗ Client credentials missing. Run /google-setup.");
      return;
    }

    let tokenSet;
    try {
      tokenSet = await oauth.exchangeCode(creds, parsed.code, consumed.redirectUri);
    } catch (err) {
      logger.error({ subsystem: "google", event: "exchange_failed", err }, "Exchange failed");
      await ctx.reply(
        "✗ Failed to exchange authorization code. " +
        "Run /google-connect to retry."
      );
      return;
    }

    // fetchUserEmail is the authoritative source; fall back to the hint the user
    // provided with /google-connect if it returns null (network error, etc.)
    const fetchedEmail = await oauth.fetchUserEmail(tokenSet.accessToken);
    const email = fetchedEmail ?? consumed.hintEmail ?? null;
    tokenStore.upsert(tokenSet, email);

    logger.info({ subsystem: "google", event: "oauth_complete", email }, "OAuth complete");
    await ctx.reply(
      `✓ Google connected${email ? ` as ${email}` : ""}. ` +
      `Gmail and Calendar tools are now active.`
    );
  });
}
```

**Integration test outline (`google-complete.test.ts`):**

```typescript
it("happy path: valid URL + valid state → token stored, success reply");
it("invalid URL → error reply, state not consumed");
it("unknown state → error reply, no token stored");
it("already-consumed state → error reply, no token stored");
it("redirect_uri mismatch → error reply, state IS consumed (single-use)");
it("Google error in URL (?error=access_denied) → error reply");
it("missing code in URL → error reply");
it("exchange fails → error reply, state consumed, no token stored");
```

**Exit criteria:** All integration tests pass. Happy path populates `credentials` table with the full token set.

---

### Task 3.15 — Telegram commands: /google-status, /google-disconnect

**Goal:** Observability and teardown commands.

**Key files:** `src/telegram/commands/google.ts`

```typescript
export function registerGoogleStatus(deps: {
  bot: Bot; clientStore: GoogleClientStore; tokenStore: GoogleTokenStore;
  isOwner: (ctx: Context) => boolean;
}) {
  const { bot, clientStore, tokenStore, isOwner } = deps;
  bot.command("google-status", async (ctx) => {
    if (!isOwner(ctx)) return;
    const hasClient = clientStore.has();
    const hasCreds  = tokenStore.hasCredential();
    const email     = tokenStore.accountLabel();
    await ctx.reply(
      `Client credentials: ${hasClient ? "✓ uploaded" : "✗ missing (run /google-setup)"}\n` +
      `Account authorization: ${hasCreds
        ? `✓ connected${email ? ` as ${email}` : ""}`
        : "✗ not connected (run /google-connect)"}`
    );
  });
}

export function registerGoogleDisconnect(deps: {
  bot: Bot; tokenStore: GoogleTokenStore; isOwner: (ctx: Context) => boolean;
}) {
  const { bot, tokenStore, isOwner } = deps;
  bot.command("google-disconnect", async (ctx) => {
    if (!isOwner(ctx)) return;
    tokenStore.delete();
    await ctx.reply("Google account disconnected. Client credentials kept.");
  });
}
```

**Exit criteria:** `/google-status` reflects current DB state accurately. `/google-disconnect` removes the credential row.

---

### Task 3.16 — Gmail normalizer

**Goal:** Convert raw Gmail API response to `CompactEmail` / `CompactEmailDetail`.

**Key files:** `src/google/normalize-gmail.ts`

Full code: see TDD §6.12 (under "normalize-gmail.ts" block).

**Unit tests:**

```typescript
it("extracts From, Subject, and receivedAt from headers");
it("converts internalDate (Unix ms string) to ISO 8601");
it("prefers text/plain part over text/html");
it("falls back to stripped HTML when no plain text exists");
it("caps snippet at 300 chars");
it("caps excerpt at 2000 chars");
it("returns null on malformed input without throwing");
it("handles multipart/mixed with nested multipart/alternative");
```

**Exit criteria:** All tests pass. No network calls.

---

### Task 3.17 — Gmail client

**Goal:** Call Gmail API endpoints for `listRecent` and `getMessage`.

**Key files:** `src/google/gmail.ts`

Full code: see TDD §6.12.

**Exit criteria:** With mocked `fetch`, `listRecent()` returns `CompactEmail[]` with `Authorization: Bearer <token>` header on all requests. `getMessage()` returns `CompactEmailDetail | null`.

---

### Task 3.18 — Calendar normalizer and client

**Goal:** Implement `normalize-calendar.ts` and `calendar.ts`.

**Key files:** `src/google/normalize-calendar.ts`, `src/google/calendar.ts`

```typescript
// src/google/normalize-calendar.ts
import type { CompactCalendarEvent } from "./types.ts";

const DESCRIPTION_MAX = 500;

export function normalizeCalendarEvent(raw: any, calendarId?: string): CompactCalendarEvent | null {
  try {
    return {
      id:                 raw.id,
      title:              raw.summary ?? "(No title)",
      start:              raw.start?.dateTime ?? raw.start?.date ?? "",
      end:                raw.end?.dateTime ?? raw.end?.date ?? undefined,
      location:           raw.location ? String(raw.location).slice(0, 200) : undefined,
      descriptionExcerpt: raw.description
        ? stripHtml(raw.description).slice(0, DESCRIPTION_MAX)
        : undefined,
      calendarId,
    };
  } catch { return null; }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}
```

```typescript
// src/google/calendar.ts
import type { GoogleTokenStore } from "./token-store.ts";
import type { CompactCalendarEvent } from "./types.ts";
import { normalizeCalendarEvent } from "./normalize-calendar.ts";

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

export class CalendarClient {
  constructor(private readonly tokens: GoogleTokenStore) {}

  private async headers(): Promise<HeadersInit> {
    return { Authorization: `Bearer ${await this.tokens.getAccessToken()}` };
  }

  async listWindow(p: {
    startIso: string; endIso: string;
    calendarIds?: string[]; maxResults?: number;
  }): Promise<CompactCalendarEvent[]> {
    const cals = p.calendarIds ?? ["primary"];
    const cap  = Math.min(p.maxResults ?? 20, 50);

    const perCal = await Promise.all(
      cals.map(cid => this.listOne(cid, p.startIso, p.endIso, cap)),
    );
    return perCal.flat()
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, cap);
  }

  private async listOne(
    cid: string, timeMin: string, timeMax: string, max: number,
  ): Promise<CompactCalendarEvent[]> {
    const url = new URL(`${CAL_BASE}/calendars/${encodeURIComponent(cid)}/events`);
    url.searchParams.set("timeMin",      timeMin);
    url.searchParams.set("timeMax",      timeMax);
    url.searchParams.set("maxResults",   String(max));
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy",      "startTime");
    const r = await fetch(url, { headers: await this.headers() });
    if (!r.ok) return [];   // Non-fatal: failing calendar returns empty
    const data = await r.json() as { items?: any[] };
    return (data.items ?? [])
      .map(it => normalizeCalendarEvent(it, cid))
      .filter((e): e is CompactCalendarEvent => e !== null);
  }
}
```

**Unit tests:** normalizer handles dateTime/date formats; client merges multiple calendars; failing calendar doesn't break the others.

**Exit criteria:** All tests pass.

---

### Task 3.19 — Agent tools

**Goal:** Four agent tools using the Gmail and Calendar clients.

**Key files:** `src/tools/gmail-list-recent.ts`, `src/tools/gmail-get-message.ts`, `src/tools/calendar-list-today.ts`, `src/tools/calendar-list-tomorrow.ts`

#### `gmail_list_recent`

```typescript
import { z } from "zod";
import type { ToolHandler, ToolContext } from "../agent/types.ts";
import type { GmailClient } from "../google/gmail.ts";

const Args = z.object({
  newerThanHours: z.number().int().min(1).max(168).default(24),
  maxResults:     z.number().int().min(1).max(20).default(10),
  query:          z.string().optional(),
});
type ArgsT = z.infer<typeof Args>;

export function makeGmailListRecentTool(gmail: GmailClient): ToolHandler<ArgsT, string> {
  return {
    name: "gmail_list_recent",
    description:
      "List recent emails (sender, subject, timestamp, snippet). " +
      "Use gmail_get_message to read a full email body.",
    schema: Args,
    async execute(a, _ctx: ToolContext) {
      const emails = await gmail.listRecent({
        newerThanHours: a.newerThanHours,
        maxResults:     a.maxResults,
        query:          a.query,
      });
      if (emails.length === 0) return "No emails matching the criteria.";
      return emails.map(e =>
        `[${e.id}] ${e.receivedAt} | From: ${e.from} | Subject: ${e.subject}\n  ${e.snippet}`
      ).join("\n\n");
    },
  };
}
```

#### `gmail_get_message`

```typescript
import { z } from "zod";
const Args = z.object({ id: z.string() });
type ArgsT = z.infer<typeof Args>;

export function makeGmailGetMessageTool(gmail: GmailClient): ToolHandler<ArgsT, string> {
  return {
    name: "gmail_get_message",
    description: "Fetch the full body of a specific email by ID.",
    schema: Args,
    async execute(a) {
      const m = await gmail.getMessage({ id: a.id });
      if (!m) return `Email ${a.id} not found.`;
      return `From: ${m.from}\nSubject: ${m.subject}\nDate: ${m.receivedAt}\n\n${m.excerpt || "(No readable body)"}`;
    },
  };
}
```

#### `calendar_list_today` / `calendar_list_tomorrow`

```typescript
import { z } from "zod";

function dayWindow(offsetDays: number, tz: string): { startIso: string; endIso: string } {
  const now = new Date();
  const target = new Date(now.getTime() + offsetDays * 86400000);
  const dateStr = target.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  return {
    startIso: new Date(`${dateStr}T00:00:00`).toISOString(),
    endIso:   new Date(`${dateStr}T23:59:59`).toISOString(),
  };
}

const Args = z.object({
  calendarIds: z.array(z.string()).optional(),
});
type ArgsT = z.infer<typeof Args>;

export function makeCalendarListTodayTool(
  cal: CalendarClient, tz: string,
): ToolHandler<ArgsT, string> {
  return {
    name: "calendar_list_today",
    description: "List calendar events for today.",
    schema: Args,
    async execute(a) {
      const w = dayWindow(0, tz);
      const events = await cal.listWindow({ ...w, calendarIds: a.calendarIds, maxResults: 20 });
      if (events.length === 0) return "No events today.";
      return events.map(e =>
        `${e.start}${e.end ? ` – ${e.end}` : ""} | ${e.title}${e.location ? ` @ ${e.location}` : ""}`
      ).join("\n");
    },
  };
}
```

The `_tomorrow` variant is identical with `offsetDays = 1`.

**Exit criteria:** Each tool returns a non-empty string when its mock client returns data. Tool descriptions are concise (each tool's schema+description is well under 100 tokens).

---

### Task 3.20 — Tool registry conditional registration

**Goal:** Register Google tools only when credentials exist.

**Key files:** `src/agent/tool-registry.ts`

```typescript
export function buildToolRegistry(
  config: AppConfig,
  tokenStore: GoogleTokenStore,
  gmail: GmailClient,
  calendar: CalendarClient,
  timezone: string,
  // ... other tool deps
): ToolRegistry {
  const registry = new ToolRegistry();

  // Workspace tools (always)
  registry.register(makeListFilesTool(config.workspace.root));
  registry.register(makeReadFileTool(config.workspace.root));
  registry.register(makeWriteFileTool(config.workspace.root));
  registry.register(makeApplyPatchTool(config.workspace.root));
  if (config.tools.exec.enabled) registry.register(makeExecTool(config.tools.exec));

  // Google tools (only when authorized)
  if (config.google.enabled && tokenStore.hasCredential()) {
    registry.register(makeGmailListRecentTool(gmail));
    registry.register(makeGmailGetMessageTool(gmail));
    registry.register(makeCalendarListTodayTool(calendar, timezone));
    registry.register(makeCalendarListTomorrowTool(calendar, timezone));
  }

  return registry;
}
```

**Important:** The agent runtime calls `buildToolRegistry()` at the start of each agent turn (not once at boot). This ensures that a freshly-authorized Google account becomes available on the next message without a service restart.

**Exit criteria:** Before `/google-connect`, `gmail_list_recent` is absent from the tool list sent to the model. After authorization completes, the next agent turn includes it.

---

### Task 3.21 — Bootstrap wiring

**Goal:** Instantiate and wire all Google modules in `bootstrap.ts`.

**Key files:** `src/app/bootstrap.ts`

```typescript
// After DB and logger are initialized

// Google subsystem (no config needed for OAuth proper — credentials come from DB)
const clientStore    = new GoogleClientStore(db);
const stateMgr       = new OAuthStateManager(db);
const oauth          = new GoogleOAuth();   // stateless, no constructor args
const tokenStore     = new GoogleTokenStore(db, oauth, clientStore, logger);
const gmailClient    = new GmailClient(tokenStore);
const calendarClient = new CalendarClient(tokenStore);

// Cleanup on startup
stateMgr.purgeExpired();

// Telegram command registration
const googleDeps = {
  bot, clientStore, stateMgr, oauth, tokenStore,
  scopeConfig: config.google.scopes,
  isOwner,
  logger,
};
registerGoogleSetup(googleDeps);
registerGoogleConnect(googleDeps);
registerGoogleComplete(googleDeps);
registerGoogleStatus(googleDeps);
registerGoogleDisconnect(googleDeps);

// Agent tool registry builder now includes Google clients
const buildTools = () => buildToolRegistry(
  config, tokenStore, gmailClient, calendarClient,
  config.app.timezone,
  // ...
);
// Agent runtime receives buildTools and calls it per turn
```

**Exit criteria:** `node dist/index.js` starts cleanly. All Google commands are registered. No HTTP server is required for OAuth.

---

## Key Design Decisions

### Desktop (Installed) credentials, not Web

Web credentials require pre-registered redirect URIs and are designed for hosted apps. Desktop credentials allow any `http://127.0.0.1:*` or `http://localhost:*` URI, which is exactly what the manual flow needs. The parser rejects Web credentials with a specific, actionable error message.

### No HTTP server for OAuth

gogcli's `--manual` flow proves this works: the "redirect URI" is a formatting convention, not an endpoint. Google redirects the browser to 127.0.0.1, the browser fails to connect, and the URL in the address bar contains everything needed. Removing the server eliminates HTTPS cert management, LAN hostnames, reverse proxies, and firewall configuration.

### Random port per authorization

Each authorization attempt generates a new redirect URI with a random port in the dynamic range. Since nothing binds, the port is cosmetic. Using a random port per attempt is cheap and avoids cosmetic repetition in logs.

### `redirect_uri` persisted with state

Because the redirect URI is ephemeral (different per attempt), it must be persisted alongside the state. The token exchange requires exactly the same URI used in the auth URL. Storing both in `oauth_states` means `/google-complete` can retrieve the right URI regardless of how long it sat unused.

### User-uploaded `client_secret.json`

This matches how similar tools are typically bootstrapped and is significantly friendlier than asking the user to extract fields into a YAML config. It also keeps secrets out of the application's config file on disk (they live only in the SQLite DB alongside the tokens, which have the same sensitivity).

### Explicit `/google-complete <url>` command, not auto-detect

A dedicated command is clearer than pattern-matching incoming messages and has no false-positive risk. Auto-detect can be added later as a convenience, guarded by `findPendingForChat`, but v1 uses the explicit form only.

### `prompt=consent` always set

Forces Google to always return a `refresh_token` during exchange, avoiding a subtle failure mode where a repeat authorization after a token deletion returns an access token but no refresh token. Costs one extra user interaction.

### Single-account v1

`credentials.provider` is the primary key; there can only be one Google row. Multi-account support would change the key to `(provider, account_label)` and add account selection to each tool invocation. Out of scope for v1.

### Tool registry rebuilt per agent turn

The registry reads from `tokenStore.hasCredential()` — a cheap DB query. Rebuilding per turn means `/google-connect` immediately enables Gmail/Calendar tools on the next user message without requiring a service restart.

---

## Acceptance Criteria for Phase 3

Phase 3 is complete when:

1. `node dist/index.js` starts cleanly on a fresh DB, creates all three tables.
2. `/google-setup` with a valid Desktop `client_secret.json` stores credentials and replies with confirmation.
3. `/google-setup` with a Web credential file rejects with the Desktop-vs-Web explanation.
4. `/google-connect` replies with instructions and a valid Google auth URL (containing `access_type=offline` and `prompt=consent`).
5. Opening the URL in a browser completes the consent screen and redirects to `http://127.0.0.1:PORT/...` (connection fails, URL visible in address bar).
6. Pasting that URL into `/google-complete` exchanges the code, stores the token, and replies with "Connected as <email>".
7. An expired or already-consumed state returns an error reply and does not store credentials.
8. A mismatched redirect URI returns an error reply and does not store credentials.
9. `/google-status` accurately reflects whether client credentials and account authorization are present.
10. `/google-disconnect` removes the credential row.
11. After connecting, the agent sees `gmail_list_recent`, `gmail_get_message`, `calendar_list_today`, `calendar_list_tomorrow` in its tool list on the next turn.
12. `gmail_list_recent` returns real email data from a test account.
13. `calendar_list_today` returns real event data from a test account.
14. Tokens near expiry are refreshed transparently when an API call is made.
15. No refresh token, access token, authorization code, or bearer header appears in log output.
16. All unit and integration tests pass.
17. No HTTP server is running specifically for OAuth (the existing `/healthz` server, if any, is unrelated to this subsystem).
