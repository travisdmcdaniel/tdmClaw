import { childLogger } from "./logger";

type ShutdownHandler = () => Promise<void> | void;

const handlers: Array<{ name: string; fn: ShutdownHandler }> = [];
let shuttingDown = false;

const log = () => childLogger("app");

/**
 * Registers a named shutdown handler. Handlers run in LIFO order
 * (last registered, first executed) to mirror typical dependency teardown.
 */
export function onShutdown(name: string, fn: ShutdownHandler): void {
  handlers.unshift({ name, fn });
}

/**
 * Registers SIGTERM and SIGINT listeners that execute all shutdown handlers
 * and exit. Call once during bootstrap.
 */
export function registerShutdownHandlers(): void {
  const run = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log().info({ signal }, "Shutdown signal received");

    for (const { name, fn } of handlers) {
      try {
        log().info({ handler: name }, "Running shutdown handler");
        await fn();
      } catch (err) {
        log().error({ handler: name, err }, "Shutdown handler failed");
      }
    }

    log().info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void run("SIGTERM"));
  process.on("SIGINT", () => void run("SIGINT"));
}
