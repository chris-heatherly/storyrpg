import type { Story, Episode, Scene, Beat, Consequence } from '../../types';
import type { QAReport } from '../agents/QAAgents';
import type { ComprehensiveValidationReport } from '../../types/validation';
import type { SceneValidationResult } from './IncrementalValidators';
import { CallbackOpportunitiesValidator } from './CallbackOpportunitiesValidator';
import { IncrementalEncounterValidator } from './IncrementalValidators';
import { MechanicsLeakageValidator, type MechanicsLeakageText } from './MechanicsLeakageValidator';
import { gateDesignNoteLeak, isEscalatedIssue } from './issueEscalation';
import { canonicalizeStoryWitnessReactions, canonicalizeStoryRelationshipConsequences } from '../utils/witnessNpcResolver';
import { canonicalizeProtagonistPronouns, otherGenderNamesFromStory } from '../utils/protagonistPronounResolver';
import { findNpcPronounInconsistencies, findInternalPronounConflicts } from '../utils/npcPronounResolver';
import { OutcomeTextQualityValidator } from './OutcomeTextQualityValidator';
import { FlagContractValidator } from './FlagContractValidator';
import { SentenceOpenerVarietyValidator } from './SentenceOpenerVarietyValidator';
import { ReferencedEventPresenceValidator } from './ReferencedEventPresenceValidator';
import { ChoiceTypePlanConformanceValidator } from './ChoiceTypePlanConformanceValidator';
import { ConsequenceTierPlanConformanceValidator } from './ConsequenceTierPlanConformanceValidator';
import type { SeasonChoicePlan } from '../pipeline/seasonChoicePlan';
import type { ConsequenceTier } from '../../types/scenePlan';
import { SkillPlanConformanceValidator } from './SkillPlanConformanceValidator';
import type { SeasonSkillPlan } from '../pipeline/seasonSkillPlan';
import { seedEncounterOutcomeFlags, findEncounterOutcomeDesyncs, normalizeEncounterOutcomeFlags } from '../utils/encounterOutcomeFlags';
import { isGateEnabled } from '../remediation/gateDefaults';
import { isGateEnabledAt } from '../remediation/gateRegistry';
import { isTreatmentFidelityFinding } from './treatmentFidelityGate';
import { findBeatIdCollisions } from './beatIdCollisions';
import { collectReaderFacingTexts, collectEncounterMetaTexts } from './EncounterAnchorContentValidator';
import { EncounterProseIntegrityValidator } from './EncounterProseIntegrityValidator';
import { PlanningRegisterLeakValidator } from './PlanningRegisterLeakValidator';
import { stripProtagonistFromEncounters } from '../utils/encounterProtagonistGuard';
import { PovClarityValidator } from './PovClarityValidator';
import { applyEncounterPovBackstop } from '../pipeline/encounterPovBackstop';
import { applyResidueConsumption } from '../pipeline/residueConsumption';
import { reconcileFlagVocabulary } from '../pipeline/flagVocabulary';
import { rebalanceStoryEncounterSkills } from '../utils/encounterSkillRebalance';
import type { SerializedCallbackLedger } from '../pipeline/callbackLedger';

/**
 * Scene-target sentinels that mean "the episode/story ends here" rather than a
 * real scene id. The deterministic engine treats an unresolved nextSceneId as
 * the end of the episode (getNextScene / getSceneById return undefined), and
 * StructuralValidator.autoFix routes terminal choices to 'episode-end'. The
 * contract must recognize these as valid endings — not broken navigation to a
 * missing scene. Matched case-insensitively.
 */
const TERMINAL_SCENE_TARGETS = new Set([
  'episode-end', 'story-end', 'season-end', 'end', 'the-end', 'ending',
]);
function isTerminalSceneTarget(id: string | undefined): boolean {
  return !!id && TERMINAL_SCENE_TARGETS.has(id.trim().toLowerCase());
}

export type FinalStoryContractIssueType =
  | 'empty_scene'
  | 'placeholder_scene'
  | 'invalid_encounter'
  | 'missing_runtime_encounter'
  | 'broken_navigation'
  | 'routing_contradiction'
  | 'choice_bridge_skips_required_setup'
  | 'choice_count_contract'
  | 'supernatural_canon_contradiction'
  | 'beat_id_collision'
  | 'encounter_template_collapse'
  | 'encounter_malformed_prose'
  | 'encounter_one_click_win'
  | 'encounter_clock_coverage_gap'
  | 'missing_requested_episode'
  | 'failed_incremental_validation'
  | 'unrepaired_callback_debt'
  | 'source_role_mismatch'
  | 'partial_season_scope'
  | 'treatment_fidelity_violation'
  | 'ambiguous_protagonist_pronoun'
  | 'npc_pronoun_inconsistency'
  | 'outcome_text_stub'
  | 'echo_summary_variant'
  | 'planning_register_prose'
  | 'unset_flag_condition'
  | 'promised_clue_absent'
  | 'choice_type_plan_nonconformance'
  | 'consequence_tier_plan_nonconformance'
  | 'skill_plan_nonconformance'
  | 'sentence_opener_monotony'
  | 'encounter_prose_integrity'
  | 'encounter_pov_break'
  | 'pov_break'
  | 'protagonist_as_npc'
  | 'encounter_outcome_desync'
  | 'continuity_error'
  | 'transition_continuity_violation'
  | 'scene_turn_realization_violation'
  | 'relationship_pacing_violation'
  | 'mechanic_pressure_violation'
  | 'treatment_field_utilization_violation'
  | 'qa_blocker_present';

export interface FinalStoryContractIssue {
  type: FinalStoryContractIssueType;
  severity: 'error' | 'warning';
  message: string;
  episodeId?: string;
  episodeNumber?: number;
  sceneId?: string;
  beatId?: string;
  validator?: string;
  suggestion?: string;
}

export interface FinalStoryContractReport {
  passed: boolean;
  blockingIssues: FinalStoryContractIssue[];
  warnings: FinalStoryContractIssue[];
  metrics: {
    episodesChecked: number;
    scenesChecked: number;
    beatsChecked: number;
    encounterScenesChecked: number;
    validEncounterScenes: number;
    requestedEpisodesMissing: number;
    failedIncrementalResults: number;
    callbackIssues: number;
    mechanicsLeaks: number;
    /** Shadow metric: design-note/meta-narration leaks found, regardless of GATE_DESIGN_NOTE_LEAK. */
    designNoteLeaks?: number;
  };
  generatedAt: string;
}

export interface FinalStoryContractInput {
  story: Story;
  /**
   * Canonical protagonist identity (from the brief/character bible). When present,
   * the contract deterministically repairs wrong-gender protagonist pronouns in
   * player-facing prose (W1) and — when GATE_PROTAGONIST_PRONOUN is on — flags any
   * ambiguous residue for regen. Absent ⇒ the pronoun pass is skipped.
   */
  protagonist?: { name?: string; aliases?: string[]; pronouns?: string };
  requestedEpisodeNumbers?: number[];
  sourceSeasonPlan?: {
    totalEpisodes?: number;
    episodes?: Array<{
      episodeNumber?: number;
      title?: string;
      structuralRole?: string[];
    }>;
  };
  incrementalValidationResults?: SceneValidationResult[];
  /**
   * The season choice-type plan (source of truth for which type belongs in which
   * episode). When present, ChoiceTypePlanConformanceValidator checks each generated
   * episode realized the types the plan budgeted for it (L2 conformance) — distinct from
   * the season-level balance check that runs at plan time.
   */
  seasonChoicePlan?: SeasonChoicePlan;
  /** Optional planned per-scene choice type (blueprint `choicePoint.type`), enabling the
   * conformance validator's binding-fidelity Check A. */
  plannedChoiceTypesByScene?: Record<string, string>;
  /**
   * Optional planned per-scene consequence tier from the season scene plan.
   * The budget mix is season-level; generated episodes are checked against
   * these assigned tiers, not against whole-season percentages.
   */
  plannedConsequenceTiersByScene?: Record<string, ConsequenceTier>;
  /** The season skill plan. When present, SkillPlanConformanceValidator checks each
   * generated episode leaned on the skills the plan favoured for it (L2). */
  seasonSkillPlan?: SeasonSkillPlan;
  callbackLedger?: SerializedCallbackLedger;
  generatedThroughEpisode?: number;
  qaReport?: QAReport;
  bestPracticesReport?: ComprehensiveValidationReport;
  validSkills?: string[];
  mode?: 'strict' | 'advisory' | 'disabled';
  /**
   * True when the run's source-of-record is an authored treatment. §4.6: when set,
   * treatment-fidelity findings (4.1–4.5) are NOT downgraded to advisory — they
   * hard-fail. Populated by the stage that dispatches the §4 fidelity validators.
   */
  treatmentSourced?: boolean;
  /**
   * Findings emitted by the five §4 treatment-fidelity validators
   * (AuthoredEpisodeConformance / EncounterAnchorContent /
   * InformationLedgerSchedule / SignatureDevicePresence /
   * SevenPointAnchorConformance). Each carries the emitting `validator` name so
   * §4.6 can keep them blocking. Empty/absent ⇒ no fidelity dispatch this run.
   */
  fidelityFindings?: Array<{
    validator: string;
    severity: 'error' | 'warning';
    message: string;
    suggestion?: string;
    episodeNumber?: number;
    sceneId?: string;
  }>;
}

const PLACEHOLDER_TEXT_PATTERN = /\b(what happened in|scene content was not generated|branch reconvergence|route chosen before this moment|the path here still matters|changes how everyone enters|tbd|placeholder|fill later)\b/i;

type ContractProtagonist = NonNullable<FinalStoryContractInput['protagonist']>;

const UNSAFE_PROTAGONIST_NAMES = new Set([
  'a',
  'an',
  'hero',
  'lead',
  'main',
  'protagonist',
  'the',
  'unknown',
]);

function normalizeProtagonistName(name?: string): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length < 3) return undefined;
  if (UNSAFE_PROTAGONIST_NAMES.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}

function protagonistFromStoryRoster(story: Story): ContractProtagonist | undefined {
  const rosterProtagonist = (story.npcs || []).find((npc) => npc.role === 'protagonist');
  const name = normalizeProtagonistName(rosterProtagonist?.name);
  if (!name) return undefined;
  return {
    name,
    pronouns: rosterProtagonist?.pronouns,
  };
}

function mergeAliases(rosterName: string, provided?: ContractProtagonist): string[] | undefined {
  const aliases = new Set<string>();
  const providedName = normalizeProtagonistName(provided?.name);
  if (providedName && providedName !== rosterName) aliases.add(providedName);
  for (const alias of provided?.aliases || []) {
    const clean = normalizeProtagonistName(alias);
    if (clean && clean !== rosterName) aliases.add(clean);
  }
  return aliases.size > 0 ? [...aliases] : undefined;
}

function resolveContractProtagonist(
  story: Story,
  provided?: ContractProtagonist,
): ContractProtagonist | undefined {
  const roster = protagonistFromStoryRoster(story);
  if (roster?.name) {
    return {
      name: roster.name,
      aliases: mergeAliases(roster.name, provided),
      pronouns: roster.pronouns || provided?.pronouns,
    };
  }

  const providedName = normalizeProtagonistName(provided?.name);
  if (!providedName) return undefined;
  return {
    name: providedName,
    aliases: mergeAliases(providedName, provided),
    pronouns: provided?.pronouns,
  };
}

export class FinalStoryContractValidator {
  async validate(input: FinalStoryContractInput): Promise<FinalStoryContractReport> {
    const protagonist = resolveContractProtagonist(input.story, input.protagonist);
    const mode = input.mode || 'advisory';
    const issues: FinalStoryContractIssue[] = [];
    const metrics = {
      episodesChecked: input.story.episodes?.length || 0,
      scenesChecked: 0,
      beatsChecked: 0,
      encounterScenesChecked: 0,
      validEncounterScenes: 0,
      requestedEpisodesMissing: 0,
      failedIncrementalResults: 0,
      callbackIssues: 0,
      mechanicsLeaks: 0,
    };

    if (mode === 'disabled') {
      return this.buildReport([], metrics);
    }

    issues.push(...this.collectChoiceCountContractIssues(input.story));

    // Normalize witnessReaction npcIds to canonical `story.npcs` ids before any
    // checks. Upstream authoring uses raw per-scene NPC labels (names/slugs), so
    // witness ids otherwise fail the unknown-NPC check. This is the single
    // authoritative chokepoint every final story passes through; it mutates the
    // story object in place so the shipped story.json is corrected too.
    const witnessFix = canonicalizeStoryWitnessReactions(input.story);
    if (witnessFix.remapped || witnessFix.dropped) {
      console.info(
        `[FinalStoryContract] witness npcIds canonicalized: remapped ${witnessFix.remapped}, dropped ${witnessFix.dropped} of ${witnessFix.total}`,
      );
    }

    // Canonicalize relationship-consequence npcIds against the same authoritative
    // roster. The LLM sometimes targets a relationship delta at "None"/an unknown id,
    // which the reader runtime silently no-ops (gameStore only applies a delta when the
    // NPC bond already exists) — so the choice's relationship movement is lost (G10
    // Endsong ep2). Remap resolvable ids; drop dead targets so they cannot masquerade as
    // applied consequences. The P1.3 validator surfaces the drop count for gating/regen.
    const relFix = canonicalizeStoryRelationshipConsequences(input.story);
    if (relFix.remapped || relFix.dropped) {
      console.info(
        `[FinalStoryContract] relationship-consequence npcIds canonicalized: remapped ${relFix.remapped}, dropped ${relFix.dropped} of ${relFix.total}`,
      );
    }

    // G12: the encounter generator cast the protagonist as an NPC — npcStates carried
    // "Kylie Marinescu — wary" (rendered as a HUD badge) and relationship consequences
    // paid affection to char-kylie-marinescu. Deterministic strip + a finding so the
    // prose half (a second protagonist talking at the table) gets regen attention.
    if (protagonist?.name) {
      const strip = stripProtagonistFromEncounters(input.story, {
        name: protagonist.name,
        aliases: protagonist.aliases,
      });
      if (strip.npcStatesRemoved > 0 || strip.relationshipConsequencesRemoved > 0) {
        console.info(
          `[FinalStoryContract] protagonist-as-NPC strip: ${strip.npcStatesRemoved} npcState(s), ` +
          `${strip.relationshipConsequencesRemoved} relationship consequence(s) at ${strip.locations.slice(0, 4).join(', ')}`,
        );
        issues.push({
          type: 'protagonist_as_npc',
          severity: 'warning',
          message:
            `Protagonist "${protagonist.name}" appeared as an encounter NPC ` +
            `(${strip.npcStatesRemoved} npcState(s), ${strip.relationshipConsequencesRemoved} relationship target(s) — removed). ` +
            'The encounter was likely generated without protagonist context; its prose may still address the protagonist as a separate character.',
          validator: 'encounterProtagonistGuard',
          suggestion: 'Regenerate the encounter with protagonist identity + episode-so-far context.',
        });
      }
    }

    // WS0.3: deterministic encounter-POV backstop. Coerce third-person protagonist narration
    // in encounter outcome/phase prose to second person IN PLACE (name-anchored, verb-agreed),
    // so the recurring encounter-POV break (g17: every encounter climax narrated "Kylie
    // straightens her collar… she has become it") never ships even on truncated/variant LLM
    // output. Mutates input.story like the strip/pronoun passes; the per-scene POV scan below
    // then surfaces only residue the coercion could not safely clear (same-gender NPC
    // ambiguity) for the EncounterArchitect regen route.
    if (isGateEnabledAt('GATE_ENCOUNTER_POV', 'season-final') && protagonist?.name) {
      const pov = applyEncounterPovBackstop(input.story, {
        name: protagonist.name,
        aliases: protagonist.aliases,
        pronouns: protagonist.pronouns,
      });
      if (pov.coerced > 0) {
        console.info(
          `[FinalStoryContract] encounter-POV backstop coerced ${pov.coerced} prose string(s) to ` +
          `second person; ${pov.residualBreaks.length} residual break(s) left for regen`,
        );
      }
    }

    // WS1.1: flag-vocabulary reconciliation. The SET and READ sides are authored independently,
    // so a condition can read a flag nothing sets — dead content (g17: a variant read
    // `accepted_victor_invitation` but the setter wrote `received_victor_invitation`). Rewrite
    // each dead-condition flag to its nearest real setter so the authored content renders. Pure
    // correctness, run unconditionally like the witness/pronoun canonicalizations above; golden-
    // parity when every condition already has a setter. Runs BEFORE residue (a reconciled flag
    // is now read, so residue won't double-inject for its setter).
    const flagFix = reconcileFlagVocabulary(input.story);
    if (flagFix.reconciled.length > 0) {
      console.info(
        `[FinalStoryContract] flag-vocab reconciled ${flagFix.reconciled.length} dead condition(s): ` +
        flagFix.reconciled.map((r) => `${r.from}→${r.to}`).slice(0, 4).join(', '),
      );
    }

    // WS0.2: residue-consume contract. For every consequential set-flag no condition reads,
    // append a flag-gated in-fiction acknowledgment to a downstream beat, so player decisions
    // stop silently dying (g17: 49 write-only flags). Mutates input.story before the
    // FlagContract / callback checks below, so the injected reads count. Default-OFF
    // (GATE_RESIDUE_CONSUME) until a watched smoke run confirms the prose reads cleanly live.
    if (isGateEnabledAt('GATE_RESIDUE_CONSUME', 'season-final')) {
      const residue = applyResidueConsumption(input.story);
      if (residue.injected > 0) {
        console.info(
          `[FinalStoryContract] residue-consume injected ${residue.injected} flag-gated ` +
          `acknowledgment(s); ${residue.residual.length} flag(s) had no downstream beat (terminal/cross-slice)`,
        );
      }
    }

    // WS1.4: even out encounter skill distribution so no single skill is the obvious best path
    // (g17: perception 52–55% of slots in every encounter). Reassigns excess dominant-skill slots
    // to under-used present skills in place. Default-OFF (GATE_ENCOUNTER_SKILL_REBALANCE).
    if (isGateEnabledAt('GATE_ENCOUNTER_SKILL_REBALANCE', 'season-final')) {
      const reassigned = rebalanceStoryEncounterSkills(input.story);
      if (reassigned > 0) {
        console.info(`[FinalStoryContract] encounter skill-rebalance reassigned ${reassigned} slot(s) to cap any one skill at ~40%`);
      }
    }

    const encounterProseIntegrity = new EncounterProseIntegrityValidator().validate({ story: input.story });
    if (encounterProseIntegrity.findings.length > 0) {
      const blocking = isGateEnabledAt('GATE_ENCOUNTER_PROSE_INTEGRITY', 'season-final');
      for (const finding of encounterProseIntegrity.findings) {
        issues.push({
          type: 'encounter_prose_integrity',
          severity: blocking ? 'error' : 'warning',
          message: `Encounter prose contains malformed second-person rewrite residue (${finding.pattern}): "${finding.excerpt}"`,
          sceneId: finding.sceneId,
          validator: 'EncounterProseIntegrityValidator',
          suggestion: 'Regenerate or repair the encounter prose so second-person narration uses grammatical "you/your" phrasing.',
        });
      }
    }

    // G24: planning-register prose leaked into reader-facing beats/variants,
    // encounter prose, and visual metadata ("Open the episode", "Introduce X
    // on-page", "Authored treatment choice", "Decide how to handle..."). These
    // are authoring instructions, not fiction. High precision; routed through
    // the scene-prose repair loop when blocking.
    {
      const planningLeaks = new PlanningRegisterLeakValidator().validate({ story: input.story });
      if (planningLeaks.findings.length > 0) {
        console.info(`[FinalStoryContract] planning-register prose leaks: ${planningLeaks.findings.length} finding(s)`);
      }
      const blockPlanningLeaks = isGateEnabledAt('GATE_PLANNING_REGISTER_PROSE', 'season-final');
      for (const finding of planningLeaks.findings) {
        issues.push({
          type: 'planning_register_prose',
          severity: blockPlanningLeaks ? 'error' : 'warning',
          message: `Planning-register instruction leaked into story content (${finding.pattern}) at ${finding.path}: "${finding.excerpt}"`,
          episodeId: finding.episodeId,
          episodeNumber: finding.episodeNumber,
          sceneId: finding.sceneId,
          beatId: finding.beatId,
          validator: 'PlanningRegisterLeakValidator',
          suggestion: 'Rewrite this field as in-world prose or visual direction; remove planning-register instructions and authorial task labels.',
        });
      }
    }

    // W1: deterministically repair wrong-gender protagonist pronouns in player-facing
    // prose (the encounter generator drifted Kylie -> he/him). Pronouns are canon, so
    // the safe (protagonist-only-sentence) repair runs always — pure data correctness,
    // like the witness pass above. Genuinely ambiguous residue (protagonist + a
    // wrong-gender NPC in one sentence) is never auto-rewritten; it is flagged for
    // regen only when GATE_PROTAGONIST_PRONOUN is on.
    if (protagonist?.pronouns) {
      const names = [protagonist.name, ...(protagonist.aliases || [])].filter(
        (n): n is string => Boolean(n),
      );
      if (names.length > 0) {
        const pronounFix = canonicalizeProtagonistPronouns(
          input.story,
          { names, pronouns: protagonist.pronouns },
          otherGenderNamesFromStory(input.story, protagonist.pronouns),
        );
        if (pronounFix.repaired > 0 || pronounFix.ambiguous.length > 0) {
          console.info(
            `[FinalStoryContract] protagonist pronouns: repaired ${pronounFix.repaired}, ` +
            `ambiguous ${pronounFix.ambiguous.length} (of ${pronounFix.fieldsScanned} fields)`,
          );
        }
        if (isGateEnabledAt('GATE_PROTAGONIST_PRONOUN', 'season-final')) {
          for (const amb of pronounFix.ambiguous) {
            issues.push({
              type: 'ambiguous_protagonist_pronoun',
              severity: mode === 'strict' ? 'error' : 'warning',
              message:
                `Ambiguous protagonist pronoun could not be deterministically resolved: "${amb.sentence}". ` +
                'Regenerate the prose in second person or with explicit names.',
              validator: 'protagonistPronounResolver',
              suggestion: 'Use "you"/the protagonist name; avoid a bare third-person pronoun shared with another character.',
            });
          }
        }
      }
    }

    // NPC pronoun consistency (G10): a uniquely-named gendered NPC paired with a pronoun
    // inconsistent with its roster gender — e.g. Endsong ep3 narrated he/him Captain
    // Thorne as "their shoulder"/"their gaze" in the finale. Detection only (NPC pronoun
    // attribution is too ambiguous to auto-rewrite safely). Advisory; escalated to
    // blocking when GATE_NPC_PRONOUN is on (default-OFF pending a live run).
    {
      const npcScan = findNpcPronounInconsistencies(input.story, input.story.npcs, protagonist);
      if (npcScan.findings.length > 0) {
        console.info(
          `[FinalStoryContract] NPC pronoun inconsistencies: ${npcScan.findings.length} (of ${npcScan.fieldsScanned} fields)`,
        );
      }
      const blockNpcPronoun = isGateEnabledAt('GATE_NPC_PRONOUN', 'season-final');
      for (const f of npcScan.findings) {
        issues.push({
          type: 'npc_pronoun_inconsistency',
          severity: blockNpcPronoun ? 'error' : 'warning',
          message: `NPC "${f.npcName}" is referred to with an inconsistent pronoun ("${f.wrongPronoun}") vs. its canon gender: "${f.sentence}".`,
          validator: 'npcPronounResolver',
          suggestion: `Use ${f.npcName}'s canon pronouns; reserve they/them for NPCs whose roster pronouns are they/them.`,
        });
      }

      // Roster-INDEPENDENT scan: catches UNDECLARED characters narrated with conflicting
      // genders (Bite-Me-G15's Stela drifted they→he→she with no roster entry, so the
      // roster scan above was blind to her). Always advisory (detection only, never
      // blocking) — there is no canon pronoun to rewrite toward.
      const internalConflicts = findInternalPronounConflicts(input.story, protagonist);
      for (const c of internalConflicts) {
        issues.push({
          type: 'npc_pronoun_inconsistency',
          severity: 'warning',
          message: `Character "${c.name}" is referred to with conflicting pronoun genders (${c.genders.join('/')}): e.g. ${c.examples.map((e) => `"${e}"`).join(' vs. ')}.`,
          validator: 'npcPronounResolver',
          suggestion: `Declare "${c.name}" in the cast with fixed pronouns, or correct the prose so the character keeps one set of pronouns.`,
        });
      }
    }

    // Outcome-text quality (G10): flag stub / scaffold-leak / echo / duplicate choice
    // outcomeTexts (the fixed ChoiceAuthor fallback's fingerprint). Walks the whole
    // story. Advisory; escalated to blocking when GATE_OUTCOME_TEXT_QUALITY is on.
    {
      const properNouns = [
        ...(input.story.npcs || []).map((n) => n.name).filter((n): n is string => Boolean(n)),
        ...(protagonist?.name ? [protagonist.name] : []),
      ];
      const otqResult = new OutcomeTextQualityValidator().validate({ story: input.story, properNouns });
      if (otqResult.issues.length > 0) {
        console.info(`[FinalStoryContract] outcome-text quality: ${otqResult.issues.length} finding(s)`);
      }
      const blockOtq = isGateEnabledAt('GATE_OUTCOME_TEXT_QUALITY', 'season-final');
      for (const issue of otqResult.issues) {
        issues.push({
          type: 'outcome_text_stub',
          severity: blockOtq ? (issue.severity === 'error' ? 'error' : 'warning') : 'warning',
          message: issue.message,
          validator: 'OutcomeTextQualityValidator',
          suggestion: issue.suggestion,
        });
      }
    }

    // G12: flag setter/consumer contract — conditions reading flags nothing sets
    // (blog_post_timing class) mean authored variants/modifiers can never render.
    // Deterministic; blocking when GATE_FLAG_CONTRACT is on, advisory otherwise.
    {
      const flagResult = new FlagContractValidator().validate({
        story: input.story,
        callbackLedger: input.callbackLedger,
        generatedThroughEpisode: input.generatedThroughEpisode,
      });
      if (flagResult.issues.length > 0) {
        console.info(
          `[FinalStoryContract] flag contract: ${flagResult.metrics.unsetConditionFlags} unset-condition flag(s), ` +
          `${flagResult.metrics.writeOnlyFlags} write-only flag(s) (of ${flagResult.metrics.settersTotal} setters / ${flagResult.metrics.consumersTotal} consumers)`,
        );
      }
      const blockFlags = isGateEnabledAt('GATE_FLAG_CONTRACT', 'season-final');
      for (const issue of flagResult.issues) {
        issues.push({
          type: 'unset_flag_condition',
          severity: blockFlags && issue.severity === 'error' ? 'error' : 'warning',
          message: issue.message,
          validator: 'FlagContractValidator',
          suggestion: issue.suggestion,
        });
      }
    }

    // G12: echo-summary-as-beat-variant. A textVariant whose text IS a choice's
    // feedbackCue.echoSummary / reminderPlan line REPLACES the whole beat at runtime
    // ("You asked the real question. Stela answered it." shipped as the entire text
    // of four different beats). Deterministic exact-match against choice metadata;
    // same leak class as design notes, so it blocks under GATE_DESIGN_NOTE_LEAK.
    {
      const metaStrings = new Set<string>();
      const normMeta = (s: unknown): string =>
        typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().toLowerCase() : '';
      const noteMeta = (s: unknown): void => {
        const n = normMeta(s);
        if (n.length >= 8) metaStrings.add(n);
      };
      const leakedMetaParagraph = (s: unknown): string | undefined => {
        if (typeof s !== 'string' || metaStrings.size === 0) return undefined;
        return s
          .split(/\n{2,}/)
          .map(normMeta)
          .find((paragraph) => paragraph && metaStrings.has(paragraph));
      };
      for (const ep of input.story.episodes || []) {
        for (const scene of ep.scenes || []) {
          for (const beat of scene.beats || []) {
            for (const choice of (beat as unknown as { choices?: Array<Record<string, unknown>> }).choices || []) {
              noteMeta((choice.feedbackCue as { echoSummary?: unknown } | undefined)?.echoSummary);
              const rp = choice.reminderPlan as { immediate?: unknown; shortTerm?: unknown; longTerm?: unknown } | undefined;
              noteMeta(rp?.immediate);
              noteMeta(rp?.shortTerm);
              noteMeta(rp?.longTerm);
            }
          }
        }
      }
      if (metaStrings.size > 0) {
        const blockLeak = isGateEnabledAt('GATE_DESIGN_NOTE_LEAK', 'season-final');
        for (const ep of input.story.episodes || []) {
          for (const scene of ep.scenes || []) {
            for (const beat of scene.beats || []) {
              const leakedBeatParagraph = leakedMetaParagraph(beat.text);
              if (leakedBeatParagraph) {
                issues.push({
                  type: 'echo_summary_variant',
                  severity: blockLeak ? 'error' : 'warning',
                  message:
                    `Beat ${beat.id} appends a choice echo-summary/reminder line to its base prose ` +
                    `("${leakedBeatParagraph.slice(0, 70)}…") — feedback metadata must not ship as scene text.`,
                  episodeId: ep.id,
                  sceneId: scene.id,
                  beatId: beat.id,
                  validator: 'FinalStoryContractValidator',
                  suggestion:
                    'Remove the appended feedback cue from beat text; render the choice consequence as authored prose, not metadata.',
                });
              }
              for (const variant of (beat as { textVariants?: Array<{ text?: string }> }).textVariants || []) {
                const v = normMeta(variant.text);
                if (v && metaStrings.has(v)) {
                  issues.push({
                    type: 'echo_summary_variant',
                    severity: blockLeak ? 'error' : 'warning',
                    message:
                      `Beat ${beat.id} has a textVariant whose entire text is a choice's echo-summary/reminder line ` +
                      `("${String(variant.text).slice(0, 70)}…") — at runtime it REPLACES the beat's prose with a one-line feedback cue.`,
                    episodeId: ep.id,
                    sceneId: scene.id,
                    beatId: beat.id,
                    validator: 'FinalStoryContractValidator',
                    suggestion:
                      'Compose the callback into the base prose (base text + acknowledgment line) or author a full variant beat; never ship the feedback cue as the beat.',
                  });
                }
              }
            }
          }
        }
      }
    }

    // Sentence-opener variety (prose craft): flag any beat or outcome tier that stacks
    // 3+ consecutive "You …" openers (monotonous second-person cadence). Second person
    // is correct for the reader POV; only consecutive runs flag. Advisory; escalated
    // when GATE_SENTENCE_OPENER_VARIETY is on.
    {
      const openerResult = new SentenceOpenerVarietyValidator().validate({ story: input.story });
      if (openerResult.issues.length > 0) {
        console.info(`[FinalStoryContract] sentence-opener variety: ${openerResult.issues.length} finding(s)`);
      }
      const blockOpener = isGateEnabledAt('GATE_SENTENCE_OPENER_VARIETY', 'season-final');
      for (const issue of openerResult.issues) {
        issues.push({
          type: 'sentence_opener_monotony',
          severity: blockOpener ? 'error' : 'warning',
          message: issue.message,
          validator: 'SentenceOpenerVarietyValidator',
          suggestion: issue.suggestion,
        });
      }
    }

    // Referenced-event / promised-clue presence (G10): an enumerated scene objective
    // (e.g. "collects four splinters — Ileana's tears, the photograph, the maiden name,
    // Mika's absence") must dramatize each listed item on-page, or a later payoff
    // references a clue the reader never saw. Advisory; escalated when
    // GATE_REFERENCED_EVENT_PRESENCE is on.
    {
      const refResult = new ReferencedEventPresenceValidator().validate({ story: input.story });
      if (refResult.issues.length > 0) {
        console.info(`[FinalStoryContract] referenced-event presence: ${refResult.issues.length} finding(s)`);
      }
      const blockRef = isGateEnabledAt('GATE_REFERENCED_EVENT_PRESENCE', 'season-final');
      for (const issue of refResult.issues) {
        issues.push({
          type: 'promised_clue_absent',
          severity: blockRef ? 'error' : 'warning',
          message: issue.message,
          validator: 'ReferencedEventPresenceValidator',
          suggestion: issue.suggestion,
        });
      }
    }

    // Choice-type plan conformance (G10, L2): each generated episode must realize the
    // choice types the SEASON PLAN budgeted for it. Balance itself is validated at plan
    // time over the whole season — this never compares a generated slice to the global
    // target. Advisory; escalated when GATE_CHOICE_TYPE_CONFORMANCE is on.
    if (input.seasonChoicePlan) {
      const confResult = new ChoiceTypePlanConformanceValidator().validate({
        seasonPlan: input.seasonChoicePlan,
        story: input.story,
        plannedTypesByScene: input.plannedChoiceTypesByScene,
      });
      if (confResult.issues.length > 0) {
        console.info(`[FinalStoryContract] choice-type plan conformance: ${confResult.issues.length} finding(s)`);
      }
      const blockConf = isGateEnabledAt('GATE_CHOICE_TYPE_CONFORMANCE', 'season-final');
      for (const issue of confResult.issues) {
        issues.push({
          type: 'choice_type_plan_nonconformance',
          severity: blockConf ? 'error' : 'warning',
          message: issue.message,
          validator: 'ChoiceTypePlanConformanceValidator',
          suggestion: issue.suggestion,
        });
      }
    }

    if (input.plannedConsequenceTiersByScene && Object.keys(input.plannedConsequenceTiersByScene).length > 0) {
      const consequenceConf = new ConsequenceTierPlanConformanceValidator().validate({
        story: input.story,
        plannedTiersByScene: input.plannedConsequenceTiersByScene,
      });
      if (consequenceConf.issues.length > 0) {
        console.info(`[FinalStoryContract] consequence-tier plan conformance: ${consequenceConf.issues.length} finding(s)`);
      }
      const blockConsequence = isGateEnabledAt('GATE_CONSEQUENCE_TIER_CONFORMANCE', 'season-final');
      for (const issue of consequenceConf.issues) {
        issues.push({
          type: 'consequence_tier_plan_nonconformance',
          severity: blockConsequence ? 'error' : 'warning',
          message: issue.message,
          validator: 'ConsequenceTierPlanConformanceValidator',
          suggestion: issue.suggestion,
        });
      }
    }

    // Skill plan conformance (G10, L2): each generated episode leaned on the skills its
    // season plan favoured for it (not an off-plan dominant skill). Season coverage is an
    // L1 plan property (validateSeasonSkillPlan); this never gates a slice vs season target.
    if (input.seasonSkillPlan) {
      const skillConf = new SkillPlanConformanceValidator().validate({
        story: input.story,
        seasonSkillPlan: input.seasonSkillPlan,
      });
      if (skillConf.issues.length > 0) {
        console.info(`[FinalStoryContract] skill plan conformance: ${skillConf.issues.length} finding(s)`);
      }
      const blockSkill = isGateEnabledAt('GATE_SKILL_PLAN_CONFORMANCE', 'season-final');
      for (const issue of skillConf.issues) {
        issues.push({
          type: 'skill_plan_nonconformance',
          severity: blockSkill ? 'error' : 'warning',
          message: issue.message,
          validator: 'SkillPlanConformanceValidator',
          suggestion: issue.suggestion,
        });
      }
    }

    // W4: deterministically seed `encounter_<id>_<outcome>` flags on every encounter
    // outcome (always-on capability seeding), then detect reconvergences where ≥2
    // outcomes share a next scene that carries no outcome-conditioned text — the
    // prose cannot reflect what happened (the Endsong wall-breach → s3-5 desync).
    // G12: normalize first — setters/consumers shipped with three flag spellings.
    normalizeEncounterOutcomeFlags(input.story);
    seedEncounterOutcomeFlags(input.story);
    if (isGateEnabledAt('GATE_ENCOUNTER_OUTCOME_VARIANT', 'season-final')) {
      for (const desync of findEncounterOutcomeDesyncs(input.story)) {
        issues.push({
          type: 'encounter_outcome_desync',
          severity: mode === 'strict' ? 'error' : 'warning',
          message:
            `Encounter ${desync.encounterId} outcomes [${desync.outcomes.join(', ')}] reconverge into scene ` +
            `${desync.reconvergenceSceneId}, which has no text conditioned on the outcome — the scene cannot ` +
            'reflect what happened (e.g. a character wounded in one outcome appears unharmed).',
          sceneId: desync.reconvergenceSceneId,
          validator: 'encounterOutcomeFlags',
          suggestion: `Add a textVariant gated on an encounter_${desync.encounterId}_<outcome> flag to ${desync.reconvergenceSceneId}.`,
        });
      }
    }

    this.validateRequestedEpisodes(input, issues, metrics);
    this.validateSourceEpisodeReconciliation(input, issues, mode);

    const storyTexts: MechanicsLeakageText[] = [];
    const callbackScenes: Array<{ id: string; beats: Array<{ id: string; text: string; textVariants?: Array<{ condition: unknown; text: string }>; speaker?: string }> }> = [];
    const callbackChoices: Array<{ id: string; sceneId: string; text: string; consequences?: Consequence[]; reminderPlan?: unknown }> = [];
    const encounterValidator = new IncrementalEncounterValidator(input.validSkills || Object.keys(input.story.initialState?.skills || {}));
    const povValidator = new PovClarityValidator();
    const protagonistName = protagonist?.name;

    for (const episode of input.story.episodes || []) {
      const sceneMap = new Map((episode.scenes || []).map(scene => [scene.id, scene]));
      const reachableSceneIds = this.collectReachableScenes(episode);

      if (!episode.startingSceneId || !sceneMap.has(episode.startingSceneId)) {
        issues.push({
          type: 'broken_navigation',
          severity: 'error',
          message: `Episode startingSceneId "${episode.startingSceneId || '(missing)'}" does not point at a scene.`,
          episodeId: episode.id,
          episodeNumber: episode.number,
        });
      }

      // Cross-scene beat-id collisions (exact or hierarchical-prefix). The
      // StructuralValidator autofix namespaces these before the gate; anything
      // reaching here is unrepaired and blocks (it corrupts any global/prefix
      // beat-id resolution — saves, analytics, tooling).
      for (const collision of findBeatIdCollisions(episode)) {
        issues.push({
          type: 'beat_id_collision',
          severity: 'error',
          message: `Beat id "${collision.beatId}" in scene "${collision.sceneId}" ${collision.kind === 'exact' ? 'duplicates' : 'is a prefix of'} "${collision.otherBeatId}" in scene "${collision.otherSceneId}". Beat ids must be unique across scenes.`,
          episodeId: episode.id,
          episodeNumber: episode.number,
          sceneId: collision.sceneId,
          suggestion: `Namespace beat ids per scene (e.g. "${collision.sceneId}__${collision.beatId}").`,
        });
      }

      for (const scene of episode.scenes || []) {
        metrics.scenesChecked++;
        metrics.beatsChecked += scene.beats?.length || 0;

        if (episode.startingSceneId && !reachableSceneIds.has(scene.id)) {
          issues.push({
            type: 'broken_navigation',
            severity: 'error',
            message: `Scene "${scene.name || scene.id}" is unreachable from the episode start.`,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: scene.id,
          });
        }

        const encounterResult = scene.encounter
          ? encounterValidator.validateEncounter(scene.encounter as any)
          : undefined;

        // POV-person scan over ALL reader-facing prose in the scene — flat beats (incl.
        // the cliffhanger-coda beat appended post-assembly), encounter situation beats,
        // outcome storylets, and encounter meta. These escape the per-scene
        // PovClarityValidator pass (which only inspects sceneContent.beats during
        // authoring), which is how bite-me-g16 shipped a 1st-person ep2 coda
        // ("my laptop… I have to choose") and 3rd-person ep3 maze storylets
        // ("She smooths the lapel") in a second-person story. Advisory until
        // GATE_PROTAGONIST_PRONOUN is promoted.
        if (protagonistName) {
          const povTexts = [
            ...collectReaderFacingTexts(scene),
            ...(scene.encounter ? collectEncounterMetaTexts(scene) : []),
          ];
          const povBlocking = scene.encounter
            ? isGateEnabledAt('GATE_ENCOUNTER_POV', 'season-final')
            : isGateEnabledAt('GATE_PROTAGONIST_PRONOUN', 'season-final');
          const povType = scene.encounter ? 'encounter_pov_break' : 'pov_break';
          const thirdHits = povValidator.findThirdPersonProtagonistTexts(povTexts, protagonistName);
          if (thirdHits.length > 0) {
            issues.push({
              type: povType,
              severity: povBlocking ? 'error' : 'warning',
              message: `Scene "${scene.name || scene.id}" narrates the protagonist in the third person in ${thirdHits.length} place(s) — a POV break in a second-person story. e.g. "${thirdHits[0]}"`,
              episodeId: episode.id,
              episodeNumber: episode.number,
              sceneId: scene.id,
              validator: 'PovClarityValidator',
              suggestion: 'Rewrite the prose in second person ("you/your"); reserve third-person + pronoun for NPCs only.',
            });
          }
          const firstHits = povValidator.findFirstPersonProtagonistTexts(povTexts, protagonistName);
          if (firstHits.length > 0) {
            issues.push({
              type: povType,
              severity: povBlocking ? 'error' : 'warning',
              message: `Scene "${scene.name || scene.id}" narrates the protagonist in the first person in ${firstHits.length} place(s) — a POV break in a second-person story. e.g. "${firstHits[0]}"`,
              episodeId: episode.id,
              episodeNumber: episode.number,
              sceneId: scene.id,
              validator: 'PovClarityValidator',
              suggestion: 'Rewrite the prose in second person ("you/your"); reserve first-person ("I/my") for quoted dialogue only.',
            });
          }
        }

        if (scene.encounter) {
          metrics.encounterScenesChecked++;

          if (encounterResult?.passed) {
            metrics.validEncounterScenes++;
          } else {
            issues.push({
              type: 'invalid_encounter',
              severity: 'error',
              message: `Encounter scene "${scene.name || scene.id}" does not satisfy the playable encounter contract.`,
              episodeId: episode.id,
              episodeNumber: episode.number,
              sceneId: scene.id,
              validator: 'IncrementalEncounterValidator',
              suggestion: encounterResult?.issues.map(issue => issue.detail).slice(0, 3).join('; '),
            });
          }
        }

        const sceneFailedEncounterIncrementally = input.incrementalValidationResults?.some(result =>
          result.sceneId === scene.id &&
          (result.episodeNumber === undefined || result.episodeNumber === episode.number) &&
          result.regenerationRequested === 'encounter' &&
          result.overallPassed === false
        );

        if (!scene.encounter && sceneFailedEncounterIncrementally) {
          issues.push({
            type: 'missing_runtime_encounter',
            severity: 'error',
            message: `Scene "${scene.name || scene.id}" failed encounter validation but has no runtime encounter in the final story.`,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: scene.id,
          });
        }

        // §4.2 (Treatment-Fidelity Remediation): a non-encounter scene with zero
        // reader-facing beats is always unplayable. Encounter scenes remain exempt in
        // general — their content can legitimately live in `scene.encounter`
        // (situation + storylets) rather than `beats`, per StructuralValidator's E4
        // exemption, and a non-playable encounter is already caught by the
        // `invalid_encounter` check above. The ONE exception is a treatment-sourced
        // run: under the "expand, don't rewrite" contract every authored encounter
        // anchor must be dramatized into prose, so a 0-beat encounter placeholder
        // (wall-breach-is-empty → poisoning-never-administered) must fail there —
        // BUT only when the encounter has no reader-facing prose ANYWHERE. An encounter
        // dramatized in its situation beats / outcome storylets (not `scene.beats`) is a
        // real anchor: consult the same collector EncounterAnchorContentValidator uses so
        // the two validators agree (the false positive that aborted endsong-gen-7 ep1,
        // where the encounter had a setup beat + four prose storylets).
        const sceneHasNoBeats = !scene.beats || scene.beats.length === 0;
        const encounterHasProse = !!scene.encounter && collectReaderFacingTexts(scene).length > 0;
        if (sceneHasNoBeats && (!scene.encounter || (input.treatmentSourced && !encounterHasProse))) {
          issues.push({
            type: 'empty_scene',
            severity: 'error',
            message: scene.encounter
              ? `Encounter scene "${scene.name || scene.id}" has no reader-facing beats — the encounter anchor was not dramatized.`
              : `Non-encounter scene "${scene.name || scene.id}" has no reader-facing beats.`,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: scene.id,
          });
        }

        if (!scene.encounter && this.isPlaceholderOnlyScene(scene)) {
          issues.push({
            type: 'placeholder_scene',
            severity: 'error',
            message: `Scene "${scene.name || scene.id}" is only placeholder or branch-residue text.`,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: scene.id,
          });
        }

        this.validateSceneBeatNavigation(episode, scene, sceneMap, issues);
        this.collectSceneTexts(scene, storyTexts, callbackScenes, callbackChoices);
      }
    }

    this.collectSupernaturalCanonContradictions(input.story, storyTexts, issues);
    await this.validateCallbacks(callbackScenes, callbackChoices, issues, metrics, input.treatmentSourced === true, input.callbackLedger, input.generatedThroughEpisode);
    this.validateMechanicsLeakage(storyTexts, issues, metrics);
    this.validateIncrementalResults(input.incrementalValidationResults || [], issues, metrics);
    this.validateQAReports(input.qaReport, input.bestPracticesReport, issues, metrics, input.treatmentSourced === true);
    this.validateFidelityFindings(input, issues);

    this.reconcileFrozenIncrementalFlags(issues);

    return this.buildReport(issues, metrics);
  }

  private validateRequestedEpisodes(
    input: FinalStoryContractInput,
    issues: FinalStoryContractIssue[],
    metrics: FinalStoryContractReport['metrics']
  ): void {
    const requested = input.requestedEpisodeNumbers || [];
    if (requested.length === 0) return;

    const generated = new Set((input.story.episodes || []).map(episode => episode.number));
    for (const episodeNumber of requested) {
      if (generated.has(episodeNumber)) continue;
      metrics.requestedEpisodesMissing++;
      issues.push({
        type: 'missing_requested_episode',
        severity: 'error',
        message: `Requested episode ${episodeNumber} is missing from the final story.`,
        episodeNumber,
      });
    }
  }

  private validateSourceEpisodeReconciliation(
    input: FinalStoryContractInput,
    issues: FinalStoryContractIssue[],
    mode: 'strict' | 'advisory' | 'disabled'
  ): void {
    const sourceEpisodes = input.sourceSeasonPlan?.episodes || [];
    if (sourceEpisodes.length === 0) return;

    const sourceEpisodeCount = input.sourceSeasonPlan?.totalEpisodes || sourceEpisodes.length;
    const generatedEpisodeNumbers = (input.story.episodes || [])
      .map(episode => episode.number)
      .filter((episodeNumber): episodeNumber is number => typeof episodeNumber === 'number')
      .sort((a, b) => a - b);
    if (input.treatmentSourced && sourceEpisodeCount > generatedEpisodeNumbers.length) {
      const requestedCount = input.requestedEpisodeNumbers?.length || generatedEpisodeNumbers.length;
      const fullSeasonRequested = requestedCount >= sourceEpisodeCount;
      issues.push({
        type: 'partial_season_scope',
        severity: fullSeasonRequested ? 'error' : 'warning',
        message:
          fullSeasonRequested
            ? `Treatment-sourced output is missing planned episode(s): generated episode(s) ${generatedEpisodeNumbers.join(', ') || '(none)'} of ${sourceEpisodeCount} source episode(s). Full-season mode cannot pass.`
            : `Treatment-sourced output is a partial slice: generated episode(s) ${generatedEpisodeNumbers.join(', ') || '(none)'} of ${sourceEpisodeCount} source episode(s). This is not a full treatment completion.`,
        suggestion:
          fullSeasonRequested
            ? 'Regenerate missing planned episodes before marking the treatment complete.'
            : 'Persist generatedOutputScope as partial-slice and preserve future payoff obligations for continuation.',
      });
    }

    const sourceByNumber = new Map(sourceEpisodes.map(episode => [episode.episodeNumber, episode]));
    for (const episode of input.story.episodes || []) {
      const source = sourceByNumber.get(episode.number);
      if (!source) continue;
      if (source.title && episode.title && source.title.trim() !== episode.title.trim()) {
        issues.push({
          type: 'source_role_mismatch',
          severity: mode === 'strict' ? 'error' : 'warning',
          message: `Episode ${episode.number} title differs from the source plan: "${episode.title}" vs "${source.title}".`,
          episodeId: episode.id,
          episodeNumber: episode.number,
        });
      }
    }
  }

  private collectReachableScenes(episode: Episode): Set<string> {
    const sceneMap = new Map((episode.scenes || []).map(scene => [scene.id, scene]));
    const reachable = new Set<string>();
    const queue: string[] = episode.startingSceneId ? [episode.startingSceneId] : [];

    while (queue.length > 0) {
      const sceneId = queue.shift()!;
      if (reachable.has(sceneId)) continue;
      const scene = sceneMap.get(sceneId);
      if (!scene) continue;
      reachable.add(sceneId);

      for (const nextSceneId of this.getSceneTargets(scene)) {
        if (sceneMap.has(nextSceneId) && !reachable.has(nextSceneId)) {
          queue.push(nextSceneId);
        }
      }
    }

    return reachable;
  }

  private getSceneTargets(scene: Scene): string[] {
    const targets = new Set<string>();
    for (const target of scene.leadsTo || []) {
      if (target) targets.add(target);
    }
    for (const beat of scene.beats || []) {
      if (beat.nextSceneId) targets.add(beat.nextSceneId);
      for (const choice of beat.choices || []) {
        if (choice.nextSceneId) targets.add(choice.nextSceneId);
      }
    }
    return [...targets];
  }

  private validateSceneBeatNavigation(
    episode: Episode,
    scene: Scene,
    sceneMap: Map<string, Scene>,
    issues: FinalStoryContractIssue[]
  ): void {
    const beatMap = new Map((scene.beats || []).map(beat => [beat.id, beat]));

    if (scene.beats?.length && (!scene.startingBeatId || !beatMap.has(scene.startingBeatId))) {
      issues.push({
        type: 'broken_navigation',
        severity: 'error',
        message: `Scene startingBeatId "${scene.startingBeatId || '(missing)'}" does not point at a beat.`,
        episodeId: episode.id,
        episodeNumber: episode.number,
        sceneId: scene.id,
      });
    }

    for (const beat of scene.beats || []) {
      if (beat.nextBeatId && !beatMap.has(beat.nextBeatId)) {
        issues.push({
          type: 'broken_navigation',
          severity: 'error',
          message: `Beat "${beat.id}" routes to missing beat "${beat.nextBeatId}".`,
          episodeId: episode.id,
          episodeNumber: episode.number,
          sceneId: scene.id,
          beatId: beat.id,
        });
      }
      if (beat.nextSceneId && !sceneMap.has(beat.nextSceneId) && !isTerminalSceneTarget(beat.nextSceneId)) {
        issues.push({
          type: 'broken_navigation',
          severity: 'error',
          message: `Beat "${beat.id}" routes to missing scene "${beat.nextSceneId}".`,
          episodeId: episode.id,
          episodeNumber: episode.number,
          sceneId: scene.id,
          beatId: beat.id,
        });
      }
      for (const choice of beat.choices || []) {
        if (choice.nextBeatId && !beatMap.has(choice.nextBeatId)) {
          issues.push({
            type: 'broken_navigation',
            severity: 'error',
            message: `Choice "${choice.id}" routes to missing beat "${choice.nextBeatId}".`,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: scene.id,
            beatId: beat.id,
          });
        }
        if (choice.nextSceneId && !sceneMap.has(choice.nextSceneId) && !isTerminalSceneTarget(choice.nextSceneId)) {
          issues.push({
            type: 'broken_navigation',
            severity: 'error',
            message: `Choice "${choice.id}" routes to missing scene "${choice.nextSceneId}".`,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: scene.id,
            beatId: beat.id,
          });
        }
      }
    }

    this.validateRoutingConsistency(episode, scene, sceneMap, issues);
    this.validateChoiceBridgeContinuity(episode, scene, sceneMap, issues);
  }

  /**
   * A beat/choice `nextSceneId` that points at a REAL scene which is NOT in the
   * scene's authored `leadsTo` is a routing contradiction: the scene graph and
   * the navigation disagree. This is what let cold-path players replay the wrong
   * parallel branch (scene-2a's `continue` pointed at scene-2b — the array
   * neighbour — while `leadsTo` was [scene-3]), corrupting mutually-exclusive
   * flag state. The engine honors the explicit target over `leadsTo`, so this
   * must block. We only compare when `leadsTo` is populated (it enumerates the
   * scene's real onward targets) and skip terminal sentinels + missing scenes
   * (those are handled by `broken_navigation`).
   */
  private validateRoutingConsistency(
    episode: Episode,
    scene: Scene,
    sceneMap: Map<string, Scene>,
    issues: FinalStoryContractIssue[]
  ): void {
    const leadsTo = scene.leadsTo || [];
    if (leadsTo.length === 0) return; // can't compare; last scene / open end
    const allowed = new Set(leadsTo);

    const flag = (targetSceneId: string, where: string, beatId: string) => {
      if (!targetSceneId) return;
      if (allowed.has(targetSceneId)) return;
      if (isTerminalSceneTarget(targetSceneId)) return;
      if (!sceneMap.has(targetSceneId)) return; // broken_navigation owns this
      issues.push({
        type: 'routing_contradiction',
        severity: 'error',
        message: `${where} routes to "${targetSceneId}", which is not in scene "${scene.id}".leadsTo [${leadsTo.join(', ')}]. The engine honors the explicit target over leadsTo, so this contradicts the scene graph (replays the wrong branch / corrupts flag state).`,
        episodeId: episode.id,
        episodeNumber: episode.number,
        sceneId: scene.id,
        beatId,
        suggestion: `Set the target to a leadsTo entry (e.g. "${leadsTo[0]}") or add it to leadsTo if the branch is intentional.`,
      });
    };

    for (const beat of scene.beats || []) {
      if (beat.nextSceneId) flag(beat.nextSceneId, `Beat "${beat.id}"`, beat.id);
      for (const choice of beat.choices || []) {
        if (choice.nextSceneId) flag(choice.nextSceneId, `Choice "${choice.id}"`, beat.id);
      }
    }
  }

  private validateChoiceBridgeContinuity(
    episode: Episode,
    scene: Scene,
    sceneMap: Map<string, Scene>,
    issues: FinalStoryContractIssue[]
  ): void {
    const scenes = episode.scenes || [];
    const sourceIndex = scenes.findIndex(candidate => candidate.id === scene.id);
    if (sourceIndex < 0) return;

    const isAllowedSkip = (node: unknown): boolean => {
      const data = node as Record<string, unknown> | undefined;
      return Boolean(data?.allowSceneSkip || data?.intentionalSceneSkip || data?.skipAllowed);
    };
    const isChoiceBridge = (node: unknown): boolean => {
      const data = node as Record<string, unknown> | undefined;
      return Boolean(data?.isChoiceBridge || data?.sourceChoiceId);
    };
    const hasRequiredSetup = (candidate: Scene): boolean => {
      if (candidate.encounter) return true;
      return (candidate.beats || []).some(beat => (beat.text || '').trim().length > 0 && !PLACEHOLDER_TEXT_PATTERN.test(beat.text || ''));
    };
    const flagSkip = (targetSceneId: string | undefined, where: string, beatId: string, node: unknown): void => {
      if (!isChoiceBridge(node)) return;
      if (!targetSceneId || isTerminalSceneTarget(targetSceneId) || isAllowedSkip(node)) return;
      const targetIndex = scenes.findIndex(candidate => candidate.id === targetSceneId);
      if (targetIndex <= sourceIndex + 1) return;
      if (!sceneMap.has(targetSceneId)) return;

      const skipped = scenes.slice(sourceIndex + 1, targetIndex).filter(hasRequiredSetup);
      if (skipped.length === 0) return;
      issues.push({
        type: 'choice_bridge_skips_required_setup',
        severity: 'error',
        message: `${where} jumps from "${scene.id}" to "${targetSceneId}", skipping required setup scene(s): ${skipped.map(s => s.id).join(', ')}.`,
        episodeId: episode.id,
        episodeNumber: episode.number,
        sceneId: scene.id,
        beatId,
        suggestion: 'Route through the setup scene(s), add an explicit bridge that carries their required information, or mark the skip as intentional only when alternate-path continuity has been authored.',
      });
    };

    for (const beat of scene.beats || []) {
      flagSkip(beat.nextSceneId, `Beat "${beat.id}"`, beat.id, beat);
      for (const choice of beat.choices || []) {
        flagSkip(choice.nextSceneId, `Choice "${choice.id}"`, beat.id, choice);
      }
    }
  }

  private isPlaceholderOnlyScene(scene: Scene): boolean {
    if (!scene.beats || scene.beats.length !== 1) return false;
    return PLACEHOLDER_TEXT_PATTERN.test(scene.beats[0]?.text || '');
  }

  private collectSceneTexts(
    scene: Scene,
    storyTexts: MechanicsLeakageText[],
    callbackScenes: Array<{ id: string; beats: Array<{ id: string; text: string; textVariants?: Array<{ condition: unknown; text: string }>; speaker?: string }> }>,
    callbackChoices: Array<{ id: string; sceneId: string; text: string; consequences?: Consequence[]; reminderPlan?: unknown }>
  ): void {
    callbackScenes.push({
      id: scene.id,
      beats: (scene.beats || []).map(beat => ({
        id: beat.id,
        text: beat.text,
        textVariants: beat.textVariants,
        speaker: beat.speaker,
      })),
    });

    for (const beat of scene.beats || []) {
      storyTexts.push({ id: `${scene.id}:${beat.id}`, sceneId: scene.id, beatId: beat.id, text: beat.text || '' });
      for (const variant of beat.textVariants || []) {
        storyTexts.push({ id: `${scene.id}:${beat.id}:variant`, sceneId: scene.id, beatId: beat.id, text: variant.text || '' });
      }
      for (const choice of beat.choices || []) {
        storyTexts.push({ id: `${scene.id}:${beat.id}:${choice.id}`, sceneId: scene.id, beatId: beat.id, text: choice.text || '' });
        callbackChoices.push({
          id: choice.id,
          sceneId: scene.id,
          text: choice.text,
          consequences: choice.consequences,
          reminderPlan: choice.reminderPlan,
        });
      }
    }

    this.collectEncounterTexts(scene, storyTexts);
  }

  private collectEncounterTexts(scene: Scene, storyTexts: MechanicsLeakageText[]): void {
    for (const phase of scene.encounter?.phases || []) {
      for (const beat of phase.beats || []) {
        const encounterBeat = beat as Beat & { setupText?: string; choices?: Array<{ id: string; text: string; outcomes?: Record<string, { narrativeText?: string; nextSituation?: unknown }> }> };
        const text = encounterBeat.setupText || encounterBeat.text || '';
        storyTexts.push({ id: `${scene.id}:${encounterBeat.id}`, sceneId: scene.id, beatId: encounterBeat.id, text });
        for (const choice of encounterBeat.choices || []) {
          storyTexts.push({ id: `${scene.id}:${encounterBeat.id}:${choice.id}`, sceneId: scene.id, beatId: encounterBeat.id, text: choice.text || '' });
          for (const outcome of Object.values(choice.outcomes || {})) {
            if (outcome?.narrativeText) {
              storyTexts.push({ id: `${scene.id}:${encounterBeat.id}:${choice.id}:outcome`, sceneId: scene.id, beatId: encounterBeat.id, text: outcome.narrativeText });
            }
          }
        }
      }
    }
    for (const storylet of Object.values(scene.encounter?.storylets || {})) {
      for (const beat of storylet?.beats || []) {
        storyTexts.push({ id: `${scene.id}:storylet:${beat.id}`, sceneId: scene.id, beatId: beat.id, text: beat.text || '' });
      }
    }
  }

  private collectSupernaturalCanonContradictions(
    story: Story,
    storyTexts: MechanicsLeakageText[],
    issues: FinalStoryContractIssue[],
  ): void {
    const supernaturalMealTerms = String.raw`(?:lunch|brunch|breakfast)`;
    const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const vampireNames = (story.npcs || [])
      .filter((npc) => {
        const haystack = JSON.stringify(npc).toLowerCase();
        return /\b(?:vampire|strigoi)\b/.test(haystack);
      })
      .flatMap((npc) => {
        const full = typeof npc.name === 'string' ? npc.name.trim() : '';
        const first = full.split(/\s+/)[0] || '';
        return [full, first].filter((name, index, arr) => name.length >= 3 && arr.indexOf(name) === index);
      });

    if (vampireNames.length === 0) return;

    const vampireNamePattern = vampireNames.map(escapeRegExp).join('|');
    const contradictionPattern = new RegExp(
      String.raw`\b(?:${vampireNamePattern})\b[^.!?\n]{0,120}\b${supernaturalMealTerms}\b|\b${supernaturalMealTerms}\b[^.!?\n]{0,120}\b(?:${vampireNamePattern})\b`,
      'i',
    );
    const negatedTellPattern = /\b(?:never|not|no|cannot|can't|doesn't|does not)\b[^.!?\n]{0,40}\b(?:lunch|brunch|breakfast)\b/i;

    for (const item of storyTexts) {
      const text = item.text || '';
      const match = text.match(contradictionPattern);
      if (!match) continue;
      const snippet = match[0];
      if (negatedTellPattern.test(snippet)) continue;
      issues.push({
        type: 'supernatural_canon_contradiction',
        severity: 'error',
        message:
          `Canon contradiction in ${item.id}: vampire/strigoi character scheduled for a daytime meal ` +
          `("${snippet.slice(0, 100)}${snippet.length > 100 ? '...' : ''}").`,
        sceneId: item.sceneId,
        beatId: item.beatId,
        validator: 'FinalStoryContractValidator',
        suggestion: 'Move vampire/strigoi invitations to dinner, after sundown, midnight, or another night-appropriate event.',
      });
    }
  }

  private async validateCallbacks(
    callbackScenes: Array<{ id: string; beats: Array<{ id: string; text: string; textVariants?: Array<{ condition: unknown; text: string }>; speaker?: string }> }>,
    callbackChoices: Array<{ id: string; sceneId: string; text: string; consequences?: Consequence[]; reminderPlan?: unknown }>,
    issues: FinalStoryContractIssue[],
    metrics: FinalStoryContractReport['metrics'],
    treatmentSourced: boolean,
    callbackLedger?: SerializedCallbackLedger,
    generatedThroughEpisode?: number,
  ): Promise<void> {
    const result = await new CallbackOpportunitiesValidator({ level: 'error' }).validate({
      scenes: callbackScenes,
      choices: callbackChoices as any,
      callbackLedger,
      generatedThroughEpisode,
    });
    metrics.callbackIssues = result.issues.length;
    for (const issue of result.issues) {
      if (issue.level !== 'error') continue;
      issues.push({
        // F3: callback debt remains advisory for freeform runs. Treatment-sourced
        // slices are stricter: visible authored axes cannot leave in-slice debt
        // while still claiming a passing final contract.
        type: 'unrepaired_callback_debt',
        severity: treatmentSourced ? 'error' : 'warning',
        message: issue.message,
        validator: 'CallbackOpportunitiesValidator',
        suggestion: issue.suggestion,
      });
    }
  }

  private validateMechanicsLeakage(
    storyTexts: MechanicsLeakageText[],
    issues: FinalStoryContractIssue[],
    metrics: FinalStoryContractReport['metrics']
  ): void {
    const blockOn = gateDesignNoteLeak();
    const result = new MechanicsLeakageValidator().validate({
      texts: storyTexts,
      scanDesignNotes: blockOn,
    });
    metrics.mechanicsLeaks = result.metrics.leaksFound;
    for (const issue of result.issues) {
      issues.push({
        type: 'qa_blocker_present',
        severity: 'error',
        message: issue.message,
        validator: 'MechanicsLeakageValidator',
        suggestion: issue.suggestion,
      });
    }
    // Shadow metric: count design-note-class leaks REGARDLESS of the gate flag, so the
    // off→on promotion decision has data. When the gate is on, the design-note findings
    // are already in `result`; when off, a second (pure) scan isolates their count. No
    // blocking issues are added from the shadow scan.
    if (blockOn) {
      const mechanicsOnly = new MechanicsLeakageValidator().validate({ texts: storyTexts, scanDesignNotes: false });
      metrics.designNoteLeaks = result.metrics.leaksFound - mechanicsOnly.metrics.leaksFound;
    } else {
      const withDesignNotes = new MechanicsLeakageValidator().validate({ texts: storyTexts, scanDesignNotes: true });
      metrics.designNoteLeaks = withDesignNotes.metrics.leaksFound - result.metrics.leaksFound;
    }
  }

  private validateIncrementalResults(
    results: SceneValidationResult[],
    issues: FinalStoryContractIssue[],
    metrics: FinalStoryContractReport['metrics']
  ): void {
    for (const result of results) {
      if (result.overallPassed) continue;
      metrics.failedIncrementalResults++;
      // Only HARD-BLOCK when the regeneration loop actually tried and still failed
      // (regenerationRequested !== 'none'): that's genuinely unrepaired bad output, and the
      // fix belongs in generation. A failure where the runner requested NO regeneration is a
      // SOFT/heuristic finding (continuity / POV / voice that the runner itself didn't deem
      // regenerate-worthy, or sensitivity) — blocking the whole contract on it created the
      // unrepairable dead-end the sensitivity bug exposed (one heuristic keyword aborting a
      // multi-episode run with no recourse). Those are advisory; the per-validator reasons are
      // persisted to the run diagnostics so generation can still be improved.
      const blocking = result.regenerationRequested !== 'none';
      issues.push({
        type: 'failed_incremental_validation',
        severity: blocking ? 'error' : 'warning',
        message: blocking
          ? `Scene "${result.sceneName || result.sceneId}" still has unrepaired incremental validation failures.`
          : `Scene "${result.sceneName || result.sceneId}" has advisory incremental findings (no regeneration was requested).`,
        episodeNumber: result.episodeNumber,
        sceneId: result.sceneId,
        validator: 'IncrementalValidationRunner',
        suggestion: `Regeneration requested: ${result.regenerationRequested}`,
      });
    }
  }

  /**
   * `failed_incremental_validation` is a FROZEN generation-time snapshot — it is not
   * re-derived from the current story, so it re-blocks on every contract re-validation even
   * after the Wave-4 repair loop fixes the underlying defect (bite-me-g20: s3-3's stub
   * outcome-texts were repairable, but the frozen flag kept aborting the run, an unrepairable
   * dead-end). The contract's OWN validators re-check the current, possibly-repaired story and
   * surface the actual defects (outcome_text_stub, broken_navigation, …) as their own
   * error-severity findings. So when NO other error-severity finding remains, the frozen flag is
   * stale (its issue was repaired or isn't independently blocking) → downgrade it to advisory so
   * the repaired report can pass. A persisting real defect still surfaces as its own error and
   * blocks, so this never lets a genuine defect ship.
   */
  private reconcileFrozenIncrementalFlags(issues: FinalStoryContractIssue[]): void {
    const hasOtherError = issues.some(
      (i) => i.severity === 'error' && i.validator !== 'IncrementalValidationRunner',
    );
    if (hasOtherError) return;
    for (const i of issues) {
      if (i.type === 'failed_incremental_validation' && i.severity === 'error') i.severity = 'warning';
    }
  }

  private validateQAReports(
    qaReport: QAReport | undefined,
    bestPracticesReport: ComprehensiveValidationReport | undefined,
    issues: FinalStoryContractIssue[],
    metrics: FinalStoryContractReport['metrics'],
    treatmentSourced: boolean
  ): void {
    if (qaReport && (!qaReport.passesQA || qaReport.criticalIssues.length > 0)) {
      // F3: QA score is an LLM self-assessment (craft signal), not a hard
      // playability gate — advisory by default so the story ships with the score
      // recorded rather than producing zero output. GATE_QA_CRITICAL_BLOCK promotes
      // it to blocking once an auto-repair path exists (default-off ⇒ unchanged).
      issues.push({
        type: 'qa_blocker_present',
        severity: treatmentSourced || isGateEnabledAt('GATE_QA_CRITICAL_BLOCK', 'season-final') ? 'error' : 'warning',
        message: `QA report did not pass: ${qaReport.criticalIssues.join('; ') || `score ${qaReport.overallScore}`}`,
        validator: 'QARunner',
      });
    }

    // W6: cross-scene continuity ERRORS (impossible_knowledge / contradiction /
    // missing_setup / timeline_error) are detected by the QA pass but, being part of
    // the advisory QA report, previously shipped invisibly when the remediation gate
    // was off (only the generic qa_blocker_present warning mentioned them in passing).
    // DETECTION is now DECOUPLED from remediation: these high-precision error classes
    // are ALWAYS surfaced as discrete contract issues. Severity escalates to blocking
    // only when GATE_CONTINUITY_REMEDIATION (or the broader GATE_QA_CRITICAL_BLOCK) is
    // on, so the bounded GATE_FINAL_CONTRACT_REPAIR loop can engage / the run fails
    // loud rather than shipping a contradiction. state_conflict is deliberately
    // excluded (noisier). Default-off ⇒ they appear as warnings (newly visible) but
    // never block, so a passing run cannot flip to failing.
    if (qaReport?.continuity?.issues?.length) {
      const REMEDIABLE = new Set(['impossible_knowledge', 'contradiction', 'missing_setup', 'timeline_error']);
      const blockContinuity =
        treatmentSourced || isGateEnabled('GATE_CONTINUITY_REMEDIATION') || isGateEnabled('GATE_QA_CRITICAL_BLOCK');
      for (const issue of qaReport.continuity.issues) {
        if (issue.severity !== 'error' || !REMEDIABLE.has(issue.type)) continue;
        issues.push({
          type: 'continuity_error',
          severity: blockContinuity ? 'error' : 'warning',
          message: `Continuity ${issue.type}: ${issue.description}`,
          sceneId: issue.location?.sceneId,
          beatId: issue.location?.beatId,
          validator: 'ContinuityChecker',
          suggestion: issue.suggestedFix,
        });
      }
    }

    for (const issue of bestPracticesReport?.blockingIssues || []) {
      const type = issue.category === 'callback_opportunities'
        ? 'unrepaired_callback_debt'
        : 'qa_blocker_present';
      if (type === 'unrepaired_callback_debt') metrics.callbackIssues++;
      // F3: best-practices craft findings are advisory at the final gate — EXCEPT
      // escalated correctness classes (witness-id integrity) when their rollout
      // flag is on, which stay blocking. Callback debt in treatment-sourced
      // output also blocks because the source axes are authored obligations.
      const escalated = isEscalatedIssue(issue);
      const treatmentCallbackDebt = treatmentSourced && type === 'unrepaired_callback_debt';
      issues.push({
        type,
        severity: escalated || treatmentCallbackDebt ? 'error' : 'warning',
        message: issue.message,
        validator: 'IntegratedBestPracticesValidator',
        suggestion: issue.suggestion,
      });
    }
  }

  /**
   * §4.6 — treatment-fidelity findings (4.1–4.5) at the final gate.
   *
   * QA-prose findings (validateQAReports above) are LLM craft self-assessments and
   * stay advisory so a story still ships. Treatment-fidelity findings are a
   * different class: when the run's source-of-record is an authored treatment
   * (`input.treatmentSourced`), a fidelity error means the pipeline re-cut /
   * dropped / inverted authored content — that must HARD-FAIL, not downgrade.
   *
   * When NOT treatment-sourced (no authored spine to conform to), treatment fidelity
   * findings are recorded as advisory warnings. Scene-transition continuity and
   * treatment-sourced scene-turn realization are promoted generator gates, so their
   * error findings remain blocking when they represent structural flow failures.
   * With no `fidelityFindings` passed (the validators not yet dispatched), this is
   * a no-op.
   */
  private validateFidelityFindings(
    input: FinalStoryContractInput,
    issues: FinalStoryContractIssue[]
  ): void {
    for (const finding of input.fidelityFindings || []) {
      // Defensive: only treat known §4 validators as a fidelity class.
      const isFidelity = isTreatmentFidelityFinding(finding);
      const isTransitionContinuity = finding.validator === 'SceneTransitionContinuityValidator';
      const isSceneTurn = finding.validator === 'SceneTurnRealizationValidator';
      const isRelationshipPacing = finding.validator === 'RelationshipPacingValidator';
      const isMechanicPressure = finding.validator === 'NarrativeMechanicPressureValidator';
      const isTreatmentFieldUtilization = finding.validator === 'TreatmentFieldUtilizationValidator';
      const severity: 'error' | 'warning' =
        finding.severity === 'error' && (isTransitionContinuity || isSceneTurn || isRelationshipPacing || isMechanicPressure || isTreatmentFieldUtilization)
          ? 'error'
          : finding.severity === 'error' && isFidelity && input.treatmentSourced
          ? 'error'
          : finding.severity === 'error' && !input.treatmentSourced
          ? 'warning'
          : finding.severity;
      issues.push({
        type: isTransitionContinuity
          ? 'transition_continuity_violation'
          : isSceneTurn
          ? 'scene_turn_realization_violation'
          : isRelationshipPacing
          ? 'relationship_pacing_violation'
          : isMechanicPressure
          ? 'mechanic_pressure_violation'
          : isTreatmentFieldUtilization
          ? 'treatment_field_utilization_violation'
          : 'treatment_fidelity_violation',
        severity,
        message: finding.message,
        validator: finding.validator,
        suggestion: finding.suggestion,
        episodeNumber: finding.episodeNumber,
        sceneId: finding.sceneId,
      });
    }
  }

  private buildReport(
    issues: FinalStoryContractIssue[],
    metrics: FinalStoryContractReport['metrics']
  ): FinalStoryContractReport {
    const blockingIssues = issues.filter(issue => issue.severity === 'error');
    const warnings = issues.filter(issue => issue.severity === 'warning');
    return {
      passed: blockingIssues.length === 0,
      blockingIssues,
      warnings,
      metrics,
      generatedAt: new Date().toISOString(),
    };
  }

  private collectChoiceCountContractIssues(story: Story): FinalStoryContractIssue[] {
    const issues: FinalStoryContractIssue[] = [];
    const note = (
      count: number,
      path: string,
      episodeId?: string,
      episodeNumber?: number,
      sceneId?: string,
      beatId?: string,
    ) => {
      if (count === 0 || (count >= 3 && count <= 4)) return;
      issues.push({
        type: 'choice_count_contract',
        severity: 'error',
        message: `Choice surface at ${path} has ${count} choice(s); reader-facing story and encounter beats must have 3-4 choices.`,
        episodeId,
        episodeNumber,
        sceneId,
        beatId,
        validator: 'FinalStoryContractValidator',
        suggestion: 'Re-author or repair this choice surface to exactly three or four fiction-specific options.',
      });
    };

    const walkEncounter = (
      value: unknown,
      path: string,
      episodeId: string | undefined,
      episodeNumber: number | undefined,
      sceneId: string | undefined,
    ) => {
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.choices)) {
        note(record.choices.length, path, episodeId, episodeNumber, sceneId);
      }
      for (const [key, child] of Object.entries(record)) {
        if (key === 'choices') continue;
        if (Array.isArray(child)) {
          child.forEach((item, index) => walkEncounter(item, `${path}.${key}[${index}]`, episodeId, episodeNumber, sceneId));
        } else if (child && typeof child === 'object') {
          walkEncounter(child, `${path}.${key}`, episodeId, episodeNumber, sceneId);
        }
      }
    };

    for (const ep of story.episodes || []) {
      for (const scene of ep.scenes || []) {
        for (const beat of scene.beats || []) {
          if (Array.isArray(beat.choices)) {
            note(beat.choices.length, `episode ${ep.number} scene ${scene.id} beat ${beat.id}`, ep.id, ep.number, scene.id, beat.id);
          }
        }
        const encounter = (scene as unknown as { encounter?: unknown }).encounter;
        if (encounter) {
          walkEncounter(encounter, `episode ${ep.number} scene ${scene.id} encounter`, ep.id, ep.number, scene.id);
        }
      }
    }

    return issues;
  }
}
