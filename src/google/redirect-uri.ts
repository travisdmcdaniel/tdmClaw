import { randomInt } from "crypto";

const CALLBACK_PATH = "/oauth2/callback";

/**
 * Generates an ephemeral loopback redirect URI with a random port in the
 * dynamic range (49152–65535). Nothing ever listens on this port — the URI
 * exists only so Google's redirect produces a predictable "connection refused"
 * in the user's browser, with the authorization code visible in the address bar.
 *
 * We use 127.0.0.1 (not localhost) because it is unambiguous across platforms.
 */
export function makeRedirectUri(): string {
  // IANA dynamic/private port range: 49152–65535
  const port = 49152 + randomInt(0, 65535 - 49152 + 1);
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}
