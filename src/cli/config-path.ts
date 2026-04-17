import { resolve } from "path";
import { existsSync } from "fs";

const CONFIG_PATH_ENV = "TDMCLAW_CONFIG_PATH";
const DEFAULT_CONFIG_PATH = "config/config.yaml";

/**
 * Resolves the config file path, checking the env override first.
 * Throws with a clear message if the file does not exist.
 */
export function resolveConfigPath(): string {
  const configPath = resolve(process.env[CONFIG_PATH_ENV] ?? DEFAULT_CONFIG_PATH);
  if (!existsSync(configPath)) {
    throw new Error(
      `Config file not found at "${configPath}".\n` +
        `Set ${CONFIG_PATH_ENV} or run from the project root.`
    );
  }
  return configPath;
}
