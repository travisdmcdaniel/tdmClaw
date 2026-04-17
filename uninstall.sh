#!/usr/bin/env bash
# tdmClaw uninstaller
# Usage:
#   bash uninstall.sh            # local dev install (no root required)
#   sudo bash uninstall.sh       # systemd install
set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

bold=$'\e[1m'
reset=$'\e[0m'
green=$'\e[32m'
yellow=$'\e[33m'
red=$'\e[31m'

info()  { echo "${bold}${green}==>${reset} $*"; }
warn()  { echo "${bold}${yellow}warn:${reset} $*"; }
skip()  { echo "  skipped."; }

prompt_yn() {
  # prompt_yn <message> <default y|n> -> returns 0 for yes, 1 for no
  local msg="$1" default="$2" value
  local hint="y/N"
  [[ "$default" == "y" ]] && hint="Y/n"
  read -rp "${bold}${msg}${reset} [${hint}]: " value
  value="${value:-$default}"
  [[ "${value,,}" == "y" ]]
}

remove_dir() {
  # remove_dir <path> <description>
  local path="$1" desc="$2"
  if [[ -d "$path" ]]; then
    rm -rf "$path"
    echo "  Removed ${desc}: ${path}"
  else
    echo "  ${desc} not found — skipped."
  fi
}

remove_file() {
  local path="$1" desc="$2"
  if [[ -f "$path" ]]; then
    rm -f "$path"
    echo "  Removed ${desc}: ${path}"
  else
    echo "  ${desc} not found — skipped."
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_FILE="/etc/systemd/system/tdmclaw.service"

# ---------------------------------------------------------------------------
# 1. Detect installation
# ---------------------------------------------------------------------------

SYSTEMD_INSTALLED=0
INSTALL_DIR=""
SERVICE_USER=""
ENV_DEST=""
CONFIG_DEST=""
DATA_DIR=""
WORKSPACE_ROOT=""

if [[ -f "$UNIT_FILE" ]]; then
  SYSTEMD_INSTALLED=1
  # Extract paths from the unit file so custom install dirs are handled correctly.
  INSTALL_DIR=$(grep "^WorkingDirectory=" "$UNIT_FILE" 2>/dev/null | cut -d= -f2 || true)
  SERVICE_USER=$(grep "^User=" "$UNIT_FILE" 2>/dev/null | cut -d= -f2 || true)
  ENV_DEST=$(grep "^EnvironmentFile=" "$UNIT_FILE" 2>/dev/null | cut -d= -f2 || true)
fi

# Try to find the config file: prefer the systemd install location.
if [[ -n "$ENV_DEST" && -f "$ENV_DEST" ]]; then
  CONFIG_DEST=$(grep "^TDMCLAW_CONFIG_PATH=" "$ENV_DEST" 2>/dev/null | cut -d= -f2 || true)
fi
if [[ -z "$CONFIG_DEST" || ! -f "$CONFIG_DEST" ]]; then
  CONFIG_DEST=""
fi

# Fall back to the local dev config.
LOCAL_CONFIG="$SCRIPT_DIR/config/config.yaml"
ACTIVE_CONFIG="${CONFIG_DEST:-$LOCAL_CONFIG}"

# Parse data dir and workspace root from the config (best-effort YAML grep).
if [[ -f "$ACTIVE_CONFIG" ]]; then
  DATA_DIR=$(grep -E "^\s*dataDir:" "$ACTIVE_CONFIG" 2>/dev/null \
    | sed 's/.*dataDir:[[:space:]]*//' | tr -d '"' || true)
  WORKSPACE_ROOT=$(grep -E "^\s*root:" "$ACTIVE_CONFIG" 2>/dev/null \
    | head -1 | sed 's/.*root:[[:space:]]*//' | tr -d '"' || true)
fi

# Default fallbacks
DATA_DIR="${DATA_DIR:-$HOME/.tdmclaw/data}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/.tdmclaw/workspace}"

# ---------------------------------------------------------------------------
# 2. Show what will be removed
# ---------------------------------------------------------------------------

echo
echo "${bold}tdmClaw Uninstaller${reset}"
echo
echo "The following will be evaluated for removal:"
echo

if [[ $SYSTEMD_INSTALLED -eq 1 ]]; then
  echo "  systemd service  ${UNIT_FILE}"
  [[ -n "$ENV_DEST" ]]     && echo "  environment file ${ENV_DEST}"
  [[ -n "$CONFIG_DEST" ]]  && echo "  system config    ${CONFIG_DEST}"
  [[ -n "$INSTALL_DIR" ]]  && echo "  install dir      ${INSTALL_DIR}"
  [[ -n "$SERVICE_USER" ]] && echo "  service user     ${SERVICE_USER}"
fi

echo "  npm global links tdmclaw, tdmclaw-cli"
echo
echo "  ${bold}${yellow}Prompted separately (contain your data):${reset}"
echo "  data directory   ${DATA_DIR}"
echo "  workspace        ${WORKSPACE_ROOT}"
[[ -f "$LOCAL_CONFIG" ]] && echo "  local config     ${LOCAL_CONFIG}"
echo

if ! prompt_yn "Proceed with uninstall?" "n"; then
  echo "Aborted."
  exit 0
fi
echo

# ---------------------------------------------------------------------------
# 3. Stop and remove systemd service
# ---------------------------------------------------------------------------

if [[ $SYSTEMD_INSTALLED -eq 1 ]]; then
  if [[ $EUID -ne 0 ]]; then
    echo
    warn "A systemd install was detected but this script is not running as root."
    warn "Re-run with: sudo bash uninstall.sh"
    warn "Skipping system-level removal (service, install dir, service user)."
    echo
    SYSTEMD_INSTALLED=0
  fi
fi

if [[ $SYSTEMD_INSTALLED -eq 1 ]]; then
  info "Stopping and disabling systemd service"
  if systemctl is-active --quiet tdmclaw 2>/dev/null; then
    systemctl stop tdmclaw
    echo "  Service stopped."
  else
    echo "  Service was not running."
  fi

  if systemctl is-enabled --quiet tdmclaw 2>/dev/null; then
    systemctl disable tdmclaw
    echo "  Service disabled."
  fi

  remove_file "$UNIT_FILE" "unit file"
  systemctl daemon-reload
  echo "  systemd reloaded."

  info "Removing /etc/tdmclaw"
  remove_dir "/etc/tdmclaw" "config directory"

  info "Removing install directory"
  [[ -n "$INSTALL_DIR" ]] && remove_dir "$INSTALL_DIR" "install directory"

  info "Removing service user"
  if [[ -n "$SERVICE_USER" ]] && id "$SERVICE_USER" &>/dev/null; then
    userdel "$SERVICE_USER"
    echo "  Removed user '${SERVICE_USER}'."
  else
    echo "  Service user not found — skipped."
  fi
fi

# ---------------------------------------------------------------------------
# 4. Remove npm global links
# ---------------------------------------------------------------------------

info "Removing npm global links"
cd "$SCRIPT_DIR"
if npm ls --global --depth=0 tdmclaw &>/dev/null 2>&1; then
  npm unlink --global 2>/dev/null || npm unlink 2>/dev/null || true
  echo "  Global commands removed."
else
  # Attempt anyway — harmless if not linked.
  npm unlink 2>/dev/null || true
  echo "  Global links not found (or already removed)."
fi

# ---------------------------------------------------------------------------
# 5. Data directory (contains SQLite: session history, credentials, memories)
# ---------------------------------------------------------------------------

echo
warn "The data directory contains your SQLite database (session history,"
warn "OAuth credentials, memories, job run history). This cannot be recovered."
echo
if [[ -d "$DATA_DIR" ]]; then
  if prompt_yn "  Remove data directory (${DATA_DIR})?" "n"; then
    remove_dir "$DATA_DIR" "data directory"
  else
    skip
  fi
else
  echo "  Data directory not found — skipped."
fi

# ---------------------------------------------------------------------------
# 6. Workspace (user files managed by the assistant)
# ---------------------------------------------------------------------------

echo
warn "The workspace contains files the assistant created or modified on your behalf."
echo
if [[ -d "$WORKSPACE_ROOT" ]]; then
  if prompt_yn "  Remove workspace (${WORKSPACE_ROOT})?" "n"; then
    remove_dir "$WORKSPACE_ROOT" "workspace"
  else
    skip
  fi
else
  echo "  Workspace not found — skipped."
fi

# ---------------------------------------------------------------------------
# 7. Local config file
# ---------------------------------------------------------------------------

if [[ -f "$LOCAL_CONFIG" ]]; then
  echo
  if prompt_yn "  Remove local config (${LOCAL_CONFIG})?" "n"; then
    remove_file "$LOCAL_CONFIG" "local config"
  else
    skip
  fi
fi

# ---------------------------------------------------------------------------
# 8. Done
# ---------------------------------------------------------------------------

echo
info "Done."
echo
echo "  The source directory (${SCRIPT_DIR}) was not removed."
echo "  Delete it manually if you no longer need it."
echo
