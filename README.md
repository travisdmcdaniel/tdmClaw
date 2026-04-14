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

### 1. Clone and install

```bash
git clone https://github.com/your-username/tdmclaw.git
cd tdmclaw
npm install
```

### 2. Configure

Copy the example config and fill in your values:

```bash
cp config/config.example.yaml config/config.yaml
```

At minimum you need:

```yaml
telegram:
  botToken: "your-bot-token"
  allowedUserIds:
    - "your-telegram-user-id"

workspace:
  root: /opt/tdmclaw/workspace

models:
  provider: openai-compatible
  baseUrl: http://127.0.0.1:11434
  discovery:
    enabled: true
    pollIntervalSeconds: 60
```

Sensitive values can also be provided as environment variables — see `.env.example`.

### 3. Build and run

```bash
npm run build
npm start
```

For development with hot reload:

```bash
npm run dev
```

### 4. Connect your Google account (optional)

In Telegram, send:

```
/google-connect
```

The assistant will send you an authorization URL. Open it from any device on your local network, complete the Google OAuth flow, and the assistant will confirm in Telegram.

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/models` | List all models available on the Ollama endpoint |
| `/model` | Show the currently active model and fallback chain |
| `/setmodel <name>` | Switch to a specific model |
| `/setfallback <name> [name...]` | Set the ordered fallback model list |
| `/google-connect` | Start Google OAuth authorization flow |
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

```bash
# Copy the built app
sudo mkdir -p /opt/tdmclaw
sudo cp -r dist/ node_modules/ /opt/tdmclaw/

# Create a dedicated user
sudo useradd -r -s /bin/false tdmclaw

# Install the service
sudo cp systemd/tdmclaw.service /etc/systemd/system/
sudo cp config/config.yaml /etc/tdmclaw/config.yaml
sudo systemctl daemon-reload
sudo systemctl enable --now tdmclaw
```

### LAN HTTPS for Google OAuth callbacks

Google requires an HTTPS callback URL. For a private LAN deployment:

1. Point a domain (e.g. `pi-auth.example.com`) to your Pi's local IP via split-horizon DNS or `/etc/hosts` on your devices.
2. Install [Caddy](https://caddyserver.com) on the Pi for automatic TLS termination.
3. Set `google.redirectBaseUrl: https://pi-auth.example.com` in your config.

See `docs/oauth-lan-setup.md` for detailed instructions.

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
