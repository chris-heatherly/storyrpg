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
import { ChoiceAuthor, ChoiceSet } from '../agents/ChoiceAuthor';
import { EncounterStructure, EncounterTelemetry } from '../agents/EncounterArchitect';
import {
  QAReport,
} from '../agents/QAAgents';
import {
  FinalStoryContractValidator,
  type FinalStoryContractReport,
  applyEncounterQualityGate,
  SceneValidationResult,
} from '../validators';
import type { ComprehensiveValidationReport } from '../../types/validation';
import { runFidelityValidators, type FidelityFinding } from '../validators/runFidelityValidators';
import { isGateEnabled, isShadowLoggingEnabled } from '../remediation/gateDefaults';
import { runFinalContractRepair, buildDeterministicContractHandlers, type ContractRepairHandler, type ContractRepairReport } from '../remediation/finalContractRepair';
import { GateRepairRouter } from '../remediation/gateRepairRouter';
import { buildSceneClusterRepairHandler, buildSceneProseRepairHandler } from '../remediation/sceneProseRepairHandler';
import { requiredMomentFromMessage } from '../remediation/realizationScoring';
import { buildOutcomeTextRepairHandler } from '../remediation/outcomeTextRepairHandler';
import { repairDetectedTransitionBridgeContinuity } from '../remediation/transitionBridgeRepairHandler';
import { buildRelationshipPacingLabelRepairHandler } from '../remediation/relationshipPacingLabelRepairHandler';
import { SceneCritic } from '../agents/SceneCritic';
import { FidelityRealizationJudge, confirmHeuristicFidelityFindings } from '../validators/fidelityRealizationJudge';
import type { FidelityValidationScope } from '../validators/runFidelityValidators';
import type { ValidationPhaseBaseline } from '../validators/validationPhaseBaseline';
import { classifyTreatmentObligation } from '../validators/treatmentObligationClassifier';
import { RemediationBudget, shouldAttemptRemediation } from '../remediation/RemediationBudget';
import { type RemediationLedgerRecord } from '../remediation/remediationLedger';
import { rebalanceSeasonSkillCoverage } from './seasonSkillRebalance';
import { type SeasonChoicePlan } from './seasonChoicePlan';
import { type SeasonSkillPlan } from './seasonSkillPlan';
import { foldTintFlagIntoConsequences } from './choiceAssembly';
import { plannedChoiceTypesByScene, plannedConsequenceTiersByScene } from './plannedSceneBudgets';
import { normalizeEncounterOutcomeNavigation } from './encounterOutcomeNavigation';
import { reconcileRelationshipPacingWithChoiceTypes } from './relationshipPacingChoiceTypeReconciliation';
import type { CallbackLedger } from './callbackLedger';
import {
  canonicalizeWitnessReactions,
  ensureWitnessNpcsInScenes,
  canonicalizeRelationshipConsequences,
  canonicalizeStoryRelationshipConsequences,
} from '../utils/witnessNpcResolver';
import { normalizeChoiceSetStatChecks, normalizeStoryStatChecks } from '../utils/statCheckNormalization';
import { buildSceneConstructionPromptView } from '../utils/sceneConstructionProfile';
import { PipelineError } from './errors';
import type { PipelineEvent } from './events';
// Type-only import — erased at runtime, so no runtime cycle with the monolith.
import type { FullCreativeBrief } from './FullStoryPipeline';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { isPlanningRegisterText } from '../constants/planningRegisterText';

type FinalContractWarning = NonNullable<FinalStoryContractReport['warnings']>[number];

function plannedMomentSourcesFromScenePlan(scenePlan: SeasonScenePlan | undefined) {
  if (!scenePlan?.scenes?.length) return undefined;
  const out = new Map<string, {
    requiredBeats?: Array<{ tier?: string; mustDepict?: string }>;
    storyCircleBeatContracts?: Array<{ beat?: string; sourceText?: string; requiredRealization?: string[] }>;
    signatureMoment?: string;
  }>();
  for (const scene of scenePlan.scenes) {
    if (!scene.id) continue;
    const promptView = buildSceneConstructionPromptView(scene);
    out.set(scene.id, {
      requiredBeats: promptView.requiredBeats,
      storyCircleBeatContracts: promptView.storyCircleBeatContracts,
      signatureMoment: (promptView as { signatureMoment?: string }).signatureMoment,
    });
  }
  return out;
}

function architecturalRepairBlockersFor(
  issues: ContractRepairReport['blockingIssues'],
  routeIssue: (issue: ContractRepairReport['blockingIssues'][number]) => ReturnType<GateRepairRouter['routeIssue']>,
): ContractRepairReport['blockingIssues'] {
  return issues.filter((issue) => {
    const route = routeIssue(issue);
    return route.kind === 'blueprint_rebalance'
      || route.kind === 'episode_replan'
      || route.kind === 'diagnostic_stop';
  });
}

export function guardLlmContractRepairForArchitecture(
  handler: ContractRepairHandler,
  routeIssue: (issue: ContractRepairReport['blockingIssues'][number]) => ReturnType<GateRepairRouter['routeIssue']>,
  emit: (message: string) => void,
): ContractRepairHandler {
  return (ctx) => {
    const blockers = architecturalRepairBlockersFor(ctx.blockingIssues, routeIssue);
    if (blockers.length === 0) {
      return handler(ctx);
    }
    // One architecture-class blocker must not starve repairs for INDEPENDENT
    // issues in the same report — bite-me 2026-07-02T20-30-27: a relationship
    // architecture blocker disabled every LLM handler for every round, so a
    // trivially re-authorable outcome-text stub shipped unrepaired and the run
    // aborted with both. Hand the handler the repairable subset instead of
    // skipping it; skip only when NOTHING it could act on remains.
    const architecturalIds = new Set(blockers.map((issue) => issue));
    const repairable = ctx.blockingIssues.filter((issue) => !architecturalIds.has(issue));
    if (repairable.length === 0) {
      emit(`Final contract LLM repair skipped this round because all ${blockers.length} blocker(s) require blueprint, route, or relationship architecture repair first.`);
      return { story: ctx.story, changed: false };
    }
    emit(`Final contract LLM repair proceeding on ${repairable.length} repairable issue(s); ${blockers.length} architecture-class blocker(s) withheld from LLM repair this round.`);
    return handler({ ...ctx, blockingIssues: repairable });
  };
}

function countSceneTurnWarnings(report: Pick<FinalStoryContractReport, 'warnings'>): number {
  return (report.warnings || [])
    .filter((issue: FinalContractWarning) => issue.validator === 'SceneTurnRealizationValidator')
    .length;
}

export function sceneTurnWarningsForRepair(report: FinalStoryContractReport): ContractRepairReport['blockingIssues'] {
  return (report.warnings || [])
    .filter((issue: FinalContractWarning) =>
      issue.validator === 'SceneTurnRealizationValidator'
      && Boolean(issue.sceneId)
      && /\b(?:does not dramatize|does not give it complete scene shape|no reader-facing prose|carries Story Circle|carries arc pressure)\b/i.test(issue.message || '')
    )
    .map((issue: FinalContractWarning) => ({
      ...issue,
      severity: 'error',
    }));
}

function cloneStoryForAdvisoryRepair(story: Story): Story {
  return JSON.parse(JSON.stringify(story)) as Story;
}

const CLASSIFIED_TREATMENT_VALIDATORS = new Set([
  'RequiredBeatRealizationValidator',
  'SignatureDevicePresenceValidator',
  'TreatmentEventLedgerValidator',
  'TreatmentFieldUtilizationValidator',
]);

export function selectFinalContractPlannedChoiceTypes(
  runScopedChoiceTypes: Record<string, string> | undefined,
  seasonPlan: FullCreativeBrief['seasonPlan'],
): Record<string, string> {
  return runScopedChoiceTypes && Object.keys(runScopedChoiceTypes).length > 0
    ? runScopedChoiceTypes
    : plannedChoiceTypesByScene(seasonPlan);
}

export function downgradeNonBlockingTreatmentObligations(report: FinalStoryContractReport): number {
  if (!report.blockingIssues?.length) return 0;
  const kept: typeof report.blockingIssues = [];
  const downgraded: typeof report.blockingIssues = [];

  for (const issue of report.blockingIssues) {
    if (!CLASSIFIED_TREATMENT_VALIDATORS.has(issue.validator || '')) {
      kept.push(issue);
      continue;
    }
    const classification = classifyTreatmentObligation({
      validator: issue.validator,
      message: issue.message,
      severity: issue.severity,
    });
    if (classification.blocksFinalProse) {
      kept.push(issue);
      continue;
    }
    downgraded.push({
      ...issue,
      severity: 'warning',
      suggestion: issue.suggestion
        ? `${issue.suggestion} ${classification.reason}`
        : classification.reason,
    });
  }

  if (downgraded.length === 0) return 0;
  report.blockingIssues = kept;
  report.warnings = [...(report.warnings || []), ...downgraded];
  report.passed = kept.length === 0;
  return downgraded.length;
}

export function allowsCompactRequiredBeatFallback(issue: ContractRepairReport['blockingIssues'][number]): boolean {
  if (issue.validator !== 'RequiredBeatRealizationValidator') return false;
  const moment = requiredMomentFromMessage(issue.message);
  if (!moment) return false;
  const trimmed = moment.trim();
  const stripped = trimmed.replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '').trim();
  if (!stripped) return false;
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 14) return false;
  return !/[;—]|\b(?:by\s+\d|at\s+\d|walking?|walks?|pinned?|pins?|drops?|kisses?|declines?|vanishes?)\b/i.test(stripped);
}

export function applySceneTurnWarningRepairOutcome(
  targetStory: Story,
  originalPassingReport: FinalStoryContractReport,
  outcome: { story: Story; report: ContractRepairReport; passed: boolean },
): { report: FinalStoryContractReport; committed: boolean } {
  if (!outcome.passed || (outcome.report.blockingIssues?.length ?? 0) > 0) {
    return { report: originalPassingReport, committed: false };
  }
  const repairedReport = outcome.report as FinalStoryContractReport;
  if (countSceneTurnWarnings(repairedReport) >= countSceneTurnWarnings(originalPassingReport)) {
    return { report: originalPassingReport, committed: false };
  }
  Object.assign(targetStory as object, outcome.story);
  return { report: repairedReport, committed: true };
}

function repairDiceMechanicsText(text: string): string {
  return text
    .replace(/\bsettling\s+like\s+dice\s+on\s+a\s+velvet\s+cloth\b/gi, 'settling like pearls on velvet')
    .replace(/\blike\s+dice\s+on\s+a\s+velvet\s+cloth\b/gi, 'like pearls on velvet')
    .replace(/\blike\s+dice\s+on\s+velvet\b/gi, 'like pearls on velvet')
    .replace(/\blike\s+dice\s+in\s+a\s+wooden\s+cup\b/gi, 'like pebbles in a wooden cup')
    .replace(/\blike\s+dice\s+in\s+a\s+cup\b/gi, 'like pebbles in a cup')
    .replace(/\bYou've\s+rolled\s+the\s+dice\b/gi, "You've taken the gamble")
    .replace(/\bYou\s+have\s+rolled\s+the\s+dice\b/gi, 'You have taken the gamble')
    .replace(/\broll\s+the\s+dice\b/gi, 'take the gamble')
    .replace(/\brolled\s+the\s+dice\b/gi, 'took the gamble');
}

function repairDiceMechanicsField(target: Record<string, unknown>, key: string): number {
  const current = target[key];
  if (typeof current !== 'string' || current.length === 0) return 0;
  const next = repairDiceMechanicsText(current);
  if (next === current) return 0;
  target[key] = next;
  return 1;
}

function cleanupPlanningMetadataText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s*([.!?])\s*([.!?])+/g, '$1 ')
    .trim();
}

function firstReadableSentence(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const cleaned = cleanupPlanningMetadataText(text.replace(/\n+/g, ' '));
  if (!cleaned) return undefined;
  const match = cleaned.match(/^(.{24,220}?[.!?])(?:\s|$)/);
  return cleanupPlanningMetadataText(match?.[1] ?? cleaned.slice(0, 220));
}

function stripPlanningMetadataLabels(text: string): string {
  return cleanupPlanningMetadataText(text
    .replace(/^\s*[^.!?\n]{1,120}?\b(?:seeds|sets\s+up|establishes)\s+[^.!?\n]{1,120}?\s*[—:-]\s*/i, '')
    .replace(/\bFirst\s+strong\s+image\s*:\s*/gi, '')
    .replace(/;\s*promise\s+of\s+[^.;!?]+/gi, '')
    .replace(/;\s*the\s+joke\s+is\s+the\s+season['’]s\s+thesis\s+in\s+disguise\.?/gi, '')
    .replace(/\bOpening\s+promise\s*:\s*/gi, '')
    .replace(/^\s*(?:setup|development|release|turn|payoff)\s+scene\s+\d+\.?\s*$/i, ''));
}

function repairPlanningRegisterMetadataField(
  target: Record<string, unknown> | undefined,
  key: string,
  fallback: string | undefined,
): number {
  if (!target) return 0;
  const current = target[key];
  if (
    typeof current !== 'string'
    || current.trim().length === 0
    || (!isPlanningRegisterText(current) && !/^\s*Aftermath\s+pressure\s+changes\s+the\s+protagonist['’]s\s+footing\s+around\b/i.test(current))
  ) return 0;
  const staleAftermathTurn = /^\s*Aftermath\s+pressure\s+changes\s+the\s+protagonist['’]s\s+footing\s+around\b/i.test(current);
  const stripped = stripPlanningMetadataLabels(current);
  const next = staleAftermathTurn || !stripped || isPlanningRegisterText(stripped) ? fallback : stripped;
  if (!next || next === current || isPlanningRegisterText(next)) return 0;
  target[key] = next;
  return 1;
}

export function repairPlanningRegisterMetadataLeakage(story: Story): number {
  let touched = 0;
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      const sceneRecord = scene as unknown as Record<string, unknown>;
      const turnContract = sceneRecord.turnContract as Record<string, unknown> | undefined;
      const sceneFallback = firstReadableSentence((scene.beats || [])[0]?.text)
        || firstReadableSentence(sceneRecord.description)
        || 'The scene pressure turns into visible action.';
      const turnFallback = sceneFallback;
      for (const key of ['centralTurn', 'turnEvent', 'beforeState', 'afterState', 'handoff']) {
        touched += repairPlanningRegisterMetadataField(turnContract, key, turnFallback);
      }
      for (const beat of scene.beats || []) {
        const beatRecord = beat as unknown as Record<string, unknown>;
        const sequenceIntent = beatRecord.sequenceIntent as Record<string, unknown> | undefined;
        if (!sequenceIntent) continue;
        const beatFallback = firstReadableSentence(beat.text) || sceneFallback;
        touched += repairPlanningRegisterMetadataField(sequenceIntent, 'objective', beatFallback);
        touched += repairPlanningRegisterMetadataField(sequenceIntent, 'activity', beatFallback);
        touched += repairPlanningRegisterMetadataField(sequenceIntent, 'turningPoint', beatFallback);
        touched += repairPlanningRegisterMetadataField(sequenceIntent, 'visualThread', beatFallback);
        touched += repairPlanningRegisterMetadataField(sequenceIntent, 'obstacle', 'The current pressure resists an easy answer.');
        touched += repairPlanningRegisterMetadataField(sequenceIntent, 'startState', sceneFallback);
        touched += repairPlanningRegisterMetadataField(sequenceIntent, 'endState', beatFallback);
      }
    }
  }
  return touched;
}

function npcNameFromResidueTarget(targetNpcId: unknown): string {
  const value = typeof targetNpcId === 'string' ? targetNpcId : '';
  const tokens = value
    .replace(/^char[-_]/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/[^a-z0-9\s'’-]/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token && !/^(npc|character|unknown)$/i.test(token));
  if (tokens.length === 0) return 'Someone';
  return tokens
    .slice(0, 2)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');
}

function repairResidueHintPlanningText(hint: Record<string, unknown>): number {
  const current = hint.description;
  if (typeof current !== 'string' || current.trim().length === 0) return 0;
  if (!isPlanningRegisterText(current) && !/\bnext\s+scene\b|\bwill\s+(?:address|mention|remember|seek|treat)\b|\bHim\s+will\b/i.test(current)) {
    return 0;
  }
  const npc = npcNameFromResidueTarget(hint.targetNpcId);
  const normalized = current
    .replace(/\bHim\b/g, npc)
    .replace(/\bnext\s+scene\b/gi, 'later')
    .replace(/\bwill\s+address\b/gi, 'treats the choice as permission to address')
    .replace(/\bwill\s+mention\b/gi, 'treats')
    .replace(/\bwill\s+remember\b/gi, 'remembers')
    .replace(/\bwill\s+seek\b/gi, 'seeks')
    .replace(/\bwill\s+treat\b/gi, 'treats');
  const fallback = npc === 'Someone'
    ? 'This choice changes the room the next time it echoes.'
    : `${npc} treats this choice as a visible shift in trust, distance, or leverage.`;
  const next = /\bnext\s+scene\b/i.test(current)
    || isPlanningRegisterText(normalized)
    || /\bnext\s+scene\b|\bwill\s+(?:address|mention|remember|seek|treat)\b/i.test(normalized)
    ? fallback
    : cleanupPlanningMetadataText(normalized);
  if (!next || next === current) return 0;
  hint.description = next;
  return 1;
}

export function repairChoiceResiduePlanningRegisterLeakage(story: Story): number {
  let touched = 0;
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      for (const beat of scene.beats || []) {
        for (const choice of beat.choices || []) {
          for (const hint of ((choice as any).residueHints || [])) {
            touched += repairResidueHintPlanningText(hint as Record<string, unknown>);
          }
        }
      }
    }
  }
  return touched;
}

function sceneContractCueText(scene: Story['episodes'][number]['scenes'][number]): string {
  return [
    scene.id,
    (scene as any).name,
    (scene as any).title,
    (scene as any).description,
    ...(scene.beats || []).flatMap((beat: any) => [
      beat.text,
      beat.visualMoment,
      beat.primaryAction,
      ...(beat.choices || []).flatMap((choice: any) => [
        choice.text,
        choice.reactionText,
        choice.outcomeText,
        choice.outcomeTexts?.success,
        choice.outcomeTexts?.partial,
        choice.outcomeTexts?.failure,
      ]),
    ]),
  ].filter(Boolean).join(' ');
}

function normalizeNameToken(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function castIncludesNpc(scene: Story['episodes'][number]['scenes'][number], npc: { id?: string; name?: string }): boolean {
  const id = normalizeNameToken(String(npc.id || ''));
  const fullName = normalizeNameToken(String(npc.name || ''));
  return (scene.charactersInvolved || []).some((ref) => {
    const normalized = normalizeNameToken(String(ref || ''));
    return Boolean(normalized && (normalized === id || normalized === fullName));
  });
}

function textNamesNpc(text: string, npc: { name?: string }): boolean {
  const normalized = ` ${normalizeNameToken(text)} `;
  const fullName = normalizeNameToken(String(npc.name || ''));
  if (!fullName) return false;
  if (normalized.includes(` ${fullName} `)) return true;
  const first = fullName.split(' ')[0];
  return first.length >= 3 && normalized.includes(` ${first} `);
}

function sentenceNamesPrematureNpc(sentence: string, npcs: Array<{ id?: string; name?: string }>, allowed: Set<string>): boolean {
  return npcs.some((npc) => !allowed.has(String(npc.id || '')) && textNamesNpc(sentence, npc));
}

function stripPrematureNpcSentences(text: string, npcs: Array<{ id?: string; name?: string }>, allowed: Set<string>): { text: string; touched: number } {
  const sentences = text.match(/[^.!?]+[.!?]+(?:["'”’])?|[^.!?]+$/g);
  if (!sentences || sentences.length === 0) return { text, touched: 0 };
  let touched = 0;
  const kept = sentences.filter((sentence) => {
    const premature = sentenceNamesPrematureNpc(sentence, npcs, allowed);
    if (premature) touched += 1;
    return !premature;
  });
  if (touched === 0) return { text, touched: 0 };
  if (kept.length === 0) {
    return { text: 'The moment leaves its consequence hanging in the air.', touched };
  }
  return { text: cleanupPlanningMetadataText(kept.join(' ')), touched };
}

function repairPrematureNpcField(record: Record<string, unknown>, key: string, npcs: Array<{ id?: string; name?: string }>, allowed: Set<string>): number {
  if (typeof record[key] !== 'string') return 0;
  const repaired = stripPrematureNpcSentences(record[key], npcs, allowed);
  if (repaired.touched === 0) return 0;
  record[key] = repaired.text;
  return repaired.touched;
}

function repairPrematureNpcNestedStrings(value: unknown, npcs: Array<{ id?: string; name?: string }>, allowed: Set<string>, depth = 0): number {
  if (depth > 4 || value == null) return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + repairPrematureNpcNestedStrings(item, npcs, allowed, depth + 1), 0);
  }
  if (typeof value !== 'object') return 0;
  let touched = 0;
  const record = value as Record<string, unknown>;
  for (const key of ['text', 'lockedText', 'reactionText', 'outcomeText', 'success', 'partial', 'failure', 'description', 'echoSummary', 'progressSummary']) {
    touched += repairPrematureNpcField(record, key, npcs, allowed);
  }
  for (const key of ['outcomeTexts', 'feedbackCue', 'residueHints', 'witnessReactions', 'reminderPlan']) {
    touched += repairPrematureNpcNestedStrings(record[key], npcs, allowed, depth + 1);
  }
  return touched;
}

export function repairPrematureUncastNpcTextVariants(story: Story): number {
  let touched = 0;
  const knownNpcIds = new Set<string>();
  const npcs = story.npcs || [];
  for (const episode of [...(story.episodes || [])].sort((a, b) => a.number - b.number)) {
    for (const scene of episode.scenes || []) {
      const allowed = new Set(knownNpcIds);
      for (const npc of npcs) {
        if (castIncludesNpc(scene, npc)) allowed.add(npc.id);
      }
      for (const beat of scene.beats || []) {
        if (typeof beat.text === 'string') {
          const repaired = stripPrematureNpcSentences(beat.text, npcs, allowed);
          if (repaired.touched > 0) {
            beat.text = repaired.text;
            touched += repaired.touched;
          }
        }
        for (const choice of (((beat as any).choices || []) as unknown[])) {
          touched += repairPrematureNpcNestedStrings(choice, npcs, allowed);
        }
        const variants = ((beat as any).textVariants || []) as Array<{ text?: string }>;
        if (variants.length === 0) continue;
        const kept = variants.filter((variant) => {
          const text = String(variant.text || '');
          const premature = npcs.some((npc) => !allowed.has(npc.id) && textNamesNpc(text, npc));
          if (premature) touched += 1;
          return !premature;
        });
        if (kept.length !== variants.length) {
          (beat as any).textVariants = kept;
        }
      }
      for (const npc of npcs) {
        if (castIncludesNpc(scene, npc)) knownNpcIds.add(npc.id);
      }
    }
  }
  return touched;
}

export function normalizeFinalStoryRelationshipPacing(story: Story): number {
  return reconcileRelationshipPacingWithChoiceTypes(
    (story.episodes || []).flatMap((episode) => episode.scenes || []) as never,
  );
}

function choiceHasRelationshipMovement(choice: Record<string, unknown>): boolean {
  const consequences = Array.isArray(choice.consequences) ? choice.consequences : [];
  const evidence = Array.isArray(choice.relationshipValueEvidence) ? choice.relationshipValueEvidence : [];
  return consequences.some((consequence) =>
    Boolean(consequence && typeof consequence === 'object' && (consequence as { type?: string }).type === 'relationship')
  ) || evidence.length > 0;
}

function fallbackRelationshipNpcId(scene: Story['episodes'][number]['scenes'][number]): string {
  const pacingNpc = (scene.relationshipPacing || []).find((contract) => contract.npcId)?.npcId;
  if (pacingNpc) return pacingNpc;
  const cast = (scene.charactersInvolved || []).map((ref) => String(ref)).filter(Boolean);
  return cast[1] || cast[0] || 'relationship-context';
}

export function repairRelationshipChoiceMovement(story: Story): number {
  let repaired = 0;
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      const npcId = fallbackRelationshipNpcId(scene);
      for (const beat of scene.beats || []) {
        for (const choice of ((beat as any).choices || []) as Array<Record<string, unknown>>) {
          if (choice.choiceType !== 'relationship' || choiceHasRelationshipMovement(choice)) continue;
          choice.consequences = [
            ...((Array.isArray(choice.consequences) ? choice.consequences : []) as unknown[]),
            {
              type: 'relationship',
              npcId,
              dimension: 'trust',
              change: 1,
            },
          ];
          choice.relationshipValueEvidence = [
            ...((Array.isArray(choice.relationshipValueEvidence) ? choice.relationshipValueEvidence : []) as unknown[]),
            {
              npcId,
              axis: 'trust',
              evidenceTags: ['respected_agency'],
              reason: `The choice "${String(choice.text || 'relationship choice')}" visibly changes the relationship surface.`,
            },
          ];
          repaired += 1;
        }
      }
    }
  }
  return repaired;
}

function iterableRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  if (value && typeof value === 'object') {
    return Object.values(value).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  return [];
}

export function repairDiceMetaphorMechanicsLeakage(story: Story): number {
  let touched = 0;
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      for (const beat of scene.beats || []) {
        touched += repairDiceMechanicsField(beat as unknown as Record<string, unknown>, 'text');
        for (const variant of iterableRecords(beat.textVariants)) {
          touched += repairDiceMechanicsField(variant, 'text');
        }
        for (const choice of iterableRecords(beat.choices)) {
          touched += repairDiceMechanicsField(choice, 'text');
          touched += repairDiceMechanicsField(choice, 'reactionText');
        }
      }
    }
  }
  return touched;
}

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
  writeValidatorMemory?: (input: {
    validator: string;
    lifecycle?: string;
    stage?: string;
    severity?: string;
    outcome?: string;
    storyId?: string;
    artifactIds?: string[];
    repairRoute?: string;
    findings?: unknown;
  }) => Promise<void>;
  saveFailedContractArtifacts?: (story: Story, report: FinalStoryContractReport) => Promise<void>;
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
  readonly plannedChoiceTypesByScene?: Record<string, string>;
  readonly seasonSkillPlan: SeasonSkillPlan | undefined;
  readonly callbackLedger?: CallbackLedger;
  readonly allEncounterTelemetry: EncounterTelemetry[];
  readonly remediationBudget: RemediationBudget | null;
  readonly planTimeFidelityFindings?: FidelityFinding[];
  readonly planTimeFidelityBaseline?: ValidationPhaseBaseline;
  /** The run's SceneCritic for the contract scene-prose repair handler (a one-off is constructed when absent). */
  readonly sceneCritic?: SceneCritic | null;
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
    validationScope?: FidelityValidationScope;
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
    const normalizedStatChecks = normalizeStoryStatChecks(input.story);
    if (normalizedStatChecks > 0) {
      this.deps.emit({
        type: 'debug',
        phase: input.phase,
        message: `Final story stat checks normalized ${normalizedStatChecks} choice(s).`,
      } as any);
    }

    // Season-final skill rebalance: the per-scene ChoiceAuthor rebalance can't hit a
    // SEASON coverage target (>=6/8 skills, <30% dominance), so an over-concentrated season
    // can still ship. This deterministic pass reassigns
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

    // Heuristic fidelity findings (RequiredBeatRealization / SignatureDevicePresence /
    // etc.) are RE-RUN inside runValidation on the CURRENT story, NOT frozen here; otherwise
    // the scene-prose repair could rewrite the prose forever and re-validation would
    // keep returning the pre-repair misses because the findings never tracked the rewrites.
    // `refutedFidelityKeys` carries the JUDGE's refutations (paraphrases
    // it confirmed are dramatized) across re-validation so a re-run heuristic can't
    // re-block a finding the judge already cleared. Keyed stably per finding.
    const refutedFidelityKeys = new Set<string>();
    const fidelityKey = (i: { validator?: string; sceneId?: string; message?: string }): string =>
      `${i.validator ?? ''}::${i.sceneId ?? ''}::${i.message ?? ''}`;
    let latestTreatmentSourced: ReturnType<typeof runFidelityValidators>['treatmentSourced'] = false;

    // One validation pass = FinalStoryContractValidator + the encounter-quality
    // gate (merged in place). Factored into a closure so the Wave-4 repair loop can
    // re-validate a repaired story with identical inputs.
    const runValidation = async (story: Story): Promise<FinalStoryContractReport> => {
      const diceMetaphorRepairs = repairDiceMetaphorMechanicsLeakage(story);
      if (diceMetaphorRepairs > 0) {
        this.deps.emit({
          type: 'debug',
          phase: input.phase,
          message: `Mechanics metaphor leakage normalized ${diceMetaphorRepairs} beat(s).`,
        } as any);
      }
      const planningMetadataRepairs = repairPlanningRegisterMetadataLeakage(story);
      if (planningMetadataRepairs > 0) {
        this.deps.emit({
          type: 'debug',
          phase: input.phase,
          message: `Planning-register metadata normalized ${planningMetadataRepairs} field(s).`,
        } as any);
      }
      const residuePlanningRepairs = repairChoiceResiduePlanningRegisterLeakage(story);
      if (residuePlanningRepairs > 0) {
        this.deps.emit({
          type: 'debug',
          phase: input.phase,
          message: `Choice residue planning-register leakage normalized ${residuePlanningRepairs} hint(s).`,
        } as any);
      }
      const prematureVariantRepairs = repairPrematureUncastNpcTextVariants(story);
      if (prematureVariantRepairs > 0) {
        this.deps.emit({
          type: 'debug',
          phase: input.phase,
          message: `Premature uncast NPC prose/variant(s) removed ${prematureVariantRepairs} time(s).`,
        } as any);
      }
      const relationshipPacingRepairs = normalizeFinalStoryRelationshipPacing(story);
      if (relationshipPacingRepairs > 0) {
        this.deps.emit({
          type: 'debug',
          phase: input.phase,
          message: `Final-story relationship pacing normalized ${relationshipPacingRepairs} contract(s).`,
        } as any);
      }
      const relationshipChoiceRepairs = repairRelationshipChoiceMovement(story);
      if (relationshipChoiceRepairs > 0) {
        this.deps.emit({
          type: 'debug',
          phase: input.phase,
          message: `Relationship choice movement normalized ${relationshipChoiceRepairs} choice(s).`,
        } as any);
      }
      const transitionRepairs = repairDetectedTransitionBridgeContinuity(story, input.brief.seasonPlan?.scenePlan);
      if (transitionRepairs > 0) {
        this.deps.emit({
          type: 'debug',
          phase: input.phase,
          message: `Transition bridge continuity normalized ${transitionRepairs} beat(s).`,
        } as any);
      }
      const repairedEncounterOutcomes = normalizeEncounterOutcomeNavigation(story);
      if (repairedEncounterOutcomes > 0) {
        this.deps.emit({
          type: 'debug',
          phase: input.phase,
          message: `Encounter outcome navigation normalized ${repairedEncounterOutcomes} dead-end outcome(s).`,
        } as any);
      }
      // Re-run the heuristic fidelity validators on THIS (possibly repaired) story so
      // a scene-prose rewrite is actually seen (cheap — no LLM). See refutedFidelityKeys.
      const freshFidelity = runFidelityValidators({
        story,
        seasonPlan: input.brief.seasonPlan,
        sourceAnalysis: input.brief.multiEpisode?.sourceAnalysis,
        planTimeBaseline: this.deps.planTimeFidelityBaseline,
        scope: input.validationScope,
      });
      latestTreatmentSourced = freshFidelity.treatmentSourced;
      const plannedChoiceTypes = selectFinalContractPlannedChoiceTypes(
        this.deps.plannedChoiceTypesByScene,
        input.brief.seasonPlan,
      );
      const plannedConsequenceTiers = plannedConsequenceTiersByScene(input.brief.seasonPlan);
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
        fidelityFindings: freshFidelity.fidelityFindings,
        planTimeFidelityFindings: this.deps.planTimeFidelityFindings,
        treatmentSourced: freshFidelity.treatmentSourced,
        // L2 conformance: each generated episode realizes the season plan's per-episode
        // choice-type budget and leans on its planned skills (balance itself is validated
        // at plan time, over the whole season).
        seasonChoicePlan: this.deps.seasonChoicePlan,
        plannedChoiceTypesByScene: plannedChoiceTypes,
        plannedConsequenceTiersByScene: plannedConsequenceTiers,
        seasonSkillPlan: this.deps.seasonSkillPlan,
        callbackLedger: this.deps.callbackLedger?.serialize?.(),
        seasonResiduePlan: input.brief.seasonPlan?.residuePlan,
        generatedThroughEpisode: Math.max(
          0,
          ...(story.episodes || [])
            .map((episode) => episode.number)
            .filter((n): n is number => typeof n === 'number' && Number.isFinite(n)),
        ),
      });
      try {
        // Season-final gate: read the cross-episode accumulator (superset of the
        // per-episode buffer, which is reset each episode).
        applyEncounterQualityGate(r, story, this.deps.allEncounterTelemetry);
      } catch (encErr) {
        console.warn(`[Pipeline] EncounterQualityValidator failed (non-fatal): ${(encErr as Error).message}`);
      }
      // Re-apply the fidelity judge's refutations: a paraphrase it already confirmed
      // dramatized must not re-block when the re-run heuristic re-flags it. A rewrite
      // only ADDS staged content, so a refuted (content-present) finding stays valid.
      if (refutedFidelityKeys.size > 0 && r.blockingIssues?.length) {
        const kept = r.blockingIssues.filter((i) => !refutedFidelityKeys.has(fidelityKey(i)));
        if (kept.length !== r.blockingIssues.length) {
          r.blockingIssues = kept;
          r.passed = kept.length === 0;
        }
      }
      const downgradedTreatmentObligations = downgradeNonBlockingTreatmentObligations(r);
      if (downgradedTreatmentObligations > 0) {
        this.deps.emit({
          type: 'debug',
          phase: input.phase,
          message: `Final contract downgraded ${downgradedTreatmentObligations} non-prose treatment obligation(s).`,
        } as any);
      }
      return r;
    };

    let report = await runValidation(input.story);

    // WS3 (2026-06-11 audit): judge-confirm HEURISTIC fidelity findings before
    // they can block. RequiredBeatRealization / SignatureDevicePresence are
    // keyword-overlap heuristics; a paraphrased-but-dramatized moment reads as
    // "missing" and aborts the season. One bounded LLM call asks whether each
    // flagged moment is actually dramatized on-page: refuted findings downgrade
    // to warnings; confirmed misses stay blocking and flow to the repair loop.
    // Conservative on failure (judge unavailable/error → everything stays
    // blocking, byte-identical to today). Gated; can only downgrade.
    if (!report.passed && isGateEnabled('GATE_FIDELITY_JUDGE_CONFIRM')) {
      // Snapshot blocking keys so we can tell which the judge refuted (it downgrades
      // in place), and carry those refutations into re-validation.
      const beforeJudge = new Set(report.blockingIssues.map(fidelityKey));
      const outcome = await confirmHeuristicFidelityFindings({
        report,
        story: input.story,
        judge: () => {
          try {
            return new FidelityRealizationJudge(this.deps.config.agents.sceneWriter);
          } catch (err) {
            console.warn(`[Pipeline] Fidelity judge unavailable (findings stay blocking): ${err instanceof Error ? err.message : String(err)}`);
            return null;
          }
        },
        emit: (message) => this.deps.emit({ type: 'debug', phase: input.phase, message }),
      });
      // Findings that left blocking = judge-refuted; remember them so re-validation
      // (which re-runs the heuristics fresh) does not re-block them.
      const afterJudge = new Set(report.blockingIssues.map(fidelityKey));
      for (const k of beforeJudge) if (!afterJudge.has(k)) refutedFidelityKeys.add(k);
      if (outcome.judged > 0) {
        this.deps.emit({
          type: 'checkpoint',
          phase: input.phase,
          message: `Fidelity judge reviewed ${outcome.judged} heuristic finding(s); ${outcome.downgraded} refuted (downgraded), ${outcome.judged - outcome.downgraded} confirmed blocking`,
        });
      }
    }

    // Wave-0 shadow telemetry for the final-contract-class gates (design-note +
    // treatment-fidelity), recorded regardless of flag so off→on has data.
    if (isShadowLoggingEnabled()) {
      await this.deps.recordFinalContractShadow(input, latestTreatmentSourced, report.metrics.designNoteLeaks ?? 0);
    }

    // Wave 4 keystone: attempt bounded repair + re-validation BEFORE the hard abort,
    // instead of throwing on first failure (GATE_FINAL_CONTRACT_REPAIR, default ON).
    // Handlers: deterministic autofixes first, then the LLM scene-prose repair
    // (GATE_FINAL_CONTRACT_SCENE_REGEN) — per-scene SceneCritic rewrites driven by
    // the contract's own findings (required-beat / signature-device realization),
    // so a prose-realization miss becomes a bounded repair instead of discarding
    // the entire generated season (2026-06-11 failure-cycle audit).
    if (!report.passed && isGateEnabled('GATE_FINAL_CONTRACT_REPAIR')) {
      const generatedThroughEpisode = Math.max(
        0,
        ...(input.requestedEpisodeNumbers ?? input.story.episodes?.map((episode) => episode.number).filter((n): n is number => typeof n === 'number') ?? []),
      ) || undefined;
      const repairRouter = new GateRepairRouter({
        story: input.story,
        generatedThroughEpisode,
      });
      const plannedMomentSources = plannedMomentSourcesFromScenePlan(input.brief.seasonPlan?.scenePlan);
      const routingSummary = repairRouter.summarize(report.blockingIssues as ContractRepairReport['blockingIssues']);
      const routedKinds = Object.entries(routingSummary)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${kind}:${count}`)
        .join(', ');
      if (routedKinds) {
        this.deps.emit({
          type: 'checkpoint',
          phase: input.phase,
          message: `Final contract repair routing: ${routedKinds}`,
          data: { routingSummary },
        } as any);
      }
      const routeIssue = (issue: ContractRepairReport['blockingIssues'][number]) => repairRouter.routeIssue(issue);
      const initialArchitecturalRepairBlockers = architecturalRepairBlockersFor(
        report.blockingIssues as ContractRepairReport['blockingIssues'],
        routeIssue,
      );
      if (initialArchitecturalRepairBlockers.length > 0) {
        this.deps.emit({
          type: 'debug',
          phase: input.phase,
          message: `Final contract repair will defer LLM prose/outcome repair while ${initialArchitecturalRepairBlockers.length} blocker(s) require blueprint, route, or relationship architecture repair first.`,
        } as any);
      }
      const guardLlmHandler = (handler: ContractRepairHandler): ContractRepairHandler =>
        guardLlmContractRepairForArchitecture(
          handler,
          routeIssue,
          (message) => this.deps.emit({ type: 'debug', phase: input.phase, message } as any),
        );
      const allowRequiredBeatFallback = (issue: ContractRepairReport['blockingIssues'][number]) => {
        const route = repairRouter.routeIssue(issue);
        return route.kind === 'same_scene_retry'
          && !route.unsafeForProsePatch
          && (
            allowsCompactRequiredBeatFallback(issue)
            || /compact time\/count wording is missing/i.test(route.reason)
          );
      };
      const handlers = buildDeterministicContractHandlers();
      if (isGateEnabled('GATE_FINAL_CONTRACT_SCENE_REGEN')) {
        handlers.push(
          guardLlmHandler(buildSceneProseRepairHandler({
            critic: () => {
              try {
                return this.deps.sceneCritic ?? new SceneCritic(this.deps.config.agents.sceneWriter);
              } catch (err) {
                console.warn(`[Pipeline] Scene-prose contract repair: SceneCritic unavailable — ${err instanceof Error ? err.message : String(err)}`);
                return null;
              }
            },
            emit: (message) => this.deps.emit({ type: 'debug', phase: input.phase, message }),
            routeIssue,
            allowRequiredBeatFallback,
            plannedMomentSources,
            requirePredictedClear: true,
          })),
        );
      }
      if (isGateEnabled('GATE_SCENE_TURN_CLUSTER_REPAIR')) {
        handlers.push(
          guardLlmHandler(buildSceneClusterRepairHandler({
            critic: () => {
              try {
                return this.deps.sceneCritic ?? new SceneCritic(this.deps.config.agents.sceneWriter);
              } catch (err) {
                console.warn(`[Pipeline] Scene-cluster contract repair: SceneCritic unavailable — ${err instanceof Error ? err.message : String(err)}`);
                return null;
              }
            },
            emit: (message) => this.deps.emit({ type: 'debug', phase: input.phase, message }),
            maxScenesPerRound: 2,
            routeIssue,
            allowRequiredBeatFallback,
            plannedMomentSources,
          })),
        );
      }
      if (isGateEnabled('GATE_FINAL_CONTRACT_OUTCOME_REGEN')) {
        handlers.push(
          guardLlmHandler(buildOutcomeTextRepairHandler({
            author: () => {
              try {
                return new ChoiceAuthor(this.deps.config.agents.choiceAuthor);
              } catch (err) {
                console.warn(`[Pipeline] Outcome-text contract repair: ChoiceAuthor unavailable — ${err instanceof Error ? err.message : String(err)}`);
                return null;
              }
            },
            emit: (message) => this.deps.emit({ type: 'debug', phase: input.phase, message }),
          })),
        );
      }
      // SceneCritic can fix one contract finding while reintroducing deterministic
      // residue late in the same repair round. Run those cleanup passes again after
      // LLM-backed handlers so the round revalidates cleaned prose instead of
      // spending another full pass or failing on newly reintroduced labels.
      handlers.push(buildRelationshipPacingLabelRepairHandler());
      const outcome = await runFinalContractRepair({
        story: input.story,
        initialReport: report as ContractRepairReport,
        handlers,
        revalidate: async (s) => (await runValidation(s)) as ContractRepairReport,
        // 3 rounds (was 2): with the scene-prose handler's 4-scene/round cap, a
        // 6-scene failure spends rounds 1-2 giving every scene its first pass.
        // The third round gives stubborn scenes a guided retry. Rounds only run
        // while still failing; canSpend caps spend.
        maxAttempts: 3,
        maxAttemptsPerIssue: 2,
        dedupeIssueFingerprints: true,
        canSpend: () => shouldAttemptRemediation(this.deps.remediationBudget),
      });
      report = outcome.report as FinalStoryContractReport;
      for (const rec of outcome.records) await this.deps.recordRemediationSafe(rec);
      this.deps.emit({
        type: 'checkpoint',
        phase: input.phase,
        message: `Final contract repair ran ${outcome.attempts} round(s); now ${report.passed ? 'passing' : 'still failing'}`,
      } as any);
      if (outcome.exhaustedIssueCount > 0) {
        this.deps.emit({
          type: 'debug',
          phase: input.phase,
          message: `Final contract repair stopped retrying ${outcome.exhaustedIssueCount} repeated issue fingerprint(s) after per-issue budget.`,
        });
      }
    }

    // A passing contract can still carry advisory scene-turn warnings. Those are
    // cheap to repair and expensive to ship when they represent an on-page gap.
    // Run one bounded SceneCritic pass, but commit the rewrite only when
    // re-validation still passes and reduces the scene-turn warning count.
    if (
      report.passed
      && isGateEnabled('GATE_FINAL_CONTRACT_REPAIR')
      && isGateEnabled('GATE_FINAL_CONTRACT_SCENE_REGEN')
    ) {
      const repairableWarnings = sceneTurnWarningsForRepair(report);
      if (repairableWarnings.length > 0 && shouldAttemptRemediation(this.deps.remediationBudget)) {
        const repairRouter = new GateRepairRouter({ story: input.story });
        const plannedMomentSources = plannedMomentSourcesFromScenePlan(input.brief.seasonPlan?.scenePlan);
        const originalPassingReport = report;
        const repairCandidate = cloneStoryForAdvisoryRepair(input.story);
        const outcome = await runFinalContractRepair({
          story: repairCandidate,
          initialReport: {
            ...(report as ContractRepairReport),
            passed: false,
            blockingIssues: repairableWarnings,
          },
          handlers: [
            buildSceneProseRepairHandler({
              critic: () => {
                try {
                  return this.deps.sceneCritic ?? new SceneCritic(this.deps.config.agents.sceneWriter);
                } catch (err) {
                  console.warn(`[Pipeline] Treatment-warning scene repair: SceneCritic unavailable — ${err instanceof Error ? err.message : String(err)}`);
                  return null;
                }
              },
              emit: (message) => this.deps.emit({ type: 'debug', phase: input.phase, message }),
              routeIssue: (issue) => repairRouter.routeIssue(issue),
              allowRequiredBeatFallback: (issue) => {
                const route = repairRouter.routeIssue(issue);
                return route.kind === 'same_scene_retry'
                  && !route.unsafeForProsePatch
                  && (
                    allowsCompactRequiredBeatFallback(issue)
                    || /compact time\/count wording is missing/i.test(route.reason)
                  );
              },
              plannedMomentSources,
            }),
          ],
          revalidate: async (s) => (await runValidation(s)) as ContractRepairReport,
          maxAttempts: 1,
          maxAttemptsPerIssue: 1,
          dedupeIssueFingerprints: true,
          canSpend: () => shouldAttemptRemediation(this.deps.remediationBudget),
        });
        const committed = applySceneTurnWarningRepairOutcome(input.story, originalPassingReport, outcome);
        report = committed.report;
        if (committed.committed) {
          for (const rec of outcome.records) await this.deps.recordRemediationSafe(rec);
        }
        this.deps.emit({
          type: 'checkpoint',
          phase: input.phase,
          message: `Scene-turn warning repair ran ${outcome.attempts} round(s); now ${committed.committed ? 'committed' : 'discarded advisory rewrite'}`,
        } as any);
      }
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
      await this.deps.writeValidatorMemory?.({
        validator: 'FinalStoryContractValidator',
        lifecycle: 'final-contract',
        stage: input.phase,
        severity: 'blocking',
        outcome: 'failed',
        storyId: input.story.id,
        artifactIds: input.story.episodes?.map((episode) => episode.id).filter(Boolean),
        repairRoute: 'final-contract-repair',
        findings: {
          blockingIssues: report.blockingIssues.slice(0, 20),
          warnings: report.warnings?.slice(0, 20),
          metrics: report.metrics,
        },
      });
      if (this.deps.saveFailedContractArtifacts) {
        await this.deps.saveFailedContractArtifacts(input.story, report);
      }
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

    await this.deps.writeValidatorMemory?.({
      validator: 'FinalStoryContractValidator',
      lifecycle: 'final-contract',
      stage: input.phase,
      severity: report.warnings?.length ? 'warning' : 'pass',
      outcome: 'passed',
      storyId: input.story.id,
      artifactIds: input.story.episodes?.map((episode) => episode.id).filter(Boolean),
      repairRoute: 'none',
      findings: {
        warningCount: report.warnings?.length ?? 0,
        warnings: report.warnings?.slice(0, 20),
        metrics: report.metrics,
      },
    });

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
    // Same validation chokepoint for mechanical balance: stat-check difficulty and
    // weights must be the normalized shape the assembled story will carry, not the
    // pre-repair LLM draft. Mutates shared choiceSet refs in place by design.
    normalizeChoiceSetStatChecks(choiceSets);
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
      callbackLedger: this.deps.callbackLedger?.serialize?.(),
      generatedThroughEpisode: blueprint?.number,
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
