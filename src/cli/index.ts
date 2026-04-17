#!/usr/bin/env node
/**
 * tdmclaw-cli — management tool for the tdmClaw service.
 *
 * Usage:
 *   tdmclaw-cli config get <key.path>
 *   tdmclaw-cli config set <key.path> <value>
 *   tdmclaw-cli users add <telegram-user-id>
 *   tdmclaw-cli users remove <telegram-user-id>
 *   tdmclaw-cli status
 */

import { configGet, configSet } from "./commands/config";
import { usersAdd, usersRemove } from "./commands/users";
import { status } from "./commands/status";

const args = process.argv.slice(2);
const [command, sub, ...rest] = args;

function usage(): void {
  console.error(
    [
      "Usage:",
      "  tdmclaw-cli config get <key>         Read a config value by dot-separated path",
      "  tdmclaw-cli config set <key> <value> Write a config value",
      "  tdmclaw-cli users add <id>           Add a Telegram user ID to the allowlist",
      "  tdmclaw-cli users remove <id>        Remove a Telegram user ID from the allowlist",
      "  tdmclaw-cli status                   Show DB health and job statuses",
    ].join("\n")
  );
  process.exit(1);
}

try {
  switch (command) {
    case "config":
      if (sub === "get" && rest[0]) {
        configGet(rest[0]);
      } else if (sub === "set" && rest[0] !== undefined && rest[1] !== undefined) {
        configSet(rest[0], rest[1]);
      } else {
        usage();
      }
      break;

    case "users":
      if (sub === "add" && rest[0]) {
        usersAdd(rest[0]);
      } else if (sub === "remove" && rest[0]) {
        usersRemove(rest[0]);
      } else {
        usage();
      }
      break;

    case "status":
      status();
      break;

    default:
      usage();
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
}
