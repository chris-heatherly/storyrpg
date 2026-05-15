# StoryRPG — Claude-Runnable Install & Generation Runbook

> **Purpose.** This file is written so an AI coding agent (Claude Code, Cursor Agent, etc.) or a human can execute it top-to-bottom to install StoryRPG and kick off a story generation job on a clean machine. Every step is an explicit command. Do not skip verification steps — they are how the agent confirms progress.
>
> **Audience.** Anyone (or any agent) bringing up StoryRPG from scratch on macOS, Linux, or WSL.
>
> **Deeper docs.** For background/design, see `AGENTS.md`, `docs/INSTALL.md`, `docs/TDD.md`, and `docs/GDD.md`. This file intentionally duplicates the executable subset of `docs/INSTALL.md` so an agent only needs this one entry point.

---

## 0) Agent Execution Rules

If you are an AI agent running this file, follow these rules:

1. **Always run commands from the paths specified.** Most commands run inside `storyrpg-prototype/`, not the workspace root.
2. **Never commit `.env`.** It contains API keys. If you touch it, do not stage it.
3. **Never overwrite an existing `.env`** without asking — the user's keys may already be there. Read it first; only append missing keys.
4. **Wait for long commands.** `npm install` can take 1–3 minutes. `npm run dev` is long-running; launch it in the background and poll for the "listening on port 3001" / Expo bundler lines.
5. **Stop and report** if a step fails twice. Do not invent credentials, fabricate API keys, or skip verification.
6. **Ports used:** `3001` (proxy), `8081` (Expo web). If either is in use, kill the offending process or pick a different port via `PORT=` before proceeding.

---

## 1) Prerequisites Check

Run these and confirm each succeeds before going further.

```bash
node --version     # must be v20.x or higher
npm --version      # must be 10.x or higher
git --version      # any recent version
```

If Node is missing or too old:

```bash
# macOS
brew install node@20

# Linux / WSL / macOS via nvm (preferred for dev)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# reload shell, then:
nvm install 20 && nvm use 20
```

Optional (only if the user asked for these features):

- **Docker** — only if running the proxy in a container (`docs/INSTALL.md` §7).
- **Playwright Chromium** — only if running Tier-2 browser QA or `npm run test:e2e`:
  ```bash
  cd storyrpg-prototype && npx playwright install chromium
  ```
- **Xcode / Android Studio** — only for native iOS/Android builds.

---

## 2) Get the Code

If you're already inside `StoryRPG_New/`, skip this step. Otherwise:

```bash
git clone <repo-url> StoryRPG_New
cd StoryRPG_New
```

The working tree should look like:

```
StoryRPG_New/
├── AGENTS.md
├── CLAUDE_INSTALL.md   ← this file
├── docs/
├── scripts/
└── storyrpg-prototype/ ← all app code lives here
```

---

## 3) Install Dependencies

```bash
cd storyrpg-prototype
npm install
```

Expected duration: **1–3 minutes**. A successful install ends with something like:

```
added N packages, and audited N packages in XXs
```

**If `npm install` fails, try in this order:**

```bash
npm install --legacy-peer-deps          # peer-dep conflicts
npm cache clean --force && rm -rf node_modules package-lock.json && npm install
npm install --ignore-scripts && npm rebuild sharp   # sharp native build issues on macOS
```

Verify the install:

```bash
node -e "require('expo'); require('react-native'); require('sharp'); console.log('deps ok')"
```

---

## 4) Configure `.env`

All commands in this section run from `storyrpg-prototype/`.

### 4a) Check for an existing `.env`

```bash
ls -la .env 2>/dev/null && echo "EXISTS" || echo "MISSING"
```

- If it **exists**, read it and only append keys that are missing. **Never** overwrite values that are already there.
- If it is **missing**, create it:

```bash
cat > .env <<'EOF'
# === REQUIRED FOR STORY (TEXT) GENERATION ===
ANTHROPIC_API_KEY=REPLACE_WITH_sk-ant-...

# === REQUIRED FOR IMAGE GENERATION (default: Gemini / "nano-banana") ===
EXPO_PUBLIC_GEMINI_API_KEY=REPLACE_WITH_AIza...
EXPO_PUBLIC_IMAGE_GENERATION_ENABLED=true
EXPO_PUBLIC_IMAGE_PROVIDER=nano-banana

# === OPTIONAL: Voice narration ===
# ELEVENLABS_API_KEY=

# === OPTIONAL: LLM model overrides ===
# EXPO_PUBLIC_LLM_PROVIDER=anthropic
# EXPO_PUBLIC_LLM_MODEL=claude-sonnet-4-6

# === OPTIONAL: Proxy / debug ===
# PORT=3001
# EXPO_PUBLIC_DEBUG=true
# EXPO_PUBLIC_VALIDATION_MODE=advisory
EOF
```

### 4b) Collect API keys

You **must** get real keys from the user (or from the user's secret store). Do not fabricate them.

| Variable | Required for | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Story text generation | https://console.anthropic.com/ → API Keys → Create Key (starts with `sk-ant-`) |
| `EXPO_PUBLIC_GEMINI_API_KEY` | Image generation (default) | https://aistudio.google.com/ → Get API Key (starts with `AIza`) |
| `ELEVENLABS_API_KEY` | Voice narration (optional) | https://elevenlabs.io/ → Profile → API Key |

Ask the user for any missing keys before continuing.

### 4c) Write the keys

Replace placeholders in `.env`. Example using `sed` on macOS (use `sed -i` without `''` on Linux):

```bash
# macOS
sed -i '' "s|REPLACE_WITH_sk-ant-.*|$ANTHROPIC_API_KEY|" .env
sed -i '' "s|REPLACE_WITH_AIza.*|$GEMINI_API_KEY|" .env

# Linux / WSL
sed -i "s|REPLACE_WITH_sk-ant-.*|$ANTHROPIC_API_KEY|" .env
sed -i "s|REPLACE_WITH_AIza.*|$GEMINI_API_KEY|" .env
```

Verify (without leaking the full secret):

```bash
awk -F= '/^ANTHROPIC_API_KEY=/ {print $1 "=" substr($2,1,10) "..."}' .env
awk -F= '/^EXPO_PUBLIC_GEMINI_API_KEY=/ {print $1 "=" substr($2,1,6) "..."}' .env
```

### 4d) Alternative image providers (only if the user asks)

- **Atlas Cloud:** set `EXPO_PUBLIC_IMAGE_PROVIDER=atlas-cloud` and `ATLAS_CLOUD_API_KEY=...`
- **MidAPI / Midjourney:** `EXPO_PUBLIC_IMAGE_PROVIDER=midapi` and `MIDAPI_TOKEN=...`
- **Stable Diffusion (self-hosted A1111/Forge):** see `docs/INSTALL.md` §4 and `docs/IMAGE_PIPELINE_RUNTIME.md`.
- **LoRA auto-training sidecar:** see `docs/LORA_TRAINING.md`. Off by default.

---

## 5) Sanity-Check the Install

From `storyrpg-prototype/`:

```bash
npm run typecheck   # TS across app/test/contracts/worker configs
npm test            # Vitest unit tests
```

Both should finish with zero errors. If the user wants speed, they can skip `typecheck` but it catches most integration mistakes early.

---

## 6) Start the App

### 6a) Recommended — start everything together

```bash
cd storyrpg-prototype
npm run dev
```

This kills stray `node` processes, boots the proxy on `:3001`, and the Expo web bundler on `:8081`. If you're an agent, launch it **in the background** and poll its output for these two markers before continuing:

- `Proxy server listening on port 3001`
- Expo bundler URL, typically `http://localhost:8081`

### 6b) Verify the proxy

```bash
curl -s http://localhost:3001/ | head -c 200
# Expect: {"status":"ok", ...}

# or:
npm run proxy:health
# Expect: Proxy healthy
```

### 6c) Verify the web app

Open `http://localhost:8081` in a browser. The StoryRPG home screen should show 4 built-in stories. If you're an agent without browser access, the presence of Expo's bundler banner + a healthy proxy is sufficient.

### 6d) Start components separately (only if `npm run dev` is undesirable)

```bash
# Terminal 1
cd storyrpg-prototype && npm run proxy

# Terminal 2
cd storyrpg-prototype && npm run web
```

---

## 7) Run a Generation Job

Generation requires at minimum `ANTHROPIC_API_KEY`. Images additionally require `EXPO_PUBLIC_GEMINI_API_KEY` (or another provider).

### 7a) Fastest path — CLI generation

These scripts write a finished story to `storyrpg-prototype/generated-stories/<storyId>/`.

```bash
cd storyrpg-prototype

# Pre-canned genres:
npm run generate:heist
npm run generate:fantasy

# Generic generator (reads STORY_TYPE or defaults):
npm run generate

# From a source document (text/PDF):
npm run generate:doc -- --input /absolute/path/to/source.txt

# From a template document:
npm run generate:template -- --input /absolute/path/to/template.txt
```

**Expected wall-clock time:** 15–60 minutes per episode depending on scene count, image provider latency, and LLM throughput. The job streams progress to stdout. Do not kill it unless you see a fatal error.

If you're an agent and need to run this non-blocking, background the process and poll `generated-stories/` for a new directory + the job's stdout for phase transitions (e.g. `StoryArchitect`, `SceneWriter`, `ImageAgentTeam`, `Validation`, `Saving`).

### 7b) UI path — generate from the app

1. Make sure `npm run dev` is running.
2. Open `http://localhost:8081`.
3. Click **Generator**.
4. Choose **From prompt** or **From document**.
5. Wait for the analysis phase (~1–2 min) and review the proposed season plan.
6. Click **Generate**. Progress, phase, and ETA appear in the UI.
7. When complete, the story shows up on the Home screen.

### 7c) Where output lands

```
storyrpg-prototype/
└── generated-stories/
    └── <storyId>/
        ├── story.json          # the compiled story payload
        ├── images/             # all generated illustrations
        ├── audio/              # optional TTS narration
        └── meta/               # checkpoints, memories, diagnostics
```

Transient runtime files live at:

- `storyrpg-prototype/.generation-jobs.json` — in-flight job state
- `storyrpg-prototype/.worker-checkpoints.json` — resumable phase checkpoints
- `storyrpg-prototype/pipeline-memories/` — per-agent memory

Clean these up (only when nothing is running):

```bash
cd storyrpg-prototype && npm run clean:runtime
```

### 7d) Optional — validate the generated assets

```bash
cd storyrpg-prototype
npm run validate:assets -- --story generated-stories/<storyId>
```

---

## 8) Troubleshooting (Runbook Style)

If a step fails, try the matching fix and then **retry the failed step exactly once**. If it still fails, stop and report.

| Symptom | Fix |
|---|---|
| `npm install` fails on `sharp` | `npm install --ignore-scripts && npm rebuild sharp` |
| `npm install` peer-dep conflicts | `npm install --legacy-peer-deps` |
| `EADDRINUSE` on `:3001` or `:8081` | `lsof -i :3001` (or `:8081`), then `kill -9 <PID>`. Or: `npm run dev` (it kills stragglers first). |
| `Proxy unreachable` in browser | Confirm `npm run proxy` is running; `curl http://localhost:3001/`. |
| `Cannot find module ...` | From `storyrpg-prototype/`, run `npm install` again; restart `npm run web`. |
| Stories don't appear in the app | Proxy must be running; refresh (Shift+R); check `storyrpg-prototype/generated-stories/`. |
| Generation hangs / errors | Look in the proxy terminal and `.generation-jobs.json`; verify `ANTHROPIC_API_KEY` has credits; retry — LLM timeouts are often transient. |
| Images 404 in the reader | Proxy must be up; `EXPO_PUBLIC_IMAGE_GENERATION_ENABLED=true`; Gemini key valid. |
| `AsyncStorage` quota warning | Self-healing; or clear site data in the browser DevTools → Application → Storage. |

More: `docs/INSTALL.md` §9 and `.cursor/skills/pipeline-debugging/SKILL.md`.

---

## 9) Quick Reference — npm Scripts

Run from `storyrpg-prototype/`:

| Script | What it does |
|---|---|
| `npm run dev` | Kill stray node procs, start proxy + Expo web together |
| `npm run proxy` | Start only the proxy on `:3001` |
| `npm run web` | Start only Expo web on `:8081` |
| `npm run proxy:health` | Ping the proxy; exits non-zero if unhealthy |
| `npm run typecheck` | TS check across app, test, contracts, worker configs |
| `npm test` | Vitest unit tests |
| `npm run validate` | `typecheck` + `lint` + `test` |
| `npm run generate` | CLI story generation (defaults) |
| `npm run generate:heist` | CLI heist story |
| `npm run generate:fantasy` | CLI fantasy story |
| `npm run generate:doc -- --input <file>` | Generate from a document |
| `npm run generate:template -- --input <file>` | Generate from a template |
| `npm run validate:assets` | Tier-1 asset HTTP verification over a story dir |
| `npm run test:e2e` | Playwright playthrough tests (requires proxy+web up + Chromium installed) |
| `npm run clean:runtime` | Delete transient runtime artifacts |
| `npm run proxy:compose:up` / `:down` / `:logs` | Docker proxy lifecycle |

---

## 10) Done

At the end of this runbook you should have:

- ✅ Node 20+, dependencies installed in `storyrpg-prototype/`
- ✅ `.env` populated with at least `ANTHROPIC_API_KEY` and `EXPO_PUBLIC_GEMINI_API_KEY`
- ✅ Proxy healthy on `:3001`, Expo web serving on `:8081`
- ✅ At least one built-in story visible at `http://localhost:8081`
- ✅ (If the user requested generation) a completed or in-progress story in `storyrpg-prototype/generated-stories/`

If any of these is missing, stop and report which step failed and the exact error output — do not continue improvising.
