#!/usr/bin/env node
/**
 * Deterministic treatment-fidelity checker for generated run directories.
 * Usage: node scripts/check-treatment-fidelity.mjs generated-stories/<run-id>
 */
import fs from 'node:fs';
import path from 'node:path';

const runDir = process.argv[2];
if (!runDir) {
  console.error('Usage: node scripts/check-treatment-fidelity.mjs <run-directory>');
  process.exit(1);
}

const absRun = path.resolve(runDir);
const storyPath = path.join(absRun, 'story.json');
if (!fs.existsSync(storyPath)) {
  console.error(`Missing story.json in ${absRun}`);
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
const story = payload.story ?? payload;
const ep = story.episodes?.[0];
if (!ep) {
  console.error('No episode 1 in story.json');
  process.exit(1);
}

function collectProse(sc) {
  const parts = [];
  for (const b of sc.beats ?? []) parts.push(b.text ?? '');
  for (const c of sc.choices ?? []) {
    parts.push(c.text ?? '');
    for (const o of c.outcomes ?? []) parts.push(o.text ?? '');
  }
  if (sc.encounter) parts.push(JSON.stringify(sc.encounter));
  return parts.join('\n');
}

const allProse = ep.scenes.flatMap(collectProse).join('\n');
const checks = [
  ['two suitcases', /\btwo suitcases\b/i],
  ['grandmother / Veronica', /\b(?:grandmother|Veronica)\b/i],
  ['Daniel / engagement', /\b(?:Daniel|engagement|restaurateur)\b/i],
  ['food writer', /\bfood writer\b/i],
  ['Lumina / bookshop', /\b(?:Lumina|bookshop)\b/i],
  ['Dusk Club', /\bDusk Club\b/i],
  ['rooftop suitors', /\b(?:rooftop|charcoal|kitchen)\b/i],
  ['Cismigiu', /\bCismigiu\b/i],
  ['Mr. Midnight', /\bMr\.?\s*Midnight\b/i],
  ['viral payoff', /\b(?:viral|shares|influencers|notifications)\b/i],
];

console.log(`Run: ${path.basename(absRun)}`);
console.log(`Scenes: ${ep.scenes.map((s) => s.id).join(' → ')}`);
console.log('\nTreatment term coverage:');
let misses = 0;
for (const [label, pattern] of checks) {
  const hit = pattern.test(allProse);
  console.log(`  ${hit ? '✓' : '✗'} ${label}`);
  if (!hit) misses += 1;
}

const contractPath = path.join(absRun, '07b-final-story-contract.json');
if (fs.existsSync(contractPath)) {
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  console.log(`\nFinal contract: passed=${contract.passed} warnings=${contract.warnings?.length ?? 0}`);
  for (const warning of contract.warnings ?? []) {
    console.log(`  - [${warning.type}] ${warning.message?.slice(0, 120)}`);
  }
}

const qualityPath = path.join(absRun, '07c-quality-score-report.json');
if (fs.existsSync(qualityPath)) {
  const quality = JSON.parse(fs.readFileSync(qualityPath, 'utf8'));
  console.log(`\nQuality: raw=${quality.rawScore} final=${quality.finalScore} caps=${quality.caps?.length ?? 0}`);
}

process.exit(misses > 0 ? 2 : 0);
