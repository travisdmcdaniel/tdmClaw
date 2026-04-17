#!/usr/bin/env bash
# tdmClaw installer
# Usage: bash install.sh
set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

bold=$'\e[1m'
reset=$'\e[0m'
green=$'\e[32m'
yellow=$'\e[33m'
red=$'\e[31m'

info()    { echo "${bold}${green}==>${reset} $*"; }
warn()    { echo "${bold}${yellow}warn:${reset} $*"; }
die()     { echo "${bold}${red}error:${reset} $*" >&2; exit 1; }

prompt() {
  # prompt <var_name> <message> [default]
  local var="$1" msg="$2" default="${3:-}"
  if [[ -n "$default" ]]; then
    read -rp "${bold}${msg}${reset} [${default}]: " value
    value="${value:-$default}"
  else
    read -rp "${bold}${msg}${reset}: " value
    while [[ -z "$value" ]]; do
      echo "  This field is required."
      read -rp "${bold}${msg}${reset}: " value
    done
  fi
  printf -v "$var" '%s' "$value"
}

prompt_yn() {
  # prompt_yn <message> <default y|n> -> returns 0 for yes, 1 for no
  local msg="$1" default="$2" value
  local hint="y/N"
  [[ "$default" == "y" ]] && hint="Y/n"
  read -rp "${bold}${msg}${reset} [${hint}]: " value
  value="${value:-$default}"
  [[ "${value,,}" == "y" ]]
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# 1. Check dependencies
# ---------------------------------------------------------------------------

info "Checking dependencies"

if ! command -v node &>/dev/null; then
  die "Node.js is not installed. Install Node.js 22+ and re-run."
fi

node_major=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if (( node_major < 22 )); then
  die "Node.js 22+ is required (found $(node --version))."
fi

if ! command -v npm &>/dev/null; then
  die "npm is not found. Install Node.js 22+ and re-run."
fi

echo "  Node.js $(node --version) — ok"

# ---------------------------------------------------------------------------
# 2. Install npm dependencies
# ---------------------------------------------------------------------------

info "Installing npm dependencies"
cd "$SCRIPT_DIR"
npm install --prefer-offline 2>&1 | tail -3

# ---------------------------------------------------------------------------
# 3. Collect configuration
# ---------------------------------------------------------------------------

info "Configuration"
echo "  Required values (press Enter to accept defaults where shown)."
echo

CONFIG_FILE="$SCRIPT_DIR/config/config.yaml"

if [[ -f "$CONFIG_FILE" ]]; then
  if ! prompt_yn "  config/config.yaml already exists. Overwrite it?" "n"; then
    info "Keeping existing config. Skipping to build."
    SKIP_CONFIG=1
  fi
else
  cp "$SCRIPT_DIR/config/config.example.yaml" "$CONFIG_FILE"
fi

if [[ "${SKIP_CONFIG:-0}" != "1" ]]; then
  prompt BOT_TOKEN \
    "Telegram bot token (from @BotFather)"

  prompt ALLOWED_USER_IDS \
    "Allowed Telegram user ID(s), space-separated (e.g. 123456789)"

  prompt WORKSPACE_ROOT \
    "Workspace root directory" \
    "$HOME/.tdmclaw/workspace"

  prompt DATA_DIR \
    "Data directory (SQLite database)" \
    "$HOME/.tdmclaw/data"

  prompt MODEL_BASE_URL \
    "Ollama base URL" \
    "http://127.0.0.1:11434"

  prompt TIMEZONE \
    "Timezone (IANA, e.g. America/New_York)" \
    "UTC"

  # Build the allowedUserIds YAML list
  userid_yaml=""
  for uid in $ALLOWED_USER_IDS; do
    userid_yaml+=$'\n'"    - \"${uid}\""
  done

  info "Writing config/config.yaml"
  mkdir -p "$SCRIPT_DIR/config"
  cat > "$CONFIG_FILE" <<YAML
app:
  dataDir: ${DATA_DIR}
  logLevel: info
  timezone: ${TIMEZONE}

telegram:
  botToken: "${BOT_TOKEN}"
  allowedUserIds:${userid_yaml}
  polling:
    enabled: true
    timeoutSeconds: 30

workspace:
  root: ${WORKSPACE_ROOT}

models:
  provider: openai-compatible
  baseUrl: ${MODEL_BASE_URL}
  requestTimeoutSeconds: 600
  maxToolIterations: 4
  maxHistoryTurns: 6
  maxPromptTokensHint: 4000
  discovery:
    enabled: true
    pollIntervalSeconds: 60

tools:
  exec:
    enabled: true
    timeoutSeconds: 30
    maxOutputChars: 4096
    approvalMode: owner-only
    blockedCommands:
      - "rm -rf /"
      - mkfs
    blockedPatterns:
      - "sudo rm -rf"
      - "> /dev/"
  applyPatch:
    enabled: true

google:
  enabled: false
  scopes:
    gmailRead: true
    calendarRead: true
    calendarWrite: false

scheduler:
  enabled: true
  pollIntervalSeconds: 20
  catchUpWindowMinutes: 10
YAML

  echo "  Written to config/config.yaml"
  info "Creating workspace and data directories"
  mkdir -p "$WORKSPACE_ROOT" "$DATA_DIR"
  echo "  ${WORKSPACE_ROOT}"
  echo "  ${DATA_DIR}"
fi

# ---------------------------------------------------------------------------
# 4. Build
# ---------------------------------------------------------------------------

info "Building (tsc)"
npm run build
echo "  Build complete → dist/"

info "Linking tdmclaw command"
npm link
echo "  'tdmclaw' is now available as a global command."

# ---------------------------------------------------------------------------
# 5. Optional: systemd deployment
# ---------------------------------------------------------------------------

echo
if prompt_yn "Set up systemd service for deployment?" "n"; then
  if [[ $EUID -ne 0 ]]; then
    die "systemd setup requires root. Re-run with: sudo bash install.sh"
  fi

  prompt INSTALL_DIR \
    "Install directory" \
    "/opt/tdmclaw"

  prompt SERVICE_USER \
    "Service user (will be created if it doesn't exist)" \
    "tdmclaw"

  info "Creating service user '${SERVICE_USER}'"
  if ! id "$SERVICE_USER" &>/dev/null; then
    useradd -r -s /bin/false -d "$INSTALL_DIR" "$SERVICE_USER"
    echo "  User created."
  else
    echo "  User already exists."
  fi

  info "Installing application to ${INSTALL_DIR}"
  mkdir -p "$INSTALL_DIR"
  cp -r "$SCRIPT_DIR/dist" "$SCRIPT_DIR/node_modules" "$INSTALL_DIR/"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

  CONFIG_DEST="/etc/tdmclaw/config.yaml"
  ENV_DEST="/etc/tdmclaw/tdmclaw.env"
  info "Installing config to ${CONFIG_DEST}"
  mkdir -p /etc/tdmclaw
  cp "$CONFIG_FILE" "$CONFIG_DEST"
  # Replace the literal token with an env-ref so it does not live in the config file.
  sed -i "s|botToken: \"${BOT_TOKEN}\"|botToken: env:TDMCLAW_TELEGRAM_BOT_TOKEN|" "$CONFIG_DEST"
  chown root:"$SERVICE_USER" /etc/tdmclaw "$CONFIG_DEST"
  chmod 750 /etc/tdmclaw
  chmod 640 "$CONFIG_DEST"

  info "Writing environment file to ${ENV_DEST}"
  cat > "$ENV_DEST" <<ENV
TDMCLAW_TELEGRAM_BOT_TOKEN=${BOT_TOKEN}
TDMCLAW_CONFIG_PATH=${CONFIG_DEST}
NODE_ENV=production
ENV
  chown root:"$SERVICE_USER" "$ENV_DEST"
  chmod 640 "$ENV_DEST"

  info "Writing systemd unit file"
  cat > /etc/systemd/system/tdmclaw.service <<UNIT
[Unit]
Description=tdmClaw — self-hosted Telegram AI assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_DEST}
ExecStart=/usr/bin/node ${INSTALL_DIR}/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tdmclaw
MemoryMax=512M
CPUQuota=80%
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable --now tdmclaw
  echo
  info "Service installed and started."
  echo "  Status: sudo systemctl status tdmclaw"
  echo "  Logs:   sudo journalctl -u tdmclaw -f"
fi

# ---------------------------------------------------------------------------
# 6. Done
# ---------------------------------------------------------------------------

echo
info "Done."
echo
echo "  To start:            tdmclaw"
echo "  Development mode:    npm run dev"
echo "  Management CLI:      tdmclaw-cli --help"
echo
