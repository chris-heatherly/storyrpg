/**
 * Story / episode assembly: fold the blueprint + scene content + choice sets +
 * generated images into the runtime `Story` / `Episode` shapes.
 *
 * Faithful port of FullStoryPipeline.assembleStory and assembleEpisode (pure
 * move). assembleStory builds the single-episode `Story` (encounter image
 * wiring, choice backward-navigation guard, persisted NPCs, style anchors, the
 * micro-episode structure/season validations). assembleEpisode builds one
 * `Episode` for the multi-episode/branch-validation callers (placeholder
 * scenes for missing content, the post-assembly encounter-verification gate).
 * Both lean on the same monolith helpers (fidelity text, choice-bridge beats,
 * reader sanitization, episode-scoped keys, encounter-tree image wiring),
 * injected via the deps.
 *
 * Extracted from FullStoryPipeline to keep that monolith from growing.
 */

import { PipelineConfig } from '../config';
import {
  Story,
  Episode,
  Scene,
  Beat,
  EncounterBeat as TypeEncounterBeat,
  GeneratedStorylet as TypeGeneratedStorylet,
} from '../../types';
import { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import { WorldBible } from '../agents/WorldBuilder';
import { CharacterBible } from '../agents/CharacterDesigner';
import { SceneContent } from '../agents/SceneWriter';
import { ChoiceSet } from '../agents/ChoiceAuthor';
import { EncounterStructure } from '../agents/EncounterArchitect';
import { ImageAgentTeam } from '../agents/image-team/ImageAgentTeam';
import { convertEncounterStructureToEncounter } from '../converters';
import { assembleChoiceForStory, reconcileChoiceSetBeatIds } from './choiceAssembly';
import { generateEpisodeId, slugify as idSlugify } from '../utils/idUtils';
import { sceneTimelineMetaForScene } from '../utils/sceneTimeline';
import { CHARACTER_DEFAULTS, DEFAULT_SKILLS } from '../../constants/pipeline';
import { PipelineError } from './errors';
import type { PipelineEvent } from './events';
// Type-only import — erased at runtime, so no runtime cycle with the monolith.
import type { FullCreativeBrief } from './FullStoryPipeline';

export interface AssemblyDeps {
  config: PipelineConfig;
  emit: (event: Omit<PipelineEvent, 'timestamp'>) => void;
  throwIfFailFast: (
    message: string,
    phase: string,
    options?: { agent?: string; cause?: unknown; context?: Record<string, unknown> },
  ) => void;
  imageAgentTeam: Pick<ImageAgentTeam, 'getReferenceSheet'>;
  /** Run-scoped style anchor paths, owned by the monolith (read by reference). */
  styleAnchorPaths: { character?: string; arcStrip?: string; environment?: string };
  buildPersistedNpc: (
    c: CharacterBible['characters'][number],
    portrait?: string,
  ) => Story['npcs'][number];
  ensureBlueprintFidelityText: (sceneBlueprint: SceneBlueprint, content: SceneContent) => void;
  ensureChoiceBridgeBeats: (
    blueprint: EpisodeBlueprint,
    sceneBlueprint: SceneBlueprint,
    content: SceneContent,
    choiceMap: Map<string, ChoiceSet>,
  ) => void;
  getEpisodeScopedBeatKey: (brief: FullCreativeBrief, sceneId: string, beatId: string) => string;
  getEpisodeScopedSceneId: (brief: FullCreativeBrief, sceneId: string) => string;
  sanitizeReaderFacingSceneName: (name: string | undefined, fallback?: string) => string;
  sanitizeSceneContentForReader: (sceneBlueprint: SceneBlueprint, content: SceneContent) => void;
  validateMicroEpisodeSeason: (story: Story, context: { phase: string }) => void;
  validateMicroEpisodeStructure: (episode: Episode, context: { phase: string }) => void;
  wireEncounterTreeImages: (
    choices: Array<{ id: string; outcomes?: Record<string, any> }>,
    beatId: string,
    pathPrefix: string,
    setupImages: Map<string, string>,
    outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>,
    parentSituationImage?: string,
  ) => { setupCount: number; outcomeCount: number };
}

export class Assembly {
  constructor(private deps: AssemblyDeps) {}

  assembleStory(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    encounters: Map<string, EncounterStructure>,
    imageResults?: { beatImages: Map<string, string>; sceneImages: Map<string, string> },
    encounterImageResults?: { encounterImages: Map<string, { setupImages: Map<string, string>; outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }> }>; storyletImages?: Map<string, Map<string, Map<string, string>>> },
    storyCoverUrl?: string,
    videoResults?: Map<string, string>
  ): Story {
    // Re-sync any choice set whose beatId drifted from its scene's beats during a
    // post-authoring rewrite pass, BEFORE the `${sceneId}::${beatId}` choiceMap is
    // built — else a drifted branch point assembles choiceless (GATE_BRANCH_FANOUT).
    const reSynced = reconcileChoiceSetBeatIds(sceneContents, choiceSets);
    if (reSynced > 0) {
      this.deps.emit({
        type: 'warning',
        phase: 'assembly',
        message: `Re-synced ${reSynced} choice set(s) whose beatId drifted from the assembled scene's beats (would otherwise have dropped the choices).`,
      });
    }
    const contentMap = new Map(sceneContents.map(sc => [sc.sceneId, sc]));
    const choiceMap = new Map(choiceSets.map(cs => [cs.sceneId ? `${cs.sceneId}::${cs.beatId}` : cs.beatId, cs]));
    const beatImages = imageResults?.beatImages || new Map<string, string>();
    const sceneImages = imageResults?.sceneImages || new Map<string, string>();
    const beatVideos = videoResults || new Map<string, string>();
    const encounterImages = encounterImageResults?.encounterImages || new Map();
    const storyletImages = encounterImageResults?.storyletImages || new Map<string, Map<string, Map<string, string>>>();

    // Build scenes
    const scenes: Scene[] = blueprint.scenes.map(sceneBlueprint => {
      const content = contentMap.get(sceneBlueprint.id);
      if (!content) {
        throw new Error(`Missing content for scene ${sceneBlueprint.id}`);
      }

      // Check if this scene has an encounter - use extracted converter
      const encounterStructure = encounters.get(sceneBlueprint.id);
      const sceneEncounterImages = encounterImages.get(sceneBlueprint.id);
      const encounter = encounterStructure
        ? convertEncounterStructureToEncounter(encounterStructure, sceneBlueprint)
        : undefined;

      // Map encounter images to the encounter structure (including recursive nextSituation trees)
      if (encounter && sceneEncounterImages) {
        let mappedSetupCount = 0;
        let mappedOutcomeCount = 0;
        encounter.phases.forEach(phase => {
          phase.beats.forEach(beat => {
            const isEncounterBeat = 'setupText' in beat;

            const setupImage = sceneEncounterImages.setupImages.get(beat.id);
            if (setupImage && isEncounterBeat) {
              (beat as TypeEncounterBeat).situationImage = setupImage;
              mappedSetupCount++;
            }

            if (isEncounterBeat) {
              const encounterBeat = beat as TypeEncounterBeat;
              if (encounterBeat.choices) {
                const treeResult = this.deps.wireEncounterTreeImages(
                  encounterBeat.choices,
                  encounterBeat.id,
                  '',
                  sceneEncounterImages.setupImages,
                  sceneEncounterImages.outcomeImages,
                  encounterBeat.situationImage,
                );
                mappedSetupCount += treeResult.setupCount;
                mappedOutcomeCount += treeResult.outcomeCount;
              }
            }
          });
        });
        console.log(`[Pipeline] Encounter image mapping for ${sceneBlueprint.id}: ${mappedSetupCount} setup images, ${mappedOutcomeCount} outcome images wired`);
      } else if (encounter && !sceneEncounterImages) {
        console.warn(`[Pipeline] Scene ${sceneBlueprint.id} has encounter but NO encounter images were generated`);
      }

      // Wire storylet aftermath images into each storylet beat's image field
      if (encounter) {
        const sceneStoryletImages = storyletImages.get(sceneBlueprint.id);
        if (sceneStoryletImages && encounter.storylets) {
          const outcomes: Array<[string, TypeGeneratedStorylet | undefined]> = [
            ['victory', encounter.storylets.victory],
            ['partialVictory', encounter.storylets.partialVictory],
            ['defeat', encounter.storylets.defeat],
            ['escape', encounter.storylets.escape],
          ];
          for (const [outcomeName, storylet] of outcomes) {
            if (!storylet) continue;
            const beatImageMap = sceneStoryletImages.get(outcomeName);
            if (beatImageMap) {
              storylet.beats.forEach(beat => {
                const url = beatImageMap.get(beat.id);
                if (url) beat.image = url;
              });
            }
          }
        }
      }

      this.deps.ensureBlueprintFidelityText(sceneBlueprint, content);
      this.deps.ensureChoiceBridgeBeats(blueprint, sceneBlueprint, content, choiceMap);
      this.deps.sanitizeSceneContentForReader(sceneBlueprint, content);

      const beats: Beat[] = content.beats.map(genBeat => {
        const compositeKey = this.deps.getEpisodeScopedBeatKey(brief, sceneBlueprint.id, genBeat.id);
        const beat: Beat = {
          id: genBeat.id,
          text: genBeat.text,
          textVariants: genBeat.textVariants,
          speaker: genBeat.speaker,
          speakerMood: genBeat.speakerMood,
          nextBeatId: genBeat.nextBeatId,
          nextSceneId: genBeat.nextSceneId,
          onShow: genBeat.onShow,
          image: beatImages.get(compositeKey),
          video: beatVideos.get(compositeKey),
          visualMoment: genBeat.visualMoment,
          primaryAction: genBeat.primaryAction,
          emotionalRead: genBeat.emotionalRead,
          relationshipDynamic: genBeat.relationshipDynamic,
          mustShowDetail: genBeat.mustShowDetail,
          shotType: genBeat.shotType,
          intensityTier: genBeat.intensityTier,
          visualContinuity: genBeat.visualContinuity,
          visualCast: (genBeat as any).visualCast,
          coveragePlan: (genBeat as any).coveragePlan,
          dramaticIntent: genBeat.dramaticIntent,
          sequenceIntent: (genBeat as any).sequenceIntent,
          isChoiceBridge: genBeat.isChoiceBridge,
          routeContext: genBeat.routeContext,
        };

        // Attach choices whenever a choice set EXISTS for this beat — not only when
        // genBeat.isChoicePoint is set. A choiceMap entry is created exclusively for a
        // real choice point, so its presence is the source of truth. Gating on the
        // flag too silently drops choices when an auto-marked / fallback choice point's
        // isChoicePoint was set AFTER the scene checkpoint was saved (so the assembled
        // copy never sees it) — shipping a branch point choiceless (bite-me-g14 ep2 s2-1).
        if (choiceMap.has(`${sceneBlueprint.id}::${genBeat.id}`)) {
          const choiceSet = choiceMap.get(`${sceneBlueprint.id}::${genBeat.id}`);
          if (choiceSet) {
            beat.choices = choiceSet.choices.map((gc, ci) => {
              let nextSceneId = gc.nextSceneId;

              // Guard: prevent backward navigation to current scene or scenes
              // that precede it in the episode (which would cause loops).
              if (nextSceneId) {
                const targetIdx = blueprint.scenes.findIndex(s => s.id === nextSceneId);
                const currentIdx = blueprint.scenes.findIndex(s => s.id === sceneBlueprint.id);
                if (targetIdx >= 0 && targetIdx <= currentIdx) {
                  const leadsTo = sceneBlueprint.leadsTo || [];
                  const corrected = leadsTo[ci % leadsTo.length] || leadsTo[0];
                  if (corrected) {
                    console.warn(
                      `[Pipeline] assembleStory: choice "${gc.id}" in scene "${sceneBlueprint.id}" ` +
                      `routes backward to "${nextSceneId}" (idx ${targetIdx} <= ${currentIdx}). ` +
                      `Auto-correcting to "${corrected}".`
                    );
                    nextSceneId = corrected;
                  }
                }
              }

              return assembleChoiceForStory(gc, nextSceneId);
            });
          }
        }

        return beat;
      });

      return {
        id: sceneBlueprint.id,
        name: this.deps.sanitizeReaderFacingSceneName(sceneBlueprint.name, sceneBlueprint.name),
        charactersInvolved: content.charactersInvolved || sceneBlueprint.npcsPresent,
        beats,
        startingBeatId: content.startingBeatId,
        backgroundImage: sceneImages.get(this.deps.getEpisodeScopedSceneId(brief, sceneBlueprint.id)),
        encounter,
        sequenceIntent: content.sequenceIntent,
        sceneVisualSequencePlan: content.sceneVisualSequencePlan,
        leadsTo: sceneBlueprint.leadsTo,
        isBottleneck: blueprint.bottleneckScenes?.includes(sceneBlueprint.id) || sceneBlueprint.purpose === 'bottleneck',
        isConvergencePoint: blueprint.scenes.filter(s => s.leadsTo?.includes(sceneBlueprint.id)).length > 1,
        branchType: content.branchType,
        // Planned time/place + the writer's transition phrase, persisted so the
        // SceneTransitionContinuityValidator can verify the prose honored them.
        timeline: sceneTimelineMetaForScene(sceneBlueprint, content.transitionIn),
      };
    });

    const episodeCover = storyCoverUrl
      || (scenes.length > 0 ? sceneImages.get(this.deps.getEpisodeScopedSceneId(brief, scenes[0].id)) || '' : '');

    const episode: Episode = {
      id: generateEpisodeId(brief.episode.number, brief.episode.title),
      number: brief.episode.number,
      title: brief.episode.title,
      synopsis: brief.episode.synopsis,
      coverImage: episodeCover,
      episodeStructureMode: this.deps.config.generation?.episodeStructureMode,
      scenes,
      startingSceneId: blueprint.startingSceneId,
    };
    this.deps.validateMicroEpisodeStructure(episode, {
      phase: 'micro_episode_final_validation',
    });

    const storyCover = episodeCover;

    // Build complete story
    const story: Story = {
      id: idSlugify(brief.story.title) || 'untitled-story',
      title: brief.story.title,
      genre: brief.story.genre,
      synopsis: brief.story.synopsis,
      coverImage: storyCover,
      author: 'AI Generated',
      tags: brief.story.themes,

      initialState: {
        attributes: { ...CHARACTER_DEFAULTS.attributes },
        skills: Object.fromEntries(DEFAULT_SKILLS.map(s => [s.name, 10])),
        tags: [],
        inventory: [],
      },

      npcs: characterBible.characters
        .filter(c => c.id !== brief.protagonist.id)
        .map(c => {
          let portrait: string | undefined;
          const refSheet = this.deps.imageAgentTeam.getReferenceSheet(c.id);
          if (refSheet) {
            const frontImg = refSheet.generatedImages.get('front') || refSheet.generatedImages.get('composite');
            portrait = frontImg?.imageUrl || frontImg?.imagePath;
          }
          return this.deps.buildPersistedNpc(c, portrait);
        }),

      episodes: [episode],
      outputDir: '', // Will be filled in by pipeline

      artStyleProfile: this.deps.config.imageGen?.artStyleProfile,
      styleAnchors: (this.deps.styleAnchorPaths.character || this.deps.styleAnchorPaths.arcStrip || this.deps.styleAnchorPaths.environment)
        ? {
            character: this.deps.styleAnchorPaths.character ? { imagePath: this.deps.styleAnchorPaths.character } : undefined,
            arcStrip: this.deps.styleAnchorPaths.arcStrip ? { imagePath: this.deps.styleAnchorPaths.arcStrip } : undefined,
            environment: this.deps.styleAnchorPaths.environment ? { imagePath: this.deps.styleAnchorPaths.environment } : undefined,
          }
        : undefined,
    };
    this.deps.validateMicroEpisodeSeason(story, { phase: 'micro_episode_season_final_validation' });

    return story;
  }

  assembleEpisode(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    imageResults?: { beatImages: Map<string, string>; sceneImages: Map<string, string> },
    encounters?: Map<string, EncounterStructure>,
    encounterImageResults?: {
      encounterImages: Map<string, { setupImages: Map<string, string>; outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }> }>;
      storyletImages?: Map<string, Map<string, Map<string, string>>>;
    },
    videoResults?: Map<string, string>
  ): Episode {
    // Re-sync any choice set whose beatId drifted from its scene's beats during a
    // post-authoring rewrite pass, BEFORE the `${sceneId}::${beatId}` choiceMap is
    // built — else a drifted branch point assembles choiceless (GATE_BRANCH_FANOUT).
    const reSynced = reconcileChoiceSetBeatIds(sceneContents, choiceSets);
    if (reSynced > 0) {
      this.deps.emit({
        type: 'warning',
        phase: 'assembly',
        message: `Re-synced ${reSynced} choice set(s) whose beatId drifted from the assembled scene's beats (would otherwise have dropped the choices).`,
      });
    }
    const contentMap = new Map(sceneContents.map(sc => [sc.sceneId, sc]));
    const choiceMap = new Map(choiceSets.map(cs => [cs.sceneId ? `${cs.sceneId}::${cs.beatId}` : cs.beatId, cs]));
    const beatImages = imageResults?.beatImages || new Map<string, string>();
    const sceneImages = imageResults?.sceneImages || new Map<string, string>();
    const beatVideos = videoResults || new Map<string, string>();
    const encounterImages = encounterImageResults?.encounterImages || new Map();
    const storyletImages = encounterImageResults?.storyletImages || new Map<string, Map<string, Map<string, string>>>();

    const scenes: Scene[] = [];
    const assemblyWarnings: string[] = [];

    for (const sb of blueprint.scenes) {
      let content = contentMap.get(sb.id);
      if (!content) {
        console.error(`[Pipeline] Missing content for scene ${sb.id} — inserting placeholder`);
        this.deps.emit({ type: 'error', phase: 'assembly', message: `Missing content for scene ${sb.id} — inserting placeholder` });
        assemblyWarnings.push(`Missing content for scene ${sb.id}`);
        content = {
          sceneId: sb.id,
          sceneName: sb.name,
          beats: [{ id: `${sb.id}-missing-beat`, text: '[Scene content was not generated]', nextBeatId: undefined }],
          startingBeatId: `${sb.id}-missing-beat`,
          moodProgression: [sb.mood],
          charactersInvolved: sb.npcsPresent,
          keyMoments: [sb.description],
          continuityNotes: ['Content generation did not produce this scene'],
        } as SceneContent;
      }

      // Check if this scene has an encounter (wrapped in try/catch for resilience)
      const encounterStructure = encounters?.get(sb.id);
      const sceneEncounterImages = encounterImages.get(sb.id);
      let encounter: ReturnType<typeof convertEncounterStructureToEncounter> | undefined;

      try {
        encounter = encounterStructure
          ? convertEncounterStructureToEncounter(encounterStructure, sb)
          : undefined;
      } catch (convError) {
        const convMsg = convError instanceof Error ? convError.message : String(convError);
        console.error(`[Pipeline] Failed to convert encounter for scene ${sb.id} (non-fatal): ${convMsg}`);
        assemblyWarnings.push(`Encounter conversion failed for ${sb.id}: ${convMsg}`);
        if (this.deps.config.validation?.enabled && this.deps.config.validation?.mode !== 'disabled') {
          throw new PipelineError(
            `Encounter conversion failed for scene ${sb.id}: ${convMsg}`,
            'assembly',
            {
              context: {
                sceneId: sb.id,
                sceneName: sb.name,
                failureKind: 'encounter_conversion',
              },
              originalError: convError instanceof Error ? convError : undefined,
            }
          );
        }
        encounter = undefined; // Continue without the encounter
      }

      // Map encounter images to the encounter structure (including recursive nextSituation trees)
      if (encounter && sceneEncounterImages) {
        let epMappedSetup = 0;
        let epMappedOutcome = 0;
        encounter.phases.forEach(phase => {
          phase.beats.forEach(beat => {
            const isEncounterBeat = 'setupText' in beat;

            const setupImage = sceneEncounterImages.setupImages.get(beat.id);
            if (setupImage && isEncounterBeat) {
              (beat as TypeEncounterBeat).situationImage = setupImage;
              epMappedSetup++;
            }

            if (isEncounterBeat) {
              const encounterBeat = beat as TypeEncounterBeat;
              if (encounterBeat.choices) {
                const treeResult = this.deps.wireEncounterTreeImages(
                  encounterBeat.choices,
                  encounterBeat.id,
                  '',
                  sceneEncounterImages.setupImages,
                  sceneEncounterImages.outcomeImages,
                  encounterBeat.situationImage,
                );
                epMappedSetup += treeResult.setupCount;
                epMappedOutcome += treeResult.outcomeCount;
              }
            }
          });
        });
        console.log(`[Pipeline] assembleEpisode: Encounter image mapping for ${sb.id}: ${epMappedSetup} setup, ${epMappedOutcome} outcome images`);
      } else if (encounter && !sceneEncounterImages) {
        console.warn(`[Pipeline] assembleEpisode: Scene ${sb.id} has encounter but NO encounter images were generated`);
      }

      // Wire storylet aftermath images into each storylet beat's image field.
      if (encounter) {
        const sceneStoryletImages = storyletImages.get(sb.id);
        if (sceneStoryletImages && encounter.storylets) {
          const outcomes: Array<[string, TypeGeneratedStorylet | undefined]> = [
            ['victory', encounter.storylets.victory],
            ['partialVictory', encounter.storylets.partialVictory],
            ['defeat', encounter.storylets.defeat],
            ['escape', encounter.storylets.escape],
          ];
          for (const [outcomeName, storylet] of outcomes) {
            if (!storylet) continue;
            const beatImageMap = sceneStoryletImages.get(outcomeName);
            if (beatImageMap) {
              storylet.beats.forEach(beat => {
                const url = beatImageMap.get(beat.id);
                if (url) beat.image = url;
              });
            }
          }
        }
      }

      // Determine if this is a bottleneck scene
      const isBottleneck = blueprint.bottleneckScenes?.includes(sb.id) || sb.purpose === 'bottleneck';

      // Determine if this is a convergence point (multiple scenes lead to it)
      const incomingScenes = blueprint.scenes.filter(s => s.leadsTo?.includes(sb.id));
      const isConvergencePoint = incomingScenes.length > 1;

      this.deps.ensureBlueprintFidelityText(sb, content);
      this.deps.ensureChoiceBridgeBeats(blueprint, sb, content, choiceMap);
      this.deps.sanitizeSceneContentForReader(sb, content);

      scenes.push({
        id: sb.id,
        name: this.deps.sanitizeReaderFacingSceneName(sb.name, sb.name),
        charactersInvolved: content.charactersInvolved || sb.npcsPresent,
        startingBeatId: content.startingBeatId,
        backgroundImage: sceneImages.get(this.deps.getEpisodeScopedSceneId(brief, sb.id)),
        beats: content.beats.map(gb => ({
          id: gb.id,
          text: gb.text,
          textVariants: gb.textVariants,
          callbackHookIds: gb.callbackHookIds,
          onShow: gb.onShow,
          speaker: gb.speaker,
          speakerMood: gb.speakerMood,
          nextBeatId: gb.nextBeatId,
          nextSceneId: gb.nextSceneId,
          image: beatImages.get(this.deps.getEpisodeScopedBeatKey(brief, sb.id, gb.id)),
          video: beatVideos.get(this.deps.getEpisodeScopedBeatKey(brief, sb.id, gb.id)),
          visualMoment: gb.visualMoment,
          primaryAction: gb.primaryAction,
          emotionalRead: gb.emotionalRead,
          relationshipDynamic: gb.relationshipDynamic,
          mustShowDetail: gb.mustShowDetail,
          shotType: gb.shotType,
          intensityTier: gb.intensityTier,
          visualContinuity: gb.visualContinuity,
          visualCast: (gb as any).visualCast,
          coveragePlan: (gb as any).coveragePlan,
          dramaticIntent: (gb as any).dramaticIntent,
          sequenceIntent: (gb as any).sequenceIntent,
          isChoiceBridge: gb.isChoiceBridge,
          routeContext: gb.routeContext,
          // Attach whenever a choice set exists for this beat (source of truth), not
          // only when gb.isChoicePoint survived to assembly. See assembleStory above.
          choices: choiceMap.get(`${sb.id}::${gb.id}`)?.choices.map(c => assembleChoiceForStory(c))
        })),
        encounter,
        sequenceIntent: (content as any).sequenceIntent || (sb as any).sequenceIntent,
        // Branch navigation metadata
        leadsTo: sb.leadsTo,
        isBottleneck,
        isConvergencePoint,
      });
    }

    if (assemblyWarnings.length > 0) {
      console.warn(`[Pipeline] Episode assembly completed with ${assemblyWarnings.length} warning(s): ${assemblyWarnings.join('; ')}`);
    }

    // Post-assembly encounter verification: the final episode must contain encounters
    // when the blueprint flagged scenes as encounters.
    const blueprintEncounterSceneIds = blueprint.scenes.filter(s => s.isEncounter).map(s => s.id);
    const assembledEncounterSceneIds = scenes.filter(s => s.encounter).map(s => s.id);
    if (blueprintEncounterSceneIds.length > 0 && assembledEncounterSceneIds.length === 0) {
      const message =
        `Episode assembly lost all encounters. Blueprint expected ${blueprintEncounterSceneIds.length} encounter scene(s) ` +
        `[${blueprintEncounterSceneIds.join(', ')}] but 0 made it to final output.`;
      console.error(`[Pipeline] ENCOUNTER VERIFICATION FAILED: ${message}`);
      this.deps.emit({ type: 'error', phase: 'assembly', message });
      this.deps.throwIfFailFast(message, 'assembly', {
        context: {
          expectedEncounterSceneIds: blueprintEncounterSceneIds,
          assembledEncounterSceneIds,
          failureKind: 'encounter_assembly',
        },
      });
    } else if (blueprintEncounterSceneIds.length > assembledEncounterSceneIds.length) {
      const missing = blueprintEncounterSceneIds.filter(id => !assembledEncounterSceneIds.includes(id));
      const message = `${missing.length} encounter scene(s) lost during assembly: ${missing.join(', ')}`;
      console.warn(`[Pipeline] Encounter verification: ${message}`);
      this.deps.emit({ type: 'warning', phase: 'assembly', message });
      this.deps.throwIfFailFast(message, 'assembly', {
        context: {
          expectedEncounterSceneIds: blueprintEncounterSceneIds,
          assembledEncounterSceneIds,
          missingEncounterSceneIds: missing,
          failureKind: 'encounter_assembly',
        },
      });
    }

    // Use first scene's background as episode cover
    const episodeCover = scenes.length > 0 ? sceneImages.get(this.deps.getEpisodeScopedSceneId(brief, scenes[0].id)) || '' : '';

    const seasonEpisode = brief.seasonPlan?.episodes.find(e => e.episodeNumber === brief.episode.number);
    const episodeStructureMode = seasonEpisode?.episodeStructureMode || this.deps.config.generation?.episodeStructureMode;

    return {
      id: generateEpisodeId(brief.episode.number, brief.episode.title),
      number: brief.episode.number,
      title: brief.episode.title,
      synopsis: brief.episode.synopsis,
      episodeStructureMode,
      routeMeta: seasonEpisode?.routeMeta,
      scenes,
      startingSceneId: blueprint.startingSceneId,
      unlockConditions: seasonEpisode?.unlockConditions,
      coverImage: episodeCover
    };
  }
}
