/**
 * Image resume hydration service (pure move from FullStoryPipeline).
 *
 * Everything needed to resume an image run against existing on-disk output:
 * loading/merging the asset registry (including the legacy JSONL location),
 * hydrating character reference sheets and season style anchors from files,
 * marking slots resolved from existing artifacts (with continuity-source
 * linking), and the resume reference preflight that scans the story for every
 * planned visible/encounter character and hydrates-or-generates their sheets.
 *
 * Run-scoped state is injected as lazy reads; the asset registry additionally
 * gets a setter because resume flows REPLACE the registry instance. The brief
 * is passed through opaquely to the injected reference-sheet generator so this
 * module does not import FullCreativeBrief (no monolith cycle).
 */

import { AssetRegistry } from '../images/assetRegistry';
import { anchorIdentifier } from '../images/anchorPrompts';
import { slugify as idSlugify } from '../utils/idUtils';
import { computeCharacterIdentityFingerprint } from '../agents/image-team/ImageAgentTeam';
import type { ImageAgentTeam } from '../agents/image-team/ImageAgentTeam';
import type { ImageGenerationService } from '../services/imageGenerationService';
import type { GeneratedImage } from '../images/imageTypes';
import type { ImageSlot } from '../images/slotTypes';
import type { CharacterBible, CharacterProfile } from '../agents/CharacterDesigner';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { Story, Scene } from '../../types';
import { saveEarlyDiagnostic } from '../utils/pipelineOutputWriter';
import type { PipelineEvent } from './events';
import { resolveCharacterId } from './imageCasting';

export interface ImageResumeHydrationDeps {
  imageService(): ImageGenerationService;
  imageAgentTeam(): ImageAgentTeam;
  assetRegistry(): AssetRegistry;
  setAssetRegistry(registry: AssetRegistry): void;
  activeImageResumeOutputDirectory(): string | undefined;
  /** Live style-anchor path record — hydration writes discovered paths onto it. */
  styleAnchorPaths(): { character?: string; arcStrip?: string; environment?: string };
  checkCancellation(): Promise<void>;
  /** Opaque brief pass-through: the monolith's generator needs the full creative brief. */
  generateCharacterReferenceSheet(char: CharacterProfile, brief: unknown): Promise<unknown>;
  emit(event: Omit<PipelineEvent, 'timestamp'>): void;
}

export interface ResumeReferencePreflightReport {
  plannedReferenceCharacterIds: string[];
  alreadyAvailableReferenceCharacterIds: string[];
  hydratedReferenceCharacterIds: string[];
  generatedReferenceCharacterIds: string[];
  missingReferenceCharacterIds: string[];
}

export class ImageResumeHydration {
  constructor(private readonly deps: ImageResumeHydrationDeps) {}

  resetAssetRegistry(storyId?: string, persistPath?: string): void {
    this.deps.setAssetRegistry(new AssetRegistry(storyId, undefined, persistPath));
  }

  loadAssetRegistryForImageResume(storyId: string, outputDirectory: string): void {
    const normalizedOutputDir = outputDirectory.endsWith('/') ? outputDirectory : `${outputDirectory}/`;
    const primaryPath = `${normalizedOutputDir}asset-registry.jsonl`;
    const legacyPath = `${normalizedOutputDir}08-asset-registry.jsonl`;
    const assetRegistry = AssetRegistry.fromJSONL(primaryPath, storyId);
    this.deps.setAssetRegistry(assetRegistry);

    const legacyRegistry = AssetRegistry.fromJSONL(legacyPath, storyId);
    for (const record of legacyRegistry.values()) {
      if (record.status !== 'succeeded' || !record.latestUrl) continue;
      if (assetRegistry.getResolvedAsset(record.slot.slotId)) continue;
      assetRegistry.planSlot(record.slot);
      assetRegistry.markSuccess(record.slot.slotId, {
        prompt: { prompt: `image-resume imported legacy registry record ${record.slot.slotId}` },
        imageUrl: record.latestUrl,
        imagePath: record.latestPath || record.latestUrl,
        provider: record.provider,
        model: record.model,
      });
    }
  }

  servedUrlForGeneratedImagePath(imagePath: string): string {
    const gsIndex = imagePath.indexOf('generated-stories/');
    if (gsIndex >= 0) return `http://localhost:3001/${imagePath.slice(gsIndex)}`;
    return imagePath;
  }

  async readImageArtifact(imagePath: string): Promise<GeneratedImage | undefined> {
    if (!imagePath || /\.(txt)$/i.test(imagePath)) return undefined;
    try {
      const fs = await import('fs/promises');
      const buffer = await fs.readFile(imagePath);
      const lower = imagePath.toLowerCase();
      const mimeType = lower.endsWith('.jpg') || lower.endsWith('.jpeg')
        ? 'image/jpeg'
        : lower.endsWith('.webp')
          ? 'image/webp'
          : 'image/png';
      return {
        prompt: { prompt: `image-resume hydrated existing file ${imagePath}` },
        imagePath,
        imageUrl: this.servedUrlForGeneratedImagePath(imagePath),
        imageData: buffer.toString('base64'),
        mimeType,
        metadata: { hydratedFromDisk: true },
      };
    } catch {
      return undefined;
    }
  }

  async findExistingImageArtifact(imagesDir: string, baseIdentifier: string): Promise<GeneratedImage | undefined> {
    const exact = this.deps.imageService().findExistingGeneratedImage(baseIdentifier);
    if (exact?.imagePath) {
      const hydrated = await this.readImageArtifact(exact.imagePath);
      return {
        ...(hydrated || { prompt: { prompt: `image-resume reused ${baseIdentifier}` } }),
        imagePath: exact.imagePath,
        imageUrl: exact.imageUrl || hydrated?.imageUrl || this.servedUrlForGeneratedImagePath(exact.imagePath),
      } as GeneratedImage;
    }

    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const files = await fs.readdir(imagesDir);
      const candidates: Array<{ name: string; fullPath: string; mtimeMs: number }> = [];
      const imageExt = /\.(png|jpg|jpeg|webp)$/i;
      for (const name of files) {
        if (!imageExt.test(name)) continue;
        if (!name.startsWith(`${baseIdentifier}-`)) continue;
        if (!/-(qa-retry|retry|textfix|repair|recovery|fallback)/i.test(name)) continue;
        const fullPath = path.join(imagesDir, name);
        const stat = await fs.stat(fullPath);
        candidates.push({ name, fullPath, mtimeMs: stat.mtimeMs });
      }
      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return candidates[0] ? this.readImageArtifact(candidates[0].fullPath) : undefined;
    } catch {
      return undefined;
    }
  }

  async hydrateReferenceSheetsFromExistingImages(
    outputDirectory: string,
    characterBible: CharacterBible,
  ): Promise<number> {
    const imagesDir = `${outputDirectory.endsWith('/') ? outputDirectory : `${outputDirectory}/`}images/`;
    let hydrated = 0;
    for (const char of characterBible.characters || []) {
      if (this.deps.imageAgentTeam().hasReferenceSheet(char.id)) continue;
      if (await this.hydrateReferenceSheetFromDisk(char, imagesDir)) hydrated += 1;
    }
    return hydrated;
  }

  referenceIdentifierBasesForCharacter(char: CharacterProfile): string[] {
    const candidates = [
      char.id,
      idSlugify(char.id),
      idSlugify(char.name),
      char.id.replace(/^character[-_]/i, 'char-'),
      char.id.replace(/^char[-_]/i, 'char-'),
      `char-${idSlugify(char.name)}`,
    ];
    return Array.from(new Set(candidates.filter(Boolean).map((value) => `ref_${value}`)));
  }

  async hydrateReferenceSheetFromDisk(char: CharacterProfile, imagesDir?: string): Promise<boolean> {
    const imageAgentTeam = this.deps.imageAgentTeam();
    if (imageAgentTeam.hasReferenceSheet(char.id)) return true;
    const activeDir = this.deps.activeImageResumeOutputDirectory();
    const resolvedImagesDir = imagesDir
      || (activeDir
        ? `${activeDir.endsWith('/') ? activeDir : `${activeDir}/`}images/`
        : undefined);
    if (!resolvedImagesDir) return false;

    const views: Array<{ viewType: string; imageData: string; mimeType: string; imageUrl?: string; imagePath?: string }> = [];
    const bases = this.referenceIdentifierBasesForCharacter(char);
    for (const viewType of ['face', 'front', 'three-quarter', 'profile', 'composite']) {
      for (const base of bases) {
        const image = await this.findExistingImageArtifact(resolvedImagesDir, `${base}_${viewType}`);
        if (!image?.imageData || !image.mimeType) continue;
        views.push({
          viewType,
          imageData: image.imageData,
          mimeType: image.mimeType,
          imageUrl: image.imageUrl,
          imagePath: image.imagePath,
        });
        break;
      }
    }
    if (views.length === 0) return false;

    const identityFingerprint = computeCharacterIdentityFingerprint(char);
    const didHydrate = imageAgentTeam.hydrateReferenceSheetFromExistingImages({
      characterId: char.id,
      characterName: char.name,
      images: views,
      visualAnchors: [
        char.physicalDescription,
        ...(char.distinctiveFeatures || []),
        char.typicalAttire,
      ].filter(Boolean) as string[],
      identityFingerprint,
    });
    if (didHydrate) {
      imageAgentTeam.setReferenceSheetIdentityFingerprint(char.id, identityFingerprint);
      this.deps.emit({
        type: 'debug',
        phase: 'reference_sheet',
        message: `Resume scan hydrated existing reference for ${char.name} (${views.map((view) => view.viewType).join(', ')}); skipping reference regeneration.`,
      });
    }
    return didHydrate;
  }

  async hydrateStyleAnchorsFromExistingImages(outputDirectory: string, storyTitle: string): Promise<number> {
    const imagesDir = `${outputDirectory.endsWith('/') ? outputDirectory : `${outputDirectory}/`}images/`;
    const titleSlug = idSlugify(storyTitle || 'story');
    const styleAnchorPaths = this.deps.styleAnchorPaths();
    let hydrated = 0;
    const characterAnchor = await this.findExistingImageArtifact(imagesDir, anchorIdentifier(titleSlug, 'character-anchor'));
    if (characterAnchor?.imageData && characterAnchor.mimeType) {
      styleAnchorPaths.character = characterAnchor.imagePath;
      this.deps.imageService().setSeasonStyleReference(characterAnchor.imageData, characterAnchor.mimeType);
      hydrated += 1;
    }
    const arcStrip = await this.findExistingImageArtifact(imagesDir, anchorIdentifier(titleSlug, 'arc-strip'));
    if (arcStrip?.imagePath) {
      styleAnchorPaths.arcStrip = arcStrip.imagePath;
      hydrated += 1;
    }
    const environment = await this.findExistingImageArtifact(imagesDir, anchorIdentifier(titleSlug, 'environment-anchor'));
    if (environment?.imagePath) {
      styleAnchorPaths.environment = environment.imagePath;
      hydrated += 1;
    }
    return hydrated;
  }

  async markSlotFromExistingArtifact(slot: ImageSlot, imagesDir: string): Promise<boolean> {
    const assetRegistry = this.deps.assetRegistry();
    assetRegistry.planSlot(slot);
    if (assetRegistry.getResolvedAsset(slot.slotId)?.latestUrl) return true;

    if (slot.continuitySourceSlotId) {
      const source = assetRegistry.getResolvedAsset(slot.continuitySourceSlotId);
      if (source?.latestUrl) {
        assetRegistry.markSuccess(slot.slotId, {
          prompt: { prompt: `image-resume linked continuity source ${slot.continuitySourceSlotId}` },
          imageUrl: source.latestUrl,
          imagePath: source.latestPath || source.latestUrl,
          provider: source.provider,
          model: source.model,
        });
        return true;
      }
    }

    const artifact = await this.findExistingImageArtifact(imagesDir, slot.baseIdentifier);
    if (!artifact?.imageUrl) return false;
    assetRegistry.markSuccess(slot.slotId, artifact);
    return true;
  }

  collectPlannedReferenceCharacterIdsForResume(
    story: Story,
    characterBible: CharacterBible,
    encounters: EncounterStructure[],
  ): string[] {
    const planned = new Set<string>();
    const addRaw = (raw: unknown) => {
      if (typeof raw !== 'string' || !raw.trim()) return;
      const resolved = resolveCharacterId(raw, characterBible);
      if (resolved) planned.add(resolved);
    };
    const addMany = (raw: unknown) => {
      if (Array.isArray(raw)) {
        raw.forEach((item) => {
          if (typeof item === 'string') addRaw(item);
          else if (item && typeof item === 'object') {
            const record = item as Record<string, unknown>;
            addRaw(record.id);
            addRaw(record.characterId);
            addRaw(record.npcId);
            addRaw(record.name);
          }
        });
      } else {
        addRaw(raw);
      }
    };
    const addVisualCast = (visualCast: unknown) => {
      if (!visualCast || typeof visualCast !== 'object') return;
      const record = visualCast as Record<string, unknown>;
      [
        'sceneCharacterIds',
        'activeCharacterIds',
        'foregroundCharacterIds',
        'backgroundCharacterIds',
        'speakerCharacterId',
        'addressedCharacterIds',
        'listenerCharacterIds',
        'observerCharacterIds',
        'payoffRelevantCharacterIds',
        'requiredVisibleCharacterIds',
        'focalCharacterIds',
      ].forEach((key) => addMany(record[key]));
    };
    const scanReferenceKeys = (value: unknown, parentKey = '', depth = 0) => {
      if (!value || depth > 8) return;
      if (Array.isArray(value)) {
        value.forEach((item) => scanReferenceKeys(item, parentKey, depth + 1));
        return;
      }
      if (typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      for (const [key, child] of Object.entries(record)) {
        const lower = key.toLowerCase();
        const isCharacterKey =
          lower.includes('characterid') ||
          lower.includes('characterids') ||
          lower.includes('npcid') ||
          lower.includes('npcids') ||
          lower === 'speaker' ||
          lower === 'speakercharacterid' ||
          lower.includes('participant') ||
          lower.includes('observer') ||
          lower.includes('listener') ||
          lower.includes('addressed') ||
          lower.includes('payoffrelevant') ||
          lower.includes('requiredvisible') ||
          lower.includes('foregroundcharacter') ||
          lower.includes('backgroundcharacter') ||
          lower.includes('activecharacter') ||
          lower.includes('focalcharacter');
        if (isCharacterKey) addMany(child);
        if (lower === 'visualcast' || lower === 'coverageplan') addVisualCast(child);
        scanReferenceKeys(child, lower || parentKey, depth + 1);
      }
    };

    for (const char of characterBible.characters || []) {
      if (char.importance === 'core' || char.importance === 'major' || char.id === characterBible.protagonist?.id) {
        planned.add(char.id);
      }
    }

    for (const episode of story.episodes || []) {
      for (const scene of episode.scenes || []) {
        const sceneRecord = scene as unknown as Record<string, unknown>;
        addMany(sceneRecord.charactersInvolved);
        addMany(sceneRecord.characterIds);
        addMany(sceneRecord.characters);
        addMany(sceneRecord.npcIds);
        addVisualCast(sceneRecord.visualCast);
        scanReferenceKeys(sceneRecord.encounter, 'encounter');
        for (const beat of scene.beats || []) {
          const beatRecord = beat as unknown as Record<string, unknown>;
          addMany(beatRecord.characters);
          addMany(beatRecord.characterIds);
          addMany(beatRecord.npcIds);
          addRaw(beatRecord.speaker);
          addRaw(beatRecord.speakerCharacterId);
          addVisualCast(beatRecord.visualCast);
          addVisualCast(beatRecord.coveragePlan);
        }
        for (const choice of (scene as Scene & { choices?: unknown[] }).choices || []) {
          scanReferenceKeys(choice, 'choice');
        }
      }
    }

    for (const encounter of encounters || []) {
      scanReferenceKeys(encounter, 'encounter');
    }

    return [...planned];
  }

  async preflightResumeReferenceSheets(
    outputDirectory: string,
    story: Story,
    characterBible: CharacterBible,
    encounters: EncounterStructure[],
    brief: unknown,
  ): Promise<ResumeReferencePreflightReport> {
    const imageAgentTeam = this.deps.imageAgentTeam();
    const plannedReferenceCharacterIds = this.collectPlannedReferenceCharacterIdsForResume(story, characterBible, encounters);
    const alreadyAvailableReferenceCharacterIds: string[] = [];
    const hydratedReferenceCharacterIds: string[] = [];
    const generatedReferenceCharacterIds: string[] = [];
    const missingReferenceCharacterIds: string[] = [];

    this.deps.emit({
      type: 'debug',
      phase: 'reference_sheet',
      message: `Resume reference preflight checking ${plannedReferenceCharacterIds.length} planned visible/encounter character(s).`,
      data: { plannedReferenceCharacterIds },
    });

    for (const id of plannedReferenceCharacterIds) {
      await this.deps.checkCancellation();
      const char = characterBible.characters.find((candidate) => candidate.id === id);
      if (!char) continue;
      if (imageAgentTeam.hasReferenceSheet(id)) {
        alreadyAvailableReferenceCharacterIds.push(id);
        continue;
      }
      const hydrated = await this.hydrateReferenceSheetFromDisk(char);
      if (hydrated || imageAgentTeam.hasReferenceSheet(id)) {
        hydratedReferenceCharacterIds.push(id);
        continue;
      }

      this.deps.emit({
        type: 'warning',
        phase: 'reference_sheet',
        message: `Resume reference preflight missing ${char.name}; generating reference before story images continue.`,
        data: { characterId: id, characterName: char.name },
      });
      await this.deps.generateCharacterReferenceSheet(char, brief);
      const fingerprint = computeCharacterIdentityFingerprint(char);
      imageAgentTeam.setReferenceSheetIdentityFingerprint(char.id, fingerprint);
      if (imageAgentTeam.hasReferenceSheet(id)) {
        generatedReferenceCharacterIds.push(id);
      } else {
        missingReferenceCharacterIds.push(id);
      }
    }

    await saveEarlyDiagnostic(outputDirectory, 'image-reference-preflight.json', {
      generatedAt: new Date().toISOString(),
      plannedReferenceCharacterIds,
      alreadyAvailableReferenceCharacterIds,
      hydratedReferenceCharacterIds,
      generatedReferenceCharacterIds,
      missingReferenceCharacterIds,
      plannedReferenceCharacters: plannedReferenceCharacterIds.map((id) => {
        const char = characterBible.characters.find((candidate) => candidate.id === id);
        return { id, name: char?.name };
      }),
    });

    this.deps.emit({
      type: 'debug',
      phase: 'reference_sheet',
      message: `Resume reference preflight complete: ${alreadyAvailableReferenceCharacterIds.length + hydratedReferenceCharacterIds.length} available, ${generatedReferenceCharacterIds.length} generated, ${missingReferenceCharacterIds.length} missing.`,
      data: {
        plannedReferenceCharacterIds,
        alreadyAvailableReferenceCharacterIds,
        hydratedReferenceCharacterIds,
        generatedReferenceCharacterIds,
        missingReferenceCharacterIds,
      },
    });

    return {
      plannedReferenceCharacterIds,
      alreadyAvailableReferenceCharacterIds,
      hydratedReferenceCharacterIds,
      generatedReferenceCharacterIds,
      missingReferenceCharacterIds,
    };
  }
}
