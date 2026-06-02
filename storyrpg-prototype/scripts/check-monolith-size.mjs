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
//
// +150 (21078 -> 21228): structure-driven progress plan instrumentation, incl.
// per-scene active/activity emission for the generator progress UI. The plan
// math/accumulation lives in pipeline/generationPlan.ts; the remainder is
// irreducible per-episode/scene/beat emission call sites woven through the run.
//
// -56 (21228 -> 21172): extracted callback orchestration (episode harvest +
// unresolved-hook prompt shaping) to pipeline/callbackOrchestration.ts. The
// pipeline keeps thin delegating wrappers. Decomposition progress (PR B).
//
// +18 (21172 -> 21190): track encounter scenes in the progress plan at their
// true completion (EncounterArchitect done, incl. storylets) + show "designing
// encounter" while in progress, so episode completion is derived from all scenes
// actually finishing rather than a forced flag ("3/5 scenes · 100%" fix).
//
// +23 (21190 -> 21213): run StructuralValidator.autoFix on the merged
// multi-episode season before the final-story contract (parity with the
// single-episode path, which already did) — repairs dangling choice navigation
// so the contract doesn't abort on mechanically fixable defects.
//
// +11 (21213 -> 21224): wire the blocking EncounterQualityValidator into the
// final-story gate (catches encounters that shipped template/boilerplate prose
// or an unfillable clock — the Endsong climax bug). The validator + its merge
// orchestration live in validators/EncounterQualityValidator.ts
// (applyEncounterQualityGate); only the thin try/catch call site is here.
//
// +13 (21224 -> 21237): reconcile the consequence-budget target to the validator
// (tint 25 / branch 5, not 20/10) + run the choice-type rebalance after
// StoryArchitect so the episode can't ship 0% expression / 0% relationship
// choices. Allocation logic lives in pipeline/choiceTypePlanner.ts; only the
// thin call site + the corrected literal are here.
//
// +3 (21237 -> 21240): SceneWriter beat cap (B3) — clamp getTargetBeatCountForScene
// to config.maxBeatsPerScene || MAX_BEATS_PER_SCENE so an outlier blueprint can't
// produce a pathologically large single SceneWriter generation. Cap constant +
// pure clampTargetBeatCount live in config.ts; only the Math.min wrap of the two
// return branches is here.
//
// +1 (21240 -> 21241): final-scene payoff beats fall back to the 'episode-end'
// sentinel (leadsTo?.[0] || 'episode-end') so they route consistently instead of
// dead-ending — pairs with the reader's terminal-sentinel handling. One-line comment.
//
// +1 (21241 -> 21242): raise SourceMaterialAnalyzer maxTokens 16384 -> 32000 so the
// structure-analysis JSON for rich multi-episode treatments stops truncating at the
// cap (unparseable mid-string). One-line comment.
//
// +6 (21242 -> 21248): Season Canon P1 — within-episode plant context. Accumulate
// flags planted by earlier scenes and merge them into the unresolvedCallbacks fed to
// later scenes so SceneWriter authors within-episode callback payoffs. Logic lives in
// pipeline/episodePlantContext.ts; only the running list + two thin call sites here.
//
// +37 (21248 -> 21285): Season Canon P4 — incremental seal/resume runner wiring.
// Per-run reset + disk-resume rehydration of the durable SeasonCanon/PromiseLedger/
// snapshot, and the per-episode seal call in the sequential loop (advisory gate,
// default-off via generation.seasonCanonEnabled). All logic lives in
// pipeline/seasonSealOrchestration.ts / seasonCanon.ts / episodeStateSnapshot.ts;
// these are the irreducible reset/resume/seal call sites + two new private fields.
const baselines = {
  'src/ai-agents/pipeline/FullStoryPipeline.ts': 21285,
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
