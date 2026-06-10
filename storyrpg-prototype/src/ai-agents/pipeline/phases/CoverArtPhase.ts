/**
 * Cover Art Phase
 *
 * Generates the dedicated story cover image — movie-poster style key art.
 *
 * Faithful port of FullStoryPipeline.generateStoryCoverArt +
 * distillPosterConcept + formatPosterConceptForPrompt +
 * fallbackPosterConceptBlock (pure move): same two-step distill-then-render
 * flow, same prompt text, same non-blocking failure semantics, same events.
 * The PosterConcept brief types and the compositional-structure normalizer
 * move along with it.
 */

import { CharacterBible, CharacterProfile } from '../../agents/CharacterDesigner';
import { WorldBible } from '../../agents/WorldBuilder';
import { ImageAgentTeam } from '../../agents/image-team/ImageAgentTeam';
import { ImageGenerationService, type CharacterAppearanceDescription } from '../../services/imageGenerationService';
import { ImagePrompt } from '../../images/imageTypes';
import type { GeneratedImage } from '../../images/imageTypes';
import { applyPromptContract } from '../../images/imagePromptContracts';
import { withTimeout, PIPELINE_TIMEOUTS } from '../../utils/withTimeout';
// Type-only import — erased at runtime, so no runtime cycle with the monolith.
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

/**
 * Structured brief distilled from a story before rendering its cover / key art.
 *
 * Encodes the movie-poster design principles the renderer is expected to honor:
 * one idea + one focal point, symbols over scenes, a committed compositional
 * structure, deliberate depth cues, bulletproof figure-ground, explicit gaze
 * direction, intentional negative space, limited palette with accent, and a
 * list of clichés to specifically avoid for this story's genre.
 */
export interface PosterConcept {
  /** Single-sentence emotional promise — the half-a-second glance feeling. */
  coreIdea: string;
  /** Iconic symbolic image encoding the core idea. NOT a literal scene. */
  visualMetaphor: string;
  /** The ONE thing the eye hits first — subject, pose, scale, placement. */
  focalSubject: string;
  /** Chosen poster structure. */
  compositionalStructure: PosterCompositionalStructure;
  /** One-sentence justification for choosing this structure for this story. */
  structureRationale: string;
  /** Up to 3 clearly subordinate supporting elements. */
  supportingElements: string[];
  /** Limited palette + any saturated accent, with warm/cool placement for depth. */
  colorStrategy: string;
  /** Where the focal subject is looking (or 'none' if not a person). */
  gazeDirection: PosterGazeDirection;
  /** What the gaze implies. */
  gazeRationale: string;
  /** Where intentional negative space lives and what it communicates. */
  negativeSpaceStrategy: string;
  /** How overlap / linear / atmospheric perspective build 3D space. */
  depthStrategy: string;
  /** How the focal subject separates from background (value, color, or edge). */
  figureGroundStrategy: string;
  /** Clichés at risk for this genre that must be explicitly avoided. */
  clichesAvoided: string[];
  /** What the silhouette reads as at tile size. */
  thumbnailTest: string;
}

export type PosterCompositionalStructure =
  | 'triangular'
  | 'rule-of-thirds'
  | 'radial-symmetry'
  | 'scale-asymmetry'
  | 'silhouette-against-environment'
  | 'overhead'
  | 'worms-eye';

export type PosterGazeDirection = 'direct' | 'off-frame' | 'internal-loop' | 'none';

const POSTER_COMPOSITIONAL_STRUCTURES: readonly PosterCompositionalStructure[] = [
  'triangular',
  'rule-of-thirds',
  'radial-symmetry',
  'scale-asymmetry',
  'silhouette-against-environment',
  'overhead',
  'worms-eye',
];

function normalizeCompositionalStructure(raw: unknown): PosterCompositionalStructure {
  if (typeof raw !== 'string') return 'rule-of-thirds';
  const lower = raw.trim().toLowerCase().replace(/[_\s]/g, '-');
  for (const s of POSTER_COMPOSITIONAL_STRUCTURES) {
    if (lower === s) return s;
  }
  // Accept some common variants the LLM may emit.
  if (/triangl|pyramid/.test(lower)) return 'triangular';
  if (/thirds|rule-of-third/.test(lower)) return 'rule-of-thirds';
  if (/radial|symmetr|centered/.test(lower)) return 'radial-symmetry';
  if (/scale|asymmetr|loom|giant-vs-small|size-diff/.test(lower)) return 'scale-asymmetry';
  if (/silhouette|against-env|against-horizon/.test(lower)) return 'silhouette-against-environment';
  if (/overhead|top-down|birds-eye/.test(lower)) return 'overhead';
  if (/worms?-eye|low-angle|up-shot/.test(lower)) return 'worms-eye';
  return 'rule-of-thirds';
}

export interface CoverArtPhaseInput {
  brief: FullCreativeBrief;
  characterBible: CharacterBible;
  worldBible: WorldBible;
  outputDirectory?: string;
}

export interface CoverArtPhaseDeps {
  imageService: Pick<ImageGenerationService, 'getGeminiSettings'>;
  imageAgentTeam: Pick<ImageAgentTeam, 'getCharacterReferenceImages' | 'getCompositeReferenceImage'>;
  /** Run-scoped user style references (read for styleSource selection only). */
  uploadedStyleReferenceImages: () => ReadonlyArray<unknown>;
  resolveProtagonistCharacterId: (characterBible: CharacterBible, brief: FullCreativeBrief) => string | null;
  resolveCharacterIdWithBrief: (idOrName: string, characterBible: CharacterBible, brief: FullCreativeBrief) => string | null;
  shouldAttachCompositeCharacterRefs: () => boolean;
  generateImageWithDefectRetries: (
    prompt: ImagePrompt,
    identifier: string,
    metadata: any,
    referenceImages: any[] | undefined,
    label: string,
    outputDirectory?: string,
  ) => Promise<GeneratedImage>;
  buildCharacterDescriptions: (
    characterIds: string[],
    characterBible: CharacterBible
  ) => CharacterAppearanceDescription[];
}

export class CoverArtPhase {
  constructor(private deps: CoverArtPhaseDeps) {}

  /**
   * Generate a dedicated story cover image — movie-poster style, designed to sell the story.
   *
   * Two-step process informed by movie-poster design best practices:
   *   1. Distill the story into a PosterConcept brief (one core idea, one focal point,
   *      chosen compositional structure, symbolic elements, color strategy, gaze, negative
   *      space, depth cues, figure-ground plan, explicit cliché avoidances).
   *   2. Render the image from the brief, strictly matching the story's ArtStyleProfile
   *      and reserving a lower-band UI safe zone for the tile's title overlay.
   *
   * References: "one idea, one focal point", "symbols not scenes", core compositional
   * structures (triangular, rule-of-thirds, radial symmetry, scale asymmetry, silhouette,
   * grid/triptych, overhead/worm's-eye), deliberate depth cues, bulletproof figure-ground,
   * thumbnail scalability, gaze direction, negative space as composition, color as tool,
   * and cliché avoidance (floating heads, back-to-camera with weapon, default orange/teal,
   * lone figure in front of explosion, disembodied giant eye, stacked cast).
   */
  async run(input: CoverArtPhaseInput, context: PipelineContext): Promise<string | undefined> {
    const { brief, characterBible, worldBible, outputDirectory } = input;
    if (!context.config.imageGen?.enabled) return undefined;

    try {
      context.emit({ type: 'agent_start', agent: 'ImageService', message: 'Generating story cover art...' });

      const protagonistId = this.deps.resolveProtagonistCharacterId(characterBible, brief)
        || this.deps.resolveCharacterIdWithBrief(brief.protagonist.id || brief.protagonist.name, characterBible, brief)
        || this.deps.resolveCharacterIdWithBrief(brief.protagonist.name, characterBible, brief)
        || brief.protagonist.id;
      const protagonist = characterBible.characters.find(c => c.id === protagonistId);
      const antagonist = characterBible.characters.find(c =>
        c.role === 'antagonist' && c.importance === 'major'
      );
      const primaryLocation = worldBible.locations[0];

      const protDesc = protagonist
        ? `${protagonist.name}: ${protagonist.physicalDescription || (protagonist as CharacterProfile & { briefDescription?: string }).briefDescription}`
        : brief.protagonist.description;
      const antagDesc = antagonist
        ? `${antagonist.name}: ${antagonist.physicalDescription || (antagonist as CharacterProfile & { briefDescription?: string }).briefDescription}`
        : '';

      const artStyleProfile = context.config.imageGen?.artStyleProfile;
      const artStyle = this.deps.imageService.getGeminiSettings().canonicalArtStyle || context.config.artStyle || 'dramatic cinematic story art';

      const artDirectionLines: string[] = [];
      if (artStyleProfile) {
        artDirectionLines.push(`Style name: ${artStyleProfile.name}.`);
        if (artStyleProfile.renderingTechnique) artDirectionLines.push(`Rendering: ${artStyleProfile.renderingTechnique}.`);
        if (artStyleProfile.colorPhilosophy) artDirectionLines.push(`Color: ${artStyleProfile.colorPhilosophy}.`);
        if (artStyleProfile.lightingApproach) artDirectionLines.push(`Lighting: ${artStyleProfile.lightingApproach}.`);
        if (artStyleProfile.lineWeight) artDirectionLines.push(`Line/edge: ${artStyleProfile.lineWeight}.`);
        if (artStyleProfile.compositionStyle) artDirectionLines.push(`Composition language: ${artStyleProfile.compositionStyle}.`);
        if (artStyleProfile.moodRange) artDirectionLines.push(`Mood: ${artStyleProfile.moodRange}.`);
        if (artStyleProfile.positiveVocabulary?.length) {
          artDirectionLines.push(`Style vocabulary: ${artStyleProfile.positiveVocabulary.slice(0, 8).join(', ')}.`);
        }
      } else {
        artDirectionLines.push(`Art style: ${artStyle}.`);
      }
      const artDirection = artDirectionLines.join(' ');

      const styleNegativeTerms = Array.from(new Set([
        ...(artStyleProfile?.genreNegatives || []),
        ...(artStyleProfile?.inappropriateVocabulary || []),
      ].filter(Boolean)));
      const profileNegatives = styleNegativeTerms.length
        ? ', ' + styleNegativeTerms.join(', ')
        : '';

      // --- Step 1: Distill the story into a structured PosterConcept ------------------
      // A short, low-temperature LLM call that applies movie-poster design principles and
      // returns a concrete brief we can turn into a rendering prompt. Non-blocking: if the
      // distillation fails, we fall back to a principles-only prompt that still encodes the
      // best practices (just less specifically tuned to this story).
      let concept: PosterConcept | null = null;
      try {
        concept = await this.distillPosterConcept({
          brief,
          protDesc,
          antagDesc,
          primaryLocation: primaryLocation
            ? `${primaryLocation.name} — ${primaryLocation.fullDescription?.substring(0, 200) || primaryLocation.type}`
            : undefined,
          artDirection,
        }, context);
      } catch (conceptErr) {
        const msg = conceptErr instanceof Error ? conceptErr.message : String(conceptErr);
        console.warn(`[Pipeline] Poster concept distillation failed (non-blocking): ${msg}`);
        context.emit({ type: 'warning', phase: 'images', message: `Poster concept distillation failed: ${msg}` });
      }

      // --- Step 2: Build the image prompt from the concept brief ----------------------
      const conceptBlock = concept
        ? this.formatPosterConceptForPrompt(concept)
        : this.fallbackPosterConceptBlock(brief, protDesc, antagDesc, primaryLocation?.name);

      const coverPromptBase: ImagePrompt = {
        prompt:
          // Deliverable — what this is and is NOT
          `Produce a single theatrical MOVIE POSTER (one-sheet / streaming key art) for "${brief.story.title}". ` +
          `Genre: ${brief.story.genre}. Tone: ${brief.story.tone}. ` +
          `This is NOT a scene illustration, storyboard frame, character card, or book cover spread. It is iconic key art meant to be understood in half a second. ` +
          // Core idea & composition — the distilled brief
          `${conceptBlock} ` +
          // Design principles (movie-poster best practices, explicit)
          `MOVIE POSTER DESIGN PRINCIPLES (honor all of these): ` +
          `(1) ONE IDEA, ONE FOCAL POINT — a single unmistakable entry point the eye hits first; every other element is clearly subordinate via scale, contrast, position, or isolation. ` +
          `(2) SYMBOLS OVER SCENES — communicate with iconic, metaphorical imagery rather than literal scene illustration. ` +
          `(3) STRONG COMPOSITIONAL STRUCTURE — commit to one of: triangular/pyramidal, rule-of-thirds, radial/centered symmetry, scale asymmetry, silhouette-against-environment, or overhead/worm's-eye; do not hedge between structures. ` +
          `(4) DELIBERATE DEPTH — use overlap, diminishing scale, linear perspective, and atmospheric perspective (distant elements lighter, cooler, less saturated) to create three-dimensional space; avoid flat stacked layers. ` +
          `(5) BULLETPROOF FIGURE-GROUND — the focal subject must separate cleanly from background in value OR color OR edge sharpness; if squinted at, the subject's silhouette still reads. ` +
          `(6) THUMBNAIL SCALABLE — the silhouette of the hero element must still read when shrunk to tile size; no crucial detail depends on high resolution. ` +
          `(7) GAZE IS DELIBERATE — direct address, off-frame, or internal-loop; never accidental. ` +
          `(8) NEGATIVE SPACE IS COMPOSITION — empty areas are intentional and meaningful; resist the urge to fill every corner. ` +
          `(9) COLOR AS COMPOSITIONAL TOOL — prefer a limited, deliberate palette (2–3 dominant colors); a saturated accent in an otherwise desaturated image creates an automatic focal point; warm advances, cool recedes. ` +
          // Art direction — match the story's established look
          `ART DIRECTION (match the story's established visual language exactly): ${artDirection} ` +
          `Apply this art direction to every pixel — rendering technique, palette, lighting, and edge treatment must be instantly recognizable as belonging to this story. Do NOT default to generic photoreal cinematic — obey the style DNA above. ` +
          `If the style DNA rejects photorealism or live-action rendering, the cover must be clearly illustrated in the declared rendering technique, not photographic key art. ` +
          // Layout / tile safe zones
          `LAYOUT: PORTRAIT 2:3 aspect ratio (taller than wide). Vertical rhythm — upper third: atmospheric world / antagonist presence / symbolic element; middle third: focal subject at peak clarity; lower ~25%: quiet, darker, low-detail atmospheric foreground (smoke, mist, rain, shallow water, shadow, gradient) reserved as a UI-overlay SAFE ZONE. No critical visual detail in the bottom 25%. Generous negative space top and bottom. ` +
          // Cliché avoidance (explicit)
          `CLICHÉS TO AVOID (these signal lazy design — do NOT use unless the concept genuinely demands them): floating-heads lineup of actor faces; hero from behind looking over shoulder with a weapon; default orange-and-teal complementary color grade; lone figure standing in front of an explosion or apocalyptic skyline; disembodied giant eye; stacked/lineup ensemble cast portraits. ` +
          // Anti-text, anti-logo, anti-panel (hard rules)
          `ABSOLUTELY NO text, typography, title treatment, subtitle, tagline, credits block, watermark, signature, logo, or brand mark anywhere in the image. NO in-world readable signage, billboards, kanji, runes, badges with legible letters, or tattoos with letters. ` +
          `Single unified frame only — no diptych, no triptych, no panels, no film strip, no collage, no side bars, no letterbox bars, no picture-in-picture.`,
        negativePrompt:
          // Text & marks
          'text, words, letters, title, typography, tagline, credits, logo, watermark, caption, subtitle, signature, ' +
          'readable signage, billboards with text, kanji letters, runes with letters, tattoos with text, ' +
          // Layout violations
          'multiple panels, comic layout, storyboard, collage, split image, diptych, triptych, ' +
          'letterbox bars, black bars, side panels, picture-in-picture, image-within-image, ' +
          'landscape format, wide aspect, square aspect, ' +
          // Compositional failures
          'cluttered, busy, competing focal points, two equal subjects, dead center with no hierarchy, flat layers, ' +
          'low contrast subject against background, subject lost in background, ' +
          // Clichés to resist
          'floating heads, actor headshot grid, cast lineup, back-to-camera with weapon, ' +
          'default orange and teal, explosion behind hero, disembodied giant eye, ' +
          // Generic failures
          'boring, static, flat lighting, passport photo, mugshot, neutral pose' +
          profileNegatives,
        aspectRatio: '2:3',
        composition:
          `Vertical 2:3 movie-poster one-sheet. ${concept?.compositionalStructure ? `Compositional structure: ${concept.compositionalStructure}. ` : ''}` +
          'Single clear focal point; subordinate elements only. ' +
          'Deliberate depth via overlap / linear perspective / atmospheric perspective. ' +
          'Bottom ~25% reserved as quiet low-detail UI-overlay safe zone. ' +
          'Zero typography anywhere.',
      };
      const coverPrompt = applyPromptContract(coverPromptBase, {
        style: artStyle,
        styleSource: this.deps.uploadedStyleReferenceImages().length > 0 ? 'user-visual' : 'raw-season-style',
        mode: 'cover',
        characterIdentity: [protagonist?.name || brief.protagonist.name].filter(Boolean),
        sceneAction: concept?.visualMetaphor || brief.story.title,
        composition: coverPromptBase.composition,
        negativeContract: coverPromptBase.negativePrompt,
        hasVisualStyleRef: this.deps.uploadedStyleReferenceImages().length > 0,
      });

      const gemSettings = this.deps.imageService.getGeminiSettings();
      const maxPerChar = gemSettings.maxRefImagesPerCharacter || 2;

      const referenceImages: Array<{ data: string; mimeType: string; role: string; characterName: string; viewType: string }> = [];

      // Helper: canonicalize role from ref.name (e.g. "Aoi-face" → "character-reference-face")
      const roleFor = (refName: string): { role: string; viewType: string } => {
        const viewType = refName.split('-').pop() || 'front';
        if (viewType === 'face') return { role: 'character-reference-face', viewType };
        return { role: 'character-reference', viewType };
      };

      // Protagonist references — individual views (authoritative identity signal)
      const protRefs = this.deps.imageAgentTeam.getCharacterReferenceImages(
        protagonistId, false, maxPerChar, 'front', true
      );
      for (const ref of protRefs) {
        const { role, viewType } = roleFor(ref.name);
        referenceImages.push({
          data: ref.data, mimeType: ref.mimeType,
          role,
          characterName: protagonist?.name || brief.protagonist.name,
          viewType,
        });
      }
      // Composite turnarounds are only useful for providers that explicitly
      // consume them as identity anchors (Midjourney --cref). GPT Image 2 and
      // other edit-based providers should never see cached composite sheets.
      if (this.deps.shouldAttachCompositeCharacterRefs()) {
        const protComposite = this.deps.imageAgentTeam.getCompositeReferenceImage(protagonistId);
        if (protComposite) {
          referenceImages.push({
            data: protComposite.data, mimeType: protComposite.mimeType,
            role: 'composite-sheet',
            characterName: protagonist?.name || brief.protagonist.name,
            viewType: 'composite',
          });
        }
      }

      // Antagonist references (if available, limited)
      if (antagonist) {
        const antagRefs = this.deps.imageAgentTeam.getCharacterReferenceImages(
          antagonist.id, false, 2, 'front', true
        );
        for (const ref of antagRefs) {
          const { role, viewType } = roleFor(ref.name);
          referenceImages.push({
            data: ref.data, mimeType: ref.mimeType,
            role,
            characterName: antagonist.name,
            viewType,
          });
        }
        if (this.deps.shouldAttachCompositeCharacterRefs()) {
          const antagComposite = this.deps.imageAgentTeam.getCompositeReferenceImage(antagonist.id);
          if (antagComposite) {
            referenceImages.push({
              data: antagComposite.data, mimeType: antagComposite.mimeType,
              role: 'composite-sheet',
              characterName: antagonist.name,
              viewType: 'composite',
            });
          }
        }
      }

      const result = await withTimeout(
        this.deps.generateImageWithDefectRetries(
          coverPrompt,
          'story-cover',
          {
            type: 'cover' as const,
            characters: [protagonistId],
            characterNames: [protagonist?.name || brief.protagonist.name].filter(Boolean),
            characterDescriptions: this.deps.buildCharacterDescriptions([protagonistId], characterBible),
          },
          referenceImages.length > 0 ? referenceImages : undefined,
          'StoryCoverArt',
          outputDirectory,
        ),
        PIPELINE_TIMEOUTS.storyboard,
        'StoryCoverArt'
      );

      if (result.imageUrl) {
        context.emit({
          type: 'agent_complete', agent: 'ImageService',
          message: `Story cover art generated: ${result.imageUrl}`,
        });
        return result.imageUrl;
      }

      console.warn('[Pipeline] Cover art generation returned no imageUrl');
      return undefined;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[Pipeline] Cover art generation failed (non-blocking): ${errMsg}`);
      context.emit({ type: 'warning', phase: 'images', message: `Cover art generation failed: ${errMsg}` });
      return undefined;
    }
  }

  /**
   * Distill a story into a structured PosterConcept brief, applying movie-poster design
   * principles (one idea / one focal point, symbols over scenes, a chosen compositional
   * structure, deliberate depth cues, bulletproof figure-ground, explicit cliché avoidance).
   *
   * Low-temperature short LLM call; returns null if the response can't be parsed into the
   * expected shape — callers should fall back to the principles-only prompt block.
   */
  private async distillPosterConcept(input: {
    brief: FullCreativeBrief;
    protDesc: string;
    antagDesc: string;
    primaryLocation?: string;
    artDirection: string;
  }, context: PipelineContext): Promise<PosterConcept | null> {
    const { brief, protDesc, antagDesc, primaryLocation, artDirection } = input;

    const { BaseAgent } = await import('../../agents/BaseAgent');
    class PosterConceptDistiller extends BaseAgent {
      constructor(config: any) { super('PosterConceptDistiller', config); }
      protected getAgentSpecificPrompt(): string { return ''; }
      async execute(_input: any): Promise<any> { throw new Error('Use callLLM directly'); }
    }

    const distiller = new PosterConceptDistiller({
      ...context.config.agents.storyArchitect,
      maxTokens: 1200,
      temperature: 0.6,
    });

    const systemPrompt = `You are a senior movie-poster / key-art designer. You distill a story into a SINGLE iconic visual concept that can be rendered as a 2:3 portrait theatrical one-sheet.

You apply these principles without exception:
- ONE IDEA, ONE FOCAL POINT. A single unmistakable entry point the eye hits first; every other element clearly subordinate through scale, contrast, position, or isolation. If two elements compete equally, demote one.
- SYMBOLS OVER SCENES. The best key art is iconic and metaphorical (a red balloon in a storm drain; a fedora and a whip; a lone silhouette against a horizon). NOT a literal illustration of a scene from the story.
- COMMIT TO ONE COMPOSITIONAL STRUCTURE. Choose ONE of: "triangular", "rule-of-thirds", "radial-symmetry", "scale-asymmetry", "silhouette-against-environment", "overhead", "worms-eye". Justify briefly.
- DELIBERATE DEPTH. Specify how overlap, linear perspective, and atmospheric perspective (distant elements lighter/cooler/less saturated) create three-dimensional space.
- BULLETPROOF FIGURE-GROUND. Specify how the focal subject separates from the background in value, color, or edge sharpness; it must still read when squinted at.
- THUMBNAIL SCALABLE. The focal silhouette must still read at tile size.
- GAZE IS DELIBERATE. "direct" (staring out = confrontation/intimacy), "off-frame" (implies threat/goal), or "internal-loop" (closed relationship with another figure).
- NEGATIVE SPACE IS COMPOSITION. Empty space is intentional and carries meaning; do not fill every corner.
- COLOR AS COMPOSITIONAL TOOL. Prefer a limited palette (2–3 dominant colors); a saturated accent in an otherwise desaturated frame creates an automatic focal point; warm advances, cool recedes.

CLICHÉS TO AVOID unless the concept genuinely demands them:
- floating heads / actor-headshot lineup
- hero from behind looking over shoulder with a weapon
- default orange-and-teal complementary color grade
- lone figure standing in front of an explosion or apocalyptic skyline
- disembodied giant eye
- stacked / lineup full-cast portraits

The cover must RESPECT the story's established art direction (rendering technique, color philosophy, lighting, line treatment, mood). Never override the art direction with a renderer or finish that contradicts the style contract.

Return STRICT JSON with EXACTLY these fields, no markdown, no commentary:
{
  "coreIdea": "One sentence describing the single emotional promise of the poster — the 'half-a-second glance' feeling a viewer should walk away with.",
  "visualMetaphor": "A concrete iconic image / metaphor that encodes the coreIdea. Describe it as a symbol, not a scene (e.g. 'a wilted wedding bouquet cradled in a god's giant marble hand' rather than 'the bride at the altar').",
  "focalSubject": "The ONE thing the eye hits first — describe it concretely (subject, pose, scale, placement).",
  "compositionalStructure": "triangular | rule-of-thirds | radial-symmetry | scale-asymmetry | silhouette-against-environment | overhead | worms-eye",
  "structureRationale": "One sentence on why this structure fits this story.",
  "supportingElements": ["Up to 3 clearly subordinate elements — each one-line. Nothing else.", "..."],
  "colorStrategy": "The deliberate limited palette (2–3 dominant colors) AND any saturated accent that serves as an automatic focal point. Specify warm-vs-cool placement for depth.",
  "gazeDirection": "direct | off-frame | internal-loop | none (if focal subject is not a person)",
  "gazeRationale": "One sentence on what the gaze implies.",
  "negativeSpaceStrategy": "Where the intentional empty / quiet space lives and what it communicates (isolation, scale of threat, etc).",
  "depthStrategy": "How overlap, linear perspective, and atmospheric perspective create three-dimensional space.",
  "figureGroundStrategy": "How the focal subject separates from the background — which of value / color / edge sharpness carries the separation.",
  "clichesAvoided": ["From the cliché list, call out which are specifically at risk for this genre and MUST be avoided (e.g. 'no orange-teal grade', 'no floating heads')."],
  "thumbnailTest": "One sentence confirming what the silhouette reads as at tile size."
}`;

    const userPrompt = `STORY
Title: ${brief.story.title}
Genre: ${brief.story.genre}
Tone: ${brief.story.tone}
Themes: ${brief.story.themes.join(', ')}
Synopsis: ${brief.story.synopsis.substring(0, 800)}

PROTAGONIST
${protDesc}

${antagDesc ? `ANTAGONIST\n${antagDesc}\n\n` : ''}${primaryLocation ? `PRIMARY LOCATION / WORLD\n${primaryLocation}\n\n` : ''}ART DIRECTION (the cover MUST match this visual language — do not invent a different renderer)
${artDirection}

Design the key art. Return STRICT JSON matching the schema.`;

    const response = await (distiller as any).callLLM([
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ]);

    // Extract JSON object from the response
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn('[Pipeline] PosterConceptDistiller: no JSON object in response');
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(match[0]);
    } catch (err) {
      console.warn(`[Pipeline] PosterConceptDistiller: JSON parse failed — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }

    // Minimal validation — must have core idea and a focal subject or we can't proceed.
    if (!parsed.coreIdea || !parsed.focalSubject) {
      console.warn('[Pipeline] PosterConceptDistiller: missing coreIdea or focalSubject');
      return null;
    }

    const concept: PosterConcept = {
      coreIdea: String(parsed.coreIdea),
      visualMetaphor: String(parsed.visualMetaphor || parsed.focalSubject),
      focalSubject: String(parsed.focalSubject),
      compositionalStructure: normalizeCompositionalStructure(parsed.compositionalStructure),
      structureRationale: String(parsed.structureRationale || ''),
      supportingElements: Array.isArray(parsed.supportingElements)
        ? parsed.supportingElements.slice(0, 3).map((e: any) => String(e))
        : [],
      colorStrategy: String(parsed.colorStrategy || ''),
      gazeDirection: String(parsed.gazeDirection || 'none') as PosterGazeDirection,
      gazeRationale: String(parsed.gazeRationale || ''),
      negativeSpaceStrategy: String(parsed.negativeSpaceStrategy || ''),
      depthStrategy: String(parsed.depthStrategy || ''),
      figureGroundStrategy: String(parsed.figureGroundStrategy || ''),
      clichesAvoided: Array.isArray(parsed.clichesAvoided)
        ? parsed.clichesAvoided.slice(0, 6).map((e: any) => String(e))
        : [],
      thumbnailTest: String(parsed.thumbnailTest || ''),
    };

    context.emit({
      type: 'debug',
      phase: 'images',
      message: `Poster concept distilled: ${concept.coreIdea.substring(0, 140)}`,
    });

    return concept;
  }

  /**
   * Turn a distilled PosterConcept into a dense natural-language block that the image
   * model can act on directly. Each sentence maps to a design principle.
   */
  private formatPosterConceptForPrompt(c: PosterConcept): string {
    const parts: string[] = [];
    parts.push(`CORE IDEA (the half-a-second glance feeling): ${c.coreIdea}`);
    parts.push(`VISUAL METAPHOR (iconic, symbolic — NOT a literal scene): ${c.visualMetaphor}`);
    parts.push(`FOCAL SUBJECT (the ONE thing the eye hits first; every other element subordinate): ${c.focalSubject}`);
    parts.push(`COMPOSITIONAL STRUCTURE: ${c.compositionalStructure}${c.structureRationale ? ` — ${c.structureRationale}` : ''}.`);
    if (c.supportingElements.length) {
      parts.push(`Supporting elements (clearly subordinate, max 3): ${c.supportingElements.join(' | ')}.`);
    }
    if (c.colorStrategy) parts.push(`COLOR STRATEGY: ${c.colorStrategy}`);
    if (c.gazeDirection && c.gazeDirection !== 'none') {
      parts.push(`GAZE: ${c.gazeDirection}${c.gazeRationale ? ` — ${c.gazeRationale}` : ''}.`);
    }
    if (c.negativeSpaceStrategy) parts.push(`NEGATIVE SPACE: ${c.negativeSpaceStrategy}`);
    if (c.depthStrategy) parts.push(`DEPTH: ${c.depthStrategy}`);
    if (c.figureGroundStrategy) parts.push(`FIGURE-GROUND: ${c.figureGroundStrategy}`);
    if (c.clichesAvoided.length) {
      parts.push(`EXPLICITLY AVOID these clichés (they are at-risk for this genre): ${c.clichesAvoided.join('; ')}.`);
    }
    if (c.thumbnailTest) parts.push(`THUMBNAIL TEST: ${c.thumbnailTest}`);
    return parts.join(' ');
  }

  /**
   * Fallback concept block when LLM distillation is unavailable. Keeps the design
   * principles explicit and protagonist/antagonist roles clear, but without the
   * story-specific metaphor.
   */
  private fallbackPosterConceptBlock(
    brief: FullCreativeBrief,
    protDesc: string,
    antagDesc: string,
    locationName?: string
  ): string {
    const parts: string[] = [];
    parts.push(`CORE IDEA: Distill "${brief.story.title}" (${brief.story.genre}, ${brief.story.tone}) into a SINGLE iconic visual metaphor — the emotional promise a viewer walks away with in half a second.`);
    parts.push(`FOCAL SUBJECT: ${protDesc} staged as the one unmistakable entry point the eye hits first; every other element is clearly subordinate.`);
    if (antagDesc) {
      parts.push(`Antagonist presence as a looming, shadowed, reflected, or scale-asymmetric counterweight (never a second equal hero): ${antagDesc}.`);
    }
    if (locationName) {
      parts.push(`World atmosphere: ${locationName} — expressed symbolically, not as a literal scene.`);
    }
    parts.push(`Themes expressed symbolically through the chosen metaphor: ${brief.story.themes.join(', ')}.`);
    parts.push(`COMPOSITIONAL STRUCTURE: pick ONE clean structure (triangular, rule-of-thirds, radial-symmetry, scale-asymmetry, silhouette-against-environment, overhead, or worm's-eye) and commit fully.`);
    return parts.join(' ');
  }
}
