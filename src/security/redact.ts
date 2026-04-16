const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "bottoken",
  "apikey",
  "clientsecret",
  "client_secret",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "token_json",
  "secret",
  "password",
  "credential",
]);

// Patterns for string-level redaction (log lines, URLs)
const ACCESS_TOKEN_RE = /ya29\.[A-Za-z0-9_\-]+/g;
const REFRESH_TOKEN_RE = /1\/\/[A-Za-z0-9_\-]+/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
// Google auth codes begin with "4/" and are short-lived but still sensitive
const AUTH_CODE_RE = /\b4\/[0-9A-Za-z_\-]+/g;

/**
 * Redacts sensitive keys from a plain object for safe logging.
 * Does not mutate the original object.
 */
export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
    } else if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      out[key] = redactObject(val as Record<string, unknown>);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Redacts known token patterns and sensitive query parameters from a string.
 */
export function redactString(text: string): string {
  return text
    .replace(ACCESS_TOKEN_RE, "[ACCESS_TOKEN]")
    .replace(REFRESH_TOKEN_RE, "[REFRESH_TOKEN]")
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(AUTH_CODE_RE, "[AUTH_CODE]");
}

/**
 * Redacts sensitive query parameters from a URL string.
 */
export function redactQueryParams(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ["code", "access_token", "refresh_token", "token", "state"]) {
      if (u.searchParams.has(k)) u.searchParams.set(k, REDACTED);
    }
    return u.toString();
  } catch {
    return "[invalid url]";
  }
}
