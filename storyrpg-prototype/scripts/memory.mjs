#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import process from 'process';

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const workspaceRoot = path.resolve(appRoot, '..');

const baseUrl = (process.env.COGNEE_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const apiKey = process.env.COGNEE_API_KEY || '';
const projectDataset = process.env.COGNEE_PROJECT_DATASET || 'storyrpg-project';
const runDatasetPrefix = process.env.COGNEE_RUN_DATASET_PREFIX || 'storyrpg-run';

function headers(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
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

async function addText(dataset, title, text, nodeSet = []) {
  const body = new FormData();
  body.append('data', `# ${title}\n\n${text}`);
  body.append('datasetName', dataset);
  for (const node of nodeSet) body.append('node_set', node);
  body.append('run_in_background', 'false');
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
  let count = 0;
  for (const rel of files) {
    const full = path.join(workspaceRoot, rel);
    const text = await readIfExists(full);
    if (!text) continue;
    await addText(projectDataset, rel, text, ['project-docs', rel.replace(/[^a-z0-9]+/gi, '-')]);
    count += 1;
  }
  await cognify(projectDataset);
  console.log(`Indexed ${count} project document(s) into ${projectDataset}`);
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
  const datasets = [projectDataset, process.env.COGNEE_VALIDATOR_DATASET || 'storyrpg-validator-history'];
  const result = await search(query, datasets);
  console.log(JSON.stringify(result, null, 2));
}

async function health() {
  const res = await fetch(endpoint('health'), { headers: headers(false) });
  if (!res.ok) throw new Error(`Cognee health failed: ${res.status} ${await res.text()}`);
  console.log(`Cognee healthy at ${baseUrl}`);
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'index-project') await indexProject();
  else if (command === 'index-run') await indexRun(args);
  else if (command === 'ask') await ask(args);
  else if (command === 'health') await health();
  else {
    throw new Error('Usage: memory.mjs <index-project|index-run|ask|health>');
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
