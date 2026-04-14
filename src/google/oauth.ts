import { google } from "googleapis";
import type { AppConfig } from "../app/config";
import type { TokenStore } from "./token-store";
import type { GoogleTokenSet } from "./types";
import { buildScopeList } from "./scopes";
import { childLogger } from "../app/logger";

const log = childLogger("google");

export type OAuthManager = {
  getAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<GoogleTokenSet>;
  getAuthenticatedClient(): ReturnType<typeof google.auth.OAuth2.prototype.constructor> | null;
  refreshIfNeeded(): Promise<void>;
};

/**
 * Creates an OAuth2 manager for Google APIs.
 */
export function createOAuthManager(
  config: AppConfig["google"],
  tokenStore: TokenStore
): OAuthManager {
  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    `${config.redirectBaseUrl}/oauth/google/callback`
  );

  const scopes = buildScopeList(config.scopes);

  // If tokens are stored, pre-load them into the client
  const stored = tokenStore.load();
  if (stored) {
    oauth2Client.setCredentials({
      access_token: stored.tokens.accessToken,
      refresh_token: stored.tokens.refreshToken,
      expiry_date: stored.tokens.expiryDate,
      scope: stored.tokens.scope,
      token_type: stored.tokens.tokenType,
    });
  }

  // Auto-save refreshed tokens
  oauth2Client.on("tokens", (tokens) => {
    const existing = tokenStore.load();
    const merged: GoogleTokenSet = {
      accessToken: tokens.access_token ?? existing?.tokens.accessToken ?? "",
      refreshToken: tokens.refresh_token ?? existing?.tokens.refreshToken,
      expiryDate: tokens.expiry_date ?? undefined,
      scope: tokens.scope ?? existing?.tokens.scope,
      tokenType: tokens.token_type ?? "Bearer",
    };
    tokenStore.save(merged, scopes);
    log.info("Google tokens refreshed and saved");
  });

  return {
    getAuthUrl(state: string): string {
      return oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        state,
        prompt: "consent",
      });
    },

    async exchangeCode(code: string): Promise<GoogleTokenSet> {
      const { tokens } = await oauth2Client.getToken(code);
      const tokenSet: GoogleTokenSet = {
        accessToken: tokens.access_token ?? "",
        refreshToken: tokens.refresh_token ?? undefined,
        expiryDate: tokens.expiry_date ?? undefined,
        scope: tokens.scope ?? undefined,
        tokenType: tokens.token_type ?? "Bearer",
      };
      oauth2Client.setCredentials(tokens);
      tokenStore.save(tokenSet, scopes);
      return tokenSet;
    },

    getAuthenticatedClient() {
      const stored = tokenStore.load();
      if (!stored) return null;
      return oauth2Client as ReturnType<typeof google.auth.OAuth2.prototype.constructor>;
    },

    async refreshIfNeeded(): Promise<void> {
      if (!tokenStore.hasValidTokens()) {
        log.info("Access token expired, refreshing");
        await oauth2Client.getAccessToken();
      }
    },
  };
}
