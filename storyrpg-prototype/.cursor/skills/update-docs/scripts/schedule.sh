#!/usr/bin/env bash
# schedule.sh — Install / uninstall the 24-hour doc-update reminder on macOS.
# Usage:
#   bash schedule.sh install    # Start the 24-hr reminder
#   bash schedule.sh uninstall  # Stop and remove it
#   bash schedule.sh status     # Check if running

set -euo pipefail

LABEL="com.storyrpg.doc-update-reminder"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

case "${1:-status}" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents"
    cp "$PLIST_SRC" "$PLIST_DST"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
    echo "Installed. You'll get a macOS notification every 24 hours."
    echo "A fresh audit report will also be saved to:"
    echo "  $SCRIPT_DIR/last-audit.txt"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST_DST"
    echo "Uninstalled. No more reminders."
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" &>/dev/null; then
      echo "ACTIVE — Reminder is running."
    else
      echo "INACTIVE — Reminder is not installed."
      echo "Run: bash $0 install"
    fi
    ;;
  *)
    echo "Usage: bash $0 {install|uninstall|status}"
    exit 1
    ;;
esac
