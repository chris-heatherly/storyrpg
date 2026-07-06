/**
 * Episode Architecture Phase
 *
 * Phase 3 of story generation: runs StoryArchitect to produce the episode
 * blueprint — season-plan directives + structural context assembly, the
 * bounded branch-repair retry loop on scene-graph-branch failures, the
 * season-budgeted choice-type rebalance, generation-plan scene seeding, and
 * the B0/B1 advisory-vs-blocking craft-warning classification.
 *
 * Faithful port of FullStoryPipeline.runEpisodeArchitecture (pure move):
 * same prompts, same retry bounds, same events, same abort behavior. The
 * generate()-side wrapper block (resume checkpoint + PhaseValidator retry
 * loop) stays in the monolith with its resume state; the monolith keeps a
 * thin delegating runEpisodeArchitecture so all call sites are unchanged.
 * Run-scoped state is accessor-backed: `seasonChoicePlan` (written here,
 * read at choice assembly), `generationPlan`, `cachedPipelineMemory`, and
 * `architectAdvisoryWarnings` (appended here, surfaced at save time).
 */

import { CharacterBible } from '../../agents/CharacterDesigner';
import { StoryArchitect, StoryArchitectInput, EpisodeBlueprint, SceneBlueprint } from '../../agents/StoryArchitect';
import { WorldBible } from '../../agents/WorldBuilder';
import { type AgentResponse } from '../../agents/BaseAgent';
import { clampSceneCount } from '../../../constants/pipeline';
import { plannedIntroductionsForEpisode } from '../../utils/npcIntroductionLedger';
import { withTimeout, PIPELINE_TIMEOUTS } from '../../utils/withTimeout';
import { classifyArchitectGateWarnings } from '../../remediation/architectGatePolicy';
import { gateEnabledPredicate } from '../../remediation/gateDefaults';
import { buildSeasonPlanDirectives } from '../planningHelpers';
import { assignChoiceTypes } from '../choiceTypePlanner';
import { reconcileRelationshipPacingWithChoiceTypes } from '../relationshipPacingChoiceTypeReconciliation';
import {
  episodeTypeCounts,
  seasonChoicePlanFromSeasonPlan,
  type SeasonChoicePlan,
} from '../seasonChoicePlan';
import type { GateShadowRecord } from '../../remediation/gateShadowLedger';
import { type GenerationPlan, setEpisodeScenes } from '../generationPlan';
import { PipelineError } from '../errors';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

// ========================================
// DEPENDENCY TYPES
// ========================================

/**
 * Everything the phase still borrows from the monolith. The agent instance
 * is passed by reference; run-scoped state (seasonChoicePlan — written by
 * this phase, generationPlan, cachedPipelineMemory,
 * architectAdvisoryWarnings) is accessor-backed so both sides always see
 * current values.
 */
export interface EpisodeArchitecturePhaseDeps {
  storyArchitect: Pick<StoryArchitect, 'execute'>;

  // --- Run-scoped state (accessor-backed) ---
  readonly cachedPipelineMemory: string | null;
  readonly generationPlan: GenerationPlan | null;
  readonly architectAdvisoryWarnings: string[];
  /** Written by this phase (season choice budget), read at choice assembly. */
  seasonChoicePlan: SeasonChoicePlan | undefined;

  // --- Helpers shared with other monolith regions (injected closures) ---
  emitPlanUpdate: (message: string) => void;
  getTargetBeatCountForScene: (sceneBlueprint: SceneBlueprint) => number;
  recordGateShadowSafe?: (record: Omit<GateShadowRecord, 'timestamp' | 'runDir'>) => Promise<void> | void;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class EpisodeArchitecturePhase {
  readonly name = 'episode_architecture';

  constructor(private readonly deps: EpisodeArchitecturePhaseDeps) {}

  async run(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    context: PipelineContext
  ): Promise<EpisodeBlueprint> {
    context.emit({ type: 'agent_start', agent: 'StoryArchitect', message: 'Creating episode blueprint' });

    const protagonistProfile = characterBible.characters.find(c => c.id === brief.protagonist.id);

    // Build season plan directives for this specific episode
    const seasonPlanDirectives = buildSeasonPlanDirectives(brief, (message) => {
      console.warn(
        `[Pipeline] Season plan has no entry for episode ${brief.episode.number} — available episodes: ${brief.seasonPlan?.episodes.map((e) => e.episodeNumber).join(', ')}`,
      );
      context.emit({ type: 'warning', phase: 'architecture', message });
    });
    if (seasonPlanDirectives) {
      const encCount = seasonPlanDirectives.plannedEncounters?.length || 0;
      const branchCount = seasonPlanDirectives.incomingBranchEffects?.length || 0;
      context.emit({
        type: 'debug',
        phase: 'architecture',
        message: `Season plan directives: ${encCount} planned encounters, ${branchCount} incoming branch effects, difficulty: ${seasonPlanDirectives.difficultyTier || 'unset'}`
      });
    }

    // Look up the season-level structural context so StoryArchitect can
    // populate its episode arc block against the correct beat(s).
    const seasonPlan = brief.seasonPlan;
    const seasonEpisode = seasonPlan?.episodes.find((e) => e.episodeNumber === brief.episode.number);
    const configuredTargetSceneCount = clampSceneCount(
      brief.multiEpisode?.preferences?.targetScenesPerEpisode ||
      context.config.generation?.maxScenesPerEpisode ||
      context.config.generation?.targetSceneCount ||
      brief.options?.targetSceneCount ||
      6,
    );
    const plannedSceneCount = seasonPlanDirectives?.plannedScenes?.length || 0;
    const targetSceneCount = Math.max(configuredTargetSceneCount, plannedSceneCount);

    const architectureInput: StoryArchitectInput = {
      storyTitle: brief.story.title,
      genre: brief.story.genre,
      synopsis: brief.story.synopsis,
      tone: brief.story.tone,
      userPrompt: brief.userPrompt,
      episodeNumber: brief.episode.number,
      episodeTitle: brief.episode.title,
      episodeSynopsis: brief.episode.synopsis,
      protagonistDescription: protagonistProfile?.fullBackground || brief.protagonist.description,
      availableNPCs: characterBible.characters
        .filter(c => c.id !== brief.protagonist.id)
        .map(c => ({
          id: c.id,
          name: c.name,
          description: c.overview,
          relationshipContext: c.relationships.find(r => r.targetId === brief.protagonist.id)?.currentDynamic,
          initialRelationship: c.initialStats,
        })),
      worldContext: worldBible.worldRules.join('. ') + ' ' + worldBible.tensions.join('. '),
      currentLocation: brief.episode.startingLocation,
      previousEpisodeSummary: brief.episode.previousSummary,
      targetSceneCount,
      majorChoiceCount: brief.multiEpisode?.preferences?.targetChoicesPerEpisode || context.config.generation?.majorChoiceCount || brief.options?.majorChoiceCount || 2,
      pacing: brief.multiEpisode?.preferences?.pacing,
      seasonPlanDirectives,
      seasonAnchors: seasonPlan?.anchors,
      seasonStoryCircle: seasonPlan?.storyCircle,
      episodeStoryCircleRole: seasonEpisode?.storyCircleRole,
      cliffhangerPlan: seasonEpisode?.cliffhangerPlan,
      // Characters this episode is planned to introduce — the blueprint gives
      // each an on-page introduction beat (uncontextualized-character fix).
      introducesCharacters: plannedIntroductionsForEpisode({
        episodeNumber: brief.episode.number,
        protagonistId: brief.protagonist.id,
        roster: characterBible.characters
          .filter((c) => c.id !== brief.protagonist.id)
          .map((c) => ({ id: c.id, name: c.name })),
        introducesCharacters: seasonEpisode?.introducesCharacters,
        characterIntroductions: seasonPlan?.characterIntroductions,
      }),
      memoryContext: this.deps.cachedPipelineMemory || undefined,
    };

    let result: AgentResponse<EpisodeBlueprint> | undefined;
    const maxArchitectureAttempts = 3;
    for (let attempt = 1; attempt <= maxArchitectureAttempts; attempt += 1) {
      result = await withTimeout(
        this.deps.storyArchitect.execute(architectureInput),
        PIPELINE_TIMEOUTS.storyArchitect,
        attempt === 1 ? 'StoryArchitect.execute' : `StoryArchitect.execute(branch-repair-${attempt})`
      );

      if (result.success && result.data) break;

      const errorText = result.error || '';
      const branchFailure =
        errorText.includes('scene-graph branching') ||
        errorText.includes('valid branch point') ||
        errorText.includes('branches=true');
      const densityFailure =
        errorText.includes('TreatmentDensityGate') ||
        errorText.includes('TreatmentBindingGate') ||
        errorText.includes('Treatment density overload');
      const sceneCapFailure =
        /Blueprint must have no more than \d+ scenes/i.test(errorText) ||
        /Blueprint has \d+ scenes; maximum is \d+/i.test(errorText);
      const deterministicPlannedDensityFailure = densityFailure && plannedSceneCount > 0;
      if (deterministicPlannedDensityFailure) {
        context.emit({
          type: 'debug',
          phase: 'architecture',
          message:
            'Planned-scene treatment density failed in deterministic architecture mode; stopping without prompt retry so the season scene plan can be repaired.',
          data: { error: result.error },
        });
        break;
      }
      if ((!branchFailure && !densityFailure && !sceneCapFailure) || attempt >= maxArchitectureAttempts) break;

      context.emit({
        type: 'regeneration_triggered',
        phase: 'architecture',
        message: sceneCapFailure
          ? `Retrying StoryArchitect for scene-count cap repair (${attempt}/${maxArchitectureAttempts})`
          : densityFailure
          ? `Retrying StoryArchitect for treatment binding/density rebalance (${attempt}/${maxArchitectureAttempts})`
          : `Retrying StoryArchitect for missing scene-graph branch (${attempt}/${maxArchitectureAttempts})`,
        data: { error: result.error },
      });

      architectureInput.userPrompt = sceneCapFailure
        ? `${architectureInput.userPrompt || ''}\n\nCRITICAL BLUEPRINT SCENE CAP REPAIR:\n` +
          `The previous blueprint exceeded the hard scene cap. The scenes array must contain 3-${targetSceneCount} scenes total. ` +
          `Merge debrief, bridge, aftermath, or branch-only material into adjacent planned scenes as keyBeats, residue, choice reminders, or handoff text instead of adding new scenes. ` +
          `Preserve required treatment beats and encounter anchors by moving them into existing chronological scenes. Previous scene-cap failure: ${errorText}`
        : densityFailure
        ? `${architectureInput.userPrompt || ''}\n\nCRITICAL BLUEPRINT DENSITY REPAIR:\n` +
          `The previous blueprint had invalid treatment-obligation bindings. ` +
          `Do not default unplaced treatment fields, character introductions, encounter anchors, later/time-coded beats, or abstract future payoff seeds to the first scene. ` +
          `Move encounter anchors to the planned encounter scene; bind later/night-three/1am/blog-payoff beats only to chronological matching scenes; keep abstract future payoffs as plan-level ledger obligations; add beats to valid dense scenes instead of forcing every scene to carry the same load. ` +
          `Previous density failure: ${errorText}`
        : `${architectureInput.userPrompt || ''}\n\nCRITICAL BLUEPRINT BRANCH REPAIR:\n` +
          `The previous blueprint failed because it did not include a real scene-graph branch. ` +
          `Add at least ${context.config.generation?.minSceneGraphBranchesPerEpisode ?? 1} non-expression choicePoint with branches=true, ` +
          `at least two distinct future leadsTo scene IDs, branch scene incomingChoiceContext, and a later bottleneck/reconvergence scene.`;
    }

    if (!result!.success || !result!.data) {
      throw new PipelineError(
        `Story Architect failed: ${result!.error}`,
        'episode_architecture',
        {
          agent: 'StoryArchitect',
          context: {
            episodeNumber: brief.episode.number,
            episodeTitle: brief.episode.title,
            hasSeasonPlanDirectives: !!seasonPlanDirectives,
            diagnostics: result!.metadata?.diagnostics,
          },
        }
      );
    }

    context.emit({
      type: 'agent_complete',
      agent: 'StoryArchitect',
      message: `Created blueprint with ${result!.data.scenes.length} scenes`,
    });

    if (result!.data.treatmentBindingReport) {
      context.addCheckpoint(
        `Episode ${brief.episode.number} Treatment Binding Rebalance`,
        result!.data.treatmentBindingReport,
        false,
      );
    }

    // Rebalance choice-point types before ChoiceAuthor. The 35/30/20/15 mix is a SEASON
    // budget (E1): build the season choice plan once from the season plan, then allocate
    // THIS episode against its season-assigned slice (episodeTypeCounts) rather than forcing
    // the full mix locally — so a lopsided-but-on-plan episode is correct, not a defect.
    // Falls back to the default mix when the slice is empty (no season plan).
    this.deps.seasonChoicePlan = seasonChoicePlanFromSeasonPlan(brief.seasonPlan, {
      episode: brief.episode.number,
      choicesPerEpisode:
        brief.multiEpisode?.preferences?.targetChoicesPerEpisode ||
        context.config.generation?.majorChoiceCount ||
        brief.options?.majorChoiceCount ||
        2,
    }, undefined, (record) => {
      void this.deps.recordGateShadowSafe?.(record);
    });
    const episodeSlice = episodeTypeCounts(this.deps.seasonChoicePlan, brief.episode.number);
    const choiceTypeChanges = assignChoiceTypes(result!.data.scenes as never, undefined, episodeSlice).filter((r) => r.from !== r.to);
    if (choiceTypeChanges.length > 0) {
      context.emit({ type: 'debug', phase: 'episode_architecture', message: `Rebalanced ${choiceTypeChanges.length} choice-point type(s) toward target taxonomy` });
    }
    const relationshipPacingReconciled = reconcileRelationshipPacingWithChoiceTypes(result!.data.scenes as never);
    if (relationshipPacingReconciled > 0) {
      context.emit({ type: 'debug', phase: 'episode_architecture', message: `Reconciled ${relationshipPacingReconciled} relationship-pacing contract(s) with final choice taxonomy` });
    }

    // Fill this episode's scenes into the structure plan (estimate-then-fill:
    // each scene is pre-seeded with its target beat count until SceneWriter runs).
    if (this.deps.generationPlan) {
      setEpisodeScenes(
        this.deps.generationPlan,
        brief.episode.number,
        result!.data.scenes.map((scene) => ({
          id: scene.id,
          title: scene.name,
          expectedBeatCount: this.deps.getTargetBeatCountForScene(scene),
          isEncounter: Boolean(scene.isEncounter),
        })),
      );
      this.deps.emitPlanUpdate(`Episode ${brief.episode.number} blueprint: ${result!.data.scenes.length} scenes`);
    }

    // Validator tiering (B1): the architect may now succeed despite advisory
    // craft/fidelity issues that previously aborted the whole run. Surface them
    // as warnings and record them so the story still ships with the issues
    // visible (rather than producing zero output).
    if (result!.warnings && result!.warnings.length > 0) {
      // B0: a craft warning becomes blocking only when its per-rule GATE_* flag
      // is set. With no flags set, `blocking` is always empty and `advisory`
      // equals `result.warnings`, so the advisory behavior below is byte-for-byte
      // unchanged from before B0.
      const { blocking, advisory } = classifyArchitectGateWarnings(
        result!.warnings,
        gateEnabledPredicate,
      );
      if (blocking.length > 0) {
        throw new PipelineError(
          `Architecture craft gate(s) failed after retries: ${blocking.slice(0, 3).join(' | ')}`,
          'episode_architecture',
          {
            context: {
              failureKind: 'architecture_craft_gate',
              blockingWarnings: blocking.slice(0, 10),
            },
          }
        );
      }
      this.deps.architectAdvisoryWarnings.push(...advisory);
      context.emit({
        type: 'warning',
        phase: 'episode_architecture',
        message: `StoryArchitect proceeded with ${advisory.length} unresolved advisory issue(s) (story still generated): ${advisory.slice(0, 3).join(' | ')}${advisory.length > 3 ? ' …' : ''}`,
      });
    }

    return result!.data;
  }
}
