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

# When running under sudo the $HOME variable points to /root, not the invoking
# user's home directory. Resolve the real home from SUDO_USER if present.
if [[ -n "${SUDO_USER:-}" ]]; then
  REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
  REAL_HOME="$HOME"
fi

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

# Node 24+ requires C++20 when compiling native addons such as better-sqlite3.
# Prebuilt binaries for arm64 are also unavailable on cutting-edge Node releases.
# Node 22 is the current Active LTS and is strongly recommended.
if (( node_major > 22 )); then
  die "Node.js $(node --version) is not supported. Node 24+ requires C++20 for
  native addon compilation and lacks prebuilt arm64 binaries for better-sqlite3.
  Please install Node.js 22 LTS:
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs"
fi

if ! command -v npm &>/dev/null; then
  die "npm is not found. Install Node.js 22+ and re-run."
fi

echo "  Node.js $(node --version) — ok"

# better-sqlite3 is a native addon and must be compiled from source on arm64
# (no prebuilt binaries exist for recent Node versions). Fail early with a
# clear message rather than letting node-gyp fail mid-install.
if ! command -v make &>/dev/null || ! command -v gcc &>/dev/null; then
  if [[ $EUID -eq 0 ]] && command -v apt-get &>/dev/null; then
    warn "Build tools (make, gcc) not found. Installing build-essential..."
    apt-get install -y build-essential
    echo "  build-essential installed — ok"
  else
    die "Build tools are required to compile better-sqlite3 but were not found.
  Run:  sudo apt-get install -y build-essential
  Then re-run this installer."
  fi
else
  echo "  Build tools (make, gcc) — ok"
fi

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
fi

if [[ "${SKIP_CONFIG:-0}" != "1" ]]; then
  prompt BOT_TOKEN \
    "Telegram bot token (from @BotFather)"

  prompt ALLOWED_USER_IDS \
    "Allowed Telegram user ID(s), space-separated (e.g. 123456789)"

  prompt WORKSPACE_ROOT \
    "Workspace root directory" \
    "$REAL_HOME/.tdmclaw/workspace"

  prompt DATA_DIR \
    "Data directory (SQLite database)" \
    "$REAL_HOME/.tdmclaw/data"

  prompt MODEL_BASE_URL \
    "Ollama base URL" \
    "http://127.0.0.1:11434"

  prompt TIMEZONE \
    "Timezone (IANA, e.g. America/New_York)" \
    "UTC"

  # Start from the canonical example so every config key is present.
  # Then patch only the values that were prompted, leaving all other keys
  # and their defaults intact. This means new keys added to config.example.yaml
  # automatically appear in generated configs without changing this script.
  info "Writing config/config.yaml"
  mkdir -p "$SCRIPT_DIR/config"
  cp "$SCRIPT_DIR/config/config.example.yaml" "$CONFIG_FILE"

  # Single-line sed substitutions (values taken verbatim from example).
  sed -i "s|  dataDir: ./data|  dataDir: ${DATA_DIR}|" "$CONFIG_FILE"
  sed -i "s|  timezone: America/New_York|  timezone: ${TIMEZONE}|" "$CONFIG_FILE"
  sed -i "s|  botToken: env:TDMCLAW_TELEGRAM_BOT_TOKEN|  botToken: \"${BOT_TOKEN}\"|" "$CONFIG_FILE"
  sed -i "s|  baseUrl: http://127.0.0.1:11434|  baseUrl: ${MODEL_BASE_URL}|" "$CONFIG_FILE"
  sed -i "s|  root: /opt/tdmclaw/workspace|  root: ${WORKSPACE_ROOT}|" "$CONFIG_FILE"

  # allowedUserIds may be multiple values — build replacement lines and splice
  # them in via sed (no Python3 required).
  _userid_tmp=$(mktemp)
  for _uid in $ALLOWED_USER_IDS; do
    echo "    - \"${_uid}\"" >> "$_userid_tmp"
  done
  # Append the generated lines after the placeholder line, then delete placeholder.
  sed -i "/^    - \"123456789\"$/r $_userid_tmp" "$CONFIG_FILE"
  sed -i "/^    - \"123456789\"$/d" "$CONFIG_FILE"
  rm -f "$_userid_tmp"
  unset _userid_tmp _uid

  echo "  Written to config/config.yaml"
  info "Creating workspace and data directories"
  mkdir -p "$WORKSPACE_ROOT" "$DATA_DIR"
  # If running under sudo, give ownership to the real user.
  if [[ -n "${SUDO_USER:-}" ]]; then
    chown -R "$SUDO_USER:$SUDO_USER" "$WORKSPACE_ROOT" "$DATA_DIR"
  fi
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
