/**
 * Casting references service (pure move from FullStoryPipeline).
 *
 * Read-only gathering of character visual identity for image generation:
 * compact appearance descriptions (silhouette hooks > visual anchors >
 * physicalDescription precedence), enriched reference-image packs with
 * canonical role tagging and per-character weights, and body vocabularies
 * for pose consistency.
 *
 * Run-scoped state (image services, reference caches, style anchors) is
 * injected as lazy reads so the service always sees the pipeline's live
 * values. Deps are fully typed — no Partial casts.
 */

import type { CharacterBible } from '../agents/CharacterDesigner';
import type { ImageAgentTeam } from '../agents/image-team/ImageAgentTeam';
import type { CharacterBodyVocabulary } from '../agents/image-team/CharacterReferenceSheetAgent';
import type {
  CharacterAppearanceDescription,
  ImageGenerationService,
  ReferenceImage,
} from '../services/imageGenerationService';
import type { ImageSlotFamily } from '../images/slotTypes';
import { buildReferencePack } from '../images/referencePackBuilder';
import { sanitizeStyleContaminationText } from '../images/imagePromptContracts';
import { buildFashionStyleSummary } from '../images/characterFashionStyle';
import type { PipelineEvent } from './events';
import {
  extractCanonicalAppearance,
  inferBasePostureFromPersonality,
  inferGestureStyleFromPersonality,
  normalizeCharacterIds,
} from './imageCasting';

export interface GatheredCharacterReference {
  data: string;
  mimeType: string;
  role: string;
  characterName: string;
  viewType: string;
  visualAnchors?: string[];
}

export interface CharacterBodyVocabularyEntry {
  characterId: string;
  characterName: string;
  basePosture: string;
  gestureStyle: string;
  characteristicPoses: string[];
  statusBehavior: string;
  emotionalTells: string;
}

/** Minimal slice of collectedVisualPlanning.characterReferences this service reads. */
export interface CollectedCharacterReference {
  characterName: string;
  bodyVocabulary?: CharacterBodyVocabulary;
}

export interface CastingReferencesDeps {
  imageService(): ImageGenerationService;
  imageAgentTeam(): ImageAgentTeam;
  characterReferences(): Map<string, CollectedCharacterReference>;
  locationMasterShots(): Map<string, { data: string; mimeType: string }>;
  styleAnchorPaths(): { character?: string; arcStrip?: string; environment?: string };
  uploadedStyleReferenceImages(): ReferenceImage[];
  shouldAttachCompositeCharacterRefs(): boolean;
  emit(event: Omit<PipelineEvent, 'timestamp'>): void;
}

export class CastingReferences {
  constructor(private readonly deps: CastingReferencesDeps) {}

  buildCharacterDescriptions(
    characterIds: string[],
    characterBible: CharacterBible
  ): CharacterAppearanceDescription[] {
    const imageAgentTeam = this.deps.imageAgentTeam();
    const descs: CharacterAppearanceDescription[] = [];
    for (const charId of normalizeCharacterIds(characterIds, characterBible)) {
      const c = characterBible.characters.find(ch => ch.id === charId);
      if (!c) continue;

      // Silhouette hooks come from the visual design system and are the canonical
      // visual identity. physicalDescription is LLM-generated from source material
      // and may contradict the visual design (e.g. wrong hair color). When both
      // exist, silhouette hooks take precedence as the primary description.
      const silhouette = imageAgentTeam.getCharacterSilhouetteProfile(c.id);
      const hasSilhouette = silhouette?.silhouetteHooks && silhouette.silhouetteHooks.length > 0;
      const consistencyInfo = imageAgentTeam.getCharacterConsistencyInfo(c.id);

      const parts: string[] = [];
      if (consistencyInfo?.visualAnchors?.length) {
        parts.push(consistencyInfo.visualAnchors.map(anchor => sanitizeStyleContaminationText(anchor).text).join(', '));
      } else if (hasSilhouette) {
        parts.push(silhouette!.silhouetteHooks!.map(hook => sanitizeStyleContaminationText(hook).text).join(', '));
      } else if (c.physicalDescription) {
        parts.push(sanitizeStyleContaminationText(c.physicalDescription).text);
      }
      if (c.distinctiveFeatures && c.distinctiveFeatures.length > 0) {
        parts.push(`Distinctive features: ${c.distinctiveFeatures.map(feature => sanitizeStyleContaminationText(feature).text).join(', ')}`);
      }
      if (c.typicalAttire) parts.push(`Attire: ${sanitizeStyleContaminationText(c.typicalAttire).text}`);
      const fashionSummary = buildFashionStyleSummary(c.fashionStyle);
      if (fashionSummary) parts.push(`Fashion details: ${sanitizeStyleContaminationText(fashionSummary).text}`);

      // Build a structured canonicalAppearance by extracting semantic slots
      // from the free-form description sources. Each slot becomes its own
      // labeled line in the identity block, which dramatically reduces the
      // LLM's tendency to drop or paraphrase critical attributes (hair color,
      // eye color, distinguishing marks).
      const sources: string[] = [
        ...(consistencyInfo?.visualAnchors || []),
        ...(silhouette?.silhouetteHooks || []),
        c.physicalDescription || '',
      ].filter(Boolean);
      const canonicalAppearance = extractCanonicalAppearance(
        sources,
        c.distinctiveFeatures,
        [c.typicalAttire, fashionSummary].filter(Boolean).join('; ') || undefined,
      );

      if (parts.length > 0 || canonicalAppearance) {
        descs.push({
          name: c.name,
          appearance: parts.join('. '),
          canonicalAppearance,
        });
      }
    }
    return descs;
  }

  /**
   * Gather enriched reference images for characters to pass to image generation.
   * Uses the cached reference sheets from ImageAgentTeam.
   * Returns enriched metadata (character name, view type, visual anchors) so
   * provider adapters can build optimal labels for each image.
   */
  gatherCharacterReferenceImages(
    characterIds: string[],
    characterBible: CharacterBible,
    locationId?: string,
    options?: { includeExpressions?: boolean; family?: ImageSlotFamily; slotId?: string }
  ): GatheredCharacterReference[] {
    const MAX_TOTAL_REFS = 12;
    const references: GatheredCharacterReference[] = [];
    const imageService = this.deps.imageService();
    const imageAgentTeam = this.deps.imageAgentTeam();

    const gemSettings = imageService.getGeminiSettings();
    const mjSettings = imageService.getMidjourneySettings();
    const maxPerChar = gemSettings.maxRefImagesPerCharacter || mjSettings.maxRefImagesPerCharacter || 2;
    // Dual-artifact routing: always request the individual views here. The
    // composite sheet is added separately below with a canonical
    // `composite-sheet` role so the per-provider filter can route it
    // correctly (Midjourney --cref, Gemini style-anchor).
    const preferIndividualViews = true;

    const normalizedCharacterIds = normalizeCharacterIds(characterIds, characterBible);

    for (const charId of normalizedCharacterIds) {
      if (references.length >= MAX_TOTAL_REFS) break;
      const remaining = MAX_TOTAL_REFS - references.length;
      const charRefs = imageAgentTeam.getCharacterReferenceImages(
        charId,
        options?.includeExpressions === true,
        Math.min(maxPerChar, remaining),
        undefined,
        preferIndividualViews
      );

      const consistencyInfo = imageAgentTeam.getCharacterConsistencyInfo(charId);
      const visualAnchors = consistencyInfo?.visualAnchors;

      const charEntry = characterBible.characters.find(c => c.id === charId);
      const characterName = charEntry?.name || charId;

      for (const ref of charRefs) {
        const nameParts = ref.name.split('-');
        const viewType = nameParts.length > 1 ? nameParts[nameParts.length - 1] : 'front';

        // Canonical role tagging so the per-provider filter can route by
        // artifact shape. `character-reference-face` keeps the face-crop
        // elevated in rolePriority; expression views keep the 'expression'
        // token so rolePriority routes them correctly.
        let role: string;
        if (viewType === 'face') {
          role = 'character-reference-face';
        } else if (ref.name.includes('expression')) {
          role = `character-reference-expression-${viewType}`;
        } else {
          role = 'character-reference';
        }

        references.push({
          data: ref.data,
          mimeType: ref.mimeType,
          role,
          characterName,
          viewType,
          visualAnchors,
        });
      }

      // Emit the composite model sheet only for providers that explicitly use
      // it as the scene identity anchor. In particular, GPT Image 2 should not
      // receive or even collect cached multi-view/composite sheets.
      if (this.deps.shouldAttachCompositeCharacterRefs() && references.length < MAX_TOTAL_REFS) {
        const composite = imageAgentTeam.getCompositeReferenceImage(charId);
        if (composite) {
          references.push({
            data: composite.data,
            mimeType: composite.mimeType,
            role: 'composite-sheet',
            characterName,
            viewType: 'composite',
            visualAnchors,
          });
        }
      }

      if (consistencyInfo) {
        this.deps.emit({ type: 'debug', phase: 'images', message: `Using ${charRefs.length} ref image(s) for ${characterName}: ${consistencyInfo.visualAnchors.join(', ')}` });
      }
    }

    // Include location master shot if available and within budget
    if (locationId && references.length < MAX_TOTAL_REFS) {
      const masterShot = this.deps.locationMasterShots().get(locationId);
      if (masterShot) {
        references.push({
          data: masterShot.data,
          mimeType: masterShot.mimeType,
          role: 'location-master-shot',
          characterName: '',
          viewType: 'location',
        });
      }
    }

    const anchorPaths = this.deps.styleAnchorPaths();
    const styleAnchorPaths = [
      { role: 'style-anchor-character', imagePath: anchorPaths.character },
      { role: 'style-anchor-arc-strip', imagePath: anchorPaths.arcStrip },
      { role: 'style-anchor-environment', imagePath: anchorPaths.environment },
    ].filter((entry) => !!entry.imagePath);
    for (const anchor of styleAnchorPaths) {
      if (references.length >= MAX_TOTAL_REFS) break;
      try {
        const fs = require('fs');
        if (!fs.existsSync(anchor.imagePath)) continue;
        const ext = String(anchor.imagePath).split('.').pop()?.toLowerCase();
        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
        references.push({
          data: fs.readFileSync(anchor.imagePath).toString('base64'),
          mimeType,
          role: anchor.role,
          characterName: '',
          viewType: 'style',
        });
      } catch { /* style anchors are helpful but non-fatal */ }
    }

    for (const styleRef of this.deps.uploadedStyleReferenceImages()) {
      if (references.length >= MAX_TOTAL_REFS) break;
      references.push(styleRef as any);
    }

    const family = options?.family;
    if (!family) {
      return references;
    }

    // D3: derive per-character weights from their bible importance. Weights
    // are multiplied against the profile's maxPerCharacter so major characters
    // get more ref-pack slots than supporting/minor ones.
    const characterWeights: Record<string, number> = {};
    for (const charId of normalizedCharacterIds) {
      const entry = characterBible.characters.find((c) => c.id === charId);
      if (!entry) continue;
      const name = entry.name || charId;
      const importance = (entry.importance || '').toLowerCase();
      if (entry.role?.toLowerCase() === 'protagonist' || importance === 'major') {
        characterWeights[name] = 1.5;
      } else if (importance === 'supporting') {
        characterWeights[name] = 1.0;
      } else if (importance === 'minor') {
        characterWeights[name] = 0.75;
      }
    }

    return buildReferencePack(
      options.slotId || `${family}:${characterIds.join(',')}`,
      family,
      references,
      { characterWeights },
    ).references as unknown as GatheredCharacterReference[];
  }

  /**
   * Gather body vocabularies for characters to pass to StoryboardAgent
   * Enables character-specific pose consistency
   */
  gatherCharacterBodyVocabularies(
    characterIds: string[],
    characterBible: CharacterBible
  ): CharacterBodyVocabularyEntry[] {
    const vocabularies: CharacterBodyVocabularyEntry[] = [];

    for (const charId of characterIds) {
      // Look up the body vocabulary from collected visual planning
      const charRef = this.deps.characterReferences().get(charId);

      if (charRef?.bodyVocabulary) {
        const bv = charRef.bodyVocabulary;
        // Extract descriptions from the structured objects
        const basePostureDesc = typeof bv.basePosture === 'object' && bv.basePosture?.description
          ? bv.basePosture.description
          : (typeof bv.basePosture === 'string' ? bv.basePosture : 'neutral standing');
        const gestureStyleDesc = typeof bv.gestureStyle === 'object' && bv.gestureStyle?.description
          ? bv.gestureStyle.description
          : (typeof bv.gestureStyle === 'string' ? bv.gestureStyle : 'moderate gestures');

        // Extract signature poses as simple descriptions
        const signaturePoses = bv.signaturePoses?.map((p: { poseDescription?: string; situation?: string }) =>
          p.poseDescription || p.situation || ''
        ).filter(Boolean) || [];

        // Build status behavior from statusDefaults
        const statusDefaults = bv.statusDefaults;
        const statusBehavior = statusDefaults
          ? `with superiors: ${statusDefaults.withSuperiors || 'respectful'}, with equals: ${statusDefaults.withEquals || 'collaborative'}, with subordinates: ${statusDefaults.withSubordinates || 'supportive'}`
          : 'adapts to social context';

        // Combine stress and comfort tells
        const stressTells = bv.stressTells || [];
        const comfortTells = bv.comfortTells || [];
        const emotionalTells = [
          stressTells.length > 0 ? `stress: ${stressTells.slice(0, 2).join(', ')}` : '',
          comfortTells.length > 0 ? `comfort: ${comfortTells.slice(0, 2).join(', ')}` : ''
        ].filter(Boolean).join('; ') || 'shows emotion through face and body language';

        vocabularies.push({
          characterId: charId,
          characterName: charRef.characterName,
          basePosture: basePostureDesc,
          gestureStyle: gestureStyleDesc,
          characteristicPoses: signaturePoses.slice(0, 3), // Limit to top 3
          statusBehavior,
          emotionalTells
        });
      } else {
        // Fallback: Try to get character info from bible and create minimal vocabulary
        const charProfile = characterBible.characters?.find((c: { id: string }) => c.id === charId);

        if (charProfile) {
          // Create a basic vocabulary based on traits and overview
          const personalityText = [
            ...(charProfile.traits || []),
            charProfile.overview || ''
          ].join(' ');
          vocabularies.push({
            characterId: charId,
            characterName: charProfile.name,
            basePosture: inferBasePostureFromPersonality(personalityText),
            gestureStyle: inferGestureStyleFromPersonality(personalityText),
            characteristicPoses: [],
            statusBehavior: 'adapts to social context',
            emotionalTells: 'shows emotion through face and body language'
          });
        }
      }
    }

    return vocabularies;
  }
}
