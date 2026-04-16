import type { Context } from "grammy";
import type { AppLogger } from "../../app/logger";
import type { GoogleClientStore } from "../../google/client-store";
import type { OAuthStateManager } from "../../google/state";
import type { GoogleOAuth } from "../../google/oauth";
import type { GoogleTokenStore } from "../../google/token-store";
import type { ScopeConfig } from "../../google/scopes";
import { parseClientSecret, InvalidClientSecretError } from "../../google/parse-client-secret";
import { makeRedirectUri } from "../../google/redirect-uri";
import { parseRedirectUrl, InvalidRedirectError } from "../../google/parse-redirect";
import { buildScopes } from "../../google/scopes";
import { childLogger } from "../../app/logger";
import { redactQueryParams } from "../../security/redact";

const log = childLogger("google");

const MAX_UPLOAD_BYTES = 64 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type GoogleCommandDeps = {
  clientStore: GoogleClientStore;
  stateMgr: OAuthStateManager;
  oauth: GoogleOAuth;
  tokenStore: GoogleTokenStore;
  scopeConfig: ScopeConfig;
  isOwner: (ctx: Context) => boolean;
  botToken: string;
  logger: AppLogger;
};

/**
 * Registers all /google-* Telegram command handlers.
 *
 * Commands:
 *   /google-setup    — upload client_secret.json (Desktop credential)
 *   /google-connect  — start OAuth flow (sends auth URL)
 *   /google-complete — finish OAuth flow (paste failed redirect URL)
 *   /google-status   — show current auth state
 *   /google-disconnect — remove stored credentials
 */
export function registerGoogleCommands(
  deps: GoogleCommandDeps,
  handleCommand: (ctx: Context, command: string, args: string) => Promise<void>
): void {
  // This module exports handlers, not grammy command registrations.
  // See routeGoogleCommand() below which is called by the main handler.
  void deps;
  void handleCommand;
}

/**
 * Routes a /google-* command to the appropriate handler.
 * Called by handler.ts after the allowlist check.
 */
export async function routeGoogleCommand(
  ctx: Context,
  command: string,
  args: string,
  deps: GoogleCommandDeps
): Promise<void> {
  const { isOwner } = deps;
  if (!isOwner(ctx)) return; // silently ignore non-owners

  switch (command) {
    case "google_setup":
      await handleGoogleSetup(ctx, deps);
      break;
    case "google_connect":
      await handleGoogleConnect(ctx, args.trim(), deps);
      break;
    case "google_complete":
      await handleGoogleComplete(ctx, args.trim(), deps);
      break;
    case "google_status":
      await handleGoogleStatus(ctx, deps);
      break;
    case "google_disconnect":
      await handleGoogleDisconnect(ctx, deps);
      break;
    default:
      await ctx.reply(`Unknown Google command: /${command}`);
  }
}

// ---------------------------------------------------------------------------
// /google-setup
// ---------------------------------------------------------------------------

async function handleGoogleSetup(ctx: Context, deps: GoogleCommandDeps): Promise<void> {
  const { clientStore, botToken } = deps;

  const doc = ctx.message?.document;
  if (!doc) {
    await ctx.reply(
      "Please attach your client_secret.json file to this command.\n\n" +
        "To get the file: Google Cloud Console → APIs & Services → Credentials → " +
        "your Desktop OAuth Client ID → Download JSON."
    );
    return;
  }

  if (doc.file_size && doc.file_size > MAX_UPLOAD_BYTES) {
    await ctx.reply("That file is too large to be a client_secret.json (max 64 KB).");
    return;
  }

  let buf: Buffer;
  try {
    const file = await ctx.api.getFile(doc.file_id);
    if (!file.file_path) throw new Error("No file_path returned");
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
    const resp = await fetch(fileUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    buf = Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    log.error({ subsystem: "google", event: "file_download_failed", err }, "Download failed");
    await ctx.reply("Could not download the attached file. Try again.");
    return;
  }

  try {
    const creds = parseClientSecret(buf);
    clientStore.upsert(creds);
    const projectNote = creds.projectId ? ` (project: ${creds.projectId})` : "";
    await ctx.reply(
      `✓ Google client credentials saved${projectNote}.\n\n` +
        "Run /google-connect your@gmail.com to authorize your Google account."
    );
    log.info({ subsystem: "google", event: "client_setup" }, "Client credentials uploaded");
  } catch (err) {
    if (err instanceof InvalidClientSecretError) {
      await ctx.reply(`✗ ${err.message}`);
    } else {
      log.error({ subsystem: "google", event: "setup_failed", err }, "Setup failed");
      await ctx.reply("Unexpected error parsing the file.");
    }
  }
}

// ---------------------------------------------------------------------------
// /google-connect <email>
// ---------------------------------------------------------------------------

async function handleGoogleConnect(
  ctx: Context,
  hintEmail: string,
  deps: GoogleCommandDeps
): Promise<void> {
  const { clientStore, stateMgr, oauth, scopeConfig } = deps;

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
      "No Google client credentials found. Run /google-setup first, " +
        "attaching your client_secret.json file."
    );
    return;
  }

  const chatId = String(ctx.chat!.id);
  const userId = String(ctx.from!.id);
  const redirectUri = makeRedirectUri();
  const state = stateMgr.generate(chatId, userId, redirectUri, hintEmail);
  const authUrl = oauth.buildAuthUrl({
    clientId: creds.clientId,
    redirectUri,
    scopes: buildScopes(scopeConfig),
    state,
    loginHint: hintEmail,
  });

  await ctx.reply(
    `Connecting Google account: ${hintEmail}\n\n` +
      "1. Open the URL below in any browser (phone, laptop, etc.).\n" +
      "2. Sign in with the Google account and approve the consent screen.\n" +
      "3. Your browser will show an error page at 127.0.0.1 — this is expected.\n" +
      "4. Copy the full URL from your browser's address bar.\n" +
      "5. Send it back here with: /google-complete <paste the URL>\n\n" +
      "_This link expires in 10 minutes._",
    { parse_mode: "Markdown" }
  );
  // Send the URL as a separate message so it's easy to tap on mobile
  await ctx.reply(authUrl);
}

// ---------------------------------------------------------------------------
// /google-complete <url>
// ---------------------------------------------------------------------------

async function handleGoogleComplete(
  ctx: Context,
  raw: string,
  deps: GoogleCommandDeps
): Promise<void> {
  const { clientStore, stateMgr, oauth, tokenStore } = deps;

  if (!raw) {
    await ctx.reply("Usage: /google-complete <URL copied from browser address bar>");
    return;
  }

  log.info(
    { subsystem: "google", event: "complete_attempt", url: redactQueryParams(raw) },
    "google-complete called"
  );

  let parsed;
  try {
    parsed = parseRedirectUrl(raw);
  } catch (err) {
    await ctx.reply(`✗ ${(err as Error).message}`);
    return;
  }

  const consumed = stateMgr.validateAndConsume(parsed.state);
  if (!consumed) {
    await ctx.reply(
      "✗ This link has expired, was already used, or was not generated by this bot. " +
        "Run /google-connect to start over."
    );
    return;
  }

  if (consumed.redirectUri !== parsed.redirectUri) {
    log.warn(
      {
        subsystem: "google",
        event: "redirect_uri_mismatch",
        expected: consumed.redirectUri,
        got: parsed.redirectUri,
      },
      "Redirect URI mismatch in paste-back"
    );
    await ctx.reply(
      "✗ The URL you pasted doesn't match the one this bot generated. " +
        "Run /google-connect to start over."
    );
    return;
  }

  const creds = clientStore.read();
  if (!creds) {
    await ctx.reply("✗ Client credentials missing. Run /google-setup first.");
    return;
  }

  let tokenSet;
  try {
    tokenSet = await oauth.exchangeCode(creds, parsed.code, consumed.redirectUri);
  } catch (err) {
    log.error({ subsystem: "google", event: "exchange_failed", err }, "Code exchange failed");
    await ctx.reply(
      "✗ Failed to exchange the authorization code. " +
        "Run /google-connect to retry."
    );
    return;
  }

  // fetchUserEmail is authoritative; fall back to the hint the user provided
  const fetchedEmail = await oauth.fetchUserEmail(tokenSet.accessToken);
  const email = fetchedEmail ?? consumed.hintEmail ?? null;
  tokenStore.upsert(tokenSet, email);

  const scopeList = tokenSet.scopes.filter((s) => !s.startsWith("openid") && s !== "email");
  log.info(
    { subsystem: "google", event: "oauth_complete", email, scopes: scopeList },
    "OAuth complete"
  );

  const scopeNote = scopeList.length > 0 ? `\nScopes: ${scopeList.join(", ")}` : "";
  await ctx.reply(
    `✓ Google connected${email ? ` as ${email}` : ""}. ` +
      `Gmail and Calendar tools are now active.${scopeNote}`
  );
}

// ---------------------------------------------------------------------------
// /google-status
// ---------------------------------------------------------------------------

async function handleGoogleStatus(ctx: Context, deps: GoogleCommandDeps): Promise<void> {
  const { clientStore, tokenStore } = deps;
  const hasClient = clientStore.has();
  const hasCreds = tokenStore.hasCredential();
  const email = tokenStore.accountLabel();

  await ctx.reply(
    `Client credentials: ${hasClient ? "✓ uploaded" : "✗ missing — run /google-setup"}\n` +
      `Account authorization: ${
        hasCreds
          ? `✓ connected${email ? ` as ${email}` : ""}`
          : "✗ not connected — run /google-connect"
      }`
  );
}

// ---------------------------------------------------------------------------
// /google-disconnect
// ---------------------------------------------------------------------------

async function handleGoogleDisconnect(ctx: Context, deps: GoogleCommandDeps): Promise<void> {
  const { tokenStore } = deps;
  tokenStore.delete();
  await ctx.reply(
    "Google account disconnected. Client credentials are kept — " +
      "run /google-connect to re-authorize."
  );
}
