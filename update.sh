#!/usr/bin/env bash
# tdmClaw updater
# Run from the source directory after pulling new changes.
#
# Usage:
#   bash update.sh             # local dev install (no root required)
#   sudo bash update.sh        # systemd install
set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

bold=$'\e[1m'
reset=$'\e[0m'
green=$'\e[32m'
yellow=$'\e[33m'
red=$'\e[31m'

info() { echo "${bold}${green}==>${reset} $*"; }
warn() { echo "${bold}${yellow}warn:${reset} $*"; }
die()  { echo "${bold}${red}error:${reset} $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_FILE="/etc/systemd/system/tdmclaw.service"

# ---------------------------------------------------------------------------
# 1. Check build tools
# ---------------------------------------------------------------------------

info "Checking Node.js version"
if ! command -v node &>/dev/null; then
  die "Node.js is not installed."
fi
node_major=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if (( node_major < 22 )); then
  die "Node.js 22+ is required (found $(node --version))."
fi
if (( node_major > 22 )); then
  die "Node.js $(node --version) is not supported. Node 24+ requires C++20 for
  native addon compilation and lacks prebuilt arm64 binaries for better-sqlite3.
  Please install Node.js 22 LTS:
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs"
fi
echo "  Node.js $(node --version) — ok"

info "Checking build tools"
if ! command -v make &>/dev/null || ! command -v gcc &>/dev/null; then
  if [[ $EUID -eq 0 ]] && command -v apt-get &>/dev/null; then
    warn "Build tools (make, gcc) not found. Installing build-essential..."
    apt-get install -y build-essential
    echo "  build-essential installed — ok"
  else
    die "Build tools are required to compile native dependencies but were not found.
  Run:  sudo apt-get install -y build-essential
  Then re-run this script."
  fi
else
  echo "  Build tools (make, gcc) — ok"
fi

# ---------------------------------------------------------------------------
# 2. Pull latest changes
# ---------------------------------------------------------------------------

info "Pulling latest changes"
cd "$SCRIPT_DIR"

if ! command -v git &>/dev/null; then
  die "git is not installed."
fi

if [[ ! -d ".git" ]]; then
  die "Not a git repository. Run this script from the tdmClaw source directory."
fi

git pull
echo

# ---------------------------------------------------------------------------
# 3. Install dependencies
# ---------------------------------------------------------------------------

info "Installing dependencies"
npm install --prefer-offline 2>&1 | tail -3

# ---------------------------------------------------------------------------
# 4. Build
# ---------------------------------------------------------------------------

info "Building (tsc)"
npm run build
echo "  Build complete → dist/"

# ---------------------------------------------------------------------------
# 5. Deploy: systemd or local
# ---------------------------------------------------------------------------

if [[ -f "$UNIT_FILE" ]]; then
  # --- Systemd install ---
  if [[ $EUID -ne 0 ]]; then
    die "A systemd install was detected. Re-run with root: sudo bash update.sh"
  fi

  # Read install directory from the unit file so custom paths are handled.
  INSTALL_DIR=$(grep "^WorkingDirectory=" "$UNIT_FILE" 2>/dev/null | cut -d= -f2 || true)
  if [[ -z "$INSTALL_DIR" ]]; then
    die "Could not read WorkingDirectory from ${UNIT_FILE}."
  fi

  info "Copying new build to ${INSTALL_DIR}"
  # Stop the service before replacing files to avoid serving a mixed state.
  systemctl stop tdmclaw
  echo "  Service stopped."

  cp -r "$SCRIPT_DIR/dist" "$INSTALL_DIR/"
  echo "  dist/ copied to ${INSTALL_DIR}."

  # Refresh node_modules in case dependencies changed.
  cp -r "$SCRIPT_DIR/node_modules" "$INSTALL_DIR/"
  echo "  node_modules/ copied to ${INSTALL_DIR}."

  systemctl start tdmclaw
  echo "  Service restarted."
  echo
  info "Update complete."
  echo "  Status: sudo systemctl status tdmclaw"
  echo "  Logs:   sudo journalctl -u tdmclaw -f"

else
  # --- Local dev install ---
  info "Refreshing global npm links"
  npm link
  echo "  'tdmclaw' and 'tdmclaw-cli' links updated."
  echo
  info "Update complete."
  echo "  Restart the service manually if it is running."
fi

echo
