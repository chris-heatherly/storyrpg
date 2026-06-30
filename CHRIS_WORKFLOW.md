# Chris — Git Workflow for `story_rpg`

## Roles

| Person | Role | Branches they push to |
|---|---|---|
| Wariya | Owns `main`. Reviews and merges PRs. | `main` |
| Ashish | One branch per task. | `feature/...`, `fix/...` |
| Chris | Works on `chris/work`. | `chris/work` |

## Rules

1. Do not push to `main`.
2. Work on `chris/work` (or another `chris/...` branch).
3. Do not merge your own PRs. Wariya merges.

## One-time setup

### 1. Update `scripts/auto-commit-push.sh`

Replace the final `git push origin main` with:

```bash
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" = "main" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') — Skipped: refusing to auto-push to main" >> "$LOG_FILE"
  exit 0
fi
git push origin "$CURRENT_BRANCH"
```

### 2. Create your working branch

```bash
cd /Users/chrisheatherly/StoryRPG_New
git checkout main
git pull
git checkout -b chris/work
git push -u origin chris/work
```

This branch is permanent. Reuse it for all your work.

## Daily workflow

1. Confirm you are on `chris/work`: `git status`.
2. Code. The auto-save script commits and pushes hourly.
3. When work is ready for review, open a Pull Request:
   - Go to https://github.com/sdeviants/story_rpg.
   - Click **Compare & pull request**.
   - Title: short summary of the change.
   - Description: what changed, what to test.
   - Click **Create pull request**.
4. Notify Wariya that the PR is open. Wariya assigns the reviewer and handles the merge.

## Keeping `chris/work` up to date

Whenever `main` is updated — your PR being merged, Ashish's PR being merged, or any other change Wariya pushes — pull those changes into `chris/work`:

```bash
git checkout chris/work
git fetch origin
git merge origin/main
git push
```

Do this:

- Before opening a new PR.
- After being told a PR was merged.
- Any time you have not synced for a few days.

Syncing keeps each PR self-contained: the next PR's diff will only contain work done after the most recent sync.

## Branch naming

- Default branch: `chris/work`.
- If Wariya asks for a separate branch for a specific task, format is `chris/<short-topic>`, lowercase, hyphens (e.g. `chris/voice-narration`).
- No spaces, no underscores, no capitals.

## Reference commands

```bash
git status            # current branch and changes
git log --oneline -5  # recent commits
git checkout <branch> # switch branches
git fetch             # pull down others' branches
```
