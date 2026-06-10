/**
 * Draft-image entry helpers: the resume-scan, manifest builder, and bound-
 * reference repair that the image pipeline runs at its edges.
 *
 * Faithful port of FullStoryPipeline.scanExistingImagesForResume,
 * buildImageManifestFromStory, and repairBoundImageReferences (pure move).
 * These are deterministic (no LLM prompts): the resume scan rehydrates the
 * AssetRegistry from disk artifacts; the manifest builder derives the
 * image-status report from the registry; the reference repair rewrites stale
 * bound image URLs to surviving sibling files. The image-resume internals they
 * lean on (reference-sheet/style-anchor hydration, slot marking, scene-content
 * shaping) stay owned by the monolith and are injected via the deps.
 *
 * Extracted from FullStoryPipeline to keep that monolith from growing.
 */

import { PipelineConfig } from '../config';
import { slugify as idSlugify } from '../utils/idUtils';
import { Story, Scene, Beat } from '../../types';
import {
  saveEarlyDiagnostic,
  saveEncounterResumeState,
  loadEncounterResumeStateSync,
} from '../utils/pipelineOutputWriter';
import {
  buildEncounterSlotManifest,
  ENCOUNTER_TREE_MAX_DEPTH,
  type EncounterImageSlot,
} from '../encounters/encounterSlotManifest';
import { buildStoryletSlotManifest } from '../encounters/storyletSlotManifest';
import {
  buildStoryImageSlotManifest,
  storyBeatBaseIdentifier,
  storyBeatCoverageKey,
  storySceneBaseIdentifier,
  storySceneCoverageKey,
} from '../images/storyImageSlotManifest';
import type { ImageSlot } from '../images/slotTypes';
import { AssetRegistry } from '../images/assetRegistry';
import { CharacterBible } from '../agents/CharacterDesigner';
import { SceneContent } from '../agents/SceneWriter';
import { EncounterStructure } from '../agents/EncounterArchitect';
// Type-only import — erased at runtime, so no runtime cycle with the monolith.
import type { FullCreativeBrief } from './FullStoryPipeline';

interface ReferencePreflightResult {
  plannedReferenceCharacterIds: string[];
  alreadyAvailableReferenceCharacterIds: string[];
  hydratedReferenceCharacterIds: string[];
  generatedReferenceCharacterIds: string[];
  missingReferenceCharacterIds: string[];
}

export interface DraftImageEntryDeps {
  config: PipelineConfig;
  assetRegistry: Pick<AssetRegistry, 'values' | 'getResolvedAsset' | 'markSuccess' | 'get'>;
  /** Persist the active resume output dir, read elsewhere for image path resolution. */
  setActiveImageResumeOutputDirectory: (dir: string) => void;
  loadAssetRegistryForImageResume: (storyId: string, outputDirectory: string) => void;
  hydrateReferenceSheetsFromExistingImages: (
    outputDirectory: string,
    characterBible: CharacterBible,
  ) => Promise<number>;
  preflightResumeReferenceSheets: (
    outputDirectory: string,
    story: Story,
    characterBible: CharacterBible,
    encounters: EncounterStructure[],
    brief: FullCreativeBrief,
  ) => Promise<ReferencePreflightResult>;
  hydrateStyleAnchorsFromExistingImages: (outputDirectory: string, storyTitle: string) => Promise<number>;
  sceneContentFromStoryScene: (scene: Scene) => SceneContent;
  createEncounterRegistrySlot: (slot: EncounterImageSlot) => ImageSlot;
  markSlotFromExistingArtifact: (slot: ImageSlot, imagesDir: string) => Promise<boolean>;
}

export class DraftImageEntry {
  constructor(private deps: DraftImageEntryDeps) {}

  async scanExistingImagesForResume(
    outputDirectory: string,
    story: Story,
    characterBible: CharacterBible,
    encounters: EncounterStructure[],
    brief: FullCreativeBrief,
    options: { targetEpisodeNumber?: number } = {},
  ): Promise<{
    totalSlots: number;
    resolvedSlotsBefore: number;
    resolvedSlotsAfter: number;
    hydratedReferenceSheets: number;
    plannedReferenceCharacterIds: string[];
    generatedReferenceCharacterIds: string[];
    missingReferenceCharacterIds: string[];
    missingSlotIds: string[];
    completedEncounterBaseIdentifiersByScene: Record<string, string[]>;
  }> {
    const normalizedOutputDir = outputDirectory.endsWith('/') ? outputDirectory : `${outputDirectory}/`;
    this.deps.setActiveImageResumeOutputDirectory(normalizedOutputDir);
    const imagesDir = `${normalizedOutputDir}images/`;
    const storyId = idSlugify(story.title || story.id || 'story');
    this.deps.loadAssetRegistryForImageResume(storyId, normalizedOutputDir);
    const resolvedSlotsBefore = this.deps.assetRegistry.values().filter((record) => record.status === 'succeeded').length;
    const hydratedReferenceSheets = await this.deps.hydrateReferenceSheetsFromExistingImages(normalizedOutputDir, characterBible);
    const referencePreflight = await this.deps.preflightResumeReferenceSheets(
      normalizedOutputDir,
      story,
      characterBible,
      encounters,
      brief,
    );
    const hydratedStyleAnchors = await this.deps.hydrateStyleAnchorsFromExistingImages(normalizedOutputDir, story.title || story.id || 'story');

    const encounterBySceneId = new Map<string, EncounterStructure>();
    for (const encounter of encounters || []) {
      if ((encounter as any)?.sceneId) encounterBySceneId.set((encounter as any).sceneId, encounter);
    }

    const slots: ImageSlot[] = [];
    const completedEncounterBaseIdentifiersByScene: Record<string, string[]> = {};
    const targetEpisodes = (story.episodes || []).filter((episode) => (
      options.targetEpisodeNumber == null || episode.number === options.targetEpisodeNumber
    ));
    for (const episode of targetEpisodes) {
      for (const scene of episode.scenes || []) {
        const scopedSceneId = `episode-${episode.number}-${scene.id}`;
        const sceneContent = {
          ...this.deps.sceneContentFromStoryScene(scene),
          encounter: scene.encounter,
        };
        slots.push(...buildStoryImageSlotManifest(sceneContent, scopedSceneId).slots);

        const encounter = encounterBySceneId.get(scene.id) || (scene.encounter as unknown as EncounterStructure | undefined);
        if (!encounter) continue;
        const encounterSlots = buildEncounterSlotManifest(encounter, scene.id, scopedSceneId, ENCOUNTER_TREE_MAX_DEPTH).slots;
        for (const encounterSlot of encounterSlots) {
          slots.push(this.deps.createEncounterRegistrySlot(encounterSlot));
        }
        const storyletSlots = buildStoryletSlotManifest((encounter as any).storylets, scene.id, scopedSceneId).slots;
        for (const storyletSlot of storyletSlots) {
          slots.push({
            slotId: `storylet-aftermath:${scopedSceneId}::${storyletSlot.outcomeName}::${storyletSlot.beatId}`,
            family: 'storylet-aftermath',
            imageType: 'storylet-aftermath',
            sceneId: scene.id,
            scopedSceneId,
            beatId: storyletSlot.beatId,
            outcomeName: storyletSlot.outcomeName,
            storyFieldPath: `episodes[].scenes[id=${scene.id}].encounter.storylets.${storyletSlot.outcomeName}.beats[id=${storyletSlot.beatId}].image`,
            baseIdentifier: storyletSlot.baseIdentifier,
            required: true,
            qualityTier: 'critical',
            coverageKey: storyletSlot.coverageKey,
          });
        }
      }
    }

    for (const slot of slots) {
      const resolved = await this.deps.markSlotFromExistingArtifact(slot, imagesDir);
      if (resolved && slot.family.startsWith('encounter')) {
        const sceneId = slot.sceneId || '';
        if (!completedEncounterBaseIdentifiersByScene[sceneId]) completedEncounterBaseIdentifiersByScene[sceneId] = [];
        completedEncounterBaseIdentifiersByScene[sceneId].push(slot.baseIdentifier);
      } else if (resolved && slot.family === 'storylet-aftermath') {
        const sceneId = slot.sceneId || '';
        if (!completedEncounterBaseIdentifiersByScene[sceneId]) completedEncounterBaseIdentifiersByScene[sceneId] = [];
        completedEncounterBaseIdentifiersByScene[sceneId].push(slot.baseIdentifier);
      }
    }

    for (const slot of slots) {
      if (!slot.continuitySourceSlotId || this.deps.assetRegistry.getResolvedAsset(slot.slotId)) continue;
      const source = this.deps.assetRegistry.getResolvedAsset(slot.continuitySourceSlotId);
      if (!source?.latestUrl) continue;
      this.deps.assetRegistry.markSuccess(slot.slotId, {
        prompt: { prompt: `image-resume linked continuity source ${slot.continuitySourceSlotId}` },
        imageUrl: source.latestUrl,
        imagePath: source.latestPath || source.latestUrl,
        provider: source.provider,
        model: source.model,
      });
    }

    for (const [sceneId, completedBaseIdentifiers] of Object.entries(completedEncounterBaseIdentifiersByScene)) {
      if (!sceneId || completedBaseIdentifiers.length === 0) continue;
      const scene = story.episodes?.flatMap((episode) => episode.scenes || []).find((candidate) => candidate.id === sceneId);
      const scopedSceneId = scene
        ? `episode-${story.episodes.find((episode) => episode.scenes?.some((candidate) => candidate.id === sceneId))?.number || 0}-${sceneId}`
        : sceneId;
      const existing = loadEncounterResumeStateSync(normalizedOutputDir, idSlugify(sceneId));
      const merged = new Set<string>([
        ...(existing?.completedBaseIdentifiers || []),
        ...completedBaseIdentifiers,
      ]);
      await saveEncounterResumeState(normalizedOutputDir, idSlugify(sceneId), {
        version: 1,
        sceneId,
        scopedSceneId,
        completedBaseIdentifiers: [...merged],
        generatedAt: new Date().toISOString(),
      });
    }

    const missingSlotIds = slots
      .filter((slot) => !this.deps.assetRegistry.getResolvedAsset(slot.slotId))
      .map((slot) => slot.slotId);
    const resolvedSlotsAfter = this.deps.assetRegistry.values().filter((record) => record.status === 'succeeded').length;
    const scan = {
      outputDirectory: normalizedOutputDir,
      imageDirectory: imagesDir,
      generatedAt: new Date().toISOString(),
      totalSlots: slots.length,
      resolvedSlotsBefore,
      resolvedSlotsAfter,
      hydratedReferenceSheets,
      referencePreflight,
      hydratedStyleAnchors,
      missingSlotIds,
      missingCoverageKeys: slots
        .filter((slot) => !this.deps.assetRegistry.getResolvedAsset(slot.slotId))
        .map((slot) => slot.coverageKey),
      completedEncounterBaseIdentifiersByScene,
    };
    await saveEarlyDiagnostic(normalizedOutputDir, 'image-resume-scan.json', scan);
    return {
      totalSlots: slots.length,
      resolvedSlotsBefore,
      resolvedSlotsAfter,
      hydratedReferenceSheets,
      plannedReferenceCharacterIds: referencePreflight.plannedReferenceCharacterIds,
      generatedReferenceCharacterIds: referencePreflight.generatedReferenceCharacterIds,
      missingReferenceCharacterIds: referencePreflight.missingReferenceCharacterIds,
      missingSlotIds,
      completedEncounterBaseIdentifiersByScene,
    };
  }

  buildImageManifestFromStory(story: Story): {
    version: 1;
    storyId: string;
    generatedAt: string;
    imagesStatus: NonNullable<Story['imagesStatus']>;
    coverage: {
      totalBeats: number;
      beatsWithImages: number;
      totalScenes: number;
      scenesWithImages: number;
      encounterOnlyScenes: number;
      sceneBackgroundSlots: number;
      strategy: string;
    };
    slots: Array<ImageSlot & Record<string, unknown>>;
  } {
    const slots: ImageSlot[] = [];
    let totalBeats = 0;
    let beatsWithImages = 0;
    let totalScenes = 0;
    let scenesWithImages = 0;
    let encounterOnlyScenes = 0;
    let sceneBackgroundSlots = 0;
    for (const episode of story.episodes || []) {
      for (const scene of episode.scenes || []) {
        totalScenes += 1;
        if (scene.backgroundImage || (scene as Scene & { image?: unknown; imageUrl?: unknown; imagePath?: unknown }).image || (scene as Scene & { imageUrl?: unknown }).imageUrl || (scene as Scene & { imagePath?: unknown }).imagePath) {
          scenesWithImages += 1;
        }
        const scopedSceneId = `episode-${episode.number}-${scene.id}`;
        const isEncounterOnlyScene = !(scene.beats?.length) && Boolean(scene.encounter);
        if (isEncounterOnlyScene) {
          encounterOnlyScenes += 1;
        } else {
          sceneBackgroundSlots += 1;
          slots.push({
            slotId: `story-scene:${scopedSceneId}`,
            family: 'story-scene',
            imageType: 'scene',
            sceneId: scene.id,
            scopedSceneId,
            beatId: scene.beats?.[0]?.id,
            storyFieldPath: `episodes[number=${episode.number}].scenes[id=${scene.id}].backgroundImage`,
            baseIdentifier: storySceneBaseIdentifier(scopedSceneId),
            required: false,
            qualityTier: 'standard',
            coverageKey: storySceneCoverageKey(scene.id),
            continuitySourceSlotId: scene.beats?.[0]?.id ? `story-beat:${scopedSceneId}::${scene.beats[0].id}` : undefined,
          });
        }
        for (const beat of scene.beats || []) {
          totalBeats += 1;
          if (beat.image || (beat as Beat & { imageUrl?: unknown; imagePath?: unknown }).imageUrl || (beat as Beat & { imagePath?: unknown }).imagePath) {
            beatsWithImages += 1;
          }
          slots.push({
            slotId: `story-beat:${scopedSceneId}::${beat.id}`,
            family: 'story-beat',
            imageType: 'beat',
            sceneId: scene.id,
            scopedSceneId,
            beatId: beat.id,
            storyFieldPath: `episodes[number=${episode.number}].scenes[id=${scene.id}].beats[id=${beat.id}].image`,
            baseIdentifier: storyBeatBaseIdentifier(scopedSceneId, beat.id),
            required: false,
            qualityTier: 'standard',
            coverageKey: storyBeatCoverageKey(scene.id, beat.id),
            metadata: {
              isChoicePoint: beat.isChoicePoint === true,
            },
          });
        }
      }
    }
    const manifestSlots = slots.map((slot) => {
      const record = this.deps.assetRegistry.get(slot.slotId);
      return {
        ...slot,
        status: record?.status || 'planned',
        imageUrl: record?.latestUrl,
        imagePath: record?.latestPath,
        provider: record?.provider,
        model: record?.model,
        failureReason: record?.failureReason,
        promptSummary: record?.promptSummary,
        referencePack: record?.referencePack,
        appliedReferencePack: record?.referencePack,
        attemptCount: record?.attempts?.length || 0,
        metadata: record?.slot.metadata || slot.metadata,
        effectivePlanningMode: (record?.slot.metadata as any)?.effectivePlanningMode,
        requestedPlanningMode: (record?.slot.metadata as any)?.requestedPlanningMode,
        promptSource: (record?.slot.metadata as any)?.promptSource,
        fallbackReason: (record?.slot.metadata as any)?.fallbackReason,
        visibleCast: (record?.slot.metadata as any)?.visibleCharacterNames,
        offscreenCast: (record?.slot.metadata as any)?.offscreenCharacterIds,
      };
    });
    const requiredSlots = manifestSlots.filter((slot) => slot.required !== false);
    const requiredMissing = requiredSlots.length > 0
      ? requiredSlots.some((slot) => slot.status !== 'succeeded')
      : manifestSlots.some((slot) => slot.family === 'story-beat' && slot.status !== 'succeeded');
    const anySucceeded = manifestSlots.some((slot) => slot.status === 'succeeded');
    const registryBeatsWithImages = manifestSlots.filter((slot) => slot.family === 'story-beat' && slot.status === 'succeeded').length;
    const registryScenesWithImages = manifestSlots.filter((slot) => slot.family === 'story-scene' && slot.status === 'succeeded').length;
    const imagesStatus: NonNullable<Story['imagesStatus']> = requiredMissing
      ? (anySucceeded ? 'partial' : (story.imagesStatus === 'failed' ? 'failed' : 'pending'))
      : 'complete';
    return {
      version: 1,
      storyId: story.id,
      generatedAt: new Date().toISOString(),
      imagesStatus,
      coverage: {
        totalBeats,
        beatsWithImages: Math.max(beatsWithImages, registryBeatsWithImages),
        totalScenes,
        scenesWithImages: Math.max(scenesWithImages, registryScenesWithImages),
        encounterOnlyScenes,
        sceneBackgroundSlots,
        strategy: this.deps.config.imageGen?.strategy || 'selective',
      },
      slots: manifestSlots,
    };
  }

  async repairBoundImageReferences(story: Story, outputDirectory: string): Promise<{
    generatedAt: string;
    checked: number;
    repaired: Array<{ path: string; from: string; to: string }>;
    unresolved: Array<{ path: string; value: string; filePath: string }>;
  }> {
    const report = {
      generatedAt: new Date().toISOString(),
      checked: 0,
      repaired: [] as Array<{ path: string; from: string; to: string }>,
      unresolved: [] as Array<{ path: string; value: string; filePath: string }>,
    };
    const fs = await import('fs/promises');
    const path = await import('path');
    const outputRoot = path.resolve(outputDirectory);
    const projectRoot = process.cwd();
    const imageValueKeys = new Set([
      'image',
      'imageUrl',
      'imagePath',
      'backgroundImage',
      'coverImage',
      'situationImage',
      'outcomeImage',
      'portrait',
      'portraitImage',
    ]);
    const isImageReferenceField = (key: string, value: string): boolean => {
      if (imageValueKeys.has(key)) return true;
      if (/prompt|description|caption|style|negative/i.test(key)) return false;
      return /image/i.test(key) && /\.(png|jpe?g|webp)(?:[?#].*)?$/i.test(value);
    };

    const toFilePath = (value: string): string | undefined => {
      if (!value || value.startsWith('data:')) return undefined;
      const generatedIndex = value.indexOf('generated-stories/');
      if (generatedIndex < 0) return undefined;
      return path.resolve(projectRoot, value.slice(generatedIndex));
    };
    const toServedUrl = (filePath: string): string => {
      const relative = path.relative(projectRoot, filePath).split(path.sep).join('/');
      return `http://localhost:3001/${relative}`;
    };
    const exists = async (filePath: string): Promise<boolean> => {
      try {
        const stat = await fs.stat(filePath);
        return stat.isFile();
      } catch {
        return false;
      }
    };
    const findReplacement = async (filePath: string): Promise<string | undefined> => {
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath) || '.png';
      const stem = path.basename(filePath, ext);
      const stems = Array.from(new Set([
        stem.replace(/-(repair|recovery)-qa-retry-\d+$/i, '-$1'),
        stem.replace(/-qa-retry-\d+$/i, ''),
        stem.replace(/-(?:qa-retry-\d+|retry-\d+|textfix\d+)$/i, ''),
        stem.replace(/-(?:repair|recovery|fallback|textfix\d+|qa-retry-\d+|retry-\d+)$/i, ''),
      ].filter(Boolean)));

      for (const candidateStem of stems) {
        for (const candidateExt of [ext, '.png', '.jpg', '.jpeg', '.webp']) {
          const candidate = path.join(dir, `${candidateStem}${candidateExt}`);
          if (candidate !== filePath && await exists(candidate)) return candidate;
        }
      }

      try {
        const files = await fs.readdir(dir);
        const candidates: Array<{ filePath: string; mtimeMs: number; rank: number }> = [];
        for (const name of files) {
          if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
          const candidateStem = path.basename(name, path.extname(name));
          const rank = stems.findIndex((prefix) => candidateStem === prefix || candidateStem.startsWith(`${prefix}-`));
          if (rank < 0) continue;
          const candidate = path.join(dir, name);
          const stat = await fs.stat(candidate);
          candidates.push({ filePath: candidate, mtimeMs: stat.mtimeMs, rank });
        }
        candidates.sort((a, b) => a.rank - b.rank || b.mtimeMs - a.mtimeMs);
        return candidates[0]?.filePath;
      } catch {
        return undefined;
      }
    };

    const visit = async (node: any, breadcrumb: string): Promise<void> => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let index = 0; index < node.length; index += 1) {
          await visit(node[index], `${breadcrumb}[${index}]`);
        }
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        const childPath = breadcrumb ? `${breadcrumb}.${key}` : key;
        if (typeof value === 'string' && isImageReferenceField(key, value)) {
          const filePath = toFilePath(value);
          if (!filePath || !filePath.startsWith(outputRoot)) continue;
          report.checked += 1;
          if (await exists(filePath)) continue;
          const replacement = await findReplacement(filePath);
          if (replacement) {
            const nextValue = toServedUrl(replacement);
            node[key] = nextValue;
            report.repaired.push({ path: childPath, from: value, to: nextValue });
          } else {
            report.unresolved.push({ path: childPath, value, filePath });
          }
        } else {
          await visit(value, childPath);
        }
      }
    };

    await visit(story, 'story');
    return report;
  }
}
