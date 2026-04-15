import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { AppConfig } from "../app/config";
import type { Database } from "better-sqlite3";
import type { TelegramBot } from "../telegram/bot";
import { healthHandler } from "./health";
import { childLogger } from "../app/logger";

const log = childLogger("api");

export type ApiServer = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Creates the local HTTP server for health checks and OAuth callbacks.
 * Routes:
 *   GET /healthz
 *   GET /oauth/google/callback
 */
export function createApiServer(
  config: AppConfig,
  db: Database,
  bot: TelegramBot
): ApiServer {
  const app = new Hono();
  let server: ReturnType<typeof serve> | null = null;

  app.get("/healthz", healthHandler);

  // Google OAuth callback — only wired if Google is enabled
  if (config.google.enabled) {
    // Lazy import to avoid pulling in googleapis when Google is disabled
    app.get("/oauth/google/callback", async (c) => {
      const { createOAuthManager } = await import("../google/oauth");
      const { createTokenStore } = await import("../google/token-store");
      const { buildGoogleCallbackHandler } = await import("./google-callback");
      const tokenStore = createTokenStore(db);
      const oauthManager = createOAuthManager(config.google, tokenStore);
      const handler = buildGoogleCallbackHandler(db, oauthManager, bot);
      return handler(c);
    });
  }

  return {
    async start(): Promise<void> {
      const { callbackHost, callbackPort } = config.auth;
      await new Promise<void>((resolve, reject) => {
        server = serve({ fetch: app.fetch, hostname: callbackHost, port: callbackPort });
        server.on("listening", () => {
          log.info({ host: callbackHost, port: callbackPort }, "API server started");
          resolve();
        });
        server.on("error", reject);
      });
    },

    async stop(): Promise<void> {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          (server as { close?: (cb: (err?: Error) => void) => void }).close?.(
            (err) => (err ? reject(err) : resolve())
          );
        });
        log.info("API server stopped");
      }
    },
  };
}
