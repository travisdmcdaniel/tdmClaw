# Deploying tdmClaw

## Quick start (local / development)

Run the interactive installer from the project root:

```bash
bash install.sh
```

The installer will:

1. Check that Node.js 22+ and npm are present.
2. Run `npm install`.
3. Prompt for the values needed to generate `config/config.yaml`:
   - Telegram bot token (from [@BotFather](https://t.me/BotFather))
   - Allowed Telegram user ID(s) — find yours with [@userinfobot](https://t.me/userinfobot)
   - Workspace root directory (default: `~/.tdmclaw/workspace`)
   - Data directory for the SQLite database (default: `~/.tdmclaw/data`)
   - Ollama base URL (default: `http://127.0.0.1:11434`)
   - IANA timezone (default: `UTC`)
4. Compile the TypeScript source (`npm run build`).
5. Run `npm link` so `tdmclaw` and `tdmclaw-cli` are available as global commands.
6. Offer to set up a systemd service (see below).

Once done, start the bot:

```bash
tdmclaw
```

Or in hot-reload dev mode:

```bash
npm run dev
```

---

## Production deployment (systemd on Raspberry Pi)

Re-run the installer with root privileges and answer **y** when asked about the systemd service:

```bash
sudo bash install.sh
```

When the systemd prompt appears, the installer additionally:

1. Creates a dedicated `tdmclaw` system user.
2. Copies `dist/` and `node_modules/` to the install directory (default: `/opt/tdmclaw`).
3. Copies the config to `/etc/tdmclaw/config.yaml`, replacing the literal bot token with `env:TDMCLAW_TELEGRAM_BOT_TOKEN`.
4. Creates `/etc/tdmclaw/tdmclaw.env` containing the bot token and config path, owned `root:tdmclaw`, mode `640`.
5. Writes `/etc/systemd/system/tdmclaw.service` with `EnvironmentFile=/etc/tdmclaw/tdmclaw.env` so secrets never sit in the config file.
6. Enables and starts the service.

Check the status and logs:

```bash
sudo systemctl status tdmclaw
sudo journalctl -u tdmclaw -f
```

---

## Google OAuth setup (optional)

To enable Gmail and Calendar access, follow these steps entirely from Telegram — no browser on the Pi is required.

1. In the Google Cloud Console, create an OAuth 2.0 **Desktop** client credential and download `client_secret.json`.
2. In `config.yaml`, set `google.enabled: true` and configure the desired scopes.
3. Restart the service: `sudo systemctl restart tdmclaw`.
4. In Telegram, attach `client_secret.json` and send it with the caption `/google-setup`.
5. Run `/google-connect your@gmail.com` — the bot will reply with an authorization URL.
6. Open the URL in any browser, complete the consent flow, then copy the URL from the address bar after the redirect fails.
7. Send that URL to the bot with `/google-complete <paste-url>`.
8. The bot confirms "Connected as your@gmail.com". Gmail and Calendar tools are available on the next turn.

---

## Uninstalling

Run the uninstaller from the project root:

```bash
bash uninstall.sh          # local dev install (no root required)
sudo bash uninstall.sh     # systemd install
```

The script detects your installation by reading the systemd unit file (if present) and extracts paths from it, so custom install directories are handled correctly. It will:

- Stop and disable the systemd service (if running)
- Remove the unit file, `/etc/tdmclaw/`, the install directory, and the service user
- Remove the `tdmclaw` and `tdmclaw-cli` global npm links

You will be asked separately before the following are removed, since they contain your data:

- Data directory (SQLite database — session history, OAuth credentials, memories)
- Workspace (files the assistant created or modified)
- Local `config/config.yaml`

The source directory is never removed automatically.

---

## Updating

```bash
cd /path/to/tdmClaw
git pull
npm install
npm run build
sudo systemctl restart tdmclaw   # omit if not running under systemd
```

---

## Management CLI

The `tdmclaw-cli` command reads and writes `config.yaml` and the SQLite database directly — useful for scripted changes without editing YAML by hand.

```bash
tdmclaw-cli status                           # DB health and job status
tdmclaw-cli config get models.model          # read a config value
tdmclaw-cli config set models.model qwen3:8b # write a config value
tdmclaw-cli users add 987654321              # add a Telegram user ID
tdmclaw-cli users remove 987654321           # remove a Telegram user ID
```

Set `TDMCLAW_CONFIG_PATH` if your config is not at the default location:

```bash
TDMCLAW_CONFIG_PATH=/etc/tdmclaw/config.yaml tdmclaw-cli status
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Bot does not respond | Wrong `allowedUserIds` | `tdmclaw-cli users add <your-id>` |
| "No model available" | Ollama not running or no model pulled | `ollama list`; pull a model with `ollama pull <name>` |
| Service exits immediately | Config parse error | `sudo -u tdmclaw node /opt/tdmclaw/dist/index.js` and read stderr |
| Scheduler jobs not running | `scheduler.enabled` is false or wrong cron | Check config; use `crontab.guru` to verify cron expressions |
| Google tools missing after connect | Google not enabled in config | `tdmclaw-cli config set google.enabled true` and restart |
