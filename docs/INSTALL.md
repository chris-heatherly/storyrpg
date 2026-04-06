# StoryRPG - Installation and Setup Guide

**Version:** 1.0  
**Last Updated:** February 26, 2026  
**Audience:** Anyone setting up StoryRPG on a new machine

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

### Required API Keys

You need at least one API key to use the full application. The keys are obtained from external service providers:

| Service | Purpose | Required? | Cost | Sign Up |
|---|---|---|---|---|
| **Anthropic (Claude)** | Text generation (story content) | Yes, for generating stories | Pay-per-use (~$3-15 per story) | https://console.anthropic.com/ |
| **Google Gemini** | Image generation | Recommended (default provider) | Free tier available | https://aistudio.google.com/ |
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
# (If .env.example doesn't exist, see "Create the .env File" in Section 3)

# 5. Edit .env and add your API keys (at minimum, the Gemini key for images)
# Open .env in any text editor and fill in:
#   EXPO_PUBLIC_GEMINI_API_KEY=your-gemini-api-key-here
#   ANTHROPIC_API_KEY=your-anthropic-key-here  (needed only for generation)

# 6. Start everything
npm run dev
```

This starts both the proxy server (port 3001) and the web app (port 8081). Open your browser to `http://localhost:8081`.

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
git clone <repository-url> StoryRPG_New
cd StoryRPG_New
```

If you received the project as a zip file or folder:
```bash
# Unzip or copy the folder to your desired location
cd StoryRPG_New
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
# If an example file exists:
cp .env.example .env

# Otherwise, create it manually:
touch .env
```

Open `.env` in any text editor (VS Code, Notepad, nano, vim, etc.) and add the following:

```env
# === REQUIRED FOR IMAGE GENERATION ===
EXPO_PUBLIC_GEMINI_API_KEY=your-gemini-api-key-here
EXPO_PUBLIC_IMAGE_GENERATION_ENABLED=true
EXPO_PUBLIC_IMAGE_PROVIDER=nano-banana

# === REQUIRED FOR STORY GENERATION ===
ANTHROPIC_API_KEY=your-anthropic-api-key-here

# === OPTIONAL: Voice Narration ===
# ELEVENLABS_API_KEY=your-elevenlabs-key-here

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
# You should see "Proxy server running on port 3001"

# Check the health endpoint
curl http://localhost:3001/
# Should return {"status":"ok",...}

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

This key is used by the default image provider (Nano-Banana/Gemini) to generate illustrations.

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
3. Starts the Expo web development server on port 8081

Open your browser to **http://localhost:8081** to use the app.

### Option B: Start Components Separately

If you need more control, start each component in its own terminal:

**Terminal 1 — Proxy Server:**
```bash
cd storyrpg-prototype
npm run proxy
```
You should see: `Proxy server listening on port 3001`

**Terminal 2 — Web App:**
```bash
cd storyrpg-prototype
npm run web
```
The Expo dev server will start and show a QR code and URL. Open the URL in your browser (usually `http://localhost:8081`).

### What You Should See

1. **Proxy server terminal:** Shows "Proxy server listening on port 3001" and occasional request logs.
2. **Web app terminal:** Shows the Expo bundler output with the development server URL.
3. **Browser:** The StoryRPG home screen with a list of available stories (4 built-in stories should appear).

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

1. Click the **Generator** button on the home screen
2. Choose your input method:
   - **From prompt:** Enter a genre and brief description
   - **From document:** Upload a text file or PDF as source material
3. Wait for the analysis phase (1-2 minutes)
4. Review the season plan — the AI will suggest episodes with outlines
5. Customize if desired (change episode count, review outlines)
6. Click **Generate** to start content creation
7. Monitor progress — the UI shows phase-by-phase progress with estimated time remaining
8. When complete, the story appears in your library

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
```

Generated stories appear in the `generated-stories/` directory and will show up in the app's story catalog on next refresh.

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

# Start the web app (still runs locally)
npm run web
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
3. Restart the Expo dev server: stop it (Ctrl+C) and run `npm run web` again

### Stories don't appear in the app

**Problem:** Generated stories or built-in stories don't show up.

**Solutions:**
1. Make sure the proxy server is running (built-in stories are installed through it)
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

# Image provider: 'nano-banana' (Gemini), 'atlas-cloud', 'midapi'
EXPO_PUBLIC_IMAGE_PROVIDER=nano-banana

# Gemini model for images
EXPO_PUBLIC_GEMINI_MODEL=gemini-2.5-flash-image

# Atlas Cloud (alternative provider)
# ATLAS_CLOUD_API_KEY=...
# ATLAS_CLOUD_MODEL=...

# MidAPI/Midjourney (alternative provider)
# MIDAPI_TOKEN=...

# ===================================================================
# AUDIO / NARRATION (Optional)
# ===================================================================

# ElevenLabs text-to-speech
# ELEVENLABS_API_KEY=...

# ===================================================================
# SERVER CONFIGURATION
# ===================================================================

# Proxy server port (default: 3001)
# PORT=3001

# Public URL for webhook callbacks (e.g., ngrok URL for MidAPI)
# PROXY_PUBLIC_URL=https://your-ngrok-url.ngrok.io

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

# Enable image generation debug logging
# EXPO_PUBLIC_DEBUG_IMAGE_GENERATION=true

# Validation mode: 'strict', 'advisory', 'disabled'
# EXPO_PUBLIC_VALIDATION_MODE=advisory
```

### npm Scripts Reference

| Script | What It Does |
|---|---|
| `npm run dev` | Start proxy + web app together (kills existing node processes) |
| `npm run proxy` | Start only the proxy server |
| `npm run web` | Start only the Expo web dev server |
| `npm start` | Start Expo with platform selection menu |
| `npm run ios` | Start Expo for iOS |
| `npm run android` | Start Expo for Android |
| `npm run generate` | Generate a story from CLI |
| `npm run generate:heist` | Generate a heist-genre story |
| `npm run generate:fantasy` | Generate a fantasy-genre story |
| `npm run generate:doc` | Generate from a document file |
| `npm run generate:template` | Generate using a template file |
| `npm run proxy:compose:up` | Start proxy in Docker |
| `npm run proxy:compose:down` | Stop Docker proxy |
| `npm run proxy:compose:logs` | View Docker proxy logs |
| `npm run proxy:health` | Check proxy server health |
| `npm test` | Run tests |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run validate` | Run both type checking and tests |
| `npm run clean:runtime` | Clean up runtime artifacts |

---

## 11) Project Structure Overview

For new developers or anyone needing to understand where things are:

```
storyrpg-prototype/               ← The application root
├── .env                          ← Your API keys (DO NOT share or commit)
├── package.json                  ← Dependencies and scripts
├── proxy-server.js               ← The backend server
├── App.tsx                       ← The app's main entry point
│
├── src/
│   ├── screens/                  ← The app's pages/views
│   │   ├── HomeScreen.tsx        ← Main story catalog
│   │   ├── GeneratorScreen.tsx   ← Story generation interface
│   │   ├── ReadingScreen.tsx     ← Story reading/playing interface
│   │   ├── EpisodeSelectScreen.tsx
│   │   ├── SettingsScreen.tsx
│   │   └── VisualizerScreen.tsx
│   │
│   ├── components/               ← Reusable UI pieces
│   ├── engine/                   ← Story playback logic
│   │   ├── storyEngine.ts        ← Core story processing
│   │   ├── conditionEvaluator.ts ← Choice/branch logic
│   │   └── templateProcessor.ts  ← Dynamic content processing
│   │
│   ├── stores/                   ← Data management (Zustand stores)
│   │   ├── gameStore.ts          ← Player state management
│   │   ├── generationJobStore.ts ← Generation progress tracking
│   │   ├── seasonPlanStore.ts    ← Season planning interface state
│   │   └── settingsStore.ts      ← User preferences
│   │
│   ├── types/                    ← Data structure definitions
│   │   └── index.ts              ← All type definitions
│   │
│   ├── ai-agents/                ← The AI story generation system
│   │   ├── agents/               ← Individual AI specialists
│   │   │   ├── StoryArchitect.ts ← Overall story planning
│   │   │   ├── SceneWriter.ts    ← Scene content generation
│   │   │   ├── ChoiceAuthor.ts   ← Choice generation
│   │   │   ├── ImageGenerator.ts ← Visual content
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
├── generated-stories/            ← Output folder for generated stories
└── scripts/                     ← Utility scripts
```

### Key Files to Know

| File | What It Is |
|---|---|
| `proxy-server.js` | The Node.js server that proxies API calls and manages files |
| `App.tsx` | The React component that starts the app and handles navigation |
| `src/types/index.ts` | All the data structure definitions (the "contract" between generation and playback) |
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
- [ ] `.env` file exists with at least `EXPO_PUBLIC_GEMINI_API_KEY`
- [ ] `npm run proxy` starts without errors (shows "listening on port 3001")
- [ ] `curl http://localhost:3001/` returns `{"status":"ok"}`
- [ ] `npm run web` starts the Expo dev server
- [ ] Browser at `http://localhost:8081` shows the StoryRPG home screen
- [ ] At least one story appears in the catalog (built-in stories)
- [ ] Tapping a story shows its episodes
- [ ] Starting an episode shows the reading interface with images
- [ ] (If Anthropic key set) The Generator screen can start story generation

---

*For questions about the game design, see docs/GDD.md. For technical architecture details, see docs/TDD.md.*