/**
 * Monolith line-count ratchet (see docs/PROJECT_AUDIT_2026-05-28.md, Track A3).
 *
 * These files are the project's two largest, hardest-to-change modules. They
 * are slated for decomposition; until then this guard stops them GROWING. Any
 * increase over the baseline fails. When a file shrinks, lower its baseline
 * here so the gain is locked in (the script prints the suggested new value).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Baselines captured 2026-05-28. Only lower these as the files shrink. A raise
// is allowed ONLY for a deliberate, reviewed change that is called out in its
// commit (e.g. the B1 warning-surfacing added ~17 lines to FullStoryPipeline);
// it must never creep up via unreviewed accretion — that's what this guards.
//
// +35 (21043 -> 21078): Phase-0 encounter default-collision gating (PR A 0.3).
// Drives best-effort encounter regeneration when an outcome ships identical
// fallback prose, as advisory-only (never blocks). The collision read lives in
// a helper (getPhase4DefaultCollisions); the remainder is loop-woven decision
// logic inside the existing Karpathy regeneration loop and is not separable
// without threading the loop's scene-local state into a helper.
const baselines = {
  'src/ai-agents/pipeline/FullStoryPipeline.ts': 21078,
  'src/ai-agents/services/imageGenerationService.ts': 6564,
};

let failed = false;
for (const [rel, baseline] of Object.entries(baselines)) {
  const full = path.join(projectRoot, rel);
  if (!fs.existsSync(full)) {
    console.error(`✗ ${rel} not found (path changed? update the ratchet).`);
    failed = true;
    continue;
  }
  // Count newlines to match `wc -l` semantics.
  const lines = (fs.readFileSync(full, 'utf8').match(/\n/g) || []).length;
  if (lines > baseline) {
    console.error(
      `✗ ${rel} grew to ${lines} lines (baseline ${baseline}, +${lines - baseline}). ` +
        `This file is slated for decomposition — do not add to it. Extract instead.`,
    );
    failed = true;
  } else if (lines < baseline) {
    console.log(`✓ ${rel}: ${lines} lines (under baseline ${baseline}). Lower the baseline to ${lines} to lock in the shrink.`);
  } else {
    console.log(`✓ ${rel}: ${lines} lines (at baseline).`);
  }
}

if (failed) process.exit(1);
console.log('Monolith ratchet OK.');
