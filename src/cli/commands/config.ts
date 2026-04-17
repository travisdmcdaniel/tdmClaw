import { readFileSync, writeFileSync } from "fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveConfigPath } from "../config-path";

/**
 * Reads a dot-separated key path from the config file and prints the value.
 * Example: config get models.baseUrl
 */
export function configGet(keyPath: string): void {
  const configPath = resolveConfigPath();
  const raw = parseYaml(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  const value = getByPath(raw, keyPath);
  if (value === undefined) {
    console.error(`Key not found: ${keyPath}`);
    process.exit(1);
  }
  if (typeof value === "object") {
    console.log(stringifyYaml(value));
  } else {
    console.log(String(value));
  }
}

/**
 * Sets a dot-separated key path in the config file to the given value.
 * The value is coerced: "true"/"false" → boolean, numeric strings → number,
 * everything else remains a string.
 * Example: config set models.model qwen3.5:8b
 */
export function configSet(keyPath: string, rawValue: string): void {
  const configPath = resolveConfigPath();
  const raw = parseYaml(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  const value = coerce(rawValue);
  setByPath(raw, keyPath, value);
  writeFileSync(configPath, stringifyYaml(raw), "utf-8");
  console.log(`Set ${keyPath} = ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (typeof cur[part] !== "object" || cur[part] === null) {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function coerce(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (raw !== "" && !isNaN(n)) return n;
  return raw;
}
