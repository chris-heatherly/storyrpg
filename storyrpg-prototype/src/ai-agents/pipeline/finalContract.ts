/**
 * Final-story contract enforcement, validation-input shaping, and the
 * deterministic flag-chronology scan.
 *
 * Faithful port of FullStoryPipeline.enforceFinalStoryContract,
 * prepareValidationInput, and runFlagChronologyScan (pure move).
 * enforceFinalStoryContract runs the season-final canonicalization/rebalance +
 * regen routes, the FinalStoryContractValidator (with the encounter-quality
 * gate and the Wave-4 bounded repair loop), and throws on a failing contract.
 * prepareValidationInput shapes the per-episode scene/npc/choice/encounter
 * inputs the best-practices validators consume (canonicalizing witness +
 * relationship npcIds in place). runFlagChronologyScan is a pure forward-
 * reference / unreachable-condition scan over the assembled story.
 *
 * Extracted from FullStoryPipeline to keep that monolith from growing.
 */

import { PipelineConfig } from '../config';
import { Story, NPCTier, RelationshipDimension, Consequence } from '../../types';
import { EpisodeBlueprint } from '../agents/StoryArchitect';
import { CharacterBible } from '../agents/CharacterDesigner';
import { SceneContent } from '../agents/SceneWriter';
import { ChoiceSet } from '../agents/ChoiceAuthor';
import { EncounterStructure, EncounterTelemetry } from '../agents/EncounterArchitect';
import { QAReport } from '../agents/QAAgents';
import {
  FinalStoryContractValidator,
  type FinalStoryContractReport,
  applyEncounterQualityGate,
  SceneValidationResult,
} from '../validators';
import type { ComprehensiveValidationReport } from '../../types/validation';
import { runFidelityValidators } from '../validators/runFidelityValidators';
import { isGateEnabled, isShadowLoggingEnabled } from '../remediation/gateDefaults';
import { runFinalContractRepair, buildDeterministicContractHandlers, type ContractRepairReport } from '../remediation/finalContractRepair';
import { RemediationBudget, shouldAttemptRemediation } from '../remediation/RemediationBudget';
import { type RemediationLedgerRecord } from '../remediation/remediationLedger';
import { rebalanceSeasonSkillCoverage } from './seasonSkillRebalance';
import { type SeasonChoicePlan } from './seasonChoicePlan';
import { type SeasonSkillPlan } from './seasonSkillPlan';
import { foldTintFlagIntoConsequences } from './choiceAssembly';
import {
  canonicalizeWitnessReactions,
  ensureWitnessNpcsInScenes,
  canonicalizeRelationshipConsequences,
  canonicalizeStoryRelationshipConsequences,
} from '../utils/witnessNpcResolver';
import { PipelineError } from './errors';
import type { PipelineEvent } from './events';
// Type-only import — erased at runtime, so no runtime cycle with the monolith.
import type { FullCreativeBrief } from './FullStoryPipeline';

export interface FinalContractDeps {
  config: PipelineConfig;
  emit: (event: Omit<PipelineEvent, 'timestamp'>) => void;
  recordRemediationSafe: (
    record: Omit<RemediationLedgerRecord, 'timestamp' | 'runDir'> & { timestamp?: string; runDir?: string },
  ) => Promise<void>;
  recordFinalContractShadow: (
    input: { story: Story; brief: FullCreativeBrief },
    treatmentSourced: boolean,
    designNoteLeaks: number,
  ) => Promise<void>;
  disambiguateProtagonistPronouns: (story: Story, brief: FullCreativeBrief) => Promise<void>;
  authorEncounterOutcomeVariants: (story: Story) => Promise<void>;
  relationshipDimensionsForNpc: (
    initialStats: CharacterBible['characters'][number]['initialStats'] | undefined,
    tier?: 'core' | 'supporting' | 'background',
  ) => RelationshipDimension[];
  // Run-scoped state read during the contract (accessor-backed by the monolith).
  readonly allSceneValidationResults: SceneValidationResult[];
  readonly sceneValidationResults: SceneValidationResult[];
  readonly seasonChoicePlan: SeasonChoicePlan | undefined;
  readonly seasonSkillPlan: SeasonSkillPlan | undefined;
  readonly allEncounterTelemetry: EncounterTelemetry[];
  readonly remediationBudget: RemediationBudget | null;
}

export class FinalContract {
  constructor(private deps: FinalContractDeps) {}

  async enforceFinalStoryContract(input: {
    story: Story;
    brief: FullCreativeBrief;
    requestedEpisodeNumbers?: number[];
    qaReport?: QAReport;
    bestPracticesReport?: ComprehensiveValidationReport;
    phase: string;
  }): Promise<FinalStoryContractReport | undefined> {
    if (!this.deps.config.validation?.enabled || this.deps.config.validation?.mode === 'disabled') {
      return undefined;
    }

    // Defense-in-depth (G10): canonicalize relationship-consequence npcIds across the
    // ASSEMBLED final story before the contract's MechanicalStorytellingValidator scans for
    // "targets unknown NPC". prepareValidationInput already cleans the per-episode choiceSet
    // refs, but anything reconstructed during assembly is caught here against the story's own
    // roster. Idempotent (resolvable ids already canonical → no-op); remaps stragglers and
    // drops the genuinely-unknown so GATE_RELATIONSHIP_ID_INTEGRITY fires only on real residue.
    canonicalizeStoryRelationshipConsequences(input.story);

    // Season-final skill rebalance (G10): the per-scene ChoiceAuthor rebalance can't hit a
    // SEASON coverage target (≥6/8 skills, <30% dominance), so a perception-heavy season
    // (Bite Me G10: 4/8, perception 45%) still ships. This deterministic pass reassigns
    // single-skill checks off the over-used skill onto under-used ones (within each choice
    // type's plausible set) until the season clears the target. No LLM; fiction-first
    // (skill behind a check never surfaces). Logged for telemetry; runs before the contract
    // so SkillCoverageValidator sees the rebalanced result.
    {
      const r = rebalanceSeasonSkillCoverage(input.story);
      if (r.reassignments > 0) {
        console.info(
          `[Pipeline] season skill rebalance: ${r.reassignments} reassignment(s); ` +
          `coverage ${r.before.coveredSkills}→${r.after.coveredSkills}/8, ` +
          `dominance ${(r.before.dominantShare * 100).toFixed(0)}%→${(r.after.dominantShare * 100).toFixed(0)}% ` +
          `(${r.before.dominantSkill ?? '-'}→${r.after.dominantSkill ?? '-'})`,
        );
      }
    }

    // W1 regen route: BEFORE the contract reads protagonist-pronoun residue, run the
    // ambiguous-sentence disambiguator so the gate fires only on residue the regen
    // could not resolve (not on every protagonist+NPC sentence). Gated + LLM-backed,
    // so it costs nothing with GATE_PROTAGONIST_PRONOUN off and degrades to a no-op on
    // any failure. The contract's own deterministic resolver then re-scans the
    // (now-disambiguated) prose; only true residue survives to block.
    await this.deps.disambiguateProtagonistPronouns(input.story, input.brief);

    // W4 regen route: BEFORE the contract detects encounter-outcome desyncs, author the
    // missing outcome-conditioned opening variants so the gate fires only on
    // reconvergences the author could not cover. Gated + LLM-backed (zero cost with
    // GATE_ENCOUNTER_OUTCOME_VARIANT off; degrades to a no-op on failure).
    await this.deps.authorEncounterOutcomeVariants(input.story);

    // §4/GAP-D: dispatch the five treatment-fidelity validators (default-off per gate
    // flag) so §4.6 can keep authored-fidelity errors blocking. Logic is in the sibling
    // validators/runFidelityValidators.ts; this is one delegating call.
    const fidelity = runFidelityValidators({ story: input.story, seasonPlan: input.brief.seasonPlan, sourceAnalysis: input.brief.multiEpisode?.sourceAnalysis });

    // One validation pass = FinalStoryContractValidator + the encounter-quality
    // gate (merged in place). Factored into a closure so the Wave-4 repair loop can
    // re-validate a repaired story with identical inputs.
    const runValidation = async (story: Story): Promise<FinalStoryContractReport> => {
      const r = await new FinalStoryContractValidator().validate({
        story,
        protagonist: input.brief.protagonist
          ? { name: input.brief.protagonist.name, pronouns: input.brief.protagonist.pronouns }
          : undefined,
        requestedEpisodeNumbers: input.requestedEpisodeNumbers,
        sourceSeasonPlan: input.brief.seasonPlan,
        incrementalValidationResults: this.deps.allSceneValidationResults.length > 0
          ? this.deps.allSceneValidationResults
          : this.deps.sceneValidationResults,
        qaReport: input.qaReport,
        bestPracticesReport: input.bestPracticesReport,
        validSkills: Object.keys(story.initialState?.skills || {}),
        mode: this.deps.config.validation.mode,
        fidelityFindings: fidelity.fidelityFindings,
        treatmentSourced: fidelity.treatmentSourced,
        // L2 conformance: each generated episode realizes the season plan's per-episode
        // choice-type budget and leans on its planned skills (balance itself is validated
        // at plan time, over the whole season).
        seasonChoicePlan: this.deps.seasonChoicePlan,
        seasonSkillPlan: this.deps.seasonSkillPlan,
      });
      try {
        // Season-final gate: read the cross-episode accumulator (superset of the
        // per-episode buffer, which is reset each episode).
        applyEncounterQualityGate(r, story, this.deps.allEncounterTelemetry);
      } catch (encErr) {
        console.warn(`[Pipeline] EncounterQualityValidator failed (non-fatal): ${(encErr as Error).message}`);
      }
      return r;
    };

    let report = await runValidation(input.story);

    // Wave-0 shadow telemetry for the final-contract-class gates (design-note +
    // treatment-fidelity), recorded regardless of flag so off→on has data.
    if (isShadowLoggingEnabled()) {
      await this.deps.recordFinalContractShadow(input, fidelity.treatmentSourced, report.metrics.designNoteLeaks ?? 0);
    }

    // Wave 4 keystone: attempt bounded repair + re-validation BEFORE the hard abort,
    // instead of throwing on first failure. Default-off (GATE_FINAL_CONTRACT_REPAIR);
    // deterministic handlers today, LLM-regen handlers plug in here next.
    if (!report.passed && isGateEnabled('GATE_FINAL_CONTRACT_REPAIR')) {
      const outcome = await runFinalContractRepair({
        story: input.story,
        initialReport: report as ContractRepairReport,
        handlers: buildDeterministicContractHandlers(),
        revalidate: async (s) => (await runValidation(s)) as ContractRepairReport,
        maxAttempts: 2,
        canSpend: () => shouldAttemptRemediation(this.deps.remediationBudget),
      });
      report = outcome.report as FinalStoryContractReport;
      for (const rec of outcome.records) await this.deps.recordRemediationSafe(rec);
      this.deps.emit({
        type: 'checkpoint',
        phase: input.phase,
        message: `Final contract repair ran ${outcome.attempts} round(s); now ${report.passed ? 'passing' : 'still failing'}`,
      } as any);
    }

    this.deps.emit({
      type: report.passed ? 'checkpoint' : 'error',
      phase: input.phase,
      message: report.passed
        ? `Final story contract passed (${report.metrics.episodesChecked} episode(s), ${report.metrics.scenesChecked} scene(s))`
        : `Final story contract failed with ${report.blockingIssues.length} blocking issue(s): ${report.blockingIssues.slice(0, 3).map(issue => issue.message).join('; ')}`,
      data: report,
    });

    if (!report.passed) {
      throw new PipelineError(
        `Final story contract failed with ${report.blockingIssues.length} blocking issue(s)`,
        input.phase,
        {
          context: {
            failureKind: 'final_story_contract',
            blockingIssues: report.blockingIssues.slice(0, 10),
            metrics: report.metrics,
          },
        }
      );
    }

    return report;
  }

  prepareValidationInput(
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    characterBible: CharacterBible,
    encounters?: Map<string, EncounterStructure>,
    blueprint?: EpisodeBlueprint
  ) {
    // D3: leadsTo lives on the blueprint scene, NOT on SceneContent — read it from the
    // blueprint by id so BranchMechanicalDivergenceValidator can see routing forks
    // (reading sc.leadsTo got `undefined`, so leadsTo-routed branches scored 0).
    const leadsToById = new Map<string, string[] | undefined>(
      (blueprint?.scenes ?? []).map((s) => [s.id, s.leadsTo]),
    );
    // Branch-point targets by scene: a scene whose choicePoint genuinely diverges
    // (branches===true with ≥2 distinct leadsTo targets). Choices at these scenes route
    // to different scenes at runtime via bridge beats, so they carry no `nextSceneId` on
    // the choice object after branchRepair — which made every branch-aware validator
    // (IBPV isHighStakes, ChoiceDistribution branchingCount) under-count branching to 0.
    // We re-derive the effective scene target from the blueprint so validation is honest.
    // Only TRUE branch points are marked (linear bottlenecks stay non-branching) to keep
    // branchingCount under the per-episode cap. See SceneGraphBranchValidator.
    const branchPointTargetsByScene = new Map<string, string[]>();
    for (const s of blueprint?.scenes ?? []) {
      const targets = Array.from(new Set(s.leadsTo ?? []));
      if (s.choicePoint?.branches && targets.length >= 2) {
        branchPointTargetsByScene.set(s.id, targets);
      }
    }
    // Canonicalize witnessReaction npcIds against the canonical character roster
    // BEFORE validation. Upstream authoring uses raw per-scene NPC labels, so without
    // this the per-episode best-practices report (and thus the aggregate + final-gate)
    // carries "unknown NPC" witness errors. Mutates the shared choiceSet refs in place,
    // so the assembled story is corrected too. Lets GATE_WITNESS_ID_INTEGRITY enforce safely.
    canonicalizeWitnessReactions(choiceSets, characterBible.characters.map((c) => ({ id: c.id, name: c.name })));
    // Same chokepoint for RELATIONSHIP-consequence npcIds (G10): authoring emits raw
    // labels ("mika", "lysandra_brightwell", "Captain Rorik Thorne") that don't match the
    // canonical char-* roster, so the bond delta is silently dropped at runtime. Remap the
    // resolvable ones to their canonical id and drop the genuinely-unknown ones IN PLACE
    // (mutates the shared choiceSet refs, so the assembled story is corrected too). This is
    // what lets GATE_RELATIONSHIP_ID_INTEGRITY enforce on real residue only.
    canonicalizeRelationshipConsequences(choiceSets, characterBible.characters.map((c) => ({ id: c.id, name: c.name })));
    // Then add each canonical witness NPC to its scene's roster (deterministic repair
    // for the "not listed in scene" presence warning). Additive-only; mutates the
    // shared sceneContents refs so both validation and the assembled story see it.
    if (isGateEnabled('GATE_WITNESS_SCENE_PRESENCE')) {
      ensureWitnessNpcsInScenes(
        sceneContents as Array<{ sceneId: string; beats?: Array<{ id?: string }>; charactersInvolved?: string[] }>,
        choiceSets,
        new Set(characterBible.characters.map((c) => c.id)),
      );
    }
    // Prepare scenes for validation
    const scenes = sceneContents.map(sc => ({
      id: sc.sceneId,
      charactersInvolved: sc.charactersInvolved || [],
      leadsTo: leadsToById.get(sc.sceneId) ?? (sc as { leadsTo?: string[] }).leadsTo,
      beats: sc.beats.map(b => ({
        id: b.id,
        text: b.text,
        isChoicePoint: b.isChoicePoint,
        textVariants: b.textVariants?.map((variant) => ({
          condition: variant.condition,
          text: variant.text,
          callbackHookId: variant.callbackHookId,
        })),
      })),
    }));

    // Prepare NPCs for validation
    const npcs = characterBible.characters
      .filter(c => c.role !== 'protagonist')
      .map(c => {
        // Phase 1.3: Read tier directly from CharacterProfile. Fall back to
        // role-based inference only when the authored tier is missing (older
        // character bibles). New runs should always carry an authored tier.
        let tier: NPCTier;
        const authoredTier = (c as unknown as { tier?: NPCTier }).tier;
        if (authoredTier === 'core' || authoredTier === 'supporting' || authoredTier === 'background') {
          tier = authoredTier;
        } else {
          tier = 'background';
          if (c.role === 'antagonist' || c.role === 'ally') tier = 'core';
          else if (c.role === 'neutral') tier = 'supporting';
        }

        const dimensions = this.deps.relationshipDimensionsForNpc(c.initialStats, tier);

        return {
          id: c.id,
          name: c.name,
          tier,
          relationshipDimensions: dimensions,
        };
      });

    // Prepare choices for validation (regular choices)
    const choices = choiceSets.flatMap(cs => {
      const branchTargets = cs.sceneId ? branchPointTargetsByScene.get(cs.sceneId) : undefined;
      return cs.choices.map((choice, choiceIdx) => ({
        id: choice.id,
        text: choice.text,
        choiceType: choice.choiceType || cs.choiceType,
        // D1: fold tintFlag into consequences so the budget classifier counts cosmetic
        // tint flags as the tint tier (validation runs on raw choiceSets, BEFORE story
        // assembly does the same fold — so without this the metric showed tint 0%).
        consequences: foldTintFlagIntoConsequences(choice.consequences || [], choice.tintFlag) || [],
        // Prefer the AUTHORED triangle (choice.stakes) so any annotation reader scores
        // the real content, not StoryArchitect's placeholder sentinel. The validator
        // (resolveStakesForValidation) also reads choice.stakes directly; this keeps the
        // annotation consistent for belt-and-suspenders. See constants/placeholderStakes.ts.
        stakesAnnotation: choice.stakes ?? choice.stakesAnnotation ?? cs.overallStakes,
        sceneContext: cs.designNotes,
        // Effective scene target: the authored nextSceneId, or — for a genuine
        // branch point whose choices route via bridge beats — the blueprint leadsTo
        // target for this choice. Makes branch-aware validators see the branch.
        nextSceneId: choice.nextSceneId
          ?? (branchTargets ? branchTargets[choiceIdx % branchTargets.length] : undefined),
        reminderPlan: choice.reminderPlan,
        choiceIntent: choice.choiceIntent,
        impactFactors: choice.impactFactors,
        consequenceTier: choice.consequenceTier,
        stakes: choice.stakes,
        outcomeTexts: choice.outcomeTexts,
        lockedText: choice.lockedText,
        reactionText: choice.reactionText,
        sceneId: cs.sceneId,
        statCheck: choice.statCheck,
        conditions: choice.conditions,
        showWhenLocked: choice.showWhenLocked,
        tintFlag: choice.tintFlag,
        delayedConsequences: choice.delayedConsequences,
        residueHints: choice.residueHints,
        memorableMoment: choice.memorableMoment,
        storyVerb: choice.storyVerb,
        affordanceSource: choice.affordanceSource,
        witnessReactions: choice.witnessReactions,
        failureResidue: choice.failureResidue,
      }));
    });

    // Prepare encounters for validation
    const encounterValidation = encounters ? Array.from(encounters.values()).map(enc => ({
      sceneId: enc.sceneId,
      type: enc.encounterType,
      beatCount: enc.beats.length,
      hasStorylets: !!(enc.storylets?.victory && enc.storylets?.defeat),
      hasEnvironmentalElements: (enc.environmentalElements?.length || 0) > 0,
      hasNPCStates: (enc.npcStates?.length || 0) > 0,
      hasEscalationTriggers: (enc.escalationTriggers?.length || 0) > 0,
      choiceCount: enc.beats.reduce((sum, b) => sum + (b.choices?.length || 0), 0),
      // Validate beat flow - each non-terminal beat should have choices with nextBeatId
      beatFlowValid: enc.beats.every((beat, idx) => {
        if (beat.isTerminal || idx === enc.beats.length - 1) return true;
        return beat.choices?.every(c =>
          c.outcomes?.success?.nextBeatId &&
          c.outcomes?.complicated?.nextBeatId &&
          c.outcomes?.failure?.nextBeatId
        ) ?? false;
      }),
      // Validate storylets have beats
      storyletsValid: enc.storylets ? (
        (enc.storylets.victory?.beats?.length || 0) > 0 &&
        (enc.storylets.defeat?.beats?.length || 0) > 0
      ) : false,
    })) : [];

    // Phase 1.2: Populate knownFlags/knownScores from beat onShow + choice consequences
    // so CallbackOpportunitiesValidator can detect "flag set but never referenced".
    const knownFlagSet = new Set<string>();
    const knownScoreSet = new Set<string>();
    const collectFromConsequence = (c: { type?: string; name?: string } | undefined) => {
      if (!c || !c.name) return;
      if (c.type === 'setFlag' || c.type === 'flag' || c.type === 'addTag' || c.type === 'removeTag') {
        knownFlagSet.add(c.name);
      } else if (c.type === 'changeScore' || c.type === 'score' || c.type === 'attribute') {
        knownScoreSet.add(c.name);
      }
    };
    for (const sc of sceneContents) {
      for (const beat of sc.beats) {
        const onShow = (beat as unknown as { onShow?: Array<{ type?: string; name?: string }> }).onShow;
        if (Array.isArray(onShow)) for (const c of onShow) collectFromConsequence(c);
      }
    }
    for (const cs of choiceSets) {
      for (const ch of cs.choices) {
        const consequences = (ch as unknown as { consequences?: Array<{ type?: string; name?: string }> }).consequences;
        if (Array.isArray(consequences)) for (const c of consequences) collectFromConsequence(c);
        const delayed = (ch as unknown as { delayedConsequences?: Array<{ consequence?: { type?: string; name?: string } }> }).delayedConsequences;
        if (Array.isArray(delayed)) for (const d of delayed) collectFromConsequence(d.consequence);
      }
    }
    if (encounters) {
      for (const enc of encounters.values()) {
        for (const beat of enc.beats || []) {
          for (const ch of beat.choices || []) {
            for (const tier of ['success', 'complicated', 'failure'] as const) {
              const out = (ch as unknown as { outcomes?: Record<string, { consequences?: Array<{ type?: string; name?: string }> }> }).outcomes?.[tier];
              if (out?.consequences) for (const c of out.consequences) collectFromConsequence(c);
            }
          }
        }
      }
    }
    const knownFlags = Array.from(knownFlagSet);
    const knownScores = Array.from(knownScoreSet);

    // Raw encounter structures (for Pixar principles validation)
    const encounterStructures = encounters ? Array.from(encounters.values()) : [];

    return {
      scenes,
      npcs,
      choices,
      encounters: encounterValidation,
      encounterStructures,
      knownFlags,
      knownScores,
    };
  }

  runFlagChronologyScan(story: Story): string[] {
    const issues: string[] = [];
    const accumulatedFlags = new Set<string>();

    // Relationship upper-bound tracking: initial values + sum of positive changes
    const relBaselines = new Map<string, number>(); // "npcId:dim" -> initial value
    const relGains = new Map<string, number>();     // "npcId:dim" -> accumulated positive changes

    // Initialize relationship baselines from story NPCs
    for (const npc of story.npcs || []) {
      for (const dim of ['trust', 'affection', 'respect', 'fear'] as const) {
        const key = `${npc.id}:${dim}`;
        relBaselines.set(key, (npc as any).initialRelationship?.[dim] ?? 0);
      }
    }

    const getRelUpperBound = (npcId: string, dim: string): number => {
      const key = `${npcId}:${dim}`;
      return (relBaselines.get(key) ?? 0) + (relGains.get(key) ?? 0);
    };

    const isComparisonUnreachable = (upperBound: number, operator: string, threshold: number): boolean => {
      switch (operator) {
        case '>':  return upperBound <= threshold;
        case '>=': return upperBound < threshold;
        case '==': return upperBound < threshold;
        default:   return false;
      }
    };

    // Collect flags from initialState
    const initialStateFlags = (story.initialState as typeof story.initialState & { flags?: Record<string, unknown> } | undefined)?.flags;
    if (initialStateFlags) {
      for (const [k, v] of Object.entries(initialStateFlags)) {
        if (v) accumulatedFlags.add(k);
      }
    }

    const collectConsequences = (consequences?: Consequence[]) => {
      if (!consequences) return;
      for (const c of consequences) {
        if (c.type === 'setFlag' && (c as any).flag) {
          accumulatedFlags.add((c as any).flag);
        }
        const rel = c as any;
        if ((rel.type === 'relationship' || rel.type === 'changeRelationship') &&
            (rel.characterId || rel.npcId) && rel.dimension && typeof rel.change === 'number' && rel.change > 0) {
          const key = `${rel.characterId || rel.npcId}:${rel.dimension}`;
          relGains.set(key, (relGains.get(key) ?? 0) + rel.change);
        }
      }
    };

    const checkExpr = (expr: any, location: string) => {
      if (!expr || typeof expr !== 'object') return;
      const type = expr.type as string | undefined;
      if (type === 'flag') {
        const flag = expr.flag as string;
        if (flag && !accumulatedFlags.has(flag)) {
          issues.push(
            `Forward-reference: "${flag}" used in condition at ${location} but not set by any prior scene`
          );
        }
      } else if (type === 'relationship') {
        const npcId = expr.npcId as string;
        const dim = expr.dimension as string;
        const op = expr.operator as string;
        const val = expr.value as number;
        if (npcId && dim && op && typeof val === 'number') {
          const ub = getRelUpperBound(npcId, dim);
          if (isComparisonUnreachable(ub, op, val)) {
            issues.push(
              `Unreachable relationship condition: "${npcId}.${dim} ${op} ${val}" at ${location} (max achievable: ${ub})`
            );
          }
        }
      } else if (type === 'and' || type === 'or') {
        if (Array.isArray(expr.conditions)) {
          for (const child of expr.conditions) checkExpr(child, location);
        }
      } else if (type === 'not') {
        if (expr.condition) checkExpr(expr.condition, location);
      } else if (!type) {
        const keys = Object.keys(expr);
        if (keys.length === 1 && typeof expr[keys[0]] === 'boolean') {
          if (!accumulatedFlags.has(keys[0])) {
            issues.push(
              `Forward-reference: "${keys[0]}" used in condition at ${location} but not set by any prior scene`
            );
          }
        }
      }
    };

    const walkEncounterChoiceOutcomes = (outcomes: any, loc: string) => {
      if (!outcomes) return;
      for (const tier of ['success', 'complicated', 'failure']) {
        const outcome = outcomes[tier];
        if (!outcome) continue;
        collectConsequences(outcome.consequences);
        if (outcome.nextSituation?.choices) {
          for (const c of outcome.nextSituation.choices) {
            if (c.conditions) checkExpr(c.conditions, `${loc}:${c.id}`);
            if (c.statBonus?.condition) checkExpr(c.statBonus.condition, `${loc}:${c.id}:statBonus`);
            walkEncounterChoiceOutcomes(c.outcomes, `${loc}:${c.id}`);
          }
        }
      }
    };

    for (const episode of story.episodes || []) {
      for (const scene of episode.scenes || []) {
        // 1. Check narrative beat choice conditions
        for (const beat of scene.beats || []) {
          if (beat.choices) {
            for (const choice of beat.choices) {
              if (choice.conditions) {
                checkExpr(choice.conditions, `${scene.id}:${beat.id}:${choice.id}`);
              }
            }
          }
        }

        // 2. Check encounter choice conditions
        if (scene.encounter?.phases) {
          for (const phase of scene.encounter.phases) {
            for (const beat of phase.beats || []) {
              const encBeat = beat as any;
              if (encBeat.choices) {
                for (const choice of encBeat.choices) {
                  const loc = `encounter:${scene.id}:${encBeat.id}:${choice.id}`;
                  if (choice.conditions) checkExpr(choice.conditions, loc);
                  if (choice.statBonus?.condition) checkExpr(choice.statBonus.condition, `${loc}:statBonus`);
                  walkEncounterChoiceOutcomes(choice.outcomes, loc);
                }
              }
            }
          }
        }

        // 3. Accumulate flags from narrative choices (consequences)
        for (const beat of scene.beats || []) {
          if (beat.choices) {
            for (const choice of beat.choices) {
              collectConsequences(choice.consequences);
              if (choice.delayedConsequences) {
                for (const dc of choice.delayedConsequences) {
                  collectConsequences(dc.consequence ? [dc.consequence] : undefined);
                }
              }
            }
          }
        }

        // 4. Accumulate flags from encounter choice outcomes
        if (scene.encounter?.phases) {
          for (const phase of scene.encounter.phases) {
            for (const beat of phase.beats || []) {
              const encBeat = beat as any;
              if (encBeat.choices) {
                for (const choice of encBeat.choices) {
                  walkEncounterChoiceOutcomes(choice.outcomes, `${scene.id}:${encBeat.id}:${choice.id}`);
                }
              }
            }
          }
          // Encounter overall outcomes
          if (scene.encounter.outcomes) {
            for (const key of Object.keys(scene.encounter.outcomes)) {
              const outcome = (scene.encounter.outcomes as any)[key];
              collectConsequences(outcome?.consequences);
            }
          }
        }
      }
    }

    return issues;
  }
}
