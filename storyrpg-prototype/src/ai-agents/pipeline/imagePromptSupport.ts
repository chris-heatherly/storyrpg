/**
 * Image prompt support service (pure move from FullStoryPipeline).
 *
 * The prompt-side helpers image generation leans on: effective mode getters,
 * prompt sanitization (template resolution + artifact scrubbing), the
 * third-person render and visual-continuity contracts, prompt/character
 * consistency checks, hero visual-QA gating + diagnostic saves, storyboard
 * plan building, defect-driven prompt strengthening, and the
 * validate-and-regenerate loop.
 *
 * The creative brief is consumed structurally (protagonist name/pronouns
 * only) so this module does not import FullCreativeBrief (no monolith cycle).
 */

import type { PipelineConfig } from '../config';
import type { ImagePrompt } from '../images/imageTypes';
import type {
  ImageGenerationService,
  ReferenceImage,
} from '../services/imageGenerationService';
import type { SlotReferencePack } from '../images/slotTypes';
import type { VisualPlan } from '../agents/image-team/ImageAgentTeam';
import {
  buildSceneVisualStoryboardPlan,
  normalizeImagePlanningMode,
  visualPlanSlotsFromBeats,
  type SceneVisualStoryboardPlan,
  type VisualStoryboardPacket,
} from '../images/visualStoryboardPlanning';
import { applyPromptContract } from '../images/imagePromptContracts';
import { selectStyleAdaptation, type SceneSettingContext } from '../utils/styleAdaptation';
import { resolvePlayerTemplatesInObject } from '../utils/playerTemplateResolver';
import { saveEarlyDiagnostic } from '../utils/pipelineOutputWriter';
import type { PipelineEvent } from './events';

/**
 * Minimal structural slice of FullCreativeBrief (declared in the monolith;
 * consumed structurally here to avoid a module cycle).
 */
export interface ProtagonistPromptBrief {
  protagonist: { name: string; pronouns: string };
}

export interface ImagePromptSupportDeps {
  config(): PipelineConfig;
  imageService(): ImageGenerationService;
  uploadedStyleReferenceImages(): ReferenceImage[];
  emit(event: Omit<PipelineEvent, 'timestamp'>): void;
}

export class ImagePromptSupport {
  constructor(private readonly deps: ImagePromptSupportDeps) {}

  getEffectiveImagePromptMode(): 'deterministic' | 'llm' {
    return this.deps.config().imageGen?.qa?.promptMode || 'llm';
  }

  getEffectiveImageQaMode(): 'off' | 'fast' | 'full' {
    return this.deps.config().imageGen?.qa?.qaMode || 'full';
  }

  getEffectiveImagePlanningMode(): 'text' | 'visual-storyboard' {
    return normalizeImagePlanningMode(this.deps.config().imageGen?.imagePlanningMode);
  }

  getStoryboardMaxPanelsPerSheet(): number {
    const configured = this.deps.config().imageGen?.storyboardV2?.maxPanelsPerSheet;
    if (!Number.isFinite(configured) || !configured) return 6;
    return Math.max(1, Math.min(12, Math.floor(configured)));
  }

  async saveSceneVisualPlanningDiagnostic(
    outputDirectory: string | undefined,
    scopedSceneId: string,
    payload: Record<string, unknown>,
    options?: { suffix?: string },
  ): Promise<void> {
    if (!outputDirectory) return;
    try {
      const suffix = options?.suffix ? `.${options.suffix}` : '';
      await saveEarlyDiagnostic(outputDirectory, `images/prompts/${scopedSceneId}.visual-planning${suffix}.json`, {
        generatedAt: new Date().toISOString(),
        scopedSceneId,
        ...payload,
      });
    } catch (error) {
      this.deps.emit({
        type: 'warning',
        phase: 'images',
        message: `Failed to save visual planning diagnostic for ${scopedSceneId}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  buildBeatSceneStoryboardPlan(params: {
    sceneId: string;
    scopedSceneId: string;
    sceneName: string;
    sceneDescription?: string;
    beats: Array<{ id: string; text?: string }>;
    visualPlan?: VisualPlan;
  }): SceneVisualStoryboardPlan {
    return buildSceneVisualStoryboardPlan({
      sceneId: params.sceneId,
      scopedSceneId: params.scopedSceneId,
      sceneName: params.sceneName,
      sceneDescription: params.sceneDescription,
      slots: visualPlanSlotsFromBeats(params.scopedSceneId, params.beats),
      panelCap: this.getStoryboardMaxPanelsPerSheet(),
      branchAware: false,
      continuityBible: (params.visualPlan as any)?.continuityBible,
      sequenceGrammar: (params.visualPlan as any)?.sequenceGrammar,
    });
  }

  wrapLlmImagePromptWithContracts(
    prompt: ImagePrompt,
    input: import('../images/beatPromptBuilder').BeatPromptInput,
    sceneContext: import('../images/beatPromptBuilder').ScenePromptContext,
    characterNames: string[],
    promptMode: string,
    brief: ProtagonistPromptBrief,
  ): ImagePrompt {
    const uploadedStyleReferenceImages = this.deps.uploadedStyleReferenceImages();
    const action = [
      input.visualMoment,
      input.primaryAction,
      input.emotionalRead,
      input.relationshipDynamic,
      input.mustShowDetail,
    ].filter(Boolean).join(' ');
    const contracted = applyPromptContract({
      ...prompt,
      style: sceneContext.artStyle || prompt.style,
      promptContract: {
        ...(prompt.promptContract || {}),
        sourcePromptMode: promptMode,
      },
    }, {
      style: sceneContext.artStyle || prompt.style || '',
      styleSource: uploadedStyleReferenceImages.length > 0 ? 'user-visual' : 'raw-season-style',
      mode: 'story-beat',
      characterIdentity: characterNames,
      appearanceState: input.characterVisualStates
        ? Object.entries(input.characterVisualStates).map(([name, state]) => `${name}: ${JSON.stringify(state)}`).join('; ')
        : undefined,
      sceneAction: action,
      composition: prompt.composition,
      negativeContract: prompt.negativePrompt,
      hasVisualStyleRef: uploadedStyleReferenceImages.length > 0,
      hasVisualCharacterRef: false,
    });
    return this.sanitizeImagePrompt(
      this.applyVisualContinuityAffordance(contracted, input.coveragePlan),
      brief,
    );
  }

  applyVisualContinuityAffordance(
    prompt: ImagePrompt,
    coveragePlan?: import('../../types/content').BeatCoveragePlan,
  ): ImagePrompt {
    const continuity = coveragePlan?.visualContinuity;
    const mode = continuity?.mode || 'fresh_composition';
    const result: ImagePrompt = { ...prompt };

    if (mode === 'locked_micro_progression' && continuity?.changeOnly) {
      const preserve = continuity.preserve?.length
        ? continuity.preserve.join(', ')
        : 'camera, blocking, lighting, environment, character position';
      const directive = `VISUAL CONTINUITY AFFORDANCE: locked micro-progression. Preserve ${preserve}; ONLY visible change: ${continuity.changeOnly}. ${continuity.reason || ''}`.trim();
      result.prompt = [result.prompt, directive].filter(Boolean).join(' ');
      result.composition = [result.composition, directive].filter(Boolean).join(' ');
      return result;
    }

    const scrubLockedContinuity = (value: string | undefined): string | undefined => {
      if (!value) return value;
      return value
        .replace(/\bIDENTICAL camera angle\b/gi, 'motivated camera angle')
        .replace(/\bIDENTICAL environment\b/gi, 'recognizable environment continuity')
        .replace(/\bIDENTICAL lighting\b/gi, 'compatible lighting continuity')
        .replace(/\bSAME character position\b/gi, 'fresh character position')
        .replace(/\bsame angle, same environment, same character position\b/gi, 'fresh angle and blocking within the same story setting')
        .replace(/\bCamera angle MUST BE IDENTICAL:?\s*[^.!?\n]*/gi, 'Camera angle should change when it improves the beat')
        .replace(/\bCharacter position MUST BE IDENTICAL[^.!?\n]*/gi, 'Character position should be freshly blocked for this beat');
    };

    const directive = mode === 'preserve_scene_axis'
      ? 'VISUAL CONTINUITY AFFORDANCE: preserve the broad scene axis and spatial readability, but use fresh camera distance, focal point, pose, and blocking for this beat.'
      : 'VISUAL CONTINUITY AFFORDANCE: fresh composition is required. Do not repeat previous camera angle, character positions, blocking, or focal point; references and prior panels are continuity aids only.';
    result.prompt = [scrubLockedContinuity(result.prompt), directive].filter(Boolean).join(' ');
    result.composition = [scrubLockedContinuity(result.composition), directive].filter(Boolean).join(' ');
    result.shotDescription = scrubLockedContinuity(result.shotDescription);
    result.poseSpec = scrubLockedContinuity(result.poseSpec);
    result.negativePrompt = [
      result.negativePrompt,
      'repeated staging from previous image, same character positions as previous image, locked-off camera without explicit micro-progression',
    ].filter(Boolean).join(', ');
    return result;
  }

  promptMentionsDisallowedCharacters(
    prompt: ImagePrompt,
    allowedCharacterNames: string[],
    allSceneCharacterNames: string[],
  ): string[] {
    const allowed = new Set(allowedCharacterNames.map(name => name.toLowerCase()));
    const text = [
      prompt.prompt,
      prompt.composition,
      prompt.visualNarrative,
      prompt.keyExpression,
      prompt.keyBodyLanguage,
      prompt.poseSpec,
    ].filter(Boolean).join('\n').toLowerCase();
    return allSceneCharacterNames
      .filter(name => !allowed.has(name.toLowerCase()))
      .filter(name => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
      });
  }

  promptMissingRequiredCharacters(
    prompt: ImagePrompt,
    requiredCharacterNames: string[],
  ): string[] {
    const text = [
      prompt.prompt,
      prompt.composition,
      prompt.visualNarrative,
      prompt.keyExpression,
      prompt.keyBodyLanguage,
      prompt.poseSpec,
    ].filter(Boolean).join('\n').toLowerCase();
    return requiredCharacterNames.filter(name => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`\\b${escaped}\\b`, 'i').test(text);
    });
  }

  shouldRunHeroVisualQA(
    beat: any,
    beatIndex: number,
    totalBeats: number,
    qaMode: 'off' | 'fast' | 'full',
  ): boolean {
    if (qaMode === 'off') return false;
    if (qaMode === 'full') {
      return beatIndex === 0 ||
        beatIndex === totalBeats - 1 ||
        beat.isClimaxBeat === true ||
        beat.isKeyStoryBeat === true ||
        beat.isChoicePoint === true ||
        beat.isChoicePayoff === true;
    }
    return beat.isClimaxBeat === true || beat.isKeyStoryBeat === true || beat.isChoicePayoff === true;
  }

  async saveSceneVisualQADiagnostic(
    outputDirectory: string | undefined,
    scopedSceneId: string,
    report: unknown,
  ): Promise<void> {
    if (!outputDirectory) return;
    try {
      await saveEarlyDiagnostic(outputDirectory, `images/prompts/${scopedSceneId}.visual-qa.json`, {
        generatedAt: new Date().toISOString(),
        scopedSceneId,
        report,
      });
    } catch (error) {
      this.deps.emit({
        type: 'warning',
        phase: 'images',
        message: `Failed to save visual QA diagnostic for ${scopedSceneId}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  serializeVisualQAReport(report: any): Record<string, unknown> {
    const mapToObject = (value: unknown) => value instanceof Map ? Object.fromEntries(value.entries()) : value;
    return {
      ...report,
      expressionReports: mapToObject(report?.expressionReports),
      bodyLanguageReports: mapToObject(report?.bodyLanguageReports),
      lightingColorReports: mapToObject(report?.lightingColorReports),
      visualStorytellingReports: mapToObject(report?.visualStorytellingReports),
    };
  }

  async saveBeatVisualQADiagnostic(
    outputDirectory: string | undefined,
    identifier: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!outputDirectory) return;
    try {
      await saveEarlyDiagnostic(outputDirectory, `images/prompts/${identifier}.visual-qa.json`, {
        generatedAt: new Date().toISOString(),
        identifier,
        ...payload,
      });
    } catch (error) {
      this.deps.emit({
        type: 'warning',
        phase: 'images',
        message: `Failed to save beat visual QA diagnostic for ${identifier}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Normalize arbitrary LLM output into readable narrative text for image prompts.
   * Prevents accidental "[object Object]" leakage when a beat text field is not a string.
   */
  normalizeNarrativeText(raw: unknown, fallback = ''): string {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      return trimmed || fallback;
    }
    if (raw && typeof raw === 'object') {
      const asRecord = raw as Record<string, unknown>;
      const candidate =
        (typeof asRecord.text === 'string' && asRecord.text) ||
        (typeof asRecord.narrativeText === 'string' && asRecord.narrativeText) ||
        (typeof asRecord.description === 'string' && asRecord.description) ||
        '';
      if (candidate) return candidate.trim();
      try {
        return JSON.stringify(raw);
      } catch {
        return fallback;
      }
    }
    if (raw === undefined || raw === null) return fallback;
    return String(raw);
  }

  scrubPromptArtifacts(text: string): string {
    return (text || '')
      .replace(/\[object Object\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  sanitizePromptText(raw: unknown, brief: ProtagonistPromptBrief, fallback = ''): string {
    const normalized = this.normalizeNarrativeText(raw, fallback);
    const resolved = this.resolvePlayerTemplates(normalized, brief);
    return this.scrubPromptArtifacts(resolved);
  }

  sanitizeImagePrompt(prompt: ImagePrompt, brief: ProtagonistPromptBrief): ImagePrompt {
    const sanitize = (value: unknown) => this.sanitizePromptText(value, brief, '');
    return {
      ...prompt,
      prompt: sanitize(prompt.prompt),
      composition: sanitize(prompt.composition),
      visualNarrative: sanitize(prompt.visualNarrative),
      emotionalCore: sanitize(prompt.emotionalCore),
      keyExpression: sanitize(prompt.keyExpression),
      keyBodyLanguage: sanitize(prompt.keyBodyLanguage),
      keyGesture: sanitize(prompt.keyGesture),
      poseSpec: sanitize(prompt.poseSpec),
    };
  }

  applyThirdPersonRenderContract(
    prompt: ImagePrompt,
    storyboardShot?: VisualStoryboardPacket['shots'][number],
    options?: { isEnvironmentShot?: boolean },
  ): ImagePrompt {
    const thirdPersonContract = 'CAMERA POV CONTRACT: Render this as a third-person observer shot outside every character. Never use first-person/player-eye POV, disembodied hands, "your hand" framing, or a camera inside the protagonist body.';
    const environmentStyleContract = options?.isEnvironmentShot
      ? 'ENVIRONMENT STYLE LOCK: Render all backgrounds and architecture as stylized cartoon/graphic environment design matching the character finish: simplified designed shapes, clean illustrated edges, curated flat/cel color, non-photographic lighting, no real-estate photo look, no architectural visualization, no HDR interior realism, no live-action location still.'
      : '';
    const storyboardContract = storyboardShot ? [
      'VISUAL STORYBOARD PACKET:',
      `Sequence role: ${storyboardShot.sequenceRole}.`,
      `Shot: ${storyboardShot.shotSize}, ${storyboardShot.cameraAngle}, ${storyboardShot.cameraHeight} height, ${storyboardShot.cameraSide} side.`,
      `POV mode: ${storyboardShot.thirdPersonPov}.`,
      `Required visible cast: ${(storyboardShot.requiredVisibleCharacterIds || []).join(', ') || 'none'}.`,
      `Optional/background cast: ${(storyboardShot.optionalBackgroundCharacterIds || []).join(', ') || 'none'}.`,
      `Explicitly offscreen: ${(storyboardShot.offscreenCharacterIds || []).join(', ') || 'none'}.`,
      `Shot action: ${storyboardShot.promptFields?.action || ''}`,
      storyboardShot.promptFields?.emotionalRead ? `Emotional read: ${storyboardShot.promptFields.emotionalRead}` : '',
      storyboardShot.promptFields?.keyDetail ? `Key detail: ${storyboardShot.promptFields.keyDetail}` : '',
      storyboardShot.continuityFrom ? `Continuity from previous shot: ${storyboardShot.continuityFrom}` : '',
      `Dramatic reason: ${storyboardShot.dramaticReason || 'story beat progression'}.`,
    ].filter(Boolean).join(' ') : '';
    const environmentNegatives = options?.isEnvironmentShot
      ? 'environment style drift, unapproved location renderer, background finish that contradicts the style contract'
      : '';
    const negativeAdditions = ['first-person POV, player-eye view, POV hands, disembodied hands, your hand, your hands, selfie angle, style drift, unapproved renderer', environmentNegatives].filter(Boolean).join(', ');
    return {
      ...prompt,
      prompt: [prompt.prompt, thirdPersonContract, environmentStyleContract, storyboardContract].filter(Boolean).join('\n\n'),
      composition: [prompt.composition, thirdPersonContract, environmentStyleContract].filter(Boolean).join(' '),
      negativePrompt: [prompt.negativePrompt, negativeAdditions].filter(Boolean).join(', '),
    };
  }

  createSlotReferencePack(slotId: string, references: unknown[] | undefined): SlotReferencePack | undefined {
    const refs = Array.isArray(references) ? references.filter(Boolean) as any[] : [];
    if (refs.length === 0) return undefined;
    return {
      slotId,
      totalCount: refs.length,
      references: refs,
      summary: refs.map((ref) => ({
        role: ref.role || 'reference',
        characterName: ref.characterName,
        viewType: ref.viewType,
      })),
    };
  }

  withSettingAwarePrompt(prompt: ImagePrompt, settingContext?: SceneSettingContext): ImagePrompt {
    if (!settingContext) return prompt;
    const selection = selectStyleAdaptation(prompt.style || this.deps.config().artStyle || undefined, settingContext);
    return {
      ...prompt,
      settingContext,
      settingBranchLabel: selection.branchLabel,
      settingAdaptationNotes: selection.notes,
    };
  }

  /**
   * Resolve common protagonist template tokens before constructing image prompts.
   * Image generation happens outside runtime text rendering, so these must be concretized.
   */
  resolvePlayerTemplates(text: string, brief: ProtagonistPromptBrief): string {
    return resolvePlayerTemplatesInObject(text || '', {
      name: brief.protagonist?.name || 'Protagonist',
      pronouns: brief.protagonist?.pronouns || 'they/them',
    }).value;
  }

  /**
   * Validate a generated image and return guidance for regeneration if needed.
   * Uses vision-based analysis to check for stiff poses, neutral expressions, etc.
   */
  async validateAndRegenerateImage(
    prompt: ImagePrompt,
    identifier: string,
    metadata: { sceneId: string; beatId: string; type: string; characters: string[]; characterNames: string[]; characterDescriptions: string[]; includeExpressionRefs?: boolean },
    referenceImages: Array<{ data: string; mimeType: string }> | undefined,
    maxAttempts: number = 2
  ): Promise<{ imageUrl?: string; imageData?: string; mimeType?: string }> {
    const imageService = this.deps.imageService();
    const MAX_REGENERATION_ATTEMPTS = maxAttempts;
    const gemSettings = imageService.getGeminiSettings();
    const usePreview = gemSettings.usePreviewForValidation && imageService.isNB2OrProModel();

    for (let attempt = 0; attempt < MAX_REGENERATION_ATTEMPTS; attempt++) {
      try {
        // On retry attempts with preview validation: generate at 512px first to
        // validate the strengthened prompt before committing to full resolution
        if (attempt > 0 && usePreview) {
          console.log(`[Pipeline] Preview validation: generating 512px preview for ${metadata.beatId} (attempt ${attempt + 1})`);
          const currentSettings = { ...imageService.getGeminiSettings() };
          imageService.updateGeminiSettings({ ...currentSettings, sceneResolution: '512px' });
          try {
            const previewResult = await imageService.generateImage(
              prompt, `${identifier}_preview_${attempt}`, metadata as unknown as Parameters<ImageGenerationService['generateImage']>[2], referenceImages as unknown as Parameters<ImageGenerationService['generateImage']>[3]
            );
            if (!previewResult.imageData || !previewResult.mimeType) {
              console.warn(`[Pipeline] Preview generation failed for ${metadata.beatId}, proceeding to full resolution`);
            } else {
              console.log(`[Pipeline] Preview generated for ${metadata.beatId}, proceeding to full resolution`);
            }
          } finally {
            imageService.updateGeminiSettings(currentSettings);
          }
        }

        const result = await imageService.generateImage(
          prompt,
          identifier,
          metadata as unknown as Parameters<ImageGenerationService['generateImage']>[2],
          referenceImages as unknown as Parameters<ImageGenerationService['generateImage']>[3]
        );

        if (!result.imageUrl || !result.imageData || !result.mimeType) {
          return result;
        }

        if (attempt === 0 && MAX_REGENERATION_ATTEMPTS === 1) {
          return result;
        }

        if (attempt > 0 || MAX_REGENERATION_ATTEMPTS > 1) {
          if (attempt === 0) {
            console.log(`[Pipeline] Image generated for ${metadata.beatId}, skipping validation on first pass`);
            return result;
          }

          console.log(`[Pipeline] Regenerated image for ${metadata.beatId} (attempt ${attempt + 1}/${MAX_REGENERATION_ATTEMPTS})`);
          return result;
        }

        return result;
      } catch (err) {
        console.warn(`[Pipeline] Image generation attempt ${attempt + 1} failed:`, err);
        if (attempt === MAX_REGENERATION_ATTEMPTS - 1) {
          throw err;
        }
        prompt = this.strengthenPromptForRegeneration(prompt, attempt);
      }
    }

    return {};
  }

  /**
   * Strengthen a prompt for regeneration after a failed validation or generation
   */
  strengthenPromptForRegeneration(prompt: ImagePrompt, attemptNumber: number): ImagePrompt {
    const strengthened = { ...prompt };

    // Add increasingly aggressive anti-stiffness directives
    const strengtheningSuffix = attemptNumber === 0
      ? ' Show dramatic action with asymmetric body language.'
      : ' CRITICAL: This MUST show dynamic movement. Weight shifted, body twisted, hands active. No symmetrical poses, no neutral expressions, no static tableaux.';

    if (strengthened.visualNarrative) {
      strengthened.visualNarrative += strengtheningSuffix;
    }

    // Strengthen body language directive
    if (strengthened.keyBodyLanguage) {
      strengthened.keyBodyLanguage += ' Body must be visibly mid-action, not standing still. Weight clearly on one foot, spine curved or twisted, shoulders asymmetric.';
    } else {
      strengthened.keyBodyLanguage = 'Dynamic body language required: weight shifted to one foot, spine showing curve or twist, shoulders at different heights, body angled. Never neutral standing pose.';
    }

    // Strengthen gesture directive
    if (strengthened.keyGesture) {
      strengthened.keyGesture += ' Hands must be doing something specific — gripping, reaching, pressing, gesturing — never hanging at sides.';
    } else {
      strengthened.keyGesture = 'Hands actively engaged: gripping an object, pressing against a surface, gesturing emphatically, or touching face/body with purpose. Never hanging loosely at sides.';
    }

    // Strengthen expression directive
    if (!strengthened.keyExpression) {
      strengthened.keyExpression = 'Clear emotional expression required. Use specific facial anatomy: furrowed brow, narrowed eyes, clenched jaw, pressed lips, flared nostrils, or their opposites for positive emotions. Never neutral or blank.';
    }

    // Add stronger negatives
    strengthened.negativePrompt = (strengthened.negativePrompt || '') +
      ', stiff pose, symmetrical stance, neutral expression, arms at sides, standing straight, evenly distributed weight, mirrored poses, static tableau, portrait composition, both characters facing camera';

    console.log(`[Pipeline] Strengthened prompt for regeneration attempt ${attemptNumber + 2}`);
    return strengthened;
  }

  /**
   * Check if a primaryAction is too generic to be useful
   */
  isGenericAction(action: string): boolean {
    if (!action || action.trim().length === 0) return true;
    const genericPatterns = /^(standing|looking|together|sitting|waiting|being|having|feeling|thinking|watching|seeing)(\s|$)/i;
    const veryShort = action.trim().split(/\s+/).length <= 2 && !action.includes(',');
    return genericPatterns.test(action.trim()) || (veryShort && !/\b(grabs?|reaches?|recoils?|pushes?|pulls?|strikes?|dodges?|embraces?|confronts?|lunges?|stumbles?|runs?)\b/i.test(action));
  }
}
