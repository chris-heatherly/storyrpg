import type { Story, Episode, Scene, Beat, Consequence } from '../../types';
import type { QAReport } from '../agents/QAAgents';
import type { ComprehensiveValidationReport } from '../../types/validation';
import type { SceneValidationResult } from './IncrementalValidators';
import { CallbackOpportunitiesValidator } from './CallbackOpportunitiesValidator';
import { IncrementalEncounterValidator } from './IncrementalValidators';
import { MechanicsLeakageValidator, type MechanicsLeakageText } from './MechanicsLeakageValidator';
import { gateDesignNoteLeak, isEscalatedIssue } from './issueEscalation';
import { canonicalizeStoryWitnessReactions } from '../utils/witnessNpcResolver';
import { canonicalizeProtagonistPronouns, otherGenderNamesFromStory } from '../utils/protagonistPronounResolver';
import { seedEncounterOutcomeFlags, findEncounterOutcomeDesyncs } from '../utils/encounterOutcomeFlags';
import { isGateEnabled } from '../remediation/gateDefaults';
import { isTreatmentFidelityFinding } from './treatmentFidelityGate';
import { findBeatIdCollisions } from './beatIdCollisions';

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
  | 'beat_id_collision'
  | 'encounter_template_collapse'
  | 'encounter_clock_coverage_gap'
  | 'missing_requested_episode'
  | 'failed_incremental_validation'
  | 'unrepaired_callback_debt'
  | 'source_role_mismatch'
  | 'treatment_fidelity_violation'
  | 'ambiguous_protagonist_pronoun'
  | 'encounter_outcome_desync'
  | 'continuity_error'
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

export class FinalStoryContractValidator {
  async validate(input: FinalStoryContractInput): Promise<FinalStoryContractReport> {
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

    // W1: deterministically repair wrong-gender protagonist pronouns in player-facing
    // prose (the encounter generator drifted Kylie -> he/him). Pronouns are canon, so
    // the safe (protagonist-only-sentence) repair runs always — pure data correctness,
    // like the witness pass above. Genuinely ambiguous residue (protagonist + a
    // wrong-gender NPC in one sentence) is never auto-rewritten; it is flagged for
    // regen only when GATE_PROTAGONIST_PRONOUN is on.
    if (input.protagonist?.pronouns) {
      const names = [input.protagonist.name, ...(input.protagonist.aliases || [])].filter(
        (n): n is string => Boolean(n),
      );
      if (names.length > 0) {
        const pronounFix = canonicalizeProtagonistPronouns(
          input.story,
          { names, pronouns: input.protagonist.pronouns },
          otherGenderNamesFromStory(input.story, input.protagonist.pronouns),
        );
        if (pronounFix.repaired > 0 || pronounFix.ambiguous.length > 0) {
          console.info(
            `[FinalStoryContract] protagonist pronouns: repaired ${pronounFix.repaired}, ` +
            `ambiguous ${pronounFix.ambiguous.length} (of ${pronounFix.fieldsScanned} fields)`,
          );
        }
        if (isGateEnabled('GATE_PROTAGONIST_PRONOUN')) {
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

    // W4: deterministically seed `encounter_<id>_<outcome>` flags on every encounter
    // outcome (always-on capability seeding), then detect reconvergences where ≥2
    // outcomes share a next scene that carries no outcome-conditioned text — the
    // prose cannot reflect what happened (the Endsong wall-breach → s3-5 desync).
    seedEncounterOutcomeFlags(input.story);
    if (isGateEnabled('GATE_ENCOUNTER_OUTCOME_VARIANT')) {
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
        // (wall-breach-is-empty → poisoning-never-administered) must fail there.
        const sceneHasNoBeats = !scene.beats || scene.beats.length === 0;
        if (sceneHasNoBeats && (!scene.encounter || input.treatmentSourced)) {
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

    await this.validateCallbacks(callbackScenes, callbackChoices, issues, metrics);
    this.validateMechanicsLeakage(storyTexts, issues, metrics);
    this.validateIncrementalResults(input.incrementalValidationResults || [], issues, metrics);
    this.validateQAReports(input.qaReport, input.bestPracticesReport, issues, metrics);
    this.validateFidelityFindings(input, issues);

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

  private async validateCallbacks(
    callbackScenes: Array<{ id: string; beats: Array<{ id: string; text: string; textVariants?: Array<{ condition: unknown; text: string }>; speaker?: string }> }>,
    callbackChoices: Array<{ id: string; sceneId: string; text: string; consequences?: Consequence[]; reminderPlan?: unknown }>,
    issues: FinalStoryContractIssue[],
    metrics: FinalStoryContractReport['metrics']
  ): Promise<void> {
    const result = await new CallbackOpportunitiesValidator({ level: 'error' }).validate({
      scenes: callbackScenes,
      choices: callbackChoices as any,
    });
    metrics.callbackIssues = result.issues.length;
    for (const issue of result.issues) {
      if (issue.level !== 'error') continue;
      issues.push({
        // F3: callback debt is a craft/quality issue, not a playability bug —
        // advisory so the story still ships (recorded as a warning + in the
        // quality ledger). See docs/PROJECT_AUDIT_2026-05-28.md.
        type: 'unrepaired_callback_debt',
        severity: 'warning',
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

  private validateQAReports(
    qaReport: QAReport | undefined,
    bestPracticesReport: ComprehensiveValidationReport | undefined,
    issues: FinalStoryContractIssue[],
    metrics: FinalStoryContractReport['metrics']
  ): void {
    if (qaReport && (!qaReport.passesQA || qaReport.criticalIssues.length > 0)) {
      issues.push({
        // F3: QA score is an LLM self-assessment (craft signal), not a hard
        // playability gate — advisory so the story ships with the score
        // recorded rather than producing zero output.
        type: 'qa_blocker_present',
        severity: 'warning',
        message: `QA report did not pass: ${qaReport.criticalIssues.join('; ') || `score ${qaReport.overallScore}`}`,
        validator: 'QARunner',
      });
    }

    // W6: cross-scene continuity ERRORS (impossible_knowledge / contradiction /
    // missing_setup / timeline_error) are detected by the QA pass but, being part of
    // the advisory QA report, otherwise ship unremediated. When
    // GATE_CONTINUITY_REMEDIATION is on, promote ONLY these high-precision error
    // classes to blocking contract issues so the bounded GATE_FINAL_CONTRACT_REPAIR
    // loop engages (and, failing that, the run fails loud rather than shipping a
    // contradiction). state_conflict is deliberately excluded (noisier). Default-off
    // ⇒ behavior unchanged. NOTE: post-assembly scene REGEN wiring is the deferred
    // deeper step; this is the detection + gating half.
    if (qaReport?.continuity?.issues?.length && isGateEnabled('GATE_CONTINUITY_REMEDIATION')) {
      const REMEDIABLE = new Set(['impossible_knowledge', 'contradiction', 'missing_setup', 'timeline_error']);
      for (const issue of qaReport.continuity.issues) {
        if (issue.severity !== 'error' || !REMEDIABLE.has(issue.type)) continue;
        issues.push({
          type: 'continuity_error',
          severity: 'error',
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
      // flag is on, which stay blocking. Default-off ⇒ unchanged ('warning').
      const escalated = isEscalatedIssue(issue);
      issues.push({
        type,
        severity: escalated ? 'error' : 'warning',
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
   * When NOT treatment-sourced (no authored spine to conform to), the findings are
   * recorded as advisory warnings. Default-off ⇒ with no `fidelityFindings` passed
   * (the validators not yet dispatched), this is a no-op.
   */
  private validateFidelityFindings(
    input: FinalStoryContractInput,
    issues: FinalStoryContractIssue[]
  ): void {
    for (const finding of input.fidelityFindings || []) {
      // Defensive: only treat known §4 validators as a fidelity class.
      const isFidelity = isTreatmentFidelityFinding(finding);
      const severity: 'error' | 'warning' =
        finding.severity === 'error' && isFidelity && input.treatmentSourced
          ? 'error'
          : finding.severity === 'error' && !input.treatmentSourced
          ? 'warning'
          : finding.severity;
      issues.push({
        type: 'treatment_fidelity_violation',
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
}
