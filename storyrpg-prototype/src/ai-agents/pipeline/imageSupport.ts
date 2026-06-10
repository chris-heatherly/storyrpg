/**
 * Image support cluster: defect-retry rendering, style-bible anchors,
 * LoRA training, and the A3-narrow scene-opener prefetch.
 *
 * Faithful port of FullStoryPipeline.generateEpisodeStyleBible,
 * validateStyleAnchorPromptContract, generateImageWithDefectRetries,
 * coerceRetryIssues, saveImageQADiagnostic, validateGeneratedStyleAnchor,
 * saveStyleAnchorValidationDiagnostic, getOrCreateLoraTrainingAgent,
 * runLoraTrainingIfEligible, hydrateUploadedStyleReferences,
 * hydratePreapprovedAnchor, and prefetchSceneOpeningBeats (pure move).
 * Run-scoped state the rest of the pipeline reads (style anchor paths,
 * uploaded style references, the opening-beat prefetch map) stays owned by
 * the monolith and is shared via the deps; the LoRA agent/registry/banner
 * live here because nothing else reads them.
 *
 * Extracted from FullStoryPipeline to keep that monolith from growing.
 */

import { PipelineConfig, type PreapprovedAnchor } from '../config';
import { slugify as idSlugify } from '../utils/idUtils';
import {
  ColorScript,
  ImageAgentTeam,
  computeCharacterIdentityFingerprint,
} from '../agents/image-team/ImageAgentTeam';
import { ImagePrompt } from '../images/imageTypes';
import type { GeneratedImage } from '../images/imageTypes';
import {
  ImageGenerationService,
  ReferenceImage,
  type CharacterAppearanceDescription,
} from '../services/imageGenerationService';
import { AssetRegistry } from '../images/assetRegistry';
import { chooseSeasonStyleAnchor, type StyleAnchorValidationResult } from '../images/styleAnchorGate';
import { buildDefectRetryPrompt, type ImageDefectIssue } from '../images/imageDefectGate';
import { composeCanonicalStyleString } from '../images/artStyleProfile';
import {
  LoraTrainingAgent,
  type CharacterTrainingCandidate,
  type StyleTrainingCandidate,
} from '../agents/image-team/LoraTrainingAgent';
import {
  LoraRegistry,
  createNodeLoraRegistryIO,
} from '../images/loraRegistry';
import { createLoraTrainerAdapter } from '../services/lora-training/factory';
import { providerSupportsLoraTraining } from '../images/providerCapabilities';
import type { ImageSlotFamily } from '../images/slotTypes';
import { buildBeatImagePrompt, overrideShotFromPlan } from '../images/beatPromptBuilder';
import { CharacterStateTracker } from '../images/CharacterStateTracker';
import { type PanelMode } from '../images/shotSequencePlanner';
import { resolveShotCast } from '../images/shotCastResolver';
import { planSceneCoverage } from '../images/cinematicCoveragePlanner';
import { runTier1Checks } from '../images/visualValidation';
import {
  buildCharacterAnchorPrompt,
  buildArcStripAnchorPrompt,
  buildEnvironmentAnchorPrompt,
  anchorIdentifier,
} from '../images/anchorPrompts';
import {
  saveEarlyDiagnostic,
  loadBeatResumeStateSync,
} from '../utils/pipelineOutputWriter';
import { getLocationInfoForScene } from './planningHelpers';
import { withTimeout, PIPELINE_TIMEOUTS } from '../utils/withTimeout';
import { WorldBible } from '../agents/WorldBuilder';
import { CharacterBible } from '../agents/CharacterDesigner';
import { SceneContent } from '../agents/SceneWriter';
import type { PipelineEvent } from './events';
// Type-only import — erased at runtime, so no runtime cycle with the monolith.
import type { FullCreativeBrief } from './FullStoryPipeline';

export interface ImageSupportDeps {
  config: PipelineConfig;
  emit: (event: Omit<PipelineEvent, 'timestamp'>) => void;
  imageService: Pick<
    ImageGenerationService,
    | 'generateImage'
    | 'getMaxRetries'
    | 'checkImageForDefects'
    | 'saveImageQADiagnostic'
    | 'getStableDiffusionSettings'
    | 'updateStableDiffusionSettings'
    | 'setSeasonStyleReference'
  >;
  imageAgentTeam: Pick<ImageAgentTeam, 'generateColorScriptThumbnails' | 'getReferenceSheet'>;
  assetRegistry: Pick<AssetRegistry, 'getResolvedAsset'>;
  totalEpisodes: () => number;
  /** Run-scoped style anchor paths, owned by the monolith (mutated in place). */
  styleAnchorPaths: { character?: string; arcStrip?: string; environment?: string };
  /** Run-scoped opening-beat prefetch results, owned by the monolith (mutated in place). */
  openingBeatPrefetch: Map<string, GeneratedImage>;
  setUploadedStyleReferenceImages: (refs: ReferenceImage[]) => void;
  setGeneratedStyleReferencesAllowed: (allowed: boolean) => void;
  resolveProtagonistCharacterId: (characterBible: CharacterBible, brief: FullCreativeBrief) => string | null;
  resolveCharacterIdWithBrief: (idOrName: string, characterBible: CharacterBible, brief: FullCreativeBrief) => string | null;
  gatherCharacterReferenceImages: (
    characterIds: string[],
    characterBible: CharacterBible,
    locationId?: string,
    options?: { includeExpressions?: boolean; family?: ImageSlotFamily; slotId?: string }
  ) => Array<{ data: string; mimeType: string; role: string; characterName: string; viewType: string; visualAnchors?: string[] }>;
  buildCharacterDescriptions: (
    characterIds: string[],
    characterBible: CharacterBible
  ) => CharacterAppearanceDescription[];
  ensureCharacterReferencesForVisibleCharacters: (
    ids: string[] | undefined,
    characterBible: CharacterBible,
    brief: FullCreativeBrief,
    contextLabel: string,
  ) => Promise<string[]>;
  getCharacterIdsInScene: (scene: SceneContent, characterBible: CharacterBible, protagonistId?: string) => string[];
  extractSceneContext: (
    scene: SceneContent,
    sceneIndex: number,
    totalScenes: number,
    worldBible: WorldBible
  ) => {
    isClimactic: boolean;
    isResolution: boolean;
    isFlashback: boolean;
    isNightmare: boolean;
    isSafeHubScene: boolean;
    branchType: 'dark' | 'hopeful' | 'neutral';
    timeOfDay?: 'dawn' | 'day' | 'dusk' | 'night';
  };
  analyzeBeatCharacters: (
    beatText: string,
    beatSpeaker: string | undefined,
    sceneCharacterIds: string[],
    characterBible: CharacterBible,
    protagonistId: string
  ) => { foreground: string[]; background: string[]; foregroundNames: string[]; backgroundNames: string[] };
  isEstablishingBeat: (
    beatText: string,
    speaker: string | undefined,
    primaryAction: string | undefined,
    beatCharContext: { foreground: string[]; foregroundNames: string[] }
  ) => boolean;
  sanitizePromptText: (raw: unknown, brief: FullCreativeBrief, fallback?: string) => string;
  sanitizeImagePrompt: (prompt: ImagePrompt, brief: FullCreativeBrief) => ImagePrompt;
  getEpisodeScopedSceneId: (brief: FullCreativeBrief, sceneId: string) => string;
}

export class ImageSupport {
  /** Lazily constructed once per run; nothing outside this cluster reads these. */
  private loraTrainingAgent?: LoraTrainingAgent;
  private loraRegistry?: LoraRegistry;
  private loraTrainingBanner = false;

  constructor(private deps: ImageSupportDeps) {}

  /**
   * Generate a dedicated episode style bible before scene renders begin.
   * This becomes the primary style anchor, replacing the old
   * "first successful scene decides the style" behavior whenever possible.
   */
  async generateEpisodeStyleBible(
    brief: FullCreativeBrief,
    colorScript: ColorScript,
    characterBible: CharacterBible,
    outputDirectory?: string
  ): Promise<boolean> {
    this.deps.emit({ type: 'agent_start', agent: 'ColorScriptAgent', message: 'Generating episode style bible...' });

    try {
      // The user's raw style prompt is the season-level style contract. The
      // structured profile can fill gaps, but it must not replace the user's
      // explicit rendering and lighting vocabulary.
      const profileStyle =
        this.deps.config.artStyle ||
        composeCanonicalStyleString(this.deps.config.imageGen?.artStyleProfile) ||
        undefined;

      const titleSlug = idSlugify(brief.story.title);
      const preapproved = this.deps.config.imageGen?.preapprovedStyleAnchors;
      const uploadedStyleReferences = await this.hydrateUploadedStyleReferences(
        this.deps.config.imageGen?.uploadedStyleReferences,
      );
      this.deps.setUploadedStyleReferenceImages(uploadedStyleReferences);

      // === Arc color strip ===
      let stripImage: GeneratedImage | undefined;
      if (preapproved?.arcStrip) {
        stripImage = await this.hydratePreapprovedAnchor(preapproved.arcStrip);
        if (preapproved.arcStrip.imagePath) {
          this.deps.styleAnchorPaths.arcStrip = preapproved.arcStrip.imagePath;
        }
        this.deps.emit({
          type: 'info',
          phase: 'images',
          message: 'Style bible arc strip: using UI-preapproved anchor (skipping in-pipeline generation).',
        });
      } else {
        const thumbsResult = await withTimeout(
          this.deps.imageAgentTeam.generateColorScriptThumbnails(colorScript),
          PIPELINE_TIMEOUTS.colorScript,
          'ColorScriptThumbnails'
        );

        if (!thumbsResult.success || !thumbsResult.data) {
          this.deps.emit({ type: 'warning', phase: 'images', message: `Style bible prompt generation failed: ${thumbsResult.error || 'unknown error'}` });
          return false;
        }

        const built = buildArcStripAnchorPrompt({
          style: profileStyle,
          storyTitle: brief.story.title,
          stripPrompt: thumbsResult.data.stripPrompt,
        });
        stripImage = await withTimeout(
          this.deps.imageService.generateImage(
            built.prompt,
            anchorIdentifier(titleSlug, built.role),
            { type: 'master' },
            uploadedStyleReferences.length > 0 ? uploadedStyleReferences : undefined,
          ),
          PIPELINE_TIMEOUTS.imageGeneration,
          'EpisodeStyleBibleStrip'
        );
        if (stripImage?.imagePath) {
          this.deps.styleAnchorPaths.arcStrip = stripImage.imagePath;
        }
      }

      // === Character anchor ===
      const protagonistId = this.deps.resolveProtagonistCharacterId(characterBible, brief)
        || this.deps.resolveCharacterIdWithBrief(brief.protagonist.id || brief.protagonist.name, characterBible, brief)
        || this.deps.resolveCharacterIdWithBrief(brief.protagonist.name, characterBible, brief)
        || brief.protagonist.id;
      const protagonistRefImages = this.deps.gatherCharacterReferenceImages([protagonistId], characterBible);
      const protagonistName = characterBible.characters.find(c => c.id === protagonistId)?.name || brief.protagonist.name;
      const protagonistDescriptions = this.deps.buildCharacterDescriptions([protagonistId], characterBible);
      const colorTerms = colorScript.colorDictionary.slice(0, 3).map(entry => entry.color);

      let anchorImage: GeneratedImage;
      if (preapproved?.character) {
        anchorImage = await this.hydratePreapprovedAnchor(preapproved.character);
        if (preapproved.character.imagePath) {
          this.deps.styleAnchorPaths.character = preapproved.character.imagePath;
        }
        this.deps.emit({
          type: 'info',
          phase: 'images',
          message: 'Style bible character anchor: using UI-preapproved anchor (skipping in-pipeline generation).',
        });
      } else {
        const built = buildCharacterAnchorPrompt({
          style: profileStyle,
          protagonistName,
          colorTerms,
          protagonistDescription: protagonistDescriptions
            .map(desc => desc.canonicalAppearance || desc.appearance)
            .filter(Boolean)
            .join(' '),
        });
        anchorImage = await this.generateImageWithDefectRetries(
          built.prompt,
          anchorIdentifier(titleSlug, built.role),
          {
            type: 'master',
            characters: [protagonistId],
            characterNames: [protagonistName],
            characterDescriptions: protagonistDescriptions,
          },
          protagonistRefImages.length > 0 ? protagonistRefImages : undefined,
          'EpisodeStyleBibleCharacterAnchor',
          outputDirectory,
        );
        if (anchorImage?.imagePath) {
          this.deps.styleAnchorPaths.character = anchorImage.imagePath;
        }
      }

      // === Environment anchor (optional) ===
      // Gated behind EXPO_PUBLIC_STYLE_BIBLE_RICH for in-pipeline generation.
      // A UI-preapproved environment anchor always wins regardless of the flag.
      const env = typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);
      const richSamplesEnabled =
        env.EXPO_PUBLIC_STYLE_BIBLE_RICH === 'true' || env.EXPO_PUBLIC_STYLE_BIBLE_RICH === '1';
      let environmentAnchorImage: GeneratedImage | undefined;
      if (preapproved?.environment) {
        try {
          environmentAnchorImage = await this.hydratePreapprovedAnchor(preapproved.environment);
          if (preapproved.environment.imagePath) {
            this.deps.styleAnchorPaths.environment = preapproved.environment.imagePath;
          }
          this.deps.emit({
            type: 'info',
            phase: 'images',
            message: 'Style bible environment anchor: using UI-preapproved anchor (skipping in-pipeline generation).',
          });
        } catch (envErr) {
          this.deps.emit({
            type: 'warning',
            phase: 'images',
            message: `Preapproved environment anchor hydration failed (non-fatal): ${envErr instanceof Error ? envErr.message : String(envErr)}`,
          });
        }
      } else if (richSamplesEnabled) {
        try {
          const primaryLocation = brief.world.keyLocations[0];
          const built = buildEnvironmentAnchorPrompt({
            style: profileStyle,
            storyTitle: brief.story.title,
            locationName: primaryLocation?.name,
            toneTerms: colorScript.colorDictionary.slice(0, 2).map(e => e.color),
          });
          environmentAnchorImage = await withTimeout(
            this.deps.imageService.generateImage(
              built.prompt,
              anchorIdentifier(titleSlug, built.role),
              { type: 'master' as const },
              uploadedStyleReferences.length > 0 ? uploadedStyleReferences : undefined,
            ),
            PIPELINE_TIMEOUTS.imageGeneration,
            'EpisodeStyleBibleEnvironmentAnchor'
          );
          if (environmentAnchorImage?.imagePath) {
            this.deps.styleAnchorPaths.environment = environmentAnchorImage.imagePath;
          }
        } catch (envErr) {
          this.deps.emit({
            type: 'warning',
            phase: 'images',
            message: `C3 rich style bible: environment anchor failed (non-fatal): ${envErr instanceof Error ? envErr.message : String(envErr)}`,
          });
        }
      }

      const shouldValidateGeneratedCharacterAnchor =
        !preapproved?.character && uploadedStyleReferences.length === 0;
      const generatedCharacterValidation = shouldValidateGeneratedCharacterAnchor
        ? await this.validateGeneratedStyleAnchor(
            anchorIdentifier(titleSlug, 'character-anchor'),
            anchorImage,
            anchorImage.prompt || buildCharacterAnchorPrompt({ style: profileStyle, protagonistName, colorTerms }).prompt,
            outputDirectory,
          )
        : undefined;

      const uploadedPreferredAnchor = uploadedStyleReferences[0]?.data && uploadedStyleReferences[0]?.mimeType
        ? {
            prompt: { prompt: '' } as ImagePrompt,
            imageUrl: uploadedStyleReferences[0].url,
            imageData: uploadedStyleReferences[0].data,
            mimeType: uploadedStyleReferences[0].mimeType,
            metadata: { format: 'uploaded-style-reference' },
          } as GeneratedImage
        : undefined;
      const preapprovedCharacterAnchor = preapproved?.character && anchorImage?.imageData && anchorImage?.mimeType
        ? anchorImage
        : undefined;
      const generatedCharacterAnchor = anchorImage?.imageData && anchorImage?.mimeType
        ? anchorImage
        : undefined;
      const styleAnchorDecision = chooseSeasonStyleAnchor({
        preapprovedCharacterAnchor,
        uploadedStyleReference: uploadedPreferredAnchor,
        generatedCharacterAnchor,
        generatedCharacterValidation,
      });
      const preferredAnchor = styleAnchorDecision.anchor;

      if (!preferredAnchor?.imageData || !preferredAnchor?.mimeType) {
        if (styleAnchorDecision.rejectedGeneratedAnchor) {
          this.deps.setGeneratedStyleReferencesAllowed(false);
          this.deps.emit({
            type: 'warning',
            phase: 'images',
            message: `Style bible character anchor rejected: ${styleAnchorDecision.rejectionReason || 'off-style'}; using raw text style only.`,
            data: { validation: generatedCharacterValidation },
          });
        } else {
          this.deps.emit({ type: 'warning', phase: 'images', message: 'Episode style bible did not produce an approved reusable image anchor. Continuing with raw text style only.' });
        }
        return false;
      }

      this.deps.imageService.setSeasonStyleReference(preferredAnchor.imageData, preferredAnchor.mimeType);
      this.deps.emit({
        type: 'agent_complete',
        agent: 'ColorScriptAgent',
        message: 'Episode style bible ready and stored as the primary style anchor.',
        data: {
          stripGenerated: !!stripImage?.imageUrl,
          characterAnchorGenerated: !!anchorImage?.imageUrl,
          environmentAnchorGenerated: !!environmentAnchorImage?.imageUrl,
          richSamplesEnabled,
          preapprovedAnchorsUsed: {
            character: !!preapproved?.character,
            arcStrip: !!preapproved?.arcStrip,
            environment: !!preapproved?.environment,
          },
          uploadedStyleReferenceCount: uploadedStyleReferences.length,
          styleAnchorSource: styleAnchorDecision.source,
          generatedCharacterValidation,
        }
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.emit({ type: 'warning', phase: 'images', message: `Episode style bible generation failed: ${message}` });
      return false;
    }
  }

  private validateStyleAnchorPromptContract(
    identifier: string,
    prompt: ImagePrompt,
    rawStyle?: string,
  ): StyleAnchorValidationResult {
    const style = prompt.style?.trim() || '';
    const expectedStyle = rawStyle?.trim() || '';
    if (!style) {
      return { passed: false, reason: 'style anchor prompt is missing prompt.style', issues: ['missing prompt.style'], allowedAsStyleReference: false };
    }
    if (expectedStyle && style !== expectedStyle) {
      return { passed: false, reason: 'style anchor prompt.style does not match the raw season style', issues: ['prompt.style mismatch'], allowedAsStyleReference: false };
    }

    const positiveText = [
      prompt.prompt,
      prompt.composition,
      prompt.visualNarrative,
      prompt.keyExpression,
      prompt.keyBodyLanguage,
    ].filter(Boolean).join('\n');
    const negativeText = prompt.negativePrompt || '';
    const issues: string[] = [];
    if (/\b(cinematic story frame|style bible anchor|reference sheet|model sheet)\b/i.test(positiveText)) {
      issues.push('positive prompt contains generic style-bible/model-sheet wording');
    }
    if (/\b(reference sheet|model sheet)\b/i.test(negativeText)) {
      issues.push('negative prompt contains reference/model-sheet wording that can bias Gemini');
    }
    if (issues.length > 0) {
      return { passed: false, reason: issues.join('; '), issues, allowedAsStyleReference: false };
    }
    return { passed: true, score: 100, reason: 'prompt contract passed', issues: [], allowedAsStyleReference: true };
  }

  async generateImageWithDefectRetries(
    prompt: ImagePrompt,
    identifier: string,
    metadata: any,
    referenceImages: any[] | undefined,
    label: string,
    outputDirectory?: string,
    renderImage?: (activePrompt: ImagePrompt, attemptIdentifier: string, attemptMetadata: any, attemptReferences: any[] | undefined) => Promise<GeneratedImage>,
  ): Promise<GeneratedImage> {
    const maxRetries = Math.max(1, this.deps.imageService.getMaxRetries?.() || 1);
    const attempts: Array<{
      attempt: number;
      identifier: string;
      passed: boolean;
      issues: string[];
      reason?: string;
      imagePath?: string;
      imageUrl?: string;
      skipped?: boolean;
    }> = [];
    let activePrompt = prompt;
    let lastReason = '';

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const attemptIdentifier = attempt === 1 ? identifier : `${identifier}-qa-retry-${attempt}`;
      const attemptMetadata = {
        ...(metadata || {}),
        regeneration: attempt > 1 ? attempt - 1 : metadata?.regeneration,
      };
      const result = await withTimeout(
        renderImage
          ? renderImage(activePrompt, attemptIdentifier, attemptMetadata, referenceImages)
          : this.deps.imageService.generateImage(
              activePrompt,
              attemptIdentifier,
              attemptMetadata,
              referenceImages,
            ),
        PIPELINE_TIMEOUTS.imageGeneration,
        attempt === 1 ? label : `${label}-qa-retry-${attempt}`,
      );

      const tier1 = runTier1Checks(result, attemptIdentifier);
      let passed = tier1.passed;
      let issues: string[] = tier1.passed ? [] : ['tier1'];
      let reason = tier1.reason || 'passed';
      let skipped = false;

      if (passed && result.imageData && result.mimeType) {
        const defect = await withTimeout(
          this.deps.imageService.checkImageForDefects(result.imageData, result.mimeType, activePrompt, attemptIdentifier),
          PIPELINE_TIMEOUTS.imageGeneration,
          `imageDefectQA(${attemptIdentifier})`,
        );
        passed = defect.passed || defect.skipped === true;
        issues = defect.issues || [];
        reason = defect.reason || (passed ? 'defect gate passed' : 'defect gate failed');
        skipped = defect.skipped === true;
      }

      attempts.push({
        attempt,
        identifier: attemptIdentifier,
        passed,
        issues,
        reason,
        skipped,
        imagePath: result.imagePath,
        imageUrl: result.imageUrl,
      });
      await this.saveImageQADiagnostic(outputDirectory, identifier, maxRetries, attempts);

      if (passed) return result;

      lastReason = reason;
      if (attempt < maxRetries) {
        const retryIssues = this.coerceRetryIssues(issues);
        const patch = buildDefectRetryPrompt(prompt, retryIssues);
        activePrompt = patch.prompt;
        this.deps.emit({
          type: 'warning',
          phase: 'images',
          message: `Image defect detected for ${identifier}: ${issues.join(', ') || reason}; retry ${attempt + 1}/${maxRetries}`,
          data: { identifier, issues, reason, attempt, maxRetries },
        });
      }
    }

    throw new Error(`Image defect QA failed for ${identifier}: ${lastReason || 'unknown defect'}`);
  }

  private coerceRetryIssues(issues: string[]): ImageDefectIssue[] {
    const allowed = new Set<ImageDefectIssue>([
      'visible_text',
      'extra_limbs',
      'duplicate_body',
      'floating_character',
      'panel_leakage',
      'reference_sheet_artifact',
      'photorealism',
      'environment_photorealism',
      'style_drift',
      'first_person_pov',
    ]);
    const normalized = issues.filter((issue): issue is ImageDefectIssue => allowed.has(issue as ImageDefectIssue));
    return normalized.length > 0
      ? normalized
      : ['visible_text', 'extra_limbs', 'duplicate_body', 'floating_character', 'panel_leakage', 'reference_sheet_artifact', 'photorealism', 'environment_photorealism', 'style_drift', 'first_person_pov'];
  }

  private async saveImageQADiagnostic(
    outputDirectory: string | undefined,
    identifier: string,
    maxRetries: number,
    attempts: unknown[],
  ): Promise<void> {
    const payload = {
      identifier,
      generatedAt: new Date().toISOString(),
      maxRetries,
      attempts,
    };
    try {
      if (outputDirectory) {
        await saveEarlyDiagnostic(outputDirectory, `images/prompts/${identifier}.qa.json`, payload);
      } else {
        await this.deps.imageService.saveImageQADiagnostic?.(identifier, payload);
      }
    } catch (error) {
      this.deps.emit({
        type: 'warning',
        phase: 'images',
        message: `Failed to save image QA diagnostic for ${identifier}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async validateGeneratedStyleAnchor(
    identifier: string,
    anchorImage: GeneratedImage | undefined,
    prompt: ImagePrompt,
    outputDirectory?: string,
  ): Promise<StyleAnchorValidationResult> {
    const promptContract = this.validateStyleAnchorPromptContract(identifier, prompt, this.deps.config.artStyle);
    if (!promptContract.passed) {
      await this.saveStyleAnchorValidationDiagnostic(outputDirectory, identifier, promptContract);
      return promptContract;
    }
    if (!anchorImage?.imageData || !anchorImage?.mimeType) {
      const result: StyleAnchorValidationResult = {
        passed: false,
        reason: 'generated style anchor has no image data for vision validation',
        issues: ['missing imageData or mimeType'],
        allowedAsStyleReference: false,
      };
      await this.saveStyleAnchorValidationDiagnostic(outputDirectory, identifier, result);
      return result;
    }

    try {
      const { BaseAgent } = await import('../agents/BaseAgent');
      class StyleAnchorVisionJudge extends BaseAgent {
        constructor(config: any) { super('Style Anchor Vision Judge', config); }
        protected getAgentSpecificPrompt(): string { return ''; }
        async execute(_input: any): Promise<any> { throw new Error('Use callLLM directly'); }
      }

      const judge = new StyleAnchorVisionJudge({
        ...this.deps.config.agents.storyArchitect,
        maxTokens: 768,
        temperature: 0.1,
      });
      const rawStyle = this.deps.config.artStyle || prompt.style || '';
      const response = await (judge as any).callLLM([
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: `Review this generated style anchor image against the authoritative raw season art style.

AUTHORITATIVE RAW STYLE:
${rawStyle}

PROMPT USED:
${prompt.prompt || ''}

Judge only visual style fidelity: rendering style, lighting treatment, linework, palette, finish, and whether forbidden negatives are present. Do not judge story content.

Return ONLY valid JSON:
{
  "passed": boolean,
  "score": number,
  "reason": "one concise sentence",
  "issues": ["short issue", "..."]
}

Pass only if score is 80 or higher and the image clearly follows the authoritative raw style. Fail if it uses a renderer, finish, palette, or texture language that is visibly inconsistent with the raw style.`,
            },
            {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: anchorImage.mimeType,
                data: anchorImage.imageData,
              },
            },
          ],
        },
      ], 1);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('vision judge returned no JSON');
      }
      const parsed = JSON.parse(jsonMatch[0]);
      const score = typeof parsed.score === 'number' ? parsed.score : 0;
      const result: StyleAnchorValidationResult = {
        passed: parsed.passed === true && score >= 80,
        score,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'style anchor vision review completed',
        issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      };
      result.allowedAsStyleReference = result.passed === true;
      await this.saveStyleAnchorValidationDiagnostic(outputDirectory, identifier, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isAuthOrConfig =
        /invalid x-api-key|api key|authentication|unauthorized|permission|missing key|401|403/i.test(message);
      const result: StyleAnchorValidationResult = {
        passed: false,
        skipped: isAuthOrConfig,
        allowedAsStyleReference: false,
        reason: isAuthOrConfig
          ? `style anchor vision validation unavailable: ${message}`
          : `style anchor vision validation failed: ${message}`,
        issues: [isAuthOrConfig ? 'vision validation unavailable' : 'vision validation error'],
      };
      await this.saveStyleAnchorValidationDiagnostic(outputDirectory, identifier, result);
      return result;
    }
  }

  private async saveStyleAnchorValidationDiagnostic(
    outputDirectory: string | undefined,
    identifier: string,
    result: StyleAnchorValidationResult,
  ): Promise<void> {
    if (!outputDirectory) return;
    try {
      await saveEarlyDiagnostic(outputDirectory, `images/prompts/${identifier}.validation.json`, {
        identifier,
        generatedAt: new Date().toISOString(),
        ...result,
      });
    } catch (error) {
      this.deps.emit({
        type: 'warning',
        phase: 'images',
        message: `Failed to save style anchor validation diagnostic for ${identifier}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Lazily construct (or return) the `LoraTrainingAgent` for this run.
   * Returns `undefined` when the active image provider does not support LoRA
   * inference (non-SD) or when the subsystem is disabled — callers should
   * treat `undefined` as "skip LoRA training transparently".
   *
   * The registry is rooted under the current run's output directory
   * (`<outputDirectory>/loras/`) so trained artifacts are co-located with
   * the rest of the generation outputs and can be pruned together.
   */
  private getOrCreateLoraTrainingAgent(
    storyId: string,
    outputDirectory?: string,
  ): LoraTrainingAgent | undefined {
    const settings = this.deps.config.imageGen?.loraTraining;
    if (!settings || !settings.enabled) return undefined;
    const provider = (this.deps.config.imageGen?.provider || 'nano-banana') as import('../config').ImageProvider;
    if (!providerSupportsLoraTraining(provider)) return undefined;
    if (this.loraTrainingAgent) return this.loraTrainingAgent;

    // Pick a registry root. Prefer `<outputDirectory>/loras/` when we have
    // one; fall back to a workspace-relative `generated-stories/<storyId>/loras`
    // directory so callers that never passed outputDirectory still get a
    // stable path (the registry auto-creates it on first write).
    const registryRoot = outputDirectory
      ? (outputDirectory.endsWith('/') ? `${outputDirectory}loras` : `${outputDirectory}/loras`)
      : `generated-stories/${storyId}/loras`;

    let io;
    try {
      io = createNodeLoraRegistryIO();
    } catch {
      // Non-Node environments (native RN) can't train LoRAs today — surface
      // this once as a warning and disable the agent for the run.
      if (!this.loraTrainingBanner) {
        this.loraTrainingBanner = true;
        this.deps.emit({
          type: 'warning',
          phase: 'images',
          message: 'LoRA training enabled but filesystem access is unavailable in this runtime — skipping training.',
        });
      }
      return undefined;
    }

    const registry = new LoraRegistry(storyId, registryRoot, io);
    const adapter = createLoraTrainerAdapter({
      backend: settings.backend,
      kohya: {
        proxyBaseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
      },
    });
    const agent = new LoraTrainingAgent({
      storyId,
      provider,
      settings,
      adapter,
      registry,
      onProgress: (event) => {
        if (event.type === 'start') {
          this.deps.emit({ type: 'agent_start', agent: 'LoraTrainingAgent', message: `Training ${event.kind} LoRA for ${event.name}…` });
        } else if (event.type === 'complete') {
          this.deps.emit({ type: 'agent_complete', agent: 'LoraTrainingAgent', message: `Trained ${event.kind} LoRA ${event.record.name}.` });
        } else if (event.type === 'skip') {
          this.deps.emit({ type: 'debug', phase: 'images', message: `LoRA skip (${event.kind}/${event.name}): ${event.reason}` });
        } else if (event.type === 'fail') {
          this.deps.emit({ type: 'warning', phase: 'images', message: `LoRA training failed (${event.kind}/${event.name}): ${event.reason}` });
        }
      },
    });
    this.loraTrainingAgent = agent;
    this.loraRegistry = registry;
    return agent;
  }

  /**
   * Trigger character + style LoRA training once the reference sheets and
   * style-bible anchors exist. Safe to call multiple times per run — the
   * registry's fingerprint-keyed cache short-circuits anything that was
   * already trained.
   *
   * Newly registered artifacts are merged back into
   * `StableDiffusionSettings.styleLoras` / `.characterLoraByName` via
   * `imageService.updateStableDiffusionSettings` so the existing
   * `buildSDPrompt` path emits `<lora:...>` tags on subsequent scene
   * generation with no additional surgery.
   */
  async runLoraTrainingIfEligible(
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    outputDirectory?: string,
  ): Promise<void> {
    const storyId = idSlugify(brief.story.title) || 'story';
    const agent = this.getOrCreateLoraTrainingAgent(storyId, outputDirectory);
    if (!agent || !agent.shouldRun()) return;

    if (!this.loraTrainingBanner) {
      this.loraTrainingBanner = true;
      this.deps.emit({
        type: 'info',
        phase: 'images',
        message: `LoRA training enabled (backend=${agent.settings.backend}); checking candidates…`,
      });
    }

    // Load any artifacts persisted by previous runs of the same story.
    try {
      await this.loraRegistry?.load();
    } catch (err) {
      this.deps.emit({
        type: 'debug',
        phase: 'images',
        message: `LoRA registry load non-fatal: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Build character candidates from the cached reference sheets.
    const seen = new Set<string>();
    const characters: CharacterTrainingCandidate[] = [];
    for (const char of characterBible.characters) {
      if (seen.has(char.id)) continue;
      seen.add(char.id);
      const sheet = this.deps.imageAgentTeam.getReferenceSheet(char.id);
      if (!sheet) continue;
      const references: { viewKey: string; imagePath?: string }[] = [];
      for (const [viewKey, image] of sheet.generatedImages.entries()) {
        if (image?.imagePath) {
          references.push({ viewKey, imagePath: image.imagePath });
        }
      }
      if (references.length === 0) continue;
      const identityFingerprint = sheet.identityFingerprint || computeCharacterIdentityFingerprint(char);
      characters.push({
        character: {
          id: char.id,
          name: char.name,
          role: char.role,
          tier: (char.importance || '').toLowerCase(),
          physicalDescription: char.physicalDescription,
          distinctiveFeatures: char.distinctiveFeatures,
          typicalAttire: char.typicalAttire,
          fashionStyle: char.fashionStyle,
        },
        identityFingerprint,
        references,
      });
    }

    // Build the style candidate from the current anchor paths. We
    // fingerprint on the paths themselves (stable across rerenders if the
    // anchors haven't been regenerated) — a future improvement is to hash
    // the file bytes directly. `anchorHashes` is intentionally simple here
    // and stays compatible with `computeStyleLoraFingerprint`.
    const profile = this.deps.config.imageGen?.artStyleProfile;
    let style: StyleTrainingCandidate | undefined;
    if (profile) {
      const anchors: { role: string; imagePath?: string }[] = [];
      if (this.deps.styleAnchorPaths.character) anchors.push({ role: 'character', imagePath: this.deps.styleAnchorPaths.character });
      if (this.deps.styleAnchorPaths.arcStrip) anchors.push({ role: 'arcStrip', imagePath: this.deps.styleAnchorPaths.arcStrip });
      if (this.deps.styleAnchorPaths.environment) anchors.push({ role: 'environment', imagePath: this.deps.styleAnchorPaths.environment });
      if (anchors.length > 0) {
        style = {
          profile,
          anchors,
          anchorHashes: anchors.map((a) => a.imagePath || a.role),
          episodeCount: this.deps.totalEpisodes(),
        };
      }
    }

    if (characters.length === 0 && !style) {
      this.deps.emit({ type: 'debug', phase: 'images', message: 'LoRA training: no eligible candidates this run.' });
      return;
    }

    // Drop any previously-trained artifacts whose fingerprint no longer
    // matches the current characters/style. Mirrors
    // `invalidateStaleReferenceSheets` on the character-sheet side.
    try {
      const removed = await agent.invalidateStaleLoras(characters, style);
      if (removed.length > 0) {
        this.deps.emit({
          type: 'debug',
          phase: 'images',
          message: `LoRA registry: invalidated ${removed.length} stale record(s): ${removed.map((r) => r.name).join(', ')}`,
        });
      }
    } catch (invalidateErr) {
      this.deps.emit({
        type: 'debug',
        phase: 'images',
        message: `LoRA invalidate pass threw (non-fatal): ${invalidateErr instanceof Error ? invalidateErr.message : String(invalidateErr)}`,
      });
    }

    const report = await agent.trainAll(characters, style);
    if (!report.ran) return;

    // Merge the registry back into SD settings so subsequent scene image
    // prompts emit `<lora:...>` tags automatically.
    const existing = this.deps.imageService.getStableDiffusionSettings();
    const merged = agent.mergeSettings(existing);
    this.deps.imageService.updateStableDiffusionSettings(merged);
    this.deps.emit({
      type: 'debug',
      phase: 'images',
      message: `LoRA training report: ${report.entries
        .map((e) => `${e.kind}/${e.name}=${e.outcome}`)
        .join(', ')}`,
    });
  }

  /**
   * Turn a PreapprovedAnchor (inline base64 or on-disk path) into a
   * `GeneratedImage` shape compatible with the rest of the style-bible
   * bookkeeping — specifically the later `setSeasonStyleReference` call
   * which needs `imageData` + `mimeType`.
   */
  async hydrateUploadedStyleReferences(
    anchors: PreapprovedAnchor[] | undefined,
  ): Promise<ReferenceImage[]> {
    if (!anchors?.length) return [];

    const refs: ReferenceImage[] = [];
    for (const [index, anchor] of anchors.entries()) {
      try {
        const image = await this.hydratePreapprovedAnchor(anchor);
        if (!image.imageData || !image.mimeType) continue;
        refs.push({
          data: image.imageData,
          mimeType: image.mimeType,
          role: 'style-anchor',
          viewType: `uploaded-${index + 1}`,
          url: image.imageUrl,
        });
      } catch (err) {
        this.deps.emit({
          type: 'warning',
          phase: 'images',
          message: `Uploaded style reference ${index + 1} could not be read and will be skipped: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    if (refs.length > 0) {
      this.deps.emit({
        type: 'info',
        phase: 'images',
        message: `Using ${refs.length} uploaded style reference image(s) to seed the style bible.`,
      });
    }

    return refs;
  }

  private async hydratePreapprovedAnchor(
    anchor: PreapprovedAnchor,
  ): Promise<GeneratedImage> {
    if (!anchor) {
      throw new Error('hydratePreapprovedAnchor called with empty anchor');
    }
    if (anchor.data && anchor.mimeType) {
      return {
        prompt: { prompt: '' } as ImagePrompt,
        imagePath: anchor.imagePath,
        imageUrl: undefined,
        imageData: anchor.data,
        mimeType: anchor.mimeType,
        metadata: { format: 'preapproved-anchor' },
      };
    }
    if (anchor.imagePath) {
      try {
        const fs = await import('fs/promises');
        const buffer = await fs.readFile(anchor.imagePath);
        const b64 = buffer.toString('base64');
        const lower = anchor.imagePath.toLowerCase();
        const mimeType = lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? 'image/jpeg'
          : lower.endsWith('.webp')
          ? 'image/webp'
          : 'image/png';
        return {
          prompt: { prompt: '' } as ImagePrompt,
          imagePath: anchor.imagePath,
          imageUrl: undefined,
          imageData: b64,
          mimeType,
          metadata: { format: 'preapproved-anchor' },
        };
      } catch (err) {
        throw new Error(
          `Failed to read preapproved anchor from disk (${anchor.imagePath}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    throw new Error('Preapproved anchor has neither inline data nor an imagePath');
  }

  /**
   * A3 (narrow): optionally prefetch scene-opening beat images in parallel
   * before the main scene loop runs. This overlaps opening-beat latency
   * across scenes while keeping D10's per-scene continuity invariant
   * intact — mid-scene beats (which depend on the previous beat as a
   * continuity reference) remain strictly sequential inside the main loop.
   *
   * Gated on `EXPO_PUBLIC_IMAGE_PARALLEL_SCENE_STARTS=true`; defaults off.
   * Runs fully *before* the main loop begins mutating
   * `_geminiPreviousScene`, so the prefetch's generateImage calls see the
   * singleton in a clean null state (which is what a scene-opener expects
   * — D10 clears the previous-scene ref at every scene boundary).
   *
   * Skipped entirely for panel-mode stories (panelMode !== 'single'):
   * panel beats render multiple sub-images per beat, which the prefetch
   * doesn't cover. Also skipped per-scene for openers already resumed
   * from disk or the asset registry.
   *
   * Populates `this.deps.openingBeatPrefetch`, a map keyed by beat identifier.
   * The main loop checks this map at beat 0 of each scene and, when a
   * prefetched result is present, short-circuits the inline generateImage
   * call and feeds the prefetched image into the normal post-generation
   * bookkeeping (beatImages, sceneImages, assetRegistry, beatResume,
   * styleReferenceStored, lastGeneratedImage).
   */
  async prefetchSceneOpeningBeats(
    sceneContents: SceneContent[],
    brief: FullCreativeBrief,
    characterBible: CharacterBible,
    colorScript: ColorScript | undefined,
    worldBible: WorldBible,
    outputDirectory?: string,
  ): Promise<void> {
    this.deps.openingBeatPrefetch.clear();

    const panelMode: PanelMode = this.deps.config.imageGen?.panelMode || 'single';
    if (panelMode !== 'single') {
      this.deps.emit({
        type: 'debug',
        phase: 'images',
        message: `A3-narrow prefetch skipped: panelMode="${panelMode}" (prefetch only supports single-image mode).`,
      });
      return;
    }

    type PrefetchItem = {
      identifier: string;
      sceneId: string;
      scopedSceneId: string;
      beatId: string;
      work: Promise<GeneratedImage>;
    };
    const items: PrefetchItem[] = [];
	    const imageStrategy = this.deps.config.imageGen?.strategy || 'all-beats';

    for (const scene of sceneContents) {
      try {
        const scopedSceneId = this.deps.getEpisodeScopedSceneId(brief, scene.sceneId);

        if (!Array.isArray(scene.moodProgression)) scene.moodProgression = [];
        if (!Array.isArray(scene.keyMoments)) scene.keyMoments = [];

        const beatsToIllustrate = imageStrategy === 'all-beats'
          ? scene.beats
          : scene.beats.filter((b, idx) => {
              const isStartingBeat = b.id === scene.startingBeatId || idx === 0;
              const isChoicePoint = b.isChoicePoint === true;
              const isLastBeat = idx === scene.beats.length - 1;
              const isClimaxBeat = (b as { isClimaxBeat?: boolean }).isClimaxBeat === true;
              const isKeyStoryBeat = (b as { isKeyStoryBeat?: boolean }).isKeyStoryBeat === true;
              const isChoicePayoff = (b as { isChoicePayoff?: boolean }).isChoicePayoff === true;
              const isIntervalBeat = idx % 3 === 0;
              return isStartingBeat || isChoicePoint || isLastBeat || isClimaxBeat || isKeyStoryBeat || isChoicePayoff || isIntervalBeat;
            });
        if (beatsToIllustrate.length === 0) continue;

        const openerBeat = beatsToIllustrate[0];
        const beatId = openerBeat.id;
        const rawIdentifier = `beat-${scopedSceneId}-${beatId}`;
        // Mirror the sanitization the service performs so our map key matches
        // exactly what the main loop will eventually look up.
        const identifier = rawIdentifier.replace(/[^a-zA-Z0-9_\-./]/g, '').replace(/-+/g, '-');

        if (outputDirectory) {
          const sceneSlug = idSlugify(scene.sceneId);
          const beatResumeLoaded = loadBeatResumeStateSync(outputDirectory, sceneSlug);
          const beatResumeSet = new Set<string>(beatResumeLoaded?.completedIdentifiers ?? []);
          if (beatResumeSet.has(identifier) || beatResumeSet.has(rawIdentifier)) continue;
        }

        const resumeSlotId = `story-beat:${scopedSceneId}::${beatId}`;
        const existingRecord = this.deps.assetRegistry.getResolvedAsset(resumeSlotId);
        if (existingRecord?.latestUrl) continue;

        const sceneCharacterIds = await this.deps.ensureCharacterReferencesForVisibleCharacters(
          this.deps.getCharacterIdsInScene(scene, characterBible, brief.protagonist.id),
          characterBible,
          brief,
          `prefetch-scene:${scopedSceneId}`
        );
        const locationInfo = getLocationInfoForScene(scene, worldBible);
        const sceneLocationId = locationInfo?.locationId;
        const sceneContext = this.deps.extractSceneContext(scene, 0, sceneContents.length, worldBible);

        const beatCharContext = this.deps.analyzeBeatCharacters(
          openerBeat.text,
          openerBeat.speaker,
          sceneCharacterIds,
          characterBible,
          brief.protagonist.id,
        );
        const explicitShotType = (openerBeat as { shotType?: 'establishing' | 'character' | 'action' }).shotType;
        const openerCoverage = planSceneCoverage({
          sceneId: scene.sceneId,
          beats: beatsToIllustrate.map((b) => ({
            id: b.id,
            text: b.text,
            speaker: b.speaker,
            speakerMood: b.speakerMood,
            shotType: (b as any).shotType,
            isClimaxBeat: b.isClimaxBeat,
            isKeyStoryBeat: b.isKeyStoryBeat,
            isChoicePayoff: (b as any).isChoicePayoff,
            visualMoment: b.visualMoment,
            primaryAction: b.primaryAction,
            emotionalRead: b.emotionalRead,
            relationshipDynamic: b.relationshipDynamic,
            mustShowDetail: b.mustShowDetail,
            dramaticIntent: (b as any).dramaticIntent,
            sequenceIntent: (b as any).sequenceIntent || (scene as any).sequenceIntent,
          })),
          sceneCharacterIds,
          characters: characterBible.characters.map(c => ({ id: c.id, name: c.name, role: c.role })),
          protagonistId: brief.protagonist.id,
        }).beats.find((b) => b.beatId === beatId);
        const isEstablishing = openerCoverage
          ? openerCoverage.coveragePlan.stagingPattern === 'environment'
          : explicitShotType === 'establishing'
            || (!explicitShotType && this.deps.isEstablishingBeat(openerBeat.text, openerBeat.speaker, openerBeat.primaryAction, beatCharContext));
        const resolvedShotType: 'establishing' | 'character' | 'action' = openerCoverage
          ? (isEstablishing ? 'establishing' : ((openerBeat as any).shotType === 'action' ? 'action' : 'character'))
          : explicitShotType || (isEstablishing ? 'establishing' : 'character');
        const openerShotCast = resolveShotCast({
          beat: { ...openerBeat, shotType: resolvedShotType },
          sceneCharacterIds,
          characters: characterBible.characters.map(c => ({ id: c.id, name: c.name })),
          protagonistId: brief.protagonist.id,
        });
        const openerVisibleCharacterIds = [
          ...(openerCoverage?.coveragePlan.requiredVisibleCharacterIds || openerShotCast.requiredForegroundCharacterIds),
          ...(openerCoverage?.coveragePlan.optionalVisibleCharacterIds || openerShotCast.optionalBackgroundCharacterIds),
        ];
        const getShotName = (id: string) => characterBible.characters.find(c => c.id === id)?.name || id;

        const sceneColorMood = (colorScript as unknown as { scenes?: Array<Record<string, unknown>> })?.scenes
          ?.find((cs) => (cs as { sceneId?: string; sceneName?: string }).sceneId === scene.sceneId
            || (cs as { sceneId?: string; sceneName?: string }).sceneName === scene.sceneName) as Record<string, unknown> | undefined;
        const colorMoodHints = sceneColorMood ? {
          palette: (sceneColorMood.palette || sceneColorMood.colorPalette) as string | undefined,
          lighting: (sceneColorMood.lighting || sceneColorMood.lightingMood) as string | undefined,
          temperature: sceneColorMood.temperature as string | undefined,
        } : undefined;

        const sceneMood = scene.moodProgression.length > 0
          ? scene.moodProgression[0]
          : (sceneContext.isClimactic ? 'intense' : 'dramatic');

        const scenePromptCtx: import('../images/beatPromptBuilder').ScenePromptContext = {
          sceneId: scene.sceneId,
          sceneName: scene.sceneName,
          genre: brief.story.genre,
          tone: brief.story.tone,
          mood: sceneMood,
          settingContext: scene.settingContext,
          artStyle: this.deps.config.artStyle,
          colorMood: colorMoodHints,
          styleProfile: this.deps.config.imageGen?.artStyleProfile,
        };

        const beatColorEntry = (colorScript as unknown as { beats?: Array<Record<string, unknown>> })?.beats
          ?.find((b) => (b as { beatId?: string }).beatId === beatId) as Record<string, unknown> | undefined;
        let beatColorOverride: import('../images/beatPromptBuilder').BeatPromptInput['colorMoodOverride'] | undefined;
        if (beatColorEntry) {
          const hues: string[] = Array.isArray(beatColorEntry.dominantHues) ? beatColorEntry.dominantHues as string[] : [];
          const palette = hues.length > 0 ? hues.join(' and ') : undefined;
          const temperature = typeof beatColorEntry.lightTemp === 'string' ? beatColorEntry.lightTemp : undefined;
          beatColorOverride = {
            palette,
            lighting: typeof beatColorEntry.lightDirection === 'string'
              ? `${beatColorEntry.lightDirection} light`
              : undefined,
            temperature,
            // Beat 0 has no previous beat — no transition note.
            transitionNote: undefined,
          };
        }

        let shotCharacterIds: string[];
        if (isEstablishing) {
          shotCharacterIds = [];
        } else {
          shotCharacterIds = openerVisibleCharacterIds;
        }
        shotCharacterIds = await this.deps.ensureCharacterReferencesForVisibleCharacters(
          shotCharacterIds,
          characterBible,
          brief,
          `prefetch-beat:${scopedSceneId}:${beatId}`
        );
        const shotCharacterNames = shotCharacterIds
          .map(id => characterBible.characters.find(c => c.id === id)?.name)
          .filter(Boolean) as string[];
        const foregroundCharacterNames = isEstablishing
          ? []
          : (openerCoverage?.visualCast.foregroundCharacterIds || openerShotCast.requiredForegroundCharacterIds).map(getShotName);
        const backgroundCharacterNames = isEstablishing
          ? []
          : (openerCoverage?.visualCast.backgroundCharacterIds || openerShotCast.optionalBackgroundCharacterIds).map(getShotName);
        const openerStateTracker = new CharacterStateTracker(characterBible);
        const characterVisualStates = openerStateTracker.updateForBeat(
          openerBeat,
          [...foregroundCharacterNames, ...backgroundCharacterNames],
        );

        const beatPromptInput: import('../images/beatPromptBuilder').BeatPromptInput = {
          beatId,
          beatText: openerBeat.text,
          beatIndex: 0,
          totalBeats: beatsToIllustrate.length,
          visualMoment: this.deps.sanitizePromptText(openerBeat.visualMoment || '', brief, ''),
          primaryAction: isEstablishing ? '' : this.deps.sanitizePromptText(openerBeat.primaryAction || '', brief, ''),
          emotionalRead: isEstablishing ? '' : this.deps.sanitizePromptText(openerBeat.emotionalRead || '', brief, ''),
          relationshipDynamic: isEstablishing ? '' : this.deps.sanitizePromptText(openerBeat.relationshipDynamic || '', brief, ''),
          mustShowDetail: this.deps.sanitizePromptText(openerBeat.mustShowDetail || '', brief, ''),
          visibleTurn: this.deps.sanitizePromptText((openerBeat as any).dramaticIntent?.visibleTurn || '', brief, ''),
          visualSubtextCue: this.deps.sanitizePromptText((openerBeat as any).dramaticIntent?.visualSubtextCue || '', brief, ''),
          statusShift: this.deps.sanitizePromptText([
            (openerBeat as any).dramaticIntent?.statusBefore,
            (openerBeat as any).dramaticIntent?.statusAfter,
          ].filter(Boolean).join(' -> '), brief, ''),
          shotType: resolvedShotType,
          isClimaxBeat: openerBeat.isClimaxBeat,
          isKeyStoryBeat: openerBeat.isKeyStoryBeat,
          isChoicePayoff: (openerBeat as { isChoicePayoff?: boolean }).isChoicePayoff,
          choiceContext: this.deps.sanitizePromptText((openerBeat as { choiceContext?: string }).choiceContext || '', brief, ''),
          incomingChoiceContext: this.deps.sanitizePromptText(scene.incomingChoiceContext || '', brief, ''),
          isBranchPayoff: !!scene.incomingChoiceContext,
          foregroundCharacterNames,
          backgroundCharacterNames,
          visualCast: openerCoverage?.visualCast,
          coveragePlan: openerCoverage?.coveragePlan,
          stagingPattern: openerCoverage?.coveragePlan.stagingPattern,
          relationshipBlocking: openerCoverage?.coveragePlan.relationshipBlocking,
          coverageReason: openerCoverage?.coveragePlan.coverageReason,
          characterVisualStates,
          colorMoodOverride: beatColorOverride,
        };

        let imagePrompt = buildBeatImagePrompt(beatPromptInput, scenePromptCtx);
        if (openerCoverage?.coveragePlan) {
          imagePrompt = overrideShotFromPlan(imagePrompt, openerCoverage.coveragePlan.shotDistance, openerCoverage.coveragePlan.cameraAngle);
        }
        imagePrompt = this.deps.sanitizeImagePrompt(imagePrompt, brief);

        const includeExpressionRefs = !!(openerBeat.isClimaxBeat || openerBeat.isKeyStoryBeat);
        const referenceImages = this.deps.gatherCharacterReferenceImages(
          shotCharacterIds,
          characterBible,
          sceneLocationId,
          {
            includeExpressions: includeExpressionRefs,
            family: 'story-beat',
            slotId: resumeSlotId,
          },
        );

        const work = withTimeout(
          this.deps.imageService.generateImage(
            imagePrompt,
            identifier,
            {
              sceneId: scopedSceneId,
              beatId,
              type: 'beat' as const,
              characters: shotCharacterIds,
              characterNames: shotCharacterNames,
              characterDescriptions: this.deps.buildCharacterDescriptions(shotCharacterIds, characterBible),
              visualCast: openerCoverage?.visualCast,
              coveragePlan: openerCoverage?.coveragePlan,
            },
            referenceImages.length > 0 ? referenceImages : undefined,
          ),
          PIPELINE_TIMEOUTS.imageGeneration,
          `prefetchOpener(${scopedSceneId}:${beatId})`,
        );

        items.push({ identifier, sceneId: scene.sceneId, scopedSceneId, beatId, work });
      } catch (perSceneErr) {
        this.deps.emit({
          type: 'warning',
          phase: 'images',
          message: `A3-narrow prefetch: setup failed for scene "${scene.sceneId}" (non-fatal): ${perSceneErr instanceof Error ? perSceneErr.message : String(perSceneErr)}`,
        });
      }
    }

    if (items.length === 0) {
      this.deps.emit({
        type: 'debug',
        phase: 'images',
        message: `A3-narrow prefetch: no eligible scene-opening beats to prefetch.`,
      });
      return;
    }

    this.deps.emit({
      type: 'agent_start',
      agent: 'ImageService',
      message: `A3-narrow: prefetching ${items.length} scene-opening beats in parallel`,
    });

    const settled = await Promise.allSettled(items.map(i => i.work));

    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const result = settled[i];
      if (result.status === 'fulfilled' && (result.value.imageUrl || result.value.imagePath)) {
        this.deps.openingBeatPrefetch.set(item.identifier, result.value);
        successCount++;
      } else {
        failCount++;
        const reason = result.status === 'rejected'
          ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
          : 'prefetch returned no image';
        this.deps.emit({
          type: 'warning',
          phase: 'images',
          message: `A3-narrow prefetch missed for ${item.identifier} (will regenerate inline): ${reason}`,
        });
      }
    }

    this.deps.emit({
      type: 'agent_complete',
      agent: 'ImageService',
      message: `A3-narrow prefetch complete: ${successCount}/${items.length} succeeded (${failCount} fell back to inline)`,
      data: { prefetchSize: items.length, successCount, failCount },
    });
  }
}
