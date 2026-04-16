import type { TokenSet, GoogleClientCredentials } from "./types";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v1/userinfo";

export type AuthUrlParams = {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  loginHint?: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
};

/**
 * Core OAuth 2.0 operations for Google using plain fetch (no googleapis SDK).
 *
 * The GoogleOAuth instance is stateless — credentials are passed per-call.
 * This matches the manual loopback flow where each authorization may use
 * different ephemeral client credentials and redirect URIs.
 */
export class GoogleOAuth {
  /**
   * Build the Google authorization URL.
   *
   * - access_type=offline  → request a refresh_token
   * - prompt=consent       → always re-issue refresh_token (prevents silent
   *                          omission after prior authorization)
   * - include_granted_scopes=true → accumulate scopes across re-authorizations
   * - login_hint           → pre-selects the Google account on the consent screen
   */
  buildAuthUrl(params: AuthUrlParams): string {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      scope: params.scopes.join(" "),
      state: params.state,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });
    if (params.loginHint) q.set("login_hint", params.loginHint);
    return `${AUTH_ENDPOINT}?${q.toString()}`;
  }

  /**
   * Exchange an authorization code for a TokenSet.
   *
   * IMPORTANT: `redirectUri` must exactly match the one used in buildAuthUrl().
   * Google validates this and returns redirect_uri_mismatch otherwise.
   */
  async exchangeCode(
    creds: GoogleClientCredentials,
    code: string,
    redirectUri: string
  ): Promise<TokenSet> {
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });

    if (!resp.ok) {
      throw new Error(`Token exchange failed (${resp.status}): ${await resp.text()}`);
    }

    const data = (await resp.json()) as TokenResponse;

    if (!data.refresh_token) {
      throw new Error(
        "Google did not return a refresh_token. " +
          "Revoke app access at https://myaccount.google.com/permissions and try /google-connect again."
      );
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes: data.scope.split(" "),
    };
  }

  /**
   * Exchange a refresh token for a new access token.
   * Preserves the original refresh token if Google does not rotate it.
   */
  async refreshAccessToken(
    creds: GoogleClientCredentials,
    refreshToken: string
  ): Promise<TokenSet> {
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });

    if (!resp.ok) {
      throw new Error(`Token refresh failed (${resp.status}): ${await resp.text()}`);
    }

    const data = (await resp.json()) as TokenResponse;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes: data.scope.split(" "),
    };
  }

  /**
   * Fetch the email address associated with an access token.
   * Returns null on any error (best-effort — callers fall back to hint email).
   */
  async fetchUserEmail(accessToken: string): Promise<string | null> {
    try {
      const r = await fetch(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) return null;
      const d = (await r.json()) as { email?: string };
      return d.email ?? null;
    } catch {
      return null;
    }
  }
}
