// @ts-nocheck — TODO(tech-debt): Phase 3 will refactor this onto the shared
// PipelineContext + phases pattern and restore whole-file typecheck.
/**
 * Episode Pipeline Orchestrator
 *
 * Coordinates the three agents (Story Architect, Scene Writer, Choice Author)
 * to generate complete episode content from a creative brief.
 */

import { PipelineConfig, loadConfig, defaultValidationConfig } from '../config';
import { generateEpisodeId, slugify as idSlugify } from '../utils/idUtils';
import { StoryArchitect, StoryArchitectInput, EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import { SceneWriter, SceneWriterInput, SceneContent, GeneratedBeat } from '../agents/SceneWriter';
import { ChoiceAuthor, ChoiceAuthorInput, ChoiceSet } from '../agents/ChoiceAuthor';
import { Episode, Scene, Beat, Choice } from '../../types';
import { IntegratedBestPracticesValidator, ChoiceDistributionValidator } from '../validators';
import type { ChoiceDistributionTargets } from '../validators';
import {
  createOutputDirectory,
  savePipelineOutputs,
  OutputManifest,
} from '../utils/pipelineOutputWriter';
import {
  QuickValidationResult,
  ComprehensiveValidationReport,
  ValidationError,
} from '../../types/validation';

// Pipeline input - the creative brief
export interface CreativeBrief {
  // Story foundation
  story: {
    title: string;
    genre: string;
    synopsis: string;
    tone: string;
    worldContext: string;
    userPrompt?: string;
  };

  // Episode to generate
  episode: {
    number: number;
    title: string;
    synopsis: string;
    previousSummary?: string;
  };

  // Characters
  protagonist: {
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    description: string;
  };

  npcs: Array<{
    id: string;
    name: string;
    description: string;
    voiceNotes: string;
    currentMood?: string;
    relationshipContext?: string;
  }>;

  // Starting state
  currentLocation: string;
  initialFlags?: Array<{ name: string; description: string }>;
  initialScores?: Array<{ name: string; description: string }>;

  // Generation parameters
  targetSceneCount?: number;
  majorChoiceCount?: number;
}

// Pipeline events for monitoring
export interface PipelineProgressTelemetry {
  overallProgress?: number;
  phaseProgress?: number;
  currentItem?: number;
  totalItems?: number;
  subphaseLabel?: string;
  etaSeconds?: number | null;
  elapsedSeconds?: number;
}

export interface PipelineEvent {
  type: 
    | 'phase_start' | 'phase_complete' 
    | 'agent_start' | 'agent_complete'
    | 'error' | 'checkpoint' | 'debug' | 'warning'
    | 'incremental_validation'      // Per-scene validation result
    | 'regeneration_triggered'      // Content regeneration due to validation failure
    | 'validation_aggregated';      // Summary of all incremental validations
  phase?: string;
  agent?: string;
  message: string;
  data?: unknown;
  telemetry?: PipelineProgressTelemetry;
  timestamp: Date;
}

export type PipelineEventHandler = (event: PipelineEvent) => void;

// Pipeline output
export interface PipelineResult {
  success: boolean;
  episode?: Episode;
  blueprint?: EpisodeBlueprint;
  sceneContents?: SceneContent[];
  choiceSets?: ChoiceSet[];
  error?: string;
  events: PipelineEvent[];
  // Validation results
  quickValidation?: QuickValidationResult;
  bestPracticesReport?: ComprehensiveValidationReport;
}

export class EpisodePipeline {
  private config: PipelineConfig;
  private storyArchitect: StoryArchitect;
  private sceneWriter: SceneWriter;
  private choiceAuthor: ChoiceAuthor;
  private integratedValidator: IntegratedBestPracticesValidator;
  private distributionValidator: ChoiceDistributionValidator;
  private distributionTargets: ChoiceDistributionTargets;
  private maxBranchingChoicesPerEpisode: number;
  private events: PipelineEvent[] = [];
  private eventHandler?: PipelineEventHandler;

  constructor(config?: PipelineConfig) {
    this.config = config || loadConfig();

    // Ensure validation config exists with defaults
    if (!this.config.validation) {
      this.config.validation = defaultValidationConfig;
    } else if (!this.config.validation.rules) {
      this.config.validation.rules = defaultValidationConfig.rules;
    }

    // Initialize agents with generation config
    this.storyArchitect = new StoryArchitect(this.config.agents.storyArchitect, this.config.generation);
    this.sceneWriter = new SceneWriter(this.config.agents.sceneWriter, this.config.generation);
    this.choiceAuthor = new ChoiceAuthor(this.config.agents.choiceAuthor, this.config.generation);

    // Initialize validators
    this.integratedValidator = new IntegratedBestPracticesValidator(
      this.config.agents.storyArchitect,
      this.config.validation
    );
    this.distributionValidator = new ChoiceDistributionValidator();
    this.distributionTargets = {
      expression: this.config.generation?.choiceDistExpression ?? 35,
      relationship: this.config.generation?.choiceDistRelationship ?? 30,
      strategic: this.config.generation?.choiceDistStrategic ?? 20,
      dilemma: this.config.generation?.choiceDistDilemma ?? 15,
    };
    this.maxBranchingChoicesPerEpisode = this.config.generation?.maxBranchingChoicesPerEpisode ?? 2;
  }

  /**
   * Set event handler for monitoring progress
   */
  onEvent(handler: PipelineEventHandler): void {
    this.eventHandler = handler;
  }

  private emit(event: Omit<PipelineEvent, 'timestamp'>): void {
    const fullEvent: PipelineEvent = { ...event, timestamp: new Date() };
    this.events.push(fullEvent);
    if (this.eventHandler) {
      this.eventHandler(fullEvent);
    }
    if (this.config.debug) {
      console.log(`[${event.type}] ${event.message}`);
    }
  }

  /**
   * Generate a complete episode from a creative brief
   */
  async generate(brief: CreativeBrief): Promise<PipelineResult> {
    this.events = [];

    try {
      // === PHASE 1: FOUNDATION ===
      this.emit({
        type: 'phase_start',
        phase: 'foundation',
        message: 'Starting Foundation Phase: Creating episode blueprint',
      });

      const blueprint = await this.runFoundationPhase(brief);

      this.emit({
        type: 'checkpoint',
        phase: 'foundation',
        message: 'HUMAN CHECKPOINT: Review episode blueprint before continuing',
        data: blueprint,
      });

      // === PHASE 2: CONTENT GENERATION ===
      this.emit({
        type: 'phase_start',
        phase: 'content',
        message: 'Starting Content Generation Phase: Writing scenes',
      });

      const { sceneContents, choiceSets } = await this.runContentPhase(brief, blueprint);

      this.emit({
        type: 'checkpoint',
        phase: 'content',
        message: 'HUMAN CHECKPOINT: Review scene content before assembly',
        data: { sceneContents, choiceSets },
      });

      // === PHASE 2.5: VALIDATION ===
      let quickValidation: QuickValidationResult | undefined;
      let bestPracticesReport: ComprehensiveValidationReport | undefined;

      if (this.config.validation.enabled) {
        this.emit({
          type: 'phase_start',
          phase: 'validation',
          message: 'Running best practices validation',
        });

        // Prepare validation input
        const validationInput = this.prepareValidationInput(sceneContents, choiceSets, brief);

        // Run quick validation
        quickValidation = await this.integratedValidator.runQuickValidation(validationInput);

        if (!quickValidation.canProceed) {
          this.emit({
            type: 'error',
            message: `Validation failed: ${quickValidation.blockingIssues.length} blocking issues`,
            data: quickValidation.blockingIssues,
          });
          // Always throw on errors - they indicate broken/unusable output
          throw new ValidationError('Content validation failed', quickValidation.blockingIssues);
        }

        // Run full validation for report
        bestPracticesReport = await this.integratedValidator.runFullValidation(validationInput);

        this.emit({
          type: 'checkpoint',
          phase: 'validation',
          message: `Best Practices: ${bestPracticesReport.overallScore}/100 - ${bestPracticesReport.overallPassed ? 'PASSED' : 'NEEDS REVIEW'}`,
          data: bestPracticesReport,
        });

        // Run choice distribution validation (type distribution + branching cap)
        const distributionInput = {
          choiceSets: choiceSets.map(cs => ({
            beatId: cs.beatId,
            choiceType: cs.choiceType,
            hasBranching: cs.choices.some(c => c.nextSceneId),
          })),
          targets: this.distributionTargets,
          maxBranchingChoicesPerEpisode: this.maxBranchingChoicesPerEpisode,
        };
        const distributionResult = this.distributionValidator.validate(distributionInput);
        const metrics = this.distributionValidator.computeMetrics(distributionInput);

        this.emit({
          type: 'checkpoint',
          phase: 'validation',
          message: `Choice Distribution: ${distributionResult.score}/100 — ` +
            Object.entries(metrics.actualPercentages)
              .map(([type, pct]) => `${type}: ${pct.toFixed(0)}%`)
              .join(', ') +
            ` | branching: ${metrics.branchingCount}/${metrics.branchingCap} cap`,
          data: { distributionResult, metrics },
        });

        if (distributionResult.issues.length > 0) {
          for (const issue of distributionResult.issues) {
            console.warn(`[EpisodePipeline] Distribution: [${issue.severity}] ${issue.message}`);
          }
        }
      }

      // === PHASE 3: ASSEMBLY ===
      this.emit({
        type: 'phase_start',
        phase: 'assembly',
        message: 'Starting Assembly Phase: Compiling episode',
      });

      const episode = this.assembleEpisode(brief, blueprint, sceneContents, choiceSets);

      this.emit({
        type: 'phase_complete',
        phase: 'assembly',
        message: 'Episode generation complete',
        data: episode,
      });

      // === PHASE 4: SAVE OUTPUTS ===
      this.emit({ type: 'phase_start', phase: 'saving', message: 'Phase 4: Saving all outputs to files' });

      let outputDirectory: string | undefined;
      let outputManifest: OutputManifest | undefined;

      try {
        outputDirectory = await createOutputDirectory(brief.story.title);
        outputManifest = await savePipelineOutputs(outputDirectory, {
          brief,
          episodeBlueprint: blueprint,
          sceneContents,
          choiceSets,
          bestPracticesReport,
          finalStory: {
            id: idSlugify(brief.story.title) || 'untitled-story',
            title: brief.story.title,
            genre: brief.story.genre,
            synopsis: brief.story.synopsis,
            initialState: {
              attributes: { charm: 50, wit: 50, courage: 50, empathy: 50, resolve: 50, resourcefulness: 50 },
              skills: {},
              tags: [],
              inventory: [],
            },
            npcs: brief.npcs.map(n => ({ id: n.id, name: n.name, description: n.description })),
            episodes: [episode],
          },
        });

        this.emit({
          type: 'phase_complete',
          phase: 'saving',
          message: `Saved ${outputManifest.files.length} files to ${outputDirectory}`,
        });
      } catch (saveError) {
        console.warn(`[EpisodePipeline] Failed to save outputs: ${saveError}`);
      }

      return {
        success: true,
        episode,
        blueprint,
        sceneContents,
        choiceSets,
        events: this.events,
        quickValidation,
        bestPracticesReport,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit({
        type: 'error',
        message: `Pipeline failed: ${errorMessage}`,
      });

      return {
        success: false,
        error: errorMessage,
        events: this.events,
      };
    }
  }

  /**
   * Phase 1: Foundation - Create episode blueprint
   */
  private async runFoundationPhase(brief: CreativeBrief): Promise<EpisodeBlueprint> {
    this.emit({
      type: 'agent_start',
      agent: 'StoryArchitect',
      message: 'Story Architect generating episode blueprint',
    });

    const input: StoryArchitectInput = {
      storyTitle: brief.story.title,
      genre: brief.story.genre,
      synopsis: brief.story.synopsis,
      tone: brief.story.tone,
      episodeNumber: brief.episode.number,
      episodeTitle: brief.episode.title,
      episodeSynopsis: brief.episode.synopsis,
      protagonistDescription: brief.protagonist.description,
      availableNPCs: brief.npcs.map(npc => ({
        id: npc.id,
        name: npc.name,
        description: npc.description,
        relationshipContext: npc.relationshipContext,
      })),
      worldContext: brief.story.worldContext,
      currentLocation: brief.currentLocation,
      previousEpisodeSummary: brief.episode.previousSummary,
      targetSceneCount: brief.targetSceneCount || 6,
      majorChoiceCount: brief.majorChoiceCount || 2,
      userPrompt: brief.story.userPrompt,
    };

    const result = await this.storyArchitect.execute(input);

    if (!result.success || !result.data) {
      throw new Error(`Story Architect failed: ${result.error}`);
    }

    this.emit({
      type: 'agent_complete',
      agent: 'StoryArchitect',
      message: `Blueprint created with ${result.data.scenes.length} scenes`,
      data: result.data,
    });

    return result.data;
  }

  /**
   * Phase 2: Content Generation - Write scenes and choices
   */
  private async runContentPhase(
    brief: CreativeBrief,
    blueprint: EpisodeBlueprint
  ): Promise<{ sceneContents: SceneContent[]; choiceSets: ChoiceSet[] }> {
    const sceneContents: SceneContent[] = [];
    const choiceSets: ChoiceSet[] = [];

    // === AUTO-FIX: Ensure sufficient scenes have choicePoints ===
    // Interactive storytelling requires choices - the StoryArchitect should create these,
    // but LLMs sometimes forget or generate too few
    const scenesWithChoices = blueprint.scenes.filter(s => s.choicePoint);
    const choiceRatio = scenesWithChoices.length / blueprint.scenes.length;
    
    console.log(`[EpisodePipeline] Choice density: ${scenesWithChoices.length}/${blueprint.scenes.length} scenes have choicePoints (${Math.round(choiceRatio * 100)}%)`);
    
    // STRICT ENFORCEMENT: At least 50% density AND no gaps > 2
    let needsFix = choiceRatio < 0.5;
    
    // Check for gaps
    let consecutiveNoAgency = 0;
    for (const scene of blueprint.scenes) {
      if (scene.choicePoint) {
        consecutiveNoAgency = 0;
      } else {
        consecutiveNoAgency++;
        if (consecutiveNoAgency > 2) {
          needsFix = true;
          break;
        }
      }
    }

    if (needsFix) {
      console.warn(`[EpisodePipeline] Low density or agency gap detected! Auto-adding choicePoints...`);
      
      let currentConsecutiveNoAgency = 0;
      for (let i = 0; i < blueprint.scenes.length; i++) {
        const scene = blueprint.scenes[i];
        
        if (scene.choicePoint) {
          currentConsecutiveNoAgency = 0;
          continue;
        }
        
        currentConsecutiveNoAgency++;
        
        // Add choice if we hit a branch, or density is low, or gap is too wide
        const isLowDensity = (i / blueprint.scenes.length) > (blueprint.scenes.filter(s => s.choicePoint).length / blueprint.scenes.length);
        const needsChoice = scene.purpose === 'branch' || currentConsecutiveNoAgency > 2 || (i % 2 === 0);
        
        if (needsChoice) {
          console.warn(`[EpisodePipeline] Auto-creating choicePoint for scene "${scene.id}" (${scene.purpose})`);
          scene.choicePoint = {
            type: scene.purpose === 'branch' ? 'dilemma' : 'expression',
            branches: scene.purpose === 'branch' ? true : undefined,
            stakes: {
              want: 'achieve their immediate goal',
              cost: 'face potential consequences',
              identity: 'show what kind of person they are',
            },
            description: `A decision point in ${scene.name}`,
            optionHints: scene.leadsTo.length > 0 
              ? scene.leadsTo.map((_, idx) => `Option ${idx + 1}`)
              : ['Option 1', 'Option 2'],
          };
          currentConsecutiveNoAgency = 0;
        }
      }
      
      const newChoiceCount = blueprint.scenes.filter(s => s.choicePoint).length;
      console.log(`[EpisodePipeline] After auto-fix: ${newChoiceCount}/${blueprint.scenes.length} scenes have choicePoints`);
    }
    
    // Log final choice point status
    const finalScenesWithChoices = blueprint.scenes.filter(s => s.choicePoint);
    console.log(`[EpisodePipeline] Blueprint has ${finalScenesWithChoices.length}/${blueprint.scenes.length} scenes with choicePoints:`);
    for (const scene of blueprint.scenes) {
      console.log(`[EpisodePipeline]   - ${scene.id} (${scene.purpose}): ${scene.choicePoint ? `choicePoint=${scene.choicePoint.type}` : 'NO CHOICE POINT'}`);
    }

    // Collect all flags and scores from blueprint
    const allFlags = [
      ...(brief.initialFlags || []),
      ...blueprint.suggestedFlags,
    ];
    const allScores = [
      ...(brief.initialScores || []),
      ...blueprint.suggestedScores,
    ];

    // Process scenes in order
    for (let i = 0; i < blueprint.scenes.length; i++) {
      const sceneBlueprint = blueprint.scenes[i];
      const previousScene = i > 0 ? sceneContents[i - 1] : undefined;

      // Write scene content
      this.emit({
        type: 'agent_start',
        agent: 'SceneWriter',
        message: `Writing scene: ${sceneBlueprint.name}`,
      });

      const sceneInput: SceneWriterInput = {
        sceneBlueprint,
        storyContext: {
          title: brief.story.title,
          genre: brief.story.genre,
          tone: brief.story.tone,
          worldContext: brief.story.worldContext,
          userPrompt: brief.story.userPrompt,
        },
        protagonistInfo: brief.protagonist,
        npcs: brief.npcs.map(npc => ({
          id: npc.id,
          name: npc.name,
          description: npc.description,
          voiceNotes: npc.voiceNotes,
          currentMood: npc.currentMood,
        })),
        relevantFlags: allFlags,
        relevantScores: allScores,
        targetBeatCount: sceneBlueprint.purpose === 'bottleneck' ? 5 : 4,
        dialogueHeavy: sceneBlueprint.npcsPresent.length > 0,
        previousSceneSummary: previousScene
          ? `Previous scene "${previousScene.sceneName}": ${previousScene.keyMoments.join(', ')}`
          : undefined,
        incomingChoiceContext: sceneBlueprint.incomingChoiceContext,
      };

      const sceneResult = await this.sceneWriter.execute(sceneInput);

      if (!sceneResult.success || !sceneResult.data) {
        throw new Error(`Scene Writer failed on ${sceneBlueprint.id}: ${sceneResult.error}`);
      }

      // Create a fresh copy of the beats to avoid mutation issues
      const sceneContent: SceneContent = {
        ...sceneResult.data,
        sceneId: sceneBlueprint.id,
        sceneName: sceneResult.data.sceneName || sceneBlueprint.name,
        beats: sceneResult.data.beats.map(b => ({ ...b }))
      };

      // Scope beat IDs to the scene
      const beatIdMap = new Map<string, string>();
      sceneContent.beats.forEach((b, idx) => {
        const originalId = b.id || `beat-${idx + 1}`;
        const newId = `${sceneBlueprint.id}-${originalId}`;
        beatIdMap.set(originalId, newId);
        b.id = newId;
      });

      // Update internal references
      sceneContent.beats.forEach(b => {
        if (b.nextBeatId && beatIdMap.has(b.nextBeatId)) {
          b.nextBeatId = beatIdMap.get(b.nextBeatId);
        } else if (b.nextBeatId) {
          b.nextBeatId = `${sceneBlueprint.id}-${b.nextBeatId}`;
        }
      });

      if (sceneContent.startingBeatId && beatIdMap.has(sceneContent.startingBeatId)) {
        sceneContent.startingBeatId = beatIdMap.get(sceneContent.startingBeatId)!;
      } else {
        sceneContent.startingBeatId = sceneContent.beats[0]?.id;
      }

      sceneContents.push(sceneContent);

      // Identify the choice point beat
      if (sceneBlueprint.choicePoint) {
        let choicePointBeat = sceneContent.beats.find(b => b.isChoicePoint);
        if (!choicePointBeat && sceneContent.beats.length > 0) {
          choicePointBeat = sceneContent.beats[sceneContent.beats.length - 1];
          choicePointBeat.isChoicePoint = true;
          console.warn(`[EpisodePipeline] Auto-marked last beat "${choicePointBeat.id}" as choice point for scene ${sceneBlueprint.id}`);
        }

        if (choicePointBeat) {
          this.emit({
            type: 'agent_start',
            agent: 'ChoiceAuthor',
            message: `Creating choices for scene: ${sceneBlueprint.name}`,
          });

          const choiceInput: ChoiceAuthorInput = {
            sceneBlueprint,
            beatText: choicePointBeat.text,
            beatId: choicePointBeat.id,
            storyContext: {
              title: brief.story.title,
              genre: brief.story.genre,
              tone: brief.story.tone,
              userPrompt: brief.story.userPrompt,
            },
            protagonistInfo: brief.protagonist,
            npcsInScene: brief.npcs
              .filter(npc => sceneBlueprint.npcsPresent.includes(npc.id))
              .map(npc => ({
                id: npc.id,
                name: npc.name,
                description: npc.description,
              })),
            availableFlags: allFlags,
            availableScores: allScores,
            availableTags: blueprint.suggestedTags,
            possibleNextScenes: sceneBlueprint.leadsTo.map(sceneId => {
              const target = blueprint.scenes.find(s => s.id === sceneId);
              return { id: sceneId, name: target?.name || sceneId, description: target?.description || '' };
            }),
            optionCount: sceneBlueprint.choicePoint.optionHints.length || 3,
          };

          const choiceResult = await this.choiceAuthor.execute(choiceInput);

          if (choiceResult.success && choiceResult.data) {
            // Fix navigation references in choices
            choiceResult.data.choices.forEach(c => {
              if (c.nextBeatId) {
                if (c.nextBeatId.startsWith(sceneBlueprint.id)) {
                  // Already prefixed
                } else if (beatIdMap.has(c.nextBeatId)) {
                  c.nextBeatId = beatIdMap.get(c.nextBeatId);
                } else {
                  c.nextBeatId = `${sceneBlueprint.id}-${c.nextBeatId}`;
                }
              }
            });
            choiceSets.push(choiceResult.data);
            console.log(`[EpisodePipeline] Created ${choiceResult.data.choices.length} choices for beat ${choicePointBeat.id}`);

            // Create payoff + reaction beats for ALL choices that don't already
            // have explicit routing (nextBeatId was already set by the LLM).
            // Branching choices (nextSceneId) still get a payoff beat so the
            // outcome text is shown before the scene change.
            const choicesNeedingPayoff = choiceResult.data.choices.filter(
              c => !c.nextBeatId
            );

            if (choicesNeedingPayoff.length > 0) {
              const defaultNextSceneId = sceneBlueprint.leadsTo?.[0];

              for (let ci = 0; ci < choicesNeedingPayoff.length; ci++) {
                const choice = choicesNeedingPayoff[ci];
                const payoffId = `${choicePointBeat.id}-payoff-${ci + 1}`;
                const reactionId = `${choicePointBeat.id}-reaction-${ci + 1}`;

                // Preserve the original branching scene before we reroute the choice
                const branchSceneId = choice.nextSceneId;

                // --- Payoff beat: illustrates the choice in action ---
                // Base text is the partial/complicated outcome (most common).
                // textVariants swap to success or failure text when outcome flags are set.
                const basePayoffText = choice.outcomeTexts?.partial
                  || (choice.text.endsWith('.') ? choice.text : choice.text + '.');

                const payoffTextVariants = choice.outcomeTexts ? [
                  {
                    condition: { type: 'flag' as const, flag: '_outcome_success', value: true },
                    text: choice.outcomeTexts.success,
                  },
                  {
                    condition: { type: 'flag' as const, flag: '_outcome_failure', value: true },
                    text: choice.outcomeTexts.failure,
                  },
                ] : undefined;

                const payoffBeat: GeneratedBeat & {
                  isChoicePayoff?: boolean;
                  textVariants?: Array<{ condition: object; text: string }>;
                  choiceContext?: string;
                } = {
                  id: payoffId,
                  text: basePayoffText,
                  textVariants: payoffTextVariants,
                  isChoicePoint: false,
                  // For branching choices: navigate to the destination scene after the payoff.
                  // For non-branching choices: navigate to the reaction beat.
                  nextBeatId: branchSceneId ? undefined : reactionId,
                  nextSceneId: branchSceneId || undefined,
                  // Visual contract: use the narrative prose as the image description.
                  // outcomeTexts.partial describes the physical action; choice.text is the decision label.
                  visualMoment: basePayoffText,
                  primaryAction: basePayoffText,
                  emotionalRead: 'Living out the consequences of the chosen action',
                  // Store the choice label for the image prefix ("the player chose X — show it")
                  choiceContext: choice.text,
                  isChoicePayoff: true,
                };

                // Route the choice to the payoff beat (clear old nextSceneId — payoff handles it)
                choice.nextBeatId = payoffId;
                choice.nextSceneId = undefined;
                sceneContent.beats.push(payoffBeat as GeneratedBeat);

                // --- Reaction beat: world responds (only for non-branching choices) ---
                // Branching choices go to a new scene; that scene IS the reaction.
                if (!branchSceneId) {
                  const reactionOnShow = choice.tintFlag
                    ? [{ type: 'setFlag' as const, flag: choice.tintFlag, value: true }]
                    : [];

                  const reactionBeat: GeneratedBeat & { onShow?: any } = {
                    id: reactionId,
                    text: choice.reactionText || 'The moment settles, reshaping what comes next.',
                    isChoicePoint: false,
                    onShow: reactionOnShow.length > 0 ? reactionOnShow : undefined,
                    nextBeatId: choicePointBeat.nextBeatId,
                    nextSceneId: choicePointBeat.nextBeatId ? undefined : defaultNextSceneId,
                    emotionalRead: 'World reacts to the choice',
                  };

                  sceneContent.beats.push(reactionBeat as GeneratedBeat);
                }
              }

              console.log(`[EpisodePipeline] Created ${choicesNeedingPayoff.length} payoff+reaction beat pairs for choices in ${sceneBlueprint.id}`);
            }
          }
        }
      }

    }

    return { sceneContents, choiceSets };
  }

  /**
   * Phase 3: Assembly - Compile into final Episode format
   */
  private assembleEpisode(
    brief: CreativeBrief,
    blueprint: EpisodeBlueprint,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[]
  ): Episode {
    console.log(`[EpisodePipeline] ======== ASSEMBLY PHASE ========`);
    console.log(`[EpisodePipeline] Received ${sceneContents.length} scene contents and ${choiceSets.length} choice sets`);
    
    // Create a map for quick lookup
    const contentMap = new Map(sceneContents.map(sc => [sc.sceneId, sc]));
    const choiceMap = new Map(choiceSets.map(cs => [cs.beatId, cs]));
    
    console.log(`[EpisodePipeline] Choice map keys (beat IDs with choices): [${Array.from(choiceMap.keys()).join(', ')}]`);
    
    // Debug: Show all beats that have isChoicePoint = true
    for (const sc of sceneContents) {
      const choiceBeats = sc.beats.filter(b => b.isChoicePoint);
      if (choiceBeats.length > 0) {
        console.log(`[EpisodePipeline] Scene "${sc.sceneId}" has ${choiceBeats.length} choice point beats: [${choiceBeats.map(b => b.id).join(', ')}]`);
      } else {
        console.log(`[EpisodePipeline] Scene "${sc.sceneId}" has NO choice point beats (${sc.beats.length} total beats)`);
      }
    }

    // Build scenes
    const scenes: Scene[] = blueprint.scenes.map(sceneBlueprint => {
      const content = contentMap.get(sceneBlueprint.id);
      if (!content) {
        throw new Error(`Missing content for scene ${sceneBlueprint.id}`);
      }

      // Convert GeneratedBeat to Beat, adding choices where needed
      const beats: Beat[] = content.beats.map((genBeat, beatIndex) => {
        const beat: Beat = {
          id: genBeat.id,
          text: genBeat.text,
          textVariants: genBeat.textVariants,
          speaker: genBeat.speaker,
          speakerMood: genBeat.speakerMood,
          nextBeatId: genBeat.nextBeatId,
          onShow: genBeat.onShow,
        };

        // FORCE CHOICE ATTACHMENT
        // We check two things: 
        // 1. Is this specific beat marked as a choice point?
        // 2. Is this the LAST beat of a scene that requires a choice?
        
        const choiceSet = choiceMap.get(genBeat.id);
        const isLastBeat = beatIndex === content.beats.length - 1;
        const sceneNeedsChoice = !!sceneBlueprint.choicePoint;
        
        // Attachment logic: if marked as choice point OR (last beat AND scene needs choice)
        if (genBeat.isChoicePoint || (isLastBeat && sceneNeedsChoice)) {
          if (choiceSet && choiceSet.choices && choiceSet.choices.length > 0) {
            const defaultNextSceneId = sceneBlueprint.leadsTo.length > 0 
              ? sceneBlueprint.leadsTo[0] 
              : undefined;

            beat.choices = choiceSet.choices.map(gc => ({
              id: gc.id,
              text: gc.text,
              choiceType: gc.choiceType,
              conditions: gc.conditions,
              showWhenLocked: gc.showWhenLocked,
              lockedText: gc.lockedText,
              statCheck: gc.statCheck,
              consequences: gc.consequences,
              nextSceneId: gc.nextSceneId || (gc.nextBeatId ? undefined : defaultNextSceneId),
              nextBeatId: gc.nextBeatId,
            }));

            beat.nextBeatId = undefined;
            console.log(`[EpisodePipeline] ✓ ATTACHED ${beat.choices.length} choices to beat ${beat.id}`);
          } else if (sceneNeedsChoice && isLastBeat) {
            // EMERGENCY FALLBACK for scenes that NEED a choice but none were generated/found
            console.warn(`[EpisodePipeline] ⚠️ EMERGENCY: No choices found for scene ${sceneBlueprint.id}. Creating fallback.`);
            const defaultNextSceneId = sceneBlueprint.leadsTo.length > 0 
              ? sceneBlueprint.leadsTo[0] 
              : undefined;
              
            beat.choices = [{
              id: `${genBeat.id}-fallback-continue`,
              text: 'Continue...',
              choiceType: 'expression',
              nextSceneId: defaultNextSceneId,
            }];
            beat.nextBeatId = undefined;
          }
        }

        return beat;
      });

      // Find fallback scene for conditional scenes
      const fallbackSceneId = sceneBlueprint.leadsTo.length > 0
        ? sceneBlueprint.leadsTo[0]
        : undefined;

      return {
        id: sceneBlueprint.id,
        name: sceneBlueprint.name,
        beats,
        startingBeatId: content.startingBeatId,
        fallbackSceneId,
      };
    });

    // Build episode
    const episode: Episode = {
      id: generateEpisodeId(brief.episode.number, brief.episode.title),
      number: brief.episode.number,
      title: brief.episode.title,
      synopsis: brief.episode.synopsis,
      coverImage: '',
      scenes,
      startingSceneId: blueprint.startingSceneId,
    };

    // Final summary - count beats with choices
    let totalBeats = 0;
    let beatsWithChoices = 0;
    let totalChoices = 0;
    for (const scene of scenes) {
      for (const beat of scene.beats) {
        totalBeats++;
        if (beat.choices && beat.choices.length > 0) {
          beatsWithChoices++;
          totalChoices += beat.choices.length;
        }
      }
    }
    console.log(`[EpisodePipeline] ======== ASSEMBLY COMPLETE ========`);
    console.log(`[EpisodePipeline] Episode has ${scenes.length} scenes, ${totalBeats} beats, ${beatsWithChoices} beats with choices (${totalChoices} total choices)`);
    
    if (totalChoices === 0) {
      console.error(`[EpisodePipeline] CRITICAL ERROR: No choices were attached to any beats! The story will not be interactive.`);
      console.error(`[EpisodePipeline] Received choice sets: ${choiceSets.length}`);
      console.error(`[EpisodePipeline] Choice set beat IDs: [${choiceSets.map(cs => cs.beatId).join(', ')}]`);
      
      // Emergency fallback: Add a simple "Continue" choice to the last beat of each scene
      // This ensures the story is at least technically interactive
      for (const scene of scenes) {
        const lastBeat = scene.beats[scene.beats.length - 1];
        if (lastBeat && (!lastBeat.choices || lastBeat.choices.length === 0)) {
          console.warn(`[EpisodePipeline] EMERGENCY: Adding default continue choice to beat "${lastBeat.id}" in scene "${scene.id}"`);
          lastBeat.choices = [{
            id: 'continue',
            text: 'Continue...',
            choiceType: 'expression',
            nextSceneId: scene.fallbackSceneId,
          }];
          // Clear nextBeatId to let the choice control navigation
          lastBeat.nextBeatId = undefined;
        }
      }
    }

    return episode;
  }

  // Note: slugify moved to idUtils.ts for centralized ID generation

  /**
   * Prepare validation input from episode data
   */
  private prepareValidationInput(
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    brief: CreativeBrief
  ) {
    // Prepare scenes for validation
    const scenes = sceneContents.map(sc => ({
      id: sc.sceneId,
      beats: sc.beats.map(b => ({
        id: b.id,
        text: b.text,
        isChoicePoint: b.isChoicePoint,
      })),
    }));

    // Prepare NPCs for validation (basic tier inference from brief)
    const npcs = brief.npcs.map(npc => ({
      id: npc.id,
      name: npc.name,
      // Infer tier from NPC presence and context
      tier: 'supporting' as const,
      relationshipDimensions: ['trust', 'respect'] as ('trust' | 'affection' | 'respect' | 'fear')[],
    }));

    // Prepare choices for validation
    const choices = choiceSets.flatMap(cs =>
      cs.choices.map(choice => ({
        id: choice.id,
        text: choice.text,
        choiceType: choice.choiceType || cs.choiceType,
        consequences: choice.consequences || [],
        stakesAnnotation: choice.stakesAnnotation || cs.overallStakes,
        sceneContext: cs.designNotes,
      }))
    );

    return { scenes, npcs, choices };
  }
}
