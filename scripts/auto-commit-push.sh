#!/bin/bash
# Auto-commit and push any changes to GitHub on a schedule.
# Skips if there are no changes or if a rebase/merge is in progress.

REPO_DIR="/Users/chrisheatherly/StoryRPG_New"
LOG_FILE="$REPO_DIR/scripts/.auto-commit.log"

cd "$REPO_DIR" || exit 1

if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — Skipped: rebase or merge in progress" >> "$LOG_FILE"
  exit 0
fi

git add -A

if git diff --cached --quiet; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — Skipped: no changes" >> "$LOG_FILE"
  exit 0
fi

TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
git commit -m "Auto-save: $TIMESTAMP"
git push origin main

echo "$(date '+%Y-%m-%d %H:%M:%S') — Committed and pushed" >> "$LOG_FILE"
