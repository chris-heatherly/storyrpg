#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const prototypeRoot = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.resolve(prototypeRoot, '..');
const manifestPath = path.join(workspaceRoot, 'skills-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const dryRun = args.has('--dry-run');

for (const arg of args) {
  if (!['--check', '--dry-run'].includes(arg)) {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  }
}

const audit = spawnSync(process.execPath, [path.join(prototypeRoot, 'scripts', 'audit-skills.mjs')], {
  cwd: prototypeRoot,
  stdio: 'inherit',
});
if (audit.status !== 0) process.exit(audit.status ?? 1);

function resolveTarget(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return path.isAbsolute(value) ? value : path.join(workspaceRoot, value);
}

function skillNames(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function hashTree(root) {
  const hash = crypto.createHash('sha256');
  const visit = (directory, relative = '') => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.name !== '.storyrpg-sync-state.json')
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = path.join(relative, entry.name);
      const absolutePath = path.join(directory, entry.name);
      hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${relativePath}\n`);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else hash.update(fs.readFileSync(absolutePath));
    }
  };
  visit(root);
  return hash.digest('hex');
}

function treesMatch(source, target) {
  return fs.existsSync(target) && hashTree(source) === hashTree(target);
}

function containsPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

const failures = [];
for (const harness of manifest.harnesses ?? []) {
  const source = path.join(workspaceRoot, manifest.models[harness.model]);
  const configuredTarget = process.env[harness.targetEnv] || harness.defaultTarget;
  const target = resolveTarget(configuredTarget);
  const names = skillNames(source);

  if (path.resolve(source) === path.resolve(target)) {
    console.log(`${harness.id}: project catalog is already in its discovery location (${path.relative(workspaceRoot, target)}).`);
    continue;
  }
  if (containsPath(source, target) || containsPath(target, source)) {
    failures.push(`${harness.id}: source and target must not contain one another (${source} -> ${target})`);
    continue;
  }

  const statePath = path.join(target, '.storyrpg-sync-state.json');
  let previousNames = [];
  if (fs.existsSync(statePath)) {
    try {
      previousNames = JSON.parse(fs.readFileSync(statePath, 'utf8')).skills ?? [];
    } catch {
      failures.push(`${harness.id}: cannot parse ${statePath}`);
      continue;
    }
  }

  const drift = names.filter((name) => !treesMatch(path.join(source, name), path.join(target, name)));
  const removed = previousNames.filter((name) => !names.includes(name));

  if (checkOnly) {
    if (drift.length || removed.length) {
      failures.push(`${harness.id}: drifted [${drift.join(', ')}], obsolete [${removed.join(', ')}] at ${target}`);
    } else {
      console.log(`${harness.id}: installed catalog matches ${target}.`);
    }
    continue;
  }

  if (dryRun) {
    console.log(`${harness.id}: would sync ${drift.length} and remove ${removed.length} managed skill(s) at ${target}.`);
    continue;
  }

  fs.mkdirSync(target, { recursive: true });
  for (const name of drift) {
    const destination = path.join(target, name);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(path.join(source, name), destination, { recursive: true });
  }
  for (const name of removed) {
    fs.rmSync(path.join(target, name), { recursive: true, force: true });
  }
  fs.writeFileSync(statePath, `${JSON.stringify({ harness: harness.id, model: harness.model, skills: names }, null, 2)}\n`);
  console.log(`${harness.id}: synchronized ${names.length} skill(s) to ${target}.`);
}

if (failures.length) {
  console.error(`Skill synchronization ${checkOnly ? 'check' : 'run'} failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
