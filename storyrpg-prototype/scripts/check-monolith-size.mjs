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
//
// +10 (21285 -> 21295): Season Canon P5 — season-completion gate. When the whole
// season has sealed, advisory-check that every promise is paid or abandoned. Gate
// lives in validators/promiseLedgerValidators.ts (validateSeasonCompletion) +
// pipeline/spinePlantMap.ts; only the thin season-end call site + import are here.
//
// +63 (21295 -> 21358): audit-fix phases B/C/E/F net. Phase B (character-consistency)
// adds the repairContinuityFindings orchestration method (SceneCritic re-author +
// merge — needs `this`, so it lives here) plus grounding of ContinuityChecker
// establishedFacts and SceneWriter NPC descriptions and the canon-seal extraDeltas;
// pure logic is in pipeline/characterCanonFacts.ts + continuityRepair.ts. Phases
// C/E/F net-shrank their call sites (sceneNumbering / outcomeVariants / tint plants).
//
// +13 (21358 -> 21371): Phase G — apply the derived spine plant→payoff map onto the
// ledger before each seal (deriveSpinePlantMap from seasonFlags + applySpinePlantMap,
// both in pipeline/spinePlantMap.ts) and the seasonCanonBlocking hard-fail branch;
// only the thin apply + throw call sites are here.
//
// +10 (21371 -> 21381): Season Canon defaults ON (opt-out) via a `seasonCanonOn`
// getter — the seasonCanonEnabled flag is built client-side (GeneratorScreen), so an
// older generator bundle would post it undefined and silently disable canon; treating
// undefined as on makes "on for all generations" hold regardless of the client bundle.
//
// +33 (21381 -> 21414): audit-gap fixes 2 + 3. Fix 2 makes continuity repair run even
// when SceneCritic is disabled (construct a one-off) and persists continuity-repair.json
// so it's not invisibly inert. Fix 3 re-asserts the choice-type plan on the content-loop
// blueprint + persists choice-type-plan.json to diagnose allocation-vs-propagation. Pure
// logic stays in characterCanonFacts/continuityRepair/choiceTypePlanner; only the repair
// method body + the re-assert/persist call site are here.
//
// +8 (21414 -> 21422): audit-gap A1 — relocate the continuity-repair call into its own
// try/catch after the QA block (a QA-phase throw no longer skips repair) + an entry log.
//
// +22 (21422 -> 21444): B1 canon read-back (establishedCanonForPrompt getter + the
// establishedCanon field threaded into the SceneWriter + ChoiceAuthor inputs — the
// read-side of the canon loop) and B3a (thread PipelineError phase/agent into the
// failed-run quality-ledger row). Canon rendering lives in seasonCanon.canonForPrompt.
//
// +18 (21444 -> 21462): B2 — extract prose knowledge + flag claims at the seal site
// (extractEpisodeKnowledge + collectReferencedFlags in pipeline/knowledgeExtraction.ts)
// so the canon holds who-knows-what and the canon-consistency gate runs over real
// claims instead of being a no-op. Only the seal-site call + merge are here.
//
// +11 (21462 -> 21473): D2 — seasonCanonBlockingOn getter (blocking on by default,
// opt-out) so a promise/canon ERROR hard-fails the offending episode; the seal block
// now consults the getter. Config defaults flipped to opt-out in config.ts.
//
// +6 (21473 -> 21479): D1/D3 metric wiring — prepareValidationInput now folds tintFlag
// into the validated consequences (so the budget classifier sees tint flags) and carries
// scene.leadsTo (so BranchMechanicalDivergence sees routing forks). The validation input
// previously stripped both, so the fixes never reached the metrics.
//
// +14 (21479 -> 21493): continuity-repair diagnostic — always persist continuity-repair.json
// (even on 0 candidates) recording how many continuity issues the repair actually saw, so
// the artifact's absence stops being ambiguous and reveals whether the repair runs/sees data.
const baselines = {
  // +16 (21493 -> 21509): E2 — guard the SceneCritic construction in repairContinuityFindings
  // so a failure there writes the diagnostic + emits instead of vanishing into the outer
  // catch (the likely cause of the missing artifact). Diagnostic now records issues seen.
  //
  // +13 (21509 -> 21522): D3 leadsTo source fix (read leadsTo from the blueprint scene by id
  // in prepareValidationInput, not from SceneContent which lacks it) + a repair-reach skip
  // diagnostic (write continuity-repair.json with a reason when the repair guard is false).
  'src/ai-agents/pipeline/FullStoryPipeline.ts': 21522,
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
