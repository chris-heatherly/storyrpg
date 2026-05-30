import type { Story, Episode, Scene, Beat, Consequence } from '../../types';
import type { QAReport } from '../agents/QAAgents';
import type { ComprehensiveValidationReport } from '../../types/validation';
import type { SceneValidationResult } from './IncrementalValidators';
import { CallbackOpportunitiesValidator } from './CallbackOpportunitiesValidator';
import { IncrementalEncounterValidator } from './IncrementalValidators';
import { MechanicsLeakageValidator, type MechanicsLeakageText } from './MechanicsLeakageValidator';

export type FinalStoryContractIssueType =
  | 'empty_scene'
  | 'placeholder_scene'
  | 'invalid_encounter'
  | 'missing_runtime_encounter'
  | 'broken_navigation'
  | 'missing_requested_episode'
  | 'failed_incremental_validation'
  | 'unrepaired_callback_debt'
  | 'source_role_mismatch'
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
  };
  generatedAt: string;
}

export interface FinalStoryContractInput {
  story: Story;
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

        if (!scene.encounter && (!scene.beats || scene.beats.length === 0)) {
          issues.push({
            type: 'empty_scene',
            severity: 'error',
            message: `Non-encounter scene "${scene.name || scene.id}" has no reader-facing beats.`,
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
      if (beat.nextSceneId && !sceneMap.has(beat.nextSceneId)) {
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
        if (choice.nextSceneId && !sceneMap.has(choice.nextSceneId)) {
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
    const result = new MechanicsLeakageValidator().validate({ texts: storyTexts });
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
  }

  private validateIncrementalResults(
    results: SceneValidationResult[],
    issues: FinalStoryContractIssue[],
    metrics: FinalStoryContractReport['metrics']
  ): void {
    for (const result of results) {
      if (result.overallPassed) continue;
      metrics.failedIncrementalResults++;
      issues.push({
        // A scene the regeneration loop could not repair is bad output and must
        // block — the fix belongs in generation, not in relaxing this gate.
        // The specific per-validator reasons are persisted to the run diagnostics
        // (see worker error logging) so the generator can be fixed.
        type: 'failed_incremental_validation',
        severity: 'error',
        message: `Scene "${result.sceneName || result.sceneId}" still has unrepaired incremental validation failures.`,
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

    for (const issue of bestPracticesReport?.blockingIssues || []) {
      const type = issue.category === 'callback_opportunities'
        ? 'unrepaired_callback_debt'
        : 'qa_blocker_present';
      if (type === 'unrepaired_callback_debt') metrics.callbackIssues++;
      issues.push({
        // F3: best-practices craft findings are advisory at the final gate.
        type,
        severity: 'warning',
        message: issue.message,
        validator: 'IntegratedBestPracticesValidator',
        suggestion: issue.suggestion,
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
