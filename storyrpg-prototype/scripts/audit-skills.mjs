#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const prototypeRoot = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.resolve(prototypeRoot, '..');
const manifestPath = path.join(workspaceRoot, 'skills-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const failures = [];

function fail(message) {
  failures.push(message);
}

function readSkill(model, skillName) {
  const root = manifest.models[model];
  const skillPath = path.join(workspaceRoot, root, skillName, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    fail(`${model}/${skillName}: missing SKILL.md at ${path.relative(workspaceRoot, skillPath)}`);
    return '';
  }

  const content = fs.readFileSync(skillPath, 'utf8');
  const nameMatch = content.match(/^---\s*\n[\s\S]*?^name:\s*([^\n]+)\n[\s\S]*?^---\s*$/m);
  if (!nameMatch) {
    fail(`${model}/${skillName}: missing valid frontmatter name`);
  } else if (nameMatch[1].trim() !== skillName) {
    fail(`${model}/${skillName}: frontmatter name is ${nameMatch[1].trim()}`);
  }

  if (model === 'codex') {
    const metadataPath = path.join(workspaceRoot, root, skillName, 'agents', 'openai.yaml');
    if (!fs.existsSync(metadataPath)) {
      fail(`${model}/${skillName}: missing agents/openai.yaml`);
    } else {
      const metadata = fs.readFileSync(metadataPath, 'utf8');
      for (const field of ['display_name:', 'short_description:', 'default_prompt:']) {
        if (!metadata.includes(field)) fail(`${model}/${skillName}: openai.yaml missing ${field}`);
      }
    }
  }

  return content;
}

const harnessIds = new Set();
const harnessModels = new Set();
for (const harness of manifest.harnesses ?? []) {
  if (!harness.id || harnessIds.has(harness.id)) fail(`invalid or duplicate harness id: ${harness.id}`);
  else harnessIds.add(harness.id);
  if (!manifest.models[harness.model]) fail(`${harness.id}: unknown model ${harness.model}`);
  else harnessModels.add(harness.model);
  if (!harness.defaultTarget) fail(`${harness.id}: missing defaultTarget`);
  if (!harness.targetEnv) fail(`${harness.id}: missing targetEnv`);
}
for (const model of Object.keys(manifest.models)) {
  if (!harnessModels.has(model)) fail(`${model}: no harness distribution target declared`);
}

const allSkillContent = [];
const mappedSkills = new Map(Object.keys(manifest.models).map((model) => [model, new Set()]));
for (const capability of manifest.capabilities) {
  for (const model of Object.keys(manifest.models)) {
    const skillNames = capability.skills[model] ?? [];
    if (skillNames.length === 0) {
      fail(`${capability.id}: ${model} has no mapped skills`);
      continue;
    }
    for (const skillName of skillNames) mappedSkills.get(model).add(skillName);
    const aggregate = skillNames.map((name) => readSkill(model, name)).join('\n');
    allSkillContent.push(aggregate);
    for (const source of capability.requiredPatterns ?? []) {
      if (!new RegExp(source, 'i').test(aggregate)) {
        fail(`${capability.id}: ${model} skills missing required pattern /${source}/`);
      }
    }
  }
}

for (const [model, relativeRoot] of Object.entries(manifest.models)) {
  const root = path.join(workspaceRoot, relativeRoot);
  const discovered = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
  for (const skillName of discovered) {
    if (!mappedSkills.get(model).has(skillName)) {
      fail(`${model}/${skillName}: skill is not mapped to a capability in skills-manifest.json`);
    }
  }
}

const combined = allSkillContent.join('\n');
for (const forbidden of manifest.forbiddenPatterns ?? []) {
  if (new RegExp(forbidden.pattern, 'i').test(combined)) {
    fail(`forbidden skill claim /${forbidden.pattern}/: ${forbidden.message}`);
  }
}

for (const relativePath of manifest.authoritativeDocs ?? []) {
  if (!fs.existsSync(path.join(workspaceRoot, relativePath))) {
    fail(`missing authoritative document: ${relativePath}`);
  }
}

for (const relativePath of manifest.requiredPaths ?? []) {
  if (!fs.existsSync(path.join(workspaceRoot, relativePath))) {
    fail(`missing load-bearing skill reference: ${relativePath}`);
  }
}

if (failures.length > 0) {
  console.error(`Skill audit failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Skill audit passed: ${manifest.capabilities.length} capabilities across ${Object.keys(manifest.models).length} model catalogs.`);
