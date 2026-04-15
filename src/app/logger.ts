import pino, { type Logger } from "pino";

export type AppLogger = Logger;

export type LogLevel = "debug" | "info" | "warn" | "error";

let _logger: AppLogger | null = null;

/**
 * Initializes the application logger. Must be called once during bootstrap
 * before any subsystem uses getLogger().
 */
export function initLogger(level: LogLevel = "info"): AppLogger {
  const isDev =
    process.env["NODE_ENV"] !== "production" &&
    process.stdout.isTTY;

  _logger = pino({
    level,
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss" },
          },
        }
      : {}),
    redact: {
      paths: [
        "botToken",
        "apiKey",
        "clientSecret",
        "token",
        "accessToken",
        "refreshToken",
        "token_json",
        "*.token",
        "*.secret",
      ],
      censor: "[REDACTED]",
    },
  });

  return _logger;
}

/**
 * Returns the application logger. Throws if initLogger() has not been called.
 */
export function getLogger(): AppLogger {
  if (!_logger) {
    throw new Error("Logger not initialized. Call initLogger() during bootstrap.");
  }
  return _logger;
}

/**
 * Returns a child logger scoped to a subsystem.
 * Lazy: defers resolution until the first log call so that module-level
 * `const log = childLogger("x")` declarations don't require initLogger()
 * to have already run at import time.
 */
export function childLogger(subsystem: string): AppLogger {
  let resolved: AppLogger | null = null;
  return new Proxy({} as AppLogger, {
    get(_target, prop: string | symbol) {
      if (!resolved) {
        resolved = getLogger().child({ subsystem });
      }
      const value = (resolved as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(resolved)
        : value;
    },
  });
}
