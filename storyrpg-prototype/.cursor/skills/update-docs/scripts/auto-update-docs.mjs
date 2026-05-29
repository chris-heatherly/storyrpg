#!/usr/bin/env node
/**
 * auto-update-docs.mjs
 *
 * Fully automated documentation updater for StoryRPG.
 * Runs the audit script, reads source files, calls Claude to rewrite
 * each doc that has drifted, then writes changes back to disk.
 *
 * Requires: ANTHROPIC_API_KEY in storyrpg-prototype/.env
 * Usage:    node auto-update-docs.mjs            (normal run)
 *           node auto-update-docs.mjs --dry-run   (preview only)
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(__dirname, "../../../../..");
const PROTO = join(WORKSPACE, "storyrpg-prototype");
const DOCS_DIR = join(WORKSPACE, "docs");
const AGENTS_MD = join(WORKSPACE, "AGENTS.md");
const LOG_FILE = join(__dirname, "last-auto-update.log");

const DRY_RUN = process.argv.includes("--dry-run");
const MODEL = process.env.DOC_UPDATE_MODEL || "claude-sonnet-4-20250514";
const MAX_OUTPUT_TOKENS = 16000;
const API_TIMEOUT_MS = 300_000; // 5 min per API call
const MAX_SOURCE_CHARS_PER_FILE = 4000;
const MAX_TOTAL_SOURCE_CHARS = 20000;

// ── Helpers ─────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}
const logLines = [];

function loadEnv() {
  const envPath = join(PROTO, ".env");
  if (!existsSync(envPath)) throw new Error(`No .env at ${envPath}`);
  const text = readFileSync(envPath, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}

function readSafe(path) {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function runAudit() {
  const script = join(__dirname, "audit-docs.sh");
  return execSync(`bash "${script}"`, { cwd: WORKSPACE, encoding: "utf-8", timeout: 30_000 });
}

async function callClaude(systemPrompt, userPrompt, { maxTokens = MAX_OUTPUT_TOKENS } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Claude API ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// ── Source context readers ───────────────────────────────────────────
function readKeySourceFiles() {
  const files = {
    "package.json": join(PROTO, "package.json"),
    "src/types/index.ts (first 200 lines)": null,
    "src/config/endpoints.ts": join(PROTO, "src/config/endpoints.ts"),
  };

  const result = {};
  for (const [label, p] of Object.entries(files)) {
    if (p) result[label] = readSafe(p).slice(0, 12000);
  }

  const typesContent = readSafe(join(PROTO, "src/types/index.ts"));
  result["src/types/index.ts (first 200 lines)"] = typesContent.split("\n").slice(0, 200).join("\n");

  return result;
}

function sourceContextBlock(sources) {
  return Object.entries(sources)
    .map(([label, content]) => `--- ${label} ---\n${content}`)
    .join("\n\n");
}

// ── Doc-specific source maps ────────────────────────────────────────
const DOC_SOURCE_MAP = {
  "TDD.md": [
    "src/types/index.ts",
    "src/engine/storyEngine.ts",
    "src/ai-agents/pipeline/FullStoryPipeline.ts",
    "src/config/endpoints.ts",
    "proxy-server.js",
  ],
  "GDD.md": [
    "src/types/index.ts",
    "src/engine/storyEngine.ts",
    "src/engine/identityEngine.ts",
    "src/engine/resolutionEngine.ts",
  ],
  "INSTALL.md": ["package.json", "src/config/endpoints.ts"],
  "STORY_BRANCHING.md": [
    "src/engine/storyEngine.ts",
    "src/types/index.ts",
    "src/engine/conditionEvaluator.ts",
  ],
  "STORY_PIPELINE_PROMPTING.md": [
    "src/ai-agents/prompts/index.ts",
    "src/ai-agents/prompts/storytellingPrinciples.ts",
    "src/ai-agents/prompts/visualPrinciples.ts",
  ],
  "STORY_AGENT_SYSTEM_DETAIL.md": [
    "src/ai-agents/agents/WorldBuilder.ts",
    "src/ai-agents/agents/StoryArchitect.ts",
    "src/ai-agents/agents/SceneWriter.ts",
    "src/ai-agents/agents/ChoiceAuthor.ts",
    "src/ai-agents/agents/EncounterArchitect.ts",
    "src/ai-agents/agents/BranchManager.ts",
  ],
  "IMAGE_PIPELINE_RUNTIME.md": [
    "src/ai-agents/agents/image-team/ImageAgentTeam.ts",
    "src/ai-agents/services/imageGenerationService.ts",
  ],
  "INCREMENTAL_VALIDATION_PLAN.md": ["src/ai-agents/validators/IncrementalValidators.ts"],
  "QA_FIXES_SUMMARY.md": [],
  "MOBILE_REDESIGN.md": ["src/screens/ReadingScreen.tsx"],
  "PARALLEL_GENERATION.md": ["src/ai-agents/pipeline/FullStoryPipeline.ts"],
  "STORY_QUALITY_CONTRACT.md": ["src/ai-agents/prompts/visualPrinciples.ts"],
  "READER_GENERATOR_SPLIT.md": ["scripts/check-reader-boundary.mjs", "metro.config.js"],
};

function readDocSources(docName) {
  const paths = DOC_SOURCE_MAP[docName] || [];
  const result = {};
  let totalChars = 0;
  for (const rel of paths) {
    if (totalChars >= MAX_TOTAL_SOURCE_CHARS) break;
    const full = join(PROTO, rel);
    const content = readSafe(full);
    if (content) {
      const budget = Math.min(MAX_SOURCE_CHARS_PER_FILE, MAX_TOTAL_SOURCE_CHARS - totalChars);
      result[rel] = content.slice(0, budget);
      totalChars += result[rel].length;
    }
  }
  return result;
}

// ── AGENTS.md updater ───────────────────────────────────────────────
async function updateAgentsMd(auditReport, keySources) {
  log("Updating AGENTS.md ...");
  const current = readSafe(AGENTS_MD);

  const systemPrompt = `You are a documentation maintenance bot for the StoryRPG project.
Your job: rewrite AGENTS.md so it accurately reflects the current codebase.

Rules:
- Preserve the existing document structure, headings, and writing style exactly.
- Update ONLY facts that have drifted (file listings, version numbers, new/removed files, new scripts, new env vars, new stores, new agents, etc.).
- If something hasn't changed, keep the existing text verbatim.
- Never fabricate information — only use data from the audit report and source files.
- Keep it concise. This is an orientation doc, not an encyclopedia.
- Output ONLY the complete updated AGENTS.md content. No commentary, no markdown fences wrapping the whole thing.`;

  const userPrompt = `Here is the current AGENTS.md:

${current}

Here is the codebase audit report (ground truth):

${auditReport}

Here are key source files for reference:

${sourceContextBlock(keySources)}

Rewrite AGENTS.md so every section matches the audit. Output the full updated file.`;

  const updated = await callClaude(systemPrompt, userPrompt);

  if (!updated || updated.length < 500) {
    log("  SKIP — Claude response too short, likely error.");
    return false;
  }

  if (updated.trim() === current.trim()) {
    log("  No changes needed.");
    return false;
  }

  if (DRY_RUN) {
    log("  DRY RUN — would write " + updated.length + " chars.");
    return true;
  }

  writeFileSync(AGENTS_MD, updated, "utf-8");
  log("  Updated (" + updated.length + " chars).");
  return true;
}

// ── Individual doc updater ──────────────────────────────────────────
async function updateDoc(docName, auditReport) {
  const docPath = join(DOCS_DIR, docName);
  const current = readSafe(docPath);
  if (!current) { log(`  SKIP ${docName} — empty or missing.`); return false; }

  const sources = readDocSources(docName);
  if (Object.keys(sources).length === 0 && !["QA_FIXES_SUMMARY.md"].includes(docName)) {
    log(`  SKIP ${docName} — no mapped sources, needs manual review.`);
    return false;
  }

  log(`  Checking ${docName} ...`);

  const systemPrompt = `You are a documentation maintenance bot for the StoryRPG project.
Your job: update this documentation file so it accurately reflects the current codebase.

Rules:
- Preserve the document's existing structure, voice, and style.
- Update facts that have drifted (file names, function signatures, config values, architecture changes).
- If the doc is already accurate, return it unchanged.
- Never fabricate — only use data from the audit report and source files provided.
- For design-intent docs (GDD, visual guides): only update factual references (file paths, type names), not design philosophy.
- Output ONLY the complete updated file content. No commentary, no wrapping fences.`;

  const docSlice = current.length > 25000
    ? current.slice(0, 25000) + "\n\n[... truncated — doc continues for " + (current.length - 25000) + " more chars ...]"
    : current;

  const userPrompt = `File: docs/${docName}

Current content:
${docSlice}

Codebase audit report (ground truth):
${auditReport.slice(0, 6000)}

Relevant source files:
${sourceContextBlock(sources)}

If the doc needs updates to match the code, output the updated file. If it's already accurate, output it unchanged.`;

  const estimatedTokens = Math.ceil(current.length / 3.5);
  const maxTokens = Math.min(Math.max(estimatedTokens + 2000, MAX_OUTPUT_TOKENS), 64000);
  log(`    (doc ~${current.length} chars, maxTokens=${maxTokens})`);

  const updated = await callClaude(systemPrompt, userPrompt, { maxTokens });

  if (!updated || updated.length < 200) {
    log(`    SKIP — response too short.`);
    return false;
  }

  if (updated.trim() === current.trim()) {
    log(`    No changes needed.`);
    return false;
  }

  if (DRY_RUN) {
    log(`    DRY RUN — would write ${updated.length} chars.`);
    return true;
  }

  writeFileSync(docPath, updated, "utf-8");
  log(`    Updated (${updated.length} chars).`);
  return true;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  log("=== StoryRPG Auto Doc Update ===");
  log(DRY_RUN ? "Mode: DRY RUN (no files written)" : "Mode: LIVE");
  log("");

  loadEnv();
  log("Loaded .env");

  log("Running codebase audit ...");
  const auditReport = runAudit();
  log("Audit complete (" + auditReport.length + " chars).");
  log("");

  const keySources = readKeySourceFiles();

  // 1. Update AGENTS.md
  let agentsChanged = false;
  try {
    agentsChanged = await updateAgentsMd(auditReport, keySources);
  } catch (err) {
    log("  ERROR updating AGENTS.md: " + err.message);
  }

  // 2. Update each doc
  log("");
  log("Checking docs/ files ...");
  const docsToUpdate = readdirSync(DOCS_DIR)
    .filter(f => f.endsWith(".md"))
    .filter(f => f !== "sample-story.md");

  let docsChanged = 0;
  let docsFailed = 0;
  for (const docName of docsToUpdate) {
    try {
      const changed = await updateDoc(docName, auditReport);
      if (changed) docsChanged++;
    } catch (err) {
      log(`    ERROR on ${docName}: ${err.message}`);
      docsFailed++;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Summary
  log("");
  log("=== Summary ===");
  log(`AGENTS.md: ${agentsChanged ? "UPDATED" : "unchanged"}`);
  log(`docs/ files checked: ${docsToUpdate.length}`);
  log(`docs/ files updated: ${docsChanged}`);
  log(`docs/ files failed: ${docsFailed}`);
  log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  log("=== Done ===");

  writeFileSync(LOG_FILE, logLines.join("\n") + "\n", "utf-8");

  // macOS notification on completion
  try {
    const summary = `Docs updated: AGENTS.md ${agentsChanged ? "✓" : "—"}, ${docsChanged}/${docsToUpdate.length} docs`;
    execSync(
      `osascript -e 'display notification "${summary}" with title "StoryRPG Docs" sound name "Glass"'`,
      { timeout: 5000 },
    );
  } catch { /* notification is optional */ }
}

main().catch(err => {
  log("FATAL: " + err.message);
  writeFileSync(LOG_FILE, logLines.join("\n") + "\n", "utf-8");
  process.exit(1);
});
