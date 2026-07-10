# StoryRPG - Installation and Setup Guide

**Version:** 1.2
**Last Updated:** May 25, 2026
**Audience:** Anyone setting up StoryRPG on a new machine

For the current architecture map, read `docs/PROJECT_STATUS.md`. For the
reader/generator deployment split, read `docs/READER_GENERATOR_SPLIT.md`.

---

## 0) Agent Execution Rules

If you are an AI agent running this guide top-to-bottom, follow these rules:

1. **Always run commands from the paths specified.** Most commands run inside `storyrpg-prototype/`, not the workspace root.
2. **Never commit `.env`.** It contains API keys. If you touch it, do not stage it.
3. **Never overwrite an existing `.env`** without asking — the user's keys may already be there. Read it first; only append missing keys.
4. **Wait for long commands.** `npm install` can take 1–3 minutes. `npm run dev` is long-running; launch it in the background and poll for the "listening on port 3001" / Expo bundler lines.
5. **Stop and report** if a step fails twice. Do not invent credentials, fabricate API keys, or skip verification.
6. **Ports used:** `3001` (proxy), `8081` (Expo web). If either is in use, kill the offending process or pick a different port via `PORT=` before proceeding.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Quick Start (5-Minute Setup)](#2-quick-start-5-minute-setup)
3. [Detailed Installation Steps](#3-detailed-installation-steps)
4. [API Key Setup](#4-api-key-setup)
5. [Running the Application](#5-running-the-application)
6. [Generating Your First Story](#6-generating-your-first-story)
7. [Docker Setup (Alternative)](#7-docker-setup-alternative)
8. [Mobile Development Setup](#8-mobile-development-setup)
9. [Troubleshooting](#9-troubleshooting)
10. [Configuration Reference](#10-configuration-reference)
11. [Project Structure Overview](#11-project-structure-overview)

---

## 1) Prerequisites

### Required Software

| Software | Minimum Version | Purpose | Download |
|---|---|---|---|
| **Node.js** | 20.x or newer | JavaScript runtime | https://nodejs.org/ |
| **npm** | 10.x or newer | Package manager (comes with Node.js) | Included with Node.js |
| **Git** | Any recent version | Source code management | https://git-scm.com/ |

### Optional Software

| Software | Purpose | When Needed |
|---|---|---|
| **Docker** | Containerized proxy server | If you prefer Docker over running Node.js directly |
| **Xcode** | iOS development | Only for building native iOS app |
| **Android Studio** | Android development | Only for building native Android app |
| **Playwright Chromium** | Tier-2 browser playthrough QA | Install with `npx playwright install chromium` before `npm run test:e2e` or before running the in-pipeline browser QA phase |
| **Cloud SQL Auth Proxy** | Postgres auth/session development | Only if you are using the Postgres-backed auth path |
| **Mermaid Chart** | Text-based diagrams and flowcharts | Optional architecture/story-branching diagrams at https://mermaid.ai/ |

### Required API Keys

You need at least one API key to use the full application. The keys are obtained from external service providers:

| Service | Purpose | Required? | Cost | Sign Up |
|---|---|---|---|---|
| **Anthropic (Claude)** | Text generation (story content) | Yes, for generating stories | Pay-per-use (~$3-15 per story) | https://console.anthropic.com/ |
| **Google Gemini** | Image generation and optional Veo video | Recommended (default image provider) | Free tier available | https://aistudio.google.com/ |
| **OpenAI** | Optional LLM and GPT Image provider | Optional | Pay-per-use | https://platform.openai.com/ |
| **Atlas Cloud** | Alternative image generation | Optional | Pay-per-use | Provider account |
| **MidAPI** | Midjourney via API proxy | Optional | Pay-per-use | Provider account |
| **ElevenLabs** | Voice narration | Optional | Free tier available | https://elevenlabs.io/ |

**Note:** You can play the four built-in stories without any API keys. API keys are only needed for generating new stories.

### System Requirements

- **Operating System:** macOS, Windows 10+, or Linux
- **RAM:** 4GB minimum, 8GB recommended
- **Disk Space:** ~1GB for the application + ~100MB-1GB per generated story (images are the largest component)
- **Internet Connection:** Required for story generation (AI API calls). Not required for playing existing stories.

---

## 2) Quick Start (5-Minute Setup)

If you want to get running as fast as possible:

```bash
# 1. Clone or copy the project to your machine
cd /path/to/where/you/want/the/project

# 2. Navigate to the prototype directory
cd storyrpg-prototype

# 3. Install dependencies
npm install

# 4. Create the environment file
cp .env.example .env

# 5. Edit .env and add your local generation API keys
# Open .env in any text editor and fill in:
#   ANTHROPIC_API_KEY=your-anthropic-key-here
#   EXPO_PUBLIC_GEMINI_API_KEY=your-gemini-api-key-here  (current local Gemini image path)

# 6. Start proxy + public reader target
npm run dev
```

This starts both the proxy server (port 3001) and the Reader web app (port
8081). Open your browser to `http://localhost:8081`.

To use the Generator UI, start it in a second terminal:

```bash
cd storyrpg-prototype
npm run generator:web
```

Open `http://localhost:8082`.

---

## 3) Detailed Installation Steps

### Step 1: Install Node.js

**macOS (using Homebrew):**
```bash
brew install node@20
```

**macOS/Windows/Linux (using the installer):**
1. Go to https://nodejs.org/
2. Download the LTS (Long Term Support) version (20.x or newer)
3. Run the installer and follow the prompts
4. Verify installation:
```bash
node --version    # Should show v20.x.x or higher
npm --version     # Should show 10.x.x or higher
```

**Using nvm (Node Version Manager) — recommended for developers:**
```bash
# Install nvm (macOS/Linux)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install and use Node 20
nvm install 20
nvm use 20
```

### Step 2: Get the Project Files

If the project is in a Git repository:
```bash
git clone <repository-url> StoryRPG_fork
cd StoryRPG_fork
```

If you received the project as a zip file or folder:
```bash
# Unzip or copy the folder to your desired location
cd StoryRPG_fork
```

### Step 3: Install Dependencies

Navigate to the prototype directory and install all npm packages:

```bash
cd storyrpg-prototype
npm install
```

This will take 1-3 minutes depending on your internet speed. It downloads all required libraries listed in `package.json`.

**If you encounter errors:**
- Try `npm install --legacy-peer-deps` if there are peer dependency conflicts
- Make sure you're using Node.js 20+ (check with `node --version`)
- On macOS, if `sharp` fails to install, run: `npm install --ignore-scripts` then `npm rebuild sharp`

### Step 4: Create the .env File

The `.env` file contains your API keys and configuration. Create it in the `storyrpg-prototype` directory:

```bash
cp .env.example .env
```

Open `.env` in any text editor (VS Code, Notepad, nano, vim, etc.) and add the following:

```env
# === REQUIRED FOR IMAGE GENERATION (current local generator compatibility path) ===
EXPO_PUBLIC_GEMINI_API_KEY=your-gemini-api-key-here
EXPO_PUBLIC_IMAGE_GENERATION_ENABLED=true
EXPO_PUBLIC_IMAGE_PROVIDER=nano-banana

# === REQUIRED FOR STORY GENERATION ===
ANTHROPIC_API_KEY=your-anthropic-api-key-here

# === OPTIONAL: Alternate text/image provider ===
# OPENAI_API_KEY=your-openai-key-here
# EXPO_PUBLIC_OPENAI_IMAGE_MODEL=gpt-image-2

# === OPTIONAL: Voice Narration ===
# ELEVENLABS_API_KEY=your-elevenlabs-key-here

# === OPTIONAL: Analytics / Attribution ===
# EXPO_PUBLIC_ANALYTICS_ENABLED=true
# EXPO_PUBLIC_POSTHOG_KEY=phc_your_project_key
# EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
# EXPO_PUBLIC_LOG_LEVEL=info

# === OPTIONAL: Advanced Settings ===
# PORT=3001
# EXPO_PUBLIC_DEBUG=true
# EXPO_PUBLIC_VALIDATION_MODE=advisory
```

Replace the placeholder values with your actual API keys (see Section 4 for how to get them).

### Step 5: Verify the Setup

Run a quick check to make sure everything is ready:

```bash
# Check that the proxy server starts correctly
node proxy-server.js &
# You should see "Proxy running on http://localhost:3001"

# Check the health endpoint
curl http://localhost:3001/
# Should return {"status":"ok"}

# Kill the test server
kill %1
```

---

## 4) API Key Setup

### Anthropic (Claude) API Key — For Text Generation

This key is required to generate new stories. The AI uses Claude to write all narrative content.

1. Go to https://console.anthropic.com/
2. Create an account or sign in
3. Navigate to "API Keys" in the settings
4. Click "Create Key"
5. Copy the key (it starts with `sk-ant-`)
6. Add to your `.env` file:
   ```
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

**Cost estimate:** Generating one episode costs approximately $3-15 in API credits, depending on episode length and the number of scenes.

### Google Gemini API Key — For Image Generation

This key is used by the default image provider (`nano-banana` / Gemini) to
generate illustrations. It is also the fallback key for optional Veo video
generation.

1. Go to https://aistudio.google.com/
2. Sign in with your Google account
3. Click "Get API Key" or navigate to the API keys section
4. Click "Create API Key"
5. Copy the key
6. Add to your `.env` file:
   ```
   EXPO_PUBLIC_GEMINI_API_KEY=your-gemini-key-here
   ```

**Cost note:** Gemini has a generous free tier for image generation. For most users, the free tier is sufficient.

### OpenAI API Key — Optional Text and Image Provider

OpenAI can be used as an alternate LLM provider and as the GPT Image provider.

1. Go to https://platform.openai.com/
2. Create an API key
3. Add to your `.env` file:
   ```env
   OPENAI_API_KEY=sk-your-openai-key
   EXPO_PUBLIC_OPENAI_IMAGE_MODEL=gpt-image-2
   ```

The current generator UI and pipeline still include some
`EXPO_PUBLIC_OPENAI_*` compatibility fallbacks for local Expo builds, but
public Reader deployments should not include provider secrets.

### ElevenLabs API Key — For Voice Narration (Optional)

This key enables AI-voiced narration for stories.

1. Go to https://elevenlabs.io/
2. Create an account
3. Navigate to your profile/settings
4. Find your API key
5. Add to your `.env` file:
   ```
   ELEVENLABS_API_KEY=your-elevenlabs-key-here
   ```

**Cost note:** ElevenLabs has a limited free tier. Voice narration is entirely optional — stories are fully playable without it.

### Alternative Image Providers (Optional)

If you prefer a different image provider, you can use one of these instead of Gemini:

**Atlas Cloud:**
```env
EXPO_PUBLIC_IMAGE_PROVIDER=atlas-cloud
ATLAS_CLOUD_API_KEY=your-atlas-cloud-key-here
```

**MidAPI (Midjourney):**
```env
EXPO_PUBLIC_IMAGE_PROVIDER=midapi
MIDAPI_TOKEN=your-midapi-token-here
```

**Stable Diffusion (self-hosted AUTOMATIC1111 / Forge WebUI):**

StoryRPG talks to a Stable Diffusion WebUI via the proxy's `/sd-api/*` route; no third-party key is required unless your WebUI is fronted by one.

1. Install [AUTOMATIC1111 `stable-diffusion-webui`](https://github.com/AUTOMATIC1111/stable-diffusion-webui) or a compatible fork (Forge, reForge).
2. Launch it with the API enabled so StoryRPG can call it. Typical dev flags:
   - `./webui.sh --api --listen --port 7860 --cors-allow-origins=*`
3. (Recommended) Install the `sd-webui-controlnet` extension and place:
   - Depth, canny, or reference-only ControlNet models under `models/ControlNet/`
   - Any IP-Adapter (FaceID) models you want to use for character identity
   - Style / character LoRAs under `models/Lora/`
4. Confirm the WebUI responds with a model list: `curl http://localhost:7860/sdapi/v1/sd-models`.

Then add this to `storyrpg-prototype/.env`:

```env
EXPO_PUBLIC_IMAGE_PROVIDER=stable-diffusion
EXPO_PUBLIC_SD_ENABLED=true
STABLE_DIFFUSION_BASE_URL=http://localhost:7860
# Optional — only if you front the WebUI with an auth proxy:
# STABLE_DIFFUSION_API_KEY=your-token-here
# Optional — non-default backends throw until implemented (default: a1111):
# STABLE_DIFFUSION_BACKEND=a1111
# Optional — seed checkpoint passed on requests that don't override it:
# STABLE_DIFFUSION_DEFAULT_MODEL=sdxl-base-1.0
```

With `EXPO_PUBLIC_SD_ENABLED=true` the Generator screen exposes an `SD` segment and a parameters panel where you can override base URL, model, sampler, steps, CFG, and negative prompt per session. ControlNet models / IP-Adapter model names, per-character LoRA mappings, and style LoRAs are part of `StableDiffusionSettings` and can be edited via the UI or passed programmatically in `PipelineConfig.imageGen.stableDiffusion`. See `docs/IMAGE_PIPELINE_RUNTIME.md` (Provider Notes → `stable-diffusion`) for the full feature matrix.

### 4.c) Optional — Cognee Pipeline Memory Sidecar

StoryRPG can use [Cognee](https://github.com/topoteretes/cognee) as the
Generator-side long-term memory provider for pipeline lessons, validator
findings, generated-run diagnostics, and character reference history. Cognee
memory is advisory prompt context only; validators and typed artifacts remain
the source of truth.

1. Add Cognee settings to `storyrpg-prototype/.env`:

```env
# --- Cognee memory (Generator / worker only; never EXPO_PUBLIC_) ---
STORYRPG_MEMORY_PROVIDER=cognee
COGNEE_BASE_URL=http://localhost:8000
# Optional when the Cognee server requires auth:
# COGNEE_API_KEY=ck_...

COGNEE_PROJECT_DATASET=storyrpg-project
COGNEE_RUN_DATASET_PREFIX=storyrpg-run
COGNEE_VALIDATOR_DATASET=storyrpg-validator-history

# Cognee needs an LLM key for graph extraction.
LLM_API_KEY=your-openai-compatible-key
```

2. Start the sidecar:

```bash
cd storyrpg-prototype
docker compose -f docker-compose.cognee.yml up -d
npm run memory:health
npm run memory:doctor
```

3. Seed memory:

```bash
npm run memory:index-project
npm run memory:index-run -- --storyId your-generated-story-folder
npm run memory:ask -- "What validator failures have repeated recently?"
```

`memory:index-project` creates a content-hashed project dataset and atomically
activates it through `pipeline-memories/cognee-project-dataset.json`. Workers
read that manifest at startup, so re-indexing replaces the active project
knowledge instead of mixing stale documentation into future recall.

If Cognee is unavailable, the pipeline fails open and falls back to the local
`pipeline-memories/` file provider when configured. Cognee env vars are
server/generator-side only and must not be prefixed with `EXPO_PUBLIC_`.

`memory:doctor` checks authenticated search as well as the unauthenticated
health endpoint. This is the operational readiness check to use before a
generation run. StoryRPG bounds concurrent Cognee recalls and defers graph
extraction until QA by default; set `STORYRPG_MEMORY_COGNIFY_ON_WRITE=1` only
for deliberate low-volume maintenance work.

Proxy-spawned generation workers also enqueue Cognee writes through a
proxy-owned durable outbox. The outbox drains and cognifies only after active
story workers are idle, so a busy Cognee writer cannot block scene generation.

### 4.d) Optional — LoRA Auto-Training Sidecar

Stable Diffusion is the only provider that can consume LoRAs, so the
pipeline ships an **auto-train LoRA** subsystem that produces
per-character and per-episode style LoRAs on the fly. The subsystem is
off by default; enabling it requires a LoRA training sidecar
(`kohya_ss` today) reachable from the proxy.

1. Stand up a `kohya_ss` (or compatible) HTTP sidecar that implements
   the contract in `docs/LORA_TRAINING.md`.
2. Add this to `storyrpg-prototype/.env`:

```env
# --- LoRA auto-training (Stable Diffusion only) ---
# Master switch for the Generator UI + worker:
EXPO_PUBLIC_LORA_AUTO_TRAIN=true
# Also read by the CLI/worker entry point:
LORA_AUTO_TRAIN=true

# Trainer backend. Only "kohya" is wired today; other enum values are reserved
# for future adapters.
LORA_TRAINER_BACKEND=kohya
EXPO_PUBLIC_LORA_TRAINER_BACKEND=kohya

# Sidecar URL (proxied through /lora-training/*):
LORA_TRAINER_BASE_URL=http://localhost:7861
EXPO_PUBLIC_LORA_TRAINER_BASE_URL=http://localhost:7861

# Optional bearer token or custom auth header:
# LORA_TRAINER_API_KEY=your-token-here
# LORA_TRAINER_AUTH_HEADER=X-Api-Key

# Override the per-request timeout (default 10 minutes, artifact
# downloads use 15 minutes):
# LORA_TRAINER_TIMEOUT_MS=600000
```

3. Trained artifacts and the fingerprint registry are cached under
   `generated-stories/<storyId>/loras/`. Re-running generation with
   unchanged character / style inputs hits the cache and does not
   re-train.

See `docs/LORA_TRAINING.md` for the full sidecar contract, the
eligibility heuristics, and the Generator UI exposure.

---

## 5) Running the Application

### Option A: Start Everything Together (Recommended)

```bash
cd storyrpg-prototype
npm run dev
```

This command:
1. Kills any existing Node.js processes (to avoid port conflicts)
2. Starts the proxy server on port 3001
3. Starts the Reader Expo web development server on port 8081

Open your browser to **http://localhost:8081** to use the Reader app.

The Generator app is separate:

```bash
cd storyrpg-prototype
npm run generator:web
```

Open **http://localhost:8082** for generation controls.

### Option B: Start Components Separately

If you need more control, start each component in its own terminal:

**Terminal 1 — Proxy Server:**
```bash
cd storyrpg-prototype
npm run proxy
```
You should see: `Proxy running on http://localhost:3001`

**Terminal 2 — Web App:**
```bash
cd storyrpg-prototype
npm run reader:web
```
The Expo dev server will start and show a QR code and URL. Open the URL in your browser (usually `http://localhost:8081`).

`npm run web` is a reader alias. Use `npm run generator:web` for the
Generator target.

### What You Should See

1. **Proxy server terminal:** Shows `Proxy running on http://localhost:3001` and occasional request logs.
2. **Reader terminal:** Shows the Expo bundler output for port 8081.
3. **Reader browser:** The StoryRPG home screen with a list of available stories.
4. **Generator browser, if started:** The generation workflow on port 8082.

### Playing a Built-In Story

1. Click on any story in the home screen (e.g., "The Velvet Job")
2. Select an episode
3. The reading experience begins — tap/click to advance through beats
4. Make choices when they appear
5. Use the pause button (top-left) to access the menu

---

## 6) Generating Your First Story

Story generation requires the Anthropic API key. Image generation requires the Gemini API key (or another image provider key).

### From the App UI

1. Start the Generator target with `npm run generator:web`
2. Open `http://localhost:8082`
3. Choose your input method:
   - **From prompt:** Enter a genre and brief description
   - **From document:** Upload a text file or PDF as source material
4. Wait for the analysis phase (1-2 minutes)
5. Review the season plan — the AI will suggest episodes with outlines
6. Customize if desired (change episode count, review outlines)
7. Complete style setup if you want preapproved style-bible anchors
8. Click **Generate** to start content creation
9. Monitor progress — the UI shows phase-by-phase progress with estimated time remaining
10. When complete, the story appears in the generated story catalog and can be played by the Reader

**Expected generation time:** 15-60 minutes per episode, depending on:
- Number of scenes (5-8 per episode)
- Image generation (3-15 seconds per image)
- Audio generation (2-5 seconds per beat, if enabled)
- LLM response time (varies by load)

### From the Command Line (Alternative)

For quick generation without the UI:

```bash
cd storyrpg-prototype

# Generate a heist story
npm run generate:heist

# Generate a fantasy story
npm run generate:fantasy

# Generate from a document
npm run generate:doc -- --input /path/to/your/document.txt

# Generate using a template file
npm run generate:template -- --input /path/to/your/template.txt
```

Generated stories appear in the `generated-stories/` directory. Modern runs
write `story.json` and `manifest.json`. They show up in the Reader catalog on
refresh when the proxy is running.

---

## 7) Docker Setup (Alternative)

If you prefer running the proxy server in Docker:

### Prerequisites

- Docker and Docker Compose installed (https://docs.docker.com/get-docker/)

### Setup

```bash
cd storyrpg-prototype

# Make sure your .env file is configured (see Section 4)

# Start the proxy server in Docker
npm run proxy:compose:up

# Check that it's running
npm run proxy:health

# View logs
npm run proxy:compose:logs

# Start the Reader app (still runs locally)
npm run reader:web
```

### Docker Details

The `docker-compose.proxy.yml` configuration:
- Uses `node:20-bookworm-slim` as the base image
- Mounts the entire project directory into the container
- Exposes port 3001
- Reads environment variables from `.env`

### Stopping Docker

```bash
npm run proxy:compose:down
```

---

## 8) Mobile Development Setup

### iOS Development (macOS only)

1. Install Xcode from the Mac App Store
2. Install Xcode Command Line Tools: `xcode-select --install`
3. Install CocoaPods: `sudo gem install cocoapods`
4. Run the app:
   ```bash
   cd storyrpg-prototype
   npm run ios
   ```

### Android Development

1. Install Android Studio from https://developer.android.com/studio
2. Set up an Android emulator through Android Studio's AVD Manager
3. Set the ANDROID_HOME environment variable:
   ```bash
   # macOS/Linux — add to your shell profile (.zshrc, .bashrc, etc.)
   export ANDROID_HOME=$HOME/Android/Sdk
   export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools
   ```
4. Run the app:
   ```bash
   cd storyrpg-prototype
   npm run android
   ```

### Important Note for Mobile

The proxy server must be running and accessible from the mobile device. If testing on a physical device (not emulator), you may need to:

1. Find your computer's local IP address:
   ```bash
   # macOS
   ipconfig getifaddr en0
   # Linux
   hostname -I
   # Windows
   ipconfig
   ```
2. Update the app to point to your computer's IP instead of `localhost`
3. Ensure your firewall allows connections on port 3001

---

## 9) Troubleshooting

### "Proxy unreachable" or "Network request failed"

**Problem:** The web app cannot connect to the proxy server.

**Solutions:**
1. Make sure the proxy is running: `npm run proxy` (or check Docker status)
2. Check port 3001 is not in use: `lsof -i :3001` (macOS/Linux) or `netstat -ano | findstr :3001` (Windows)
3. Kill any existing processes on port 3001 and restart
4. Check proxy health: `curl http://localhost:3001/`

### "npm install" fails with errors

**Problem:** Dependencies fail to install.

**Solutions:**
1. Make sure you're using Node.js 20+: `node --version`
2. Clear the npm cache: `npm cache clean --force`
3. Delete node_modules and try again: `rm -rf node_modules && npm install`
4. If `sharp` fails: `npm install --ignore-scripts && npm rebuild sharp`
5. Try with legacy peer deps: `npm install --legacy-peer-deps`

### "Cannot find module" errors at runtime

**Problem:** The app crashes with missing module errors.

**Solutions:**
1. Re-run `npm install` to ensure all dependencies are present
2. Check that you're running commands from the `storyrpg-prototype` directory
3. Restart the Expo dev server: stop it (Ctrl+C) and run `npm run reader:web` or `npm run generator:web` again

### Stories don't appear in the app

**Problem:** Generated stories or built-in stories don't show up.

**Solutions:**
1. Make sure the proxy server is running if you expect generated stories from `generated-stories/`
2. Check that `generated-stories/` directory exists in `storyrpg-prototype/`
3. Refresh the app (pull-to-refresh or press Shift+R in browser)
4. Check browser console for errors (F12 → Console tab)

### Generation fails or hangs

**Problem:** Story generation starts but never completes.

**Solutions:**
1. Check the proxy server terminal for error messages
2. Verify your Anthropic API key is correct and has available credits
3. Check your internet connection
4. Look at the generation job status in the Generator screen for specific error messages
5. Try again — API timeouts are sometimes transient

### Images don't load

**Problem:** Story plays but images show as broken.

**Solutions:**
1. Verify the proxy server is running (images are served through it)
2. Check that the `generated-stories/*/images/` directory contains image files
3. Check browser console for 404 errors
4. Make sure `EXPO_PUBLIC_IMAGE_GENERATION_ENABLED=true` in `.env`
5. Verify your Gemini API key is valid

### Port conflicts

**Problem:** "EADDRINUSE" error — the port is already in use.

**Solutions:**
```bash
# Find what's using the port
lsof -i :3001    # macOS/Linux
lsof -i :8081    # for the Expo port

# Kill the process
kill -9 <PID>

# Or use the dev script which kills existing processes first
npm run dev
```

### AsyncStorage quota errors

**Problem:** The app logs storage quota warnings.

**Solutions:**
1. This is usually self-healing — the stores automatically prune old data
2. Clear app data in browser: Developer Tools → Application → Storage → Clear site data
3. Delete old generated stories you no longer need

---

## 10) Configuration Reference

### .env File — Complete Reference

```env
# ===================================================================
# CORE API KEYS
# ===================================================================

# Anthropic Claude - Required for story text generation
ANTHROPIC_API_KEY=sk-ant-...

# Google Gemini - Default image generation provider
EXPO_PUBLIC_GEMINI_API_KEY=AIza...

# ===================================================================
# IMAGE GENERATION
# ===================================================================

# Enable/disable image generation (true/false)
EXPO_PUBLIC_IMAGE_GENERATION_ENABLED=true

# Image provider: 'nano-banana' (Gemini), 'atlas-cloud', 'midapi', 'stable-diffusion'
EXPO_PUBLIC_IMAGE_PROVIDER=nano-banana

# Gemini model for images
EXPO_PUBLIC_GEMINI_MODEL=gemini-2.5-flash-image

# Atlas Cloud (alternative provider)
# ATLAS_CLOUD_API_KEY=...
# ATLAS_CLOUD_MODEL=...

# MidAPI/Midjourney (alternative provider)
# MIDAPI_TOKEN=...

# Stable Diffusion (self-hosted AUTOMATIC1111 / Forge WebUI)
# EXPO_PUBLIC_SD_ENABLED=true                # show the SD option + settings panel in the Generator UI
# STABLE_DIFFUSION_BASE_URL=http://localhost:7860
# STABLE_DIFFUSION_API_KEY=                  # optional bearer token; sent as x-stable-diffusion-token
# STABLE_DIFFUSION_BACKEND=a1111             # only 'a1111' is currently implemented
# STABLE_DIFFUSION_DEFAULT_MODEL=sdxl-base-1.0

# LoRA auto-training (Stable Diffusion only) — off by default.
# See docs/LORA_TRAINING.md for the kohya sidecar contract.
# EXPO_PUBLIC_LORA_AUTO_TRAIN=false          # master switch in the Generator UI
# LORA_AUTO_TRAIN=false                      # same, for CLI/worker entry points
# LORA_TRAINER_BACKEND=disabled              # disabled | kohya | a1111-dreambooth | comfy-training | replicate | fal
# EXPO_PUBLIC_LORA_TRAINER_BACKEND=disabled
# LORA_TRAINER_BASE_URL=http://localhost:7861
# EXPO_PUBLIC_LORA_TRAINER_BASE_URL=http://localhost:7861
# LORA_TRAINER_API_KEY=                      # optional bearer token
# LORA_TRAINER_AUTH_HEADER=                  # override header name (defaults to Authorization)
# LORA_TRAINER_TIMEOUT_MS=600000             # default 10 min; artifact downloads use 15 min

# ===================================================================
# AUDIO / NARRATION (Optional)
# ===================================================================

# ElevenLabs text-to-speech
# ELEVENLABS_API_KEY=...

# ===================================================================
# ANALYTICS / ATTRIBUTION (Optional)
# ===================================================================

# Product analytics and campaign attribution (web only in v1).
# When disabled or missing a PostHog key, analytics calls no-op.
# EXPO_PUBLIC_ANALYTICS_ENABLED=true
# EXPO_PUBLIC_POSTHOG_KEY=phc_...
# EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
# EXPO_PUBLIC_ANALYTICS_DEBUG=false

# ===================================================================
# SERVER CONFIGURATION
# ===================================================================

# Proxy server port (default: 3001)
# PORT=3001

# Public URL for webhook callbacks (e.g., ngrok URL for MidAPI)
# PROXY_PUBLIC_URL=https://your-ngrok-url.ngrok.io

# ===================================================================
# PROXY OAUTH (Optional — Google / Discord via Passport)
# ===================================================================
# Set on the machine running proxy-server.js (not EXPO_PUBLIC_ unless you mirror).
#
# GOOGLE_CLIENT_ID=...
# GOOGLE_CLIENT_SECRET=...
# DISCORD_CLIENT_ID=...
# DISCORD_CLIENT_SECRET=...
#
# Public origin of the proxy for callback URLs (no trailing slash)
# AUTH_BASE_URL=http://localhost:3001
#
# Optional explicit callback URLs (default: AUTH_BASE_URL + /auth/.../callback)
# GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback
# DISCORD_CALLBACK_URL=http://localhost:3001/auth/discord/callback
#
# Where the browser returns after successful OAuth (Expo web). Default proxy value
# includes ?afterAuth=home so the SPA clears the query and stays on the library.
# AUTH_SUCCESS_REDIRECT=http://localhost:8081/?afterAuth=home
# AUTH_FAILURE_REDIRECT=http://localhost:8081/?auth=error
#
# Session signing (use 16+ random chars in production)
# SESSION_SECRET=your-long-random-secret
#
# Production HTTPS: trust reverse proxy (Cloud Run / load balancer)
# TRUST_PROXY=1
# NODE_ENV=production
# SESSION_COOKIE_SECURE=1
# If web app and API are on different sites, you may need:
# SESSION_COOKIE_SAMESITE=none

# ===================================================================
# AUTH DATABASE (Optional)
# ===================================================================
# DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5433/story_rpg_db
# CLOUD_SQL_INSTANCE=project:region:instance
# CLOUD_SQL_PORT=5433

# ===================================================================
# PUBLIC READER CONTENT / STORAGE (Optional)
# ===================================================================
# Reader can load exported public story packages through a Blob manifest.
# EXPO_PUBLIC_BLOB_MANIFEST_URL=https://...
#
# Upload scripts:
# BLOB_READ_WRITE_TOKEN=...
# GCS_BUCKET_NAME=...
# GCS_STORIES_PREFIX=stories
# GCS_UPLOAD_CONCURRENCY=4
# GCS_UPLOAD_RETRIES=3
#
# Proxy-side generated story serving can redirect to GCS:
# STORY_STORAGE_MODE=gcs

# ===================================================================
# APP TARGETS / LINKS
# ===================================================================
# STORYRPG_APP_TARGET=reader          # reader | generator, usually set by npm scripts
# EXPO_PUBLIC_READER_APP_URL=http://localhost:8081
# EXPO_PUBLIC_GENERATOR_APP_URL=http://localhost:8082
# EXPO_PUBLIC_ENABLE_INTERNAL_APP_LINKS=false

# ===================================================================
# LLM CONFIGURATION
# ===================================================================

# LLM provider: 'anthropic', 'openai', 'gemini'
# EXPO_PUBLIC_LLM_PROVIDER=anthropic

# LLM model name
# EXPO_PUBLIC_LLM_MODEL=claude-sonnet-4-6

# ===================================================================
# DEVELOPMENT / DEBUG
# ===================================================================

# Enable debug logging
# EXPO_PUBLIC_DEBUG=true
# EXPO_PUBLIC_LOG_LEVEL=info

# Enable image generation debug logging
# EXPO_PUBLIC_DEBUG_IMAGE_GENERATION=true

# Validation mode: 'strict', 'advisory', 'disabled'
# EXPO_PUBLIC_VALIDATION_MODE=advisory

# ===================================================================
# PLAYWRIGHT / END-TO-END QA
# ===================================================================
# These variables are consumed by test/e2e/storyPlaythrough.spec.ts and
# by the in-pipeline Tier-2 browser QA runner. Defaults are usually fine.

# E2E_BASE_URL=http://localhost:8081     # App URL Playwright targets
# E2E_STORY="Story Title"                 # Story title substring to select
# E2E_MAX_BEATS=100                       # Max beats to play through per scene
# E2E_ENCOUNTER_TIER=success              # Force tier: success | complicated | failure
# E2E_CHOICE_PATH=[0,1,0]                 # JSON array of 0-based choice indices
# E2E_RESULT_FILE=latest.json             # Output filename for results JSON
```

### npm Scripts Reference

| Script | What It Does |
|---|---|
| `npm run dev` | Start proxy + Reader web together (kills existing node processes) |
| `npm run proxy` | Start only the proxy server |
| `npm run proxy:health` | Check proxy server health |
| `npm run web` | Start the Reader Expo web dev server on port 8081 |
| `npm run reader:web` | Start the Reader target on port 8081 |
| `npm run generator:web` | Start the Generator target on port 8082 |
| `npm run reader:export` | Export public Reader web build to `dist-reader` |
| `npm run reader:export:with-content` | Export Reader and copy reader-safe generated content |
| `npm run generator:export:internal` | Export internal Generator build |
| `npm run reader:typecheck` | Typecheck the Reader target |
| `npm run generator:typecheck` | Typecheck the Generator target |
| `npm run check:reader-boundary` | Enforce that Reader cannot import generator-only modules/secrets |
| `npm run validate:reader` | Reader typecheck + boundary check + focused reader tests |
| `npm start` | Start Expo with platform selection menu |
| `npm run ios` | Start Expo for iOS |
| `npm run android` | Start Expo for Android |
| `npm run generate` | Generate a story from CLI |
| `npm run generate:heist` | Generate a heist-genre story |
| `npm run generate:fantasy` | Generate a fantasy-genre story |
| `npm run generate:doc` | Generate from a document file |
| `npm run generate:template` | Generate using a template file |
| `npm run memory:index-project` | Index StoryRPG docs/contracts into Cognee |
| `npm run memory:index-run` | Index a generated story run into Cognee (`-- --storyId <folder>` optional) |
| `npm run memory:ask` | Query Cognee project/validator memory (`-- "question"`) |
| `npm run memory:health` | Check Cognee sidecar health |
| `npm run memory:doctor` | Check Cognee health plus authenticated project-memory search |
| `npm run proxy:compose:up` | Start proxy in Docker |
| `npm run proxy:compose:down` | Stop Docker proxy |
| `npm run proxy:compose:logs` | View Docker proxy logs |
| `npm test` | Run Vitest unit tests |
| `npm run typecheck` | Run TypeScript type checking across app, tests, contracts, and worker configs |
| `npm run lint` | Run ESLint over `src/**/*.{ts,tsx}` |
| `npm run validate` | Run typecheck, lint, and tests |
| `npm run test:e2e` | Run Playwright E2E playthrough tests (proxy + web must be running) |
| `npm run test:e2e:story` | Run E2E tests filtered by title, e.g. `npm run test:e2e:story -- "Blade Runner"` |
| `npm run validate:assets` | Standalone Tier-1 asset HTTP verification over a generated story directory |
| `npm run clean:runtime` | Clean up runtime artifacts |
| `npm run content:reader:export` | Copy reader-safe generated content into `public/reader-content` or `READER_CONTENT_OUTPUT_DIR` |
| `npm run db:proxy` | Start Cloud SQL Auth Proxy helper |
| `npm run db:migrate` | Apply auth database migrations |
| `npm run db:verify` | Verify `DATABASE_URL` connectivity |
| `npm run upload:gcs:latest` | Upload the latest generated story package to GCS |
| `npm run upload:gcs:all` | Upload all generated story packages to GCS |

---

## 11) Project Structure Overview

For new developers or anyone needing to understand where things are:

```
storyrpg-prototype/               ← The application root
├── .env                          ← Your API keys (DO NOT share or commit)
├── package.json                  ← Dependencies and scripts
├── proxy-server.js               ← The backend server
├── App.tsx                       ← Legacy monolithic app shell
├── apps/
│   ├── reader/ReaderApp.tsx      ← Public Reader app entry
│   └── generator/GeneratorApp.tsx ← Internal Generator app entry
├── proxy/                        ← Modular Express route handlers
│
├── src/
│   ├── screens/                  ← The app's pages/views
│   │   ├── HomeScreen.tsx        ← Main story catalog
│   │   ├── GeneratorScreen.tsx   ← Story generation interface
│   │   ├── ReadingScreen.tsx     ← Story reading/playing interface
│   │   ├── EpisodeSelectScreen.tsx
│   │   ├── SettingsScreen.tsx
│   │   └── VisualizerScreen.tsx
│   │   ├── reader/               ← Reader-only settings screen
│   │   └── generator/            ← Generator step components and hooks
│   │
│   ├── components/               ← Reusable UI pieces
│   ├── engine/                   ← Story playback logic
│   │   ├── storyEngine.ts        ← Core story processing
│   │   ├── conditionEvaluator.ts ← Choice/branch logic
│   │   └── templateProcessor.ts  ← Dynamic content processing
│   │
│   ├── stores/                   ← Data management
│   │   ├── gameStore.ts          ← Player state management (React Context)
│   │   ├── generationJobStore.ts ← Generation progress tracking
│   │   ├── seasonPlanStore.ts    ← Season planning interface state
│   │   └── settingsStore.ts      ← User preferences
│   │
│   ├── types/                    ← Data structure definitions
│   │   └── index.ts              ← Barrel re-export of topic modules
│   │
│   ├── story-codec/              ← Reader/package story codec and asset index
│   ├── assets/                   ← AssetRef helpers and runtime URL resolver
│   │
│   ├── ai-agents/                ← The AI story generation system
│   │   ├── agents/               ← Individual AI specialists
│   │   │   ├── StoryArchitect.ts ← Overall story planning
│   │   │   ├── SceneWriter.ts    ← Scene content generation
│   │   │   ├── ChoiceAuthor.ts   ← Choice generation
│   │   │   └── image-team/       ← Advanced visual generation
│   │   ├── pipeline/             ← Generation orchestration
│   │   ├── services/             ← External API integrations
│   │   ├── validators/           ← Quality checking
│   │   ├── example-usage.ts      ← CLI generation script
│   │   └── generate-from-document.ts ← Document-based generation
│   │
│   ├── data/stories/             ← Built-in story content
│   ├── config/                   ← Configuration files
│   │   └── endpoints.ts          ← API endpoint definitions
│   └── utils/                    ← Helper utilities
│
├── docs/                         ← Documentation
│   ├── GDD.md                    ← Game Design Document
│   ├── TDD.md                    ← Technical Design Document
│   └── INSTALL.md                ← This file
│
├── public/reader-content/        ← Reader-safe exported story packages (optional)
├── generated-stories/            ← Output folder for generated stories
└── scripts/                     ← Utility scripts
```

### Key Files to Know

| File | What It Is |
|---|---|
| `proxy-server.js` | The Node.js server that proxies API calls and manages files |
| `apps/reader/ReaderApp.tsx` | Public Reader target entry |
| `apps/generator/GeneratorApp.tsx` | Internal Generator target entry |
| `App.tsx` | Legacy monolithic shell retained for compatibility |
| `src/types/index.ts` | Barrel export for the topic-oriented canonical data model |
| `src/story-codec/storyCodec.ts` | Versioned story package encode/decode boundary |
| `src/assets/assetResolver.ts` | Runtime media URL resolution for strings and `AssetRef` objects |
| `src/engine/storyEngine.ts` | The core logic that processes story data into the player experience |
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | The main AI generation coordinator |
| `src/ai-agents/config.ts` | Configuration for the AI pipeline |
| `src/stores/gameStore.ts` | Player state management (saves, progress, etc.) |
| `src/screens/ReadingScreen.tsx` | The main reading/playing interface |

---

## Appendix: Verifying Everything Works

Run through this checklist after setup to confirm everything is functioning:

- [ ] `node --version` shows v20.x or higher
- [ ] `npm --version` shows 10.x or higher
- [ ] `npm install` completed without errors
- [ ] `.env` file exists with `ANTHROPIC_API_KEY` for generation and a selected image provider key if generating images
- [ ] `npm run proxy` starts without errors (shows `Proxy running on http://localhost:3001`)
- [ ] `curl http://localhost:3001/` returns `{"status":"ok"}`
- [ ] `npm run reader:web` starts the Reader Expo dev server
- [ ] Browser at `http://localhost:8081` shows the StoryRPG home screen
- [ ] At least one story appears in the catalog (built-in stories)
- [ ] Tapping a story shows its episodes
- [ ] Starting an episode shows the reading interface with images
- [ ] `npm run generator:web` starts the Generator target at `http://localhost:8082`
- [ ] (If Anthropic key set) The Generator target can start story generation
- [ ] `npm run check:reader-boundary` passes before any public Reader export

---

*For questions about the game design, see docs/GDD.md. For technical architecture details, see docs/TDD.md.*
