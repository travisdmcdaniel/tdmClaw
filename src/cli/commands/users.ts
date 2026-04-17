import { readFileSync, writeFileSync } from "fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveConfigPath } from "../config-path";

/**
 * Adds a Telegram user ID to telegram.allowedUserIds if not already present.
 */
export function usersAdd(userId: string): void {
  const configPath = resolveConfigPath();
  const raw = parseYaml(readFileSync(configPath, "utf-8")) as Record<string, unknown>;

  const telegram = raw["telegram"] as Record<string, unknown> | undefined;
  if (!telegram) {
    console.error("Config is missing the telegram section.");
    process.exit(1);
  }

  const ids = telegram["allowedUserIds"];
  if (!Array.isArray(ids)) {
    console.error("telegram.allowedUserIds is not an array.");
    process.exit(1);
  }

  const existing = ids as string[];
  if (existing.includes(userId)) {
    console.log(`User ${userId} is already in allowedUserIds.`);
    return;
  }

  existing.push(userId);
  telegram["allowedUserIds"] = existing;
  writeFileSync(configPath, stringifyYaml(raw), "utf-8");
  console.log(`Added user ${userId} to telegram.allowedUserIds.`);
}

/**
 * Removes a Telegram user ID from telegram.allowedUserIds.
 */
export function usersRemove(userId: string): void {
  const configPath = resolveConfigPath();
  const raw = parseYaml(readFileSync(configPath, "utf-8")) as Record<string, unknown>;

  const telegram = raw["telegram"] as Record<string, unknown> | undefined;
  if (!telegram) {
    console.error("Config is missing the telegram section.");
    process.exit(1);
  }

  const ids = telegram["allowedUserIds"];
  if (!Array.isArray(ids)) {
    console.error("telegram.allowedUserIds is not an array.");
    process.exit(1);
  }

  const existing = ids as string[];
  const next = existing.filter((id) => id !== userId);

  if (next.length === existing.length) {
    console.log(`User ${userId} was not in allowedUserIds.`);
    return;
  }

  if (next.length === 0) {
    console.error(
      "Refusing to remove the last user — telegram.allowedUserIds would be empty."
    );
    process.exit(1);
  }

  telegram["allowedUserIds"] = next;
  writeFileSync(configPath, stringifyYaml(raw), "utf-8");
  console.log(`Removed user ${userId} from telegram.allowedUserIds.`);
}
