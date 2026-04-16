import type { ParsedRedirect } from "./types";

export class InvalidRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRedirectError";
  }
}

/**
 * Parses a URL pasted by the user from their browser's address bar after the
 * failed loopback redirect. Returns the authorization code, state, and the
 * base redirect URI (scheme + host + port + path, no query string).
 *
 * The base redirect URI is returned because it must be passed verbatim to the
 * token exchange request — Google requires an exact match with the auth URL.
 */
export function parseRedirectUrl(raw: string): ParsedRedirect {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidRedirectError("Not a valid URL.");
  }

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

  // Reconstruct base URI: scheme + host (includes non-default port) + path
  const redirectUri = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;

  return { code, state, redirectUri };
}
