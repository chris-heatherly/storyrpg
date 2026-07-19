#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import process from 'process';

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const workspaceRoot = path.resolve(appRoot, '..');

const baseUrl = (process.env.COGNEE_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const apiKey = process.env.COGNEE_API_KEY || '';
const defaultProjectDataset = process.env.COGNEE_PROJECT_DATASET || 'storyrpg-project';
const runDatasetPrefix = process.env.COGNEE_RUN_DATASET_PREFIX || 'storyrpg-run';
const memoryRoot = process.env.MEMORY_DIR ? path.resolve(process.env.MEMORY_DIR) : path.join(appRoot, 'pipeline-memories');
const projectManifestFile = path.join(memoryRoot, 'cognee-project-dataset.json');
const outboxRoot = path.join(memoryRoot, 'cognee-outbox');

function headers(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  // Cognee authenticates minted API keys via `X-Api-Key` (Bearer is for JWTs).
  if (apiKey) h['X-Api-Key'] = apiKey;
  return h;
}

function endpoint(name) {
  return `${baseUrl}/api/v1/${name.replace(/^\/+/, '')}`;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run';
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function activeProjectDataset() {
  try {
    const manifest = JSON.parse(await fs.readFile(projectManifestFile, 'utf8'));
    return typeof manifest.activeDataset === 'string' && manifest.activeDataset ? manifest.activeDataset : defaultProjectDataset;
  } catch {
    return defaultProjectDataset;
  }
}

async function writeProjectManifest(manifest) {
  await fs.mkdir(memoryRoot, { recursive: true });
  const temp = `${projectManifestFile}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await fs.rename(temp, projectManifestFile);
}

async function addText(dataset, title, text, nodeSet = []) {
  const body = new FormData();
  // /add expects `data` as uploaded file(s), not a text field.
  body.append('data', new Blob([`# ${title}\n\n${text}`], { type: 'text/markdown' }), `${slugify(title)}.md`);
  body.append('datasetName', dataset);
  for (const node of nodeSet) body.append('node_set', node);
  body.append('run_in_background', 'true');
  const res = await fetch(endpoint('add'), {
    method: 'POST',
    headers: headers(false),
    body,
  });
  if (!res.ok) throw new Error(`Cognee add failed for ${title}: ${res.status} ${await res.text()}`);
}

async function cognify(dataset) {
  const res = await fetch(endpoint('cognify'), {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({ datasets: [dataset], runInBackground: true }),
  });
  if (!res.ok) throw new Error(`Cognee cognify failed for ${dataset}: ${res.status} ${await res.text()}`);
}

async function search(query, datasets) {
  const res = await fetch(endpoint('search'), {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({
      searchType: 'GRAPH_COMPLETION',
      query,
      datasets,
      topK: 8,
      onlyContext: true,
    }),
  });
  if (!res.ok) throw new Error(`Cognee search failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function activeGeneratorLlmTarget() {
  try {
    const settings = JSON.parse(await fs.readFile(path.join(appRoot, '.generator-settings.json'), 'utf8'));
    const provider = settings.llmProvider === 'google' ? 'gemini' : settings.llmProvider;
    const rawModel = settings.llmModel;
    if (!provider || !rawModel) return null;
    const model = provider === 'gemini' && !rawModel.includes('/') ? `gemini/${rawModel}` : rawModel;
    const apiKey = provider === 'gemini' ? process.env.GEMINI_API_KEY
      : provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY
        : provider === 'openai' ? process.env.OPENAI_API_KEY
          : undefined;
    return { provider, model, apiKey };
  } catch {
    return null;
  }
}

async function syncLlmTarget(target) {
  if (!target) return null;
  const res = await fetch(endpoint('settings'), {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({ llm: { provider: target.provider, model: target.model, ...(target.apiKey ? { apiKey: target.apiKey } : {}) } }),
  });
  if (!res.ok) throw new Error(`Cognee LLM settings failed: ${res.status} ${await res.text()}`);
  return { provider: target.provider, model: target.model };
}

async function outboxStatus() {
  const count = async (name) => {
    try { return (await fs.readdir(path.join(outboxRoot, name))).filter((file) => file.endsWith('.json')).length; } catch { return 0; }
  };
  return {
    pending: await count('pending'),
    processing: await count('processing'),
    completed: await count('completed'),
    deadLetter: await count('dead-letter'),
  };
}

async function indexProject() {
  const files = [
    'AGENTS.md',
    'docs/PROJECT_STATUS.md',
    'docs/CURRENT_PIPELINE_STATUS.md',
    'docs/STORY_QUALITY_CONTRACT.md',
    'docs/STORY_PIPELINE_PROMPTING.md',
    'docs/STORY_AGENT_SYSTEM_DETAIL.md',
    'docs/READER_GENERATOR_SPLIT.md',
    'docs/INSTALL.md',
  ];
  const sources = [];
  const digest = crypto.createHash('sha256');
  for (const rel of files) {
    const full = path.join(workspaceRoot, rel);
    const text = await readIfExists(full);
    if (!text) continue;
    digest.update(rel).update('\0').update(text).update('\0');
    sources.push({ rel, text });
  }
  const contentHash = digest.digest('hex');
  const dataset = `${defaultProjectDataset}-v${contentHash.slice(0, 12)}`;
  for (const { rel, text } of sources) {
    await addText(dataset, rel, text, ['project-docs', rel.replace(/[^a-z0-9]+/gi, '-'), `source-hash:${contentHash.slice(0, 16)}`]);
  }
  await cognify(dataset);
  await writeProjectManifest({ schemaVersion: 1, activeDataset: dataset, contentHash, indexedAt: new Date().toISOString(), sourceFiles: sources.map(({ rel }) => rel) });
  console.log(`Indexed ${sources.length} project document(s) into ${dataset} and activated it.`);
}

async function latestRunDir() {
  const storiesDir = process.env.STORIES_DIR
    ? path.resolve(process.env.STORIES_DIR)
    : path.join(appRoot, 'generated-stories');
  const entries = await fs.readdir(storiesDir, { withFileTypes: true });
  const dirs = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const full = path.join(storiesDir, entry.name);
      const stat = await fs.stat(full);
      return { name: entry.name, full, mtimeMs: stat.mtimeMs };
    }));
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs[0]?.full;
}

async function indexRun(args) {
  const storyIdArg = args.find((arg) => arg.startsWith('--storyId='))?.split('=')[1];
  const storyId = storyIdArg || args[args.indexOf('--storyId') + 1];
  const runDir = storyId
    ? path.join(appRoot, 'generated-stories', storyId)
    : await latestRunDir();
  if (!runDir) throw new Error('No generated story run directory found.');
  const runName = path.basename(runDir);
  const dataset = `${runDatasetPrefix}-${slugify(runName)}`;
  const artifactNames = [
    '00-source-analysis.json',
    '01-season-plan.json',
    '02-world-bible.json',
    '03-character-bible.json',
    '04-episode-blueprint.json',
    '05-qa-report.json',
    '06-best-practices-report.json',
    '07-final-story-contract.json',
    'story.json',
    '99-pipeline-errors.json',
    'manifest.json',
  ];
  let count = 0;
  for (const name of artifactNames) {
    const text = await readIfExists(path.join(runDir, name));
    if (!text) continue;
    await addText(dataset, `${runName}/${name}`, text, ['generated-run', name.replace(/[^a-z0-9]+/gi, '-')]);
    count += 1;
  }
  await cognify(dataset);
  console.log(`Indexed ${count} artifact(s) from ${runName} into ${dataset}`);
}

async function ask(args) {
  const query = args.join(' ').trim();
  if (!query) throw new Error('Usage: npm run memory:ask -- "<query>"');
  const datasets = [await activeProjectDataset(), process.env.COGNEE_VALIDATOR_DATASET || 'storyrpg-validator-history'];
  const result = await search(query, datasets);
  console.log(JSON.stringify(result, null, 2));
}

async function health() {
  // Cognee serves health at the root (/health), NOT under /api/v1 (where the
  // add/cognify/search data endpoints live).
  const res = await fetch(`${baseUrl}/health`, { headers: headers(false) });
  if (!res.ok) throw new Error(`Cognee health failed: ${res.status} ${await res.text()}`);
  console.log(`Cognee healthy at ${baseUrl}`);
}

async function doctor(args = []) {
  await health();
  const target = await syncLlmTarget(await activeGeneratorLlmTarget());
  const projectDataset = await activeProjectDataset();
  const result = await search('StoryRPG memory readiness check', [projectDataset]);
  const resultCount = Array.isArray(result) ? result.length : 1;
  let canary = 'not-run';
  if (args.includes('--write')) {
    const dataset = 'storyrpg-memory-health';
    const marker = `storyrpg-memory-canary-${Date.now()}`;
    await addText(dataset, marker, `Cognee readiness canary ${marker}`, ['health-canary']);
    await cognify(dataset);
    const deadline = Date.now() + 45_000;
    do {
      const hits = await search(marker, [dataset]);
      if (Array.isArray(hits) ? hits.length : hits) { canary = 'write-index-recall-ok'; break; }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    } while (Date.now() < deadline);
    if (canary !== 'write-index-recall-ok') throw new Error('Cognee write canary was not retrievable before timeout');
  }
  console.log(JSON.stringify({
    provider: 'cognee',
    baseUrl,
    projectDataset,
    authenticatedSearch: 'ok',
    resultCount,
    activeGeneratorLlm: target,
    outbox: await outboxStatus(),
    canary,
  }, null, 2));
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'index-project') await indexProject();
  else if (command === 'index-run') await indexRun(args);
  else if (command === 'ask') await ask(args);
  else if (command === 'health') await health();
  else if (command === 'doctor') await doctor(args);
  else {
    throw new Error('Usage: memory.mjs <index-project|index-run|ask|health|doctor>');
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
