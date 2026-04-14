import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * Loads a .env file into process.env if it exists.
 * Variables already set in the environment are not overwritten.
 */
export function loadDotenv(path = ".env"): void {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return;

  const lines = readFileSync(resolved, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

/**
 * Resolves a config value that may be an env-var reference.
 * Values of the form "env:VAR_NAME" are replaced with the corresponding
 * environment variable. Throws if the variable is unset.
 */
export function resolveEnvRef(value: string, fieldName: string): string {
  if (!value.startsWith("env:")) return value;
  const varName = value.slice(4);
  const resolved = process.env[varName];
  if (resolved === undefined || resolved === "") {
    throw new Error(
      `Config field "${fieldName}" references env var "${varName}" which is not set`
    );
  }
  return resolved;
}
