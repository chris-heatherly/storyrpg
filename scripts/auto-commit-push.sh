#!/bin/bash
# RETIRED 2026-05-28 (see docs/PROJECT_AUDIT_2026-05-28.md, landmine L2).
#
# This script previously ran `git add -A && git commit && git push origin main`
# on an hourly cron with NO validation. That is unsafe: it sweeps untracked
# runtime artifacts into commits, pushes broken/in-progress states straight to
# the shared `main` branch, and bypasses review and CI. It was the most likely
# source of the multi-megabyte runtime backups that ended up in git history.
#
# It is intentionally disabled. To stop it firing entirely, also remove the
# crontab entry that calls it:
#     crontab -l | grep -v auto-commit-push | crontab -
#
# If you want periodic local backups, use a dedicated WIP branch and gate on
# `npm run validate` — never a blind push to `main`. Do NOT re-enable this as-is.

echo "auto-commit-push.sh is retired (see docs/PROJECT_AUDIT_2026-05-28.md, L2). No action taken." >&2
exit 0
