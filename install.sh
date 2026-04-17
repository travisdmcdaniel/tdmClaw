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
warn()    { echo "${bold}${yellow}warn:${reset} $*" >&2; }
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
# 3. Deployment type
# Ask upfront so path defaults can be set appropriately before prompting.
# ---------------------------------------------------------------------------

echo
DEPLOY_SYSTEMD=0
if prompt_yn "Set up systemd service for deployment?" "n"; then
  if [[ $EUID -ne 0 ]]; then
    die "systemd setup requires root. Re-run with: sudo bash install.sh"
  fi
  DEPLOY_SYSTEMD=1

  prompt INSTALL_DIR \
    "Install directory" \
    "/opt/tdmclaw"

  prompt SERVICE_USER \
    "Service user (will be created if it doesn't exist)" \
    "tdmclaw"

  DEFAULT_DATA_DIR="/var/lib/tdmclaw/data"
  DEFAULT_WORKSPACE_ROOT="/var/lib/tdmclaw/workspace"
else
  DEFAULT_DATA_DIR="$REAL_HOME/.tdmclaw/data"
  DEFAULT_WORKSPACE_ROOT="$REAL_HOME/.tdmclaw/workspace"
fi

# ---------------------------------------------------------------------------
# 4. Collect configuration
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
    "$DEFAULT_WORKSPACE_ROOT"

  prompt DATA_DIR \
    "Data directory (SQLite database)" \
    "$DEFAULT_DATA_DIR"

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
fi

# ---------------------------------------------------------------------------
# 5. Build
# ---------------------------------------------------------------------------

info "Building (tsc)"
npm run build
echo "  Build complete → dist/"

# ---------------------------------------------------------------------------
# 6. Deploy
# ---------------------------------------------------------------------------

if [[ "$DEPLOY_SYSTEMD" -eq 1 ]]; then
  # --- Systemd install ---

  # If the config step was skipped, BOT_TOKEN was never collected. Extract the
  # literal token value from the existing config file so the env file can be
  # written. If it's already an env-ref, BOT_TOKEN stays empty and we skip it.
  if [[ -z "${BOT_TOKEN:-}" ]]; then
    BOT_TOKEN=$(sed -n "s/.*botToken: \"\(.*\)\"/\1/p" "$CONFIG_FILE" || true)
  fi

  info "Creating service user '${SERVICE_USER}'"
  if ! id "$SERVICE_USER" &>/dev/null; then
    # Ensure the group exists first (may be left over from a previous install),
    # then create the user referencing that group to avoid a "group exists" error.
    getent group "$SERVICE_USER" &>/dev/null || groupadd -r "$SERVICE_USER"
    useradd -r -s /bin/false -d "$INSTALL_DIR" -g "$SERVICE_USER" "$SERVICE_USER"
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
  # Replace any literal token value with an env-ref so it does not live in the
  # config file. Safe to run even if already an env-ref (pattern won't match).
  sed -i 's|  botToken: ".*"|  botToken: env:TDMCLAW_TELEGRAM_BOT_TOKEN|' "$CONFIG_DEST"
  chown root:"$SERVICE_USER" /etc/tdmclaw "$CONFIG_DEST"
  chmod 750 /etc/tdmclaw
  chmod 640 "$CONFIG_DEST"

  info "Creating data and workspace directories"
  mkdir -p "$DATA_DIR" "$WORKSPACE_ROOT"
  # Set group ownership to the service user's group and enable the setgid bit so
  # files created by the service inherit the group. Then add the real user to that
  # group so they retain full read/write access without needing sudo.
  chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR" "$WORKSPACE_ROOT"
  chmod -R 2770 "$DATA_DIR" "$WORKSPACE_ROOT"
  if [[ -n "${SUDO_USER:-}" ]]; then
    usermod -aG "$SERVICE_USER" "$SUDO_USER"
    echo "  Added '${SUDO_USER}' to the '${SERVICE_USER}' group."
    warn "Log out and back in (or run: newgrp ${SERVICE_USER}) for group membership to take effect."
  fi
  echo "  ${DATA_DIR}"
  echo "  ${WORKSPACE_ROOT}"

  info "Writing environment file to ${ENV_DEST}"
  {
    if [[ -n "${BOT_TOKEN:-}" ]]; then
      echo "TDMCLAW_TELEGRAM_BOT_TOKEN=${BOT_TOKEN}"
    else
      warn "Bot token not written to env file (already an env-ref in config). Set TDMCLAW_TELEGRAM_BOT_TOKEN manually in ${ENV_DEST}."
    fi
    echo "TDMCLAW_CONFIG_PATH=${CONFIG_DEST}"
    echo "NODE_ENV=production"
  } > "$ENV_DEST"
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

else
  # --- Local dev install ---

  info "Linking tdmclaw command"
  npm link
  echo "  'tdmclaw' is now available as a global command."

  if [[ "${SKIP_CONFIG:-0}" != "1" ]]; then
    info "Creating workspace and data directories"
    mkdir -p "$WORKSPACE_ROOT" "$DATA_DIR"
    # If running under sudo, give ownership to the real user.
    if [[ -n "${SUDO_USER:-}" ]]; then
      chown -R "$SUDO_USER:$SUDO_USER" "$WORKSPACE_ROOT" "$DATA_DIR"
    fi
    echo "  ${WORKSPACE_ROOT}"
    echo "  ${DATA_DIR}"
  fi

fi

# ---------------------------------------------------------------------------
# 7. Done
# ---------------------------------------------------------------------------

echo
info "Done."
echo
if [[ "$DEPLOY_SYSTEMD" -eq 0 ]]; then
  echo "  To start:            tdmclaw"
  echo "  Development mode:    npm run dev"
fi
echo "  Management CLI:      tdmclaw-cli --help"
echo
