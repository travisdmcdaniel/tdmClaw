# tdmClaw

A lightweight, self-hosted AI assistant designed to run continuously as a service on a headless Ubuntu Server Raspberry Pi. Communicates through Telegram with support for local file tools, shell execution, Gmail, Google Calendar, and scheduled daily briefings.

## Features

- **Telegram-first** — chat with your assistant directly in Telegram
- **Tool-using agent loop** — reads/writes files, applies patches, executes bounded shell commands
- **Ollama model discovery** — automatically discovers locally available models; select and switch via Telegram commands
- **Google integration** — OAuth-authorized access to Gmail and Google Calendar
- **Scheduled briefings** — daily morning briefings combining email and calendar data, delivered to Telegram
- **Pi-first design** — minimal token footprint, compact prompts, bounded outputs
- **SQLite persistence** — sessions, jobs, credentials, and settings survive restarts

## Requirements

- **Node.js 22 LTS** (specifically v22 — Node 24 is not supported because it requires C++20 for native addon compilation and lacks prebuilt arm64 binaries for `better-sqlite3`). Install via NodeSource: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`
- C/C++ build toolchain — required to compile `better-sqlite3` from source on arm64. Install with: `sudo apt-get install -y build-essential`
- [Ollama](https://ollama.ai) (or another OpenAI-compatible local model server)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Google Cloud project with OAuth credentials (for Gmail/Calendar features)
- Ubuntu Server on Raspberry Pi (production target; works on any Linux/macOS for development)

## Quick Start

### 1. Clone and run the installer

```bash
git clone https://github.com/travisdmcdaniel/tdmClaw.git
cd tdmClaw
sudo bash install.sh
```

The installer will:
- Check for Node.js 22+
- Install npm dependencies
- Copy `config/config.example.yaml` to `config/config.yaml` and prompt for required values (bot token, allowed user IDs, workspace path, Ollama URL)
- Build the project
- Link `tdmclaw` as a global command via `npm link`

Then start with:

```bash
tdmclaw
```

For development with hot reload:

```bash
npm run dev
```

Sensitive values can also be provided as environment variables instead of in the config file — see `.env.example`.

### 2. Connect your Google account (optional)

Google OAuth uses a loopback manual flow — no HTTP callback server, no HTTPS certificate, no reverse proxy required. The entire authorization happens through Telegram.

**One-time setup:**

1. In [Google Cloud Console](https://console.cloud.google.com), create an OAuth 2.0 Client ID of type **Desktop app** and download the `client_secret.json` file.
2. Enable the **Gmail API** and **Google Calendar API** for your project.
3. In Telegram, send `/google_setup` with the `client_secret.json` file attached.
4. Send `/google_connect your@gmail.com` — the bot replies with a Google authorization URL.
5. Open that URL in any browser on any device and approve the consent screen. Your browser will then show a "connection refused" error page at `127.0.0.1` — this is expected.
6. Copy the full URL from your browser's address bar and send it back with `/google_complete <paste URL>`.
7. The bot confirms authorization and Gmail/Calendar tools become available immediately.

Enable calendar write access (to create events) by setting `google.scopes.calendarWrite: true` in `config.yaml`.

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh session (clears conversation context) |
| `/models` | List all models available on the Ollama endpoint |
| `/model` | Show the currently active model and fallback chain |
| `/setmodel <name>` | Switch to a specific model |
| `/setfallback <name> [name...]` | Set the ordered fallback model list |
| `/google_setup` | Upload `client_secret.json` to configure Google OAuth credentials |
| `/google_connect <email>` | Start Google OAuth authorization for the given email address |
| `/google_complete <url>` | Finish authorization by pasting the failed redirect URL from your browser |
| `/google_status` | Show current Google connection state |
| `/google_disconnect` | Remove stored Google credentials |
| `/jobs` | List scheduled jobs and their status |

## Project Structure

```
src/
  index.ts              Entry point
  app/                  Bootstrap, config, logging, shutdown
  telegram/             Bot, polling, message routing, guards
  agent/                Runtime, prompt builder, tool loop, history
    providers/          Model provider abstraction + Ollama discovery
  tools/                File, exec, Gmail, and Calendar tools
  google/               OAuth, token store, Gmail/Calendar clients
  scheduler/            Job scheduler, timing, locking
    jobs/               Built-in job handlers
  services/             Briefing and summarization services
  storage/              SQLite wrapper, migrations, per-table DAOs
  api/                  Local HTTP server, OAuth callback route
  security/             Path guards, exec policy, redaction
systemd/
  tdmclaw.service       systemd unit file for Pi deployment
```

## Updating

Run `update.sh` from the source directory:

```bash
cd /path/to/tdmClaw
bash update.sh          # local dev install
sudo bash update.sh     # systemd install
```

The script pulls the latest changes, reinstalls dependencies, rebuilds, and then deploys: for a systemd install it stops the service, copies the new build to the install directory, and restarts; for a local install it refreshes the global npm links.

## Deployment on Raspberry Pi

### systemd service

Run the installer as root and answer **yes** when prompted to set up the systemd service:

```bash
sudo bash install.sh
```

This will create a dedicated service user, copy the built app and config to the install directory, write the systemd unit file, and start the service. To check status afterwards:

```bash
sudo systemctl status tdmclaw
sudo journalctl -u tdmclaw -f
```

## Configuration Reference

See `config/config.example.yaml` for the full configuration schema with comments.

Environment variable overrides follow the pattern `TDMCLAW_<SECTION>_<KEY>` (e.g. `TDMCLAW_TELEGRAM_BOT_TOKEN`).

## Development

```bash
# Run tests
npm test

# Type check only
npm run typecheck

# Lint
npm run lint
```

## License

MIT
