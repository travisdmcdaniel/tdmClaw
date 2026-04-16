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

- Node.js 22+
- [Ollama](https://ollama.ai) (or another OpenAI-compatible local model server)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Google Cloud project with OAuth credentials (for Gmail/Calendar features)
- Ubuntu Server on Raspberry Pi (production target; works on any Linux/macOS for development)

## Quick Start

### 1. Clone and run the installer

```bash
git clone https://github.com/travisdmcdaniel/tdmClaw.git
cd tdmClaw
bash install.sh
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

### 2. Connect your Google account (optional, coming in a future release)

Google OAuth support is planned. Once available, you will upload your `client_secret.json` via Telegram and authorize your account entirely through Telegram — no browser on the Pi required. The flow uses a loopback manual redirect: the bot sends you an authorization URL, you open it on any device, and paste the resulting URL back. No HTTP callback server is needed.

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/models` | List all models available on the Ollama endpoint |
| `/model` | Show the currently active model and fallback chain |
| `/setmodel <name>` | Switch to a specific model |
| `/setfallback <name> [name...]` | Set the ordered fallback model list |

The following commands are planned for upcoming releases:

| Command | Description |
|---------|-------------|
| `/google-setup` | Upload your `client_secret.json` to configure Google OAuth credentials |
| `/google-connect <email>` | Start Google OAuth authorization flow for the given email address |
| `/google-complete <url>` | Complete OAuth by pasting the failed redirect URL from your browser |
| `/google-status` | Show current Google authorization state |
| `/google-disconnect` | Remove stored Google credentials |
| `/jobs` | List scheduled jobs and their status |
| `/briefing` | Run the daily briefing immediately |

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
