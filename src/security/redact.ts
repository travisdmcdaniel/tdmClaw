const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "bottoken",
  "apikey",
  "clientsecret",
  "token",
  "accesstoken",
  "refreshtoken",
  "token_json",
  "secret",
  "password",
  "credential",
]);

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
 * Redacts known secret patterns from a string (e.g. log lines).
 */
export function redactString(text: string): string {
  // Bearer tokens
  return text.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]");
}
