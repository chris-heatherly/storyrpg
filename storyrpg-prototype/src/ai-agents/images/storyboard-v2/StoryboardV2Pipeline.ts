import type { PipelineConfig } from '../../config';
import type { CharacterBible, CharacterProfile } from '../../agents/CharacterDesigner';
import type { SceneContent } from '../../agents/SceneWriter';
import type { ChoiceSet } from '../../agents/ChoiceAuthor';
import type { EncounterStructure } from '../../agents/EncounterArchitect';
import type { GeneratedImage, ImagePrompt } from '../../agents/ImageGenerator';
import { ImageGenerationService, type ImageJobEvent, type ReferenceImage } from '../../services/imageGenerationService';
import { normalizeManagedOutputPath } from '../../services/imageGenerationHelpers';
import { PROXY_CONFIG } from '../../../config/endpoints';
import type { AssetRegistry } from '../assetRegistry';
import type { SlotReferencePack } from '../slotTypes';
import { compileStoryboardScenePacket, type StoryboardPanelSlot, type StoryboardScenePacket } from './storyboardCompiler';
import type { ImageDefectReport } from '../imageDefectGate';
import { sanitizeStyleContaminationText } from '../imagePromptContracts';
import { buildVisualGrammarDirective, formatVisualGrammarDirective, type VisualGrammarDirective } from './visualGrammar';

let nodeFs: typeof import('fs/promises') | undefined;
let sharp: any;
try {
  nodeFs = require('fs/promises');
  sharp = require('sharp');
} catch {
  nodeFs = undefined;
  sharp = undefined;
}

const STORYBOARD_DEFAULT_PANELS_PER_SHEET = 6;
const STORYBOARD_MAX_PANELS_PER_SHEET = 12;
const STORYBOARD_CROP_INSET_RATIO = 0.04;
const DERIVED_PANEL_WIDTH = 1024;
const DERIVED_PANEL_HEIGHT = 1536;
const STYLE_HIERARCHY_BLOCK = [
  'REFERENCE ROLE HIERARCHY:',
  '- ART STYLE text is the highest authority for visual style.',
  '- episodeStyleLockRef controls palette, lighting, texture, rendering approach, finish, and mood only.',
  '- Character references control identity, face, hair, body type, silhouette, wardrobe language, and recognizable design only.',
  '- Storyboard sheet/crop controls composition, staging, pose, camera angle, framing, and action only.',
  '- Do not borrow style from character sheets, crops, previous panels, or story prose if it conflicts with ART STYLE or episodeStyleLockRef.',
].join('\n');
const DUPLICATE_CHARACTER_RULE = 'DUPLICATE-CHARACTER RULE: each visible canonical character may appear exactly once in each panel. Character reference sheets show identity only; multiple views in a reference do not mean multiple bodies in the scene. Do not create clones, twins, repeated background copies, reflection-like duplicates, or a second copy of the same character unless the story explicitly requires an actual mirror, reflection, vision, or duplicate.';
const SCREEN_TEXT_POLICY = 'PHONE / SCREEN POLICY: avoid phones, tablets, laptops, signs, papers, books, labels, badges, and other readable surfaces unless the panel absolutely needs them. When a screen or written surface is necessary, render it face-down, blank, dark, reflective, glare-obscured, cropped away, or so small/angled that no letters, numbers, icons, notifications, app UI, or symbols are readable.';
const WARDROBE_IDENTITY_POLICY = 'WARDROBE / IDENTITY POLICY: preserve each referenced character\'s exact canonical wardrobe essentials, hair, face shape, skin tone, eye color, distinguishing marks, and silhouette. Do not simplify a character by changing their outfit, removing occupational markers, changing hair color, or swapping them into neutral clothing during QA repair.';
const STORYBOARD_BLOCKED_STYLE_TERMS: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  { label: 'cinematic', pattern: /\bcinematic\b/gi, replacement: 'story-focused' },
  { label: 'photoreal', pattern: /\bphotoreal(?:istic|ism)?\b/gi, replacement: 'visual' },
  { label: '3D render', pattern: /\b(?:realistic\s+)?3D render\b/gi, replacement: 'image' },
  { label: 'oil painting', pattern: /\boil painting(?: texture)?\b/gi, replacement: 'image' },
  { label: 'DSLR', pattern: /\bDSLR(?: photo)?\b/gi, replacement: 'image' },
  { label: 'lens', pattern: /\blens(?: blur)?\b/gi, replacement: 'view' },
  { label: 'bokeh', pattern: /\bbokeh\b/gi, replacement: 'background accents' },
  { label: 'film still', pattern: /\bfilm still\b/gi, replacement: 'story image' },
  { label: 'Unreal', pattern: /\bUnreal Engine\b/gi, replacement: 'image' },
  { label: 'Octane', pattern: /\bOctane render\b/gi, replacement: 'image' },
  { label: 'high fashion', pattern: /\bhigh fashion\b/gi, replacement: 'distinctive clothing' },
  { label: 'avant-garde', pattern: /\bavant-garde\b/gi, replacement: 'unusual' },
  { label: 'gothic', pattern: /\bgothic\s+(?:style|aesthetic|fashion|look|vibe)\b/gi, replacement: 'dark mood' },
  { label: 'vintage', pattern: /\bvintage\s+(?:style|aesthetic|fashion|look|vibe)\b/gi, replacement: 'older' },
  { label: 'designer', pattern: /\bdesigner\s+(?:style|aesthetic|fashion|look|clothing|wardrobe)\b/gi, replacement: 'distinctive clothing' },
];

interface StoryboardSheetLayout {
  columns: number;
  rows: number;
  aspectRatio: string;
  panelAspectRatio: string;
}

interface StoryboardSheetChunk {
  sheetId: string;
  sceneId: string;
  scopedSceneId: string;
  chunkIndex: number;
  branchPath?: string;
  panels: StoryboardPanelSlot[];
  layout: StoryboardSheetLayout;
}

interface StoryboardSheetCrop {
  slotId: string;
  panelIndex: number;
  cellBox: { x: number; y: number; width: number; height: number };
  cropBox: { x: number; y: number; width: number; height: number };
  draftCropImageUrl?: string;
  draftCropImagePath?: string;
  finalImageUrl?: string;
  finalImagePath?: string;
  sourceWidthBeforeResize?: number;
  sourceHeightBeforeResize?: number;
  referenceRoles?: string[];
  visibleCharacterIds?: string[];
  unresolvedCharacterIds?: string[];
  characterResolutionWarnings?: string[];
  panelQa?: unknown;
}

type StoryboardRepairMode = 'none' | 'edit' | 'regenerate';

interface StoryboardVisualQaSummary {
  stage: 'sheet' | 'panel';
  identifier: string;
  passed: boolean;
  skipped?: boolean;
  issues: string[];
  rawIssues?: string[];
  advisory?: boolean;
  advisoryIssues?: string[];
  blockingIssues?: string[];
  reason?: string;
  styleDriftReason?: string;
  repairMode: StoryboardRepairMode;
  attempt: number;
  retryOf?: string;
}

interface StoryboardRequiredSlotFailure {
  slotId: string;
  family: StoryboardPanelSlot['family'];
  sceneId: string;
  scopedSceneId: string;
  beatId: string;
  sheetId: string;
  error: string;
}

export interface StoryboardV2Brief {
  story: {
    title: string;
    genre: string;
    tone: string;
    synopsis?: string;
  };
  episode: {
    number: number;
    title: string;
    synopsis?: string;
  };
  protagonist?: {
    id?: string;
    name?: string;
  };
}

export interface StoryboardV2Result {
  beatImages: Map<string, string>;
  sceneImages: Map<string, string>;
  encounterImageResults: {
    encounterImages: Map<string, { setupImages: Map<string, string>; outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }> }>;
    storyletImages: Map<string, Map<string, Map<string, string>>>;
    storyletFailures?: string[];
  };
  diagnostics: {
    pipelineMode: 'storyboard-v2';
    rawArtStyle: string;
    model: string;
    sceneCount: number;
    panelCount: number;
    sheetCount: number;
    localImageCount: number;
    failedSlots: Array<{ slotId: string; error: string }>;
    advisoryQaWarnings: Array<{ identifier: string; stage: 'sheet' | 'panel'; issues: string[]; reason?: string }>;
    requiredSlotFailures: StoryboardRequiredSlotFailure[];
    imageCompleteness: {
      complete: boolean;
      requiredSlotCount: number;
      resolvedRequiredSlotCount: number;
      missingRequiredSlotCount: number;
    };
  };
}

export interface StoryboardV2PipelineOptions {
  config: PipelineConfig;
  imageService?: ImageGenerationService;
  assetRegistry: AssetRegistry;
  outputDirectory?: string;
  emit?: (event: { type: string; phase?: string; message?: string; data?: unknown; [key: string]: unknown }) => void;
  onImageJobEvent?: (event: ImageJobEvent) => void;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-./]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'storyboard';
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function hasImageData(result: GeneratedImage | undefined): result is GeneratedImage & { imageData: string; mimeType: string } {
  return Boolean(result?.imageData && result?.mimeType);
}

function compact(text: unknown, fallback = ''): string {
  if (typeof text !== 'string') return fallback;
  return text.replace(/\s+/g, ' ').trim() || fallback;
}

const GENERIC_BACKGROUND_CHARACTER_LABELS = new Set([
  'attendant',
  'barista',
  'bystander',
  'clerk',
  'commuter',
  'crowd',
  'customer',
  'driver',
  'guest',
  'host',
  'neighbor',
  'onlooker',
  'passerby',
  'passer by',
  'patron',
  'pedestrian',
  'server',
  'shopper',
  'spectator',
  'staff',
  'stranger',
  'vendor',
  'waiter',
  'waitress',
  'worker',
]);

function isGenericBackgroundCharacterLabel(value: string): boolean {
  const normalized = compact(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (GENERIC_BACKGROUND_CHARACTER_LABELS.has(normalized)) return true;
  return /^(?:background|generic|unnamed|random|nearby|passing)\s+(?:person|people|extra|extras|guest|guests|pedestrian|pedestrians|patron|patrons|bystander|bystanders|worker|workers|shopper|shoppers)$/.test(normalized);
}

function containsNonGenericCapitalizedName(text: string): boolean {
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) || [];
  return matches.some((match) => !isGenericBackgroundCharacterLabel(match));
}

function rawStyleAllowsTerm(rawArtStyle: string, label: string): boolean {
  return rawArtStyle.toLowerCase().includes(label.toLowerCase());
}

function sanitizeStoryboardText(value: unknown, rawArtStyle: string): { text: string; sanitizedTerms: string[] } {
  if (typeof value !== 'string' || !value.trim()) return { text: '', sanitizedTerms: [] };
  const firstPass = sanitizeStyleContaminationText(value);
  let text = firstPass.text;
  const sanitizedTerms = [...firstPass.sanitizedTerms];
  for (const rule of STORYBOARD_BLOCKED_STYLE_TERMS) {
    if (rawStyleAllowsTerm(rawArtStyle, rule.label)) {
      rule.pattern.lastIndex = 0;
      continue;
    }
    if (rule.pattern.test(text)) {
      sanitizedTerms.push(rule.label);
      text = text.replace(rule.pattern, rule.replacement);
    }
    rule.pattern.lastIndex = 0;
  }
  return {
    text: text.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim(),
    sanitizedTerms: Array.from(new Set(sanitizedTerms)),
  };
}

function sanitizedLine(label: string, value: unknown, rawArtStyle: string): string {
  const sanitized = sanitizeStoryboardText(value, rawArtStyle).text;
  return sanitized ? `${label}: ${sanitized}` : '';
}

function styleHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16);
}

function referenceHash(ref?: ReferenceImage): string | undefined {
  if (!ref?.data) return undefined;
  return styleHash(`${ref.role}:${ref.mimeType}:${ref.data.slice(0, 128)}:${ref.data.length}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function characterMentionAliases(name: string): string[] {
  const raw = compact(name);
  if (!raw) return [];
  const aliases = new Set<string>([raw]);
  for (const part of raw.split(/\s*(?:\/|&|\+|\band\b|\bor\b|\s+)\s*/i)) {
    const clean = compact(part);
    if (clean && clean.length > 1) aliases.add(clean);
  }
  const slashParts = raw.split('/').map((part) => compact(part)).filter(Boolean);
  if (slashParts.length > 1) {
    aliases.add(slashParts[0]);
    aliases.add(slashParts[1].split(/\s+/)[0]);
  }
  return [...aliases].sort((a, b) => b.length - a.length);
}

function toServedImageUrl(imagePath?: string): string | undefined {
  if (!imagePath) return undefined;
  const normalized = normalizeManagedOutputPath(imagePath);
  if (!normalized.startsWith('generated-stories/')) return normalized;
  return `${PROXY_CONFIG.getProxyUrl()}/${normalized}`;
}

function mapBeatKey(brief: StoryboardV2Brief, sceneId: string, beatId: string): string {
  return `episode-${brief.episode.number}-${sceneId}::${beatId}`;
}

function mapSceneKey(brief: StoryboardV2Brief, sceneId: string): string {
  return `episode-${brief.episode.number}-${sceneId}`;
}

export class StoryboardV2Pipeline {
  private readonly config: PipelineConfig;
  private readonly imageService: ImageGenerationService;
  private readonly assetRegistry: AssetRegistry;
  private readonly outputDirectory?: string;
  private readonly emitEvent?: StoryboardV2PipelineOptions['emit'];
  private readonly characterRefs = new Map<string, ReferenceImage>();
  private episodeStyleLockRef?: ReferenceImage;
  private readonly failedSlots: Array<{ slotId: string; error: string }> = [];
  private readonly promptAudits: Array<Record<string, unknown>> = [];
  private readonly styleConsistencyFailures: Array<{ identifier: string; error: string }> = [];
  private readonly advisoryQaWarnings: Array<{ identifier: string; stage: 'sheet' | 'panel'; issues: string[]; reason?: string }> = [];
  private readonly sheetManifest: Array<{
    sheetId: string;
    sceneId: string;
    scopedSceneId: string;
    chunkIndex: number;
    branchPath?: string;
    imageUrl?: string;
    imagePath?: string;
    sourceWidth?: number;
    sourceHeight?: number;
    panelOrder: Array<{
      index: number;
      sequenceIndex?: number;
      slotId: string;
      family: StoryboardPanelSlot['family'];
      beatId: string;
      label: string;
      visibleCharacterIds?: string[];
      unresolvedCharacterIds?: string[];
      characterResolutionWarnings?: string[];
      visualGrammar?: VisualGrammarDirective;
    }>;
    layout: StoryboardSheetLayout;
    crops: StoryboardSheetCrop[];
    sheetQa?: unknown;
  }> = [];
  private readonly localImages: Array<{
    slotId: string;
    family: StoryboardPanelSlot['family'];
    sceneId: string;
    scopedSceneId: string;
    beatId: string;
    sequenceIndex?: number;
    imageUrl?: string;
    imagePath?: string;
  }> = [];

  constructor(options: StoryboardV2PipelineOptions) {
    this.config = options.config;
    this.assetRegistry = options.assetRegistry;
    this.outputDirectory = options.outputDirectory ? ensureTrailingSlash(options.outputDirectory) : undefined;
    this.emitEvent = options.emit;

    this.imageService = options.imageService || new ImageGenerationService({
      ...(this.config.imageGen || {}),
      enabled: true,
      provider: 'dall-e',
      openaiApiKey: this.config.imageGen?.openaiApiKey,
      openaiImageModel: this.config.imageGen?.openaiImageModel || 'gpt-image-2',
      openaiModeration: this.config.imageGen?.openaiModeration || 'auto',
      outputDirectory: this.outputDirectory ? `${this.outputDirectory}images/storyboard-v2/` : undefined,
      savePrompts: true,
      failFast: this.config.generation?.failurePolicy === 'fail_fast',
    } as any);

    if (options.onImageJobEvent) {
      this.imageService.onEvent((event) => options.onImageJobEvent?.(this.enrichImageJobEvent(event)));
    }
  }

  async generateEpisode(params: {
    brief: StoryboardV2Brief;
    sceneContents: SceneContent[];
    choiceSets?: ChoiceSet[];
    characterBible: CharacterBible;
    encounters?: Map<string, EncounterStructure>;
  }): Promise<StoryboardV2Result> {
    const { brief, sceneContents, characterBible } = params;
    const rawArtStyle = compact(this.config.artStyle, 'expressive illustrated story art');
    const model = this.config.imageGen?.openaiImageModel || 'gpt-image-2';

    this.imageService.setOutputDirectory(this.outputDirectory ? `${this.outputDirectory}images/storyboard-v2/` : './generated-images/storyboard-v2/');
    this.emit('phase_start', 'images', `Storyboard v2: generating GPT Image panels for Episode ${brief.episode.number}...`);

    this.episodeStyleLockRef = await this.generateEpisodeStyleLockReference(brief, sceneContents, rawArtStyle);
    if (!this.episodeStyleLockRef) {
      throw new Error('Storyboard v2 style lock failed: episodeStyleLockRef is required before generating sheets or refined panels.');
    }

    const beatImages = new Map<string, string>();
    const sceneImages = new Map<string, string>();
    const encounterImages = new Map<string, { setupImages: Map<string, string>; outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }> }>();
    const storyletImages = new Map<string, Map<string, Map<string, string>>>();
    const packets: StoryboardScenePacket[] = [];

    for (const scene of sceneContents) {
      const scopedSceneId = mapSceneKey(brief, scene.sceneId);
      const packet = compileStoryboardScenePacket({
        scene,
        scopedSceneId,
        characterBible,
        protagonistId: brief.protagonist?.id,
        protagonistName: brief.protagonist?.name,
        encounter: params.encounters?.get(scene.sceneId),
      });
      packets.push(packet);
      await this.saveJson(`images/storyboard-v2/${scopedSceneId}.packet.json`, packet);
    }

    await this.ensureAllCharacterRefs(characterBible, rawArtStyle);

    for (const packet of packets) {
      const chunks = this.buildSheetChunks(packet);
      for (const chunk of chunks) {
        const sheetResult = await this.generateSheet({
          brief,
          packet,
          chunk,
          characterBible,
          rawArtStyle,
        });
        if (!sheetResult) continue;
        for (const panel of chunk.panels) {
          const result = await this.derivePanelFromSheet({
            brief,
            packet,
            chunk,
            panel,
            sheetResult,
            rawArtStyle,
            characterBible,
          });
          if (!result?.imageUrl) continue;
          this.bindPanelResult(brief, panel, result, beatImages, sceneImages, encounterImages, storyletImages);
        }
      }
    }

    const requiredSlotFailures = this.collectRequiredSlotFailures({
      brief,
      packets,
      beatImages,
      encounterImages,
      storyletImages,
    });
    if (requiredSlotFailures.length > 0) {
      this.emit('warning', 'images', `Storyboard v2 incomplete: ${requiredSlotFailures.length} required image slot(s) were not bound.`, {
        requiredSlotFailures,
      });
    }
    const requiredSlotCount = packets.reduce((sum, packet) => sum + packet.panels.length, 0);
    const imageCompleteness = {
      complete: requiredSlotFailures.length === 0,
      requiredSlotCount,
      resolvedRequiredSlotCount: Math.max(0, requiredSlotCount - requiredSlotFailures.length),
      missingRequiredSlotCount: requiredSlotFailures.length,
    };

    await this.saveJson('images/storyboard-v2/reference-manifest.json', {
      rawArtStyle,
      model,
      episodeStyleLockRef: this.episodeStyleLockRef ? {
        role: this.episodeStyleLockRef.role,
        governs: this.episodeStyleLockRef.governs,
        prohibited: this.episodeStyleLockRef.prohibited,
        mimeType: this.episodeStyleLockRef.mimeType,
        hash: referenceHash(this.episodeStyleLockRef),
        hasData: Boolean(this.episodeStyleLockRef.data),
      } : undefined,
      characterRefs: [...this.characterRefs.entries()].map(([characterId, ref]) => ({
        characterId,
        role: ref.role,
        governs: ref.governs,
        prohibited: ref.prohibited,
        refCharacterId: ref.characterId,
        characterName: ref.characterName,
        viewType: ref.viewType,
        mimeType: ref.mimeType,
      })),
    });
    await this.saveJson('images/storyboard-v2/sheet-manifest.json', {
      pipelineMode: 'storyboard-v2',
      rawArtStyle,
      rawArtStyleHash: styleHash(rawArtStyle),
      episodeStyleLockHash: referenceHash(this.episodeStyleLockRef),
      model,
      maxPanelsPerSheet: this.maxPanelsPerSheet(),
      cropInsetRatio: this.cropInsetRatio(),
      refineCroppedPanels: this.refineCroppedPanels(),
      sheets: this.sheetManifest,
      styleConsistencyFailures: this.styleConsistencyFailures,
      advisoryQaWarnings: this.advisoryQaWarnings,
      requiredSlotFailures,
      imageCompleteness,
    });
    await this.saveJson('images/storyboard-v2/summary.json', {
      pipelineMode: 'storyboard-v2',
      rawArtStyle,
      rawArtStyleHash: styleHash(rawArtStyle),
      episodeStyleLockHash: referenceHash(this.episodeStyleLockRef),
      model,
      sceneCount: sceneContents.length,
      panelCount: packets.reduce((sum, packet) => sum + packet.panels.length, 0),
      sheetCount: this.sheetManifest.length,
      localImageCount: this.localImages.length,
      failedSlots: this.failedSlots,
      styleConsistencyFailures: this.styleConsistencyFailures,
      advisoryQaWarnings: this.advisoryQaWarnings,
      requiredSlotFailures,
      imageCompleteness,
    });
    await this.saveJson('images/storyboard-v2/local-images.json', {
      pipelineMode: 'storyboard-v2',
      rawArtStyle,
      rawArtStyleHash: styleHash(rawArtStyle),
      episodeStyleLockHash: referenceHash(this.episodeStyleLockRef),
      model,
      images: this.localImages,
    });
    await this.saveJson('images/storyboard-v2/prompt-audits.json', {
      pipelineMode: 'storyboard-v2',
      rawArtStyle,
      rawArtStyleHash: styleHash(rawArtStyle),
      episodeStyleLockHash: referenceHash(this.episodeStyleLockRef),
      audits: this.promptAudits,
      styleConsistencyFailures: this.styleConsistencyFailures,
      advisoryQaWarnings: this.advisoryQaWarnings,
      requiredSlotFailures,
      imageCompleteness,
    });

    return {
      beatImages,
      sceneImages,
      encounterImageResults: {
        encounterImages,
        storyletImages,
        storyletFailures: this.failedSlots.filter((slot) => slot.slotId.startsWith('storylet-aftermath:')).map((slot) => slot.slotId),
      },
      diagnostics: {
        pipelineMode: 'storyboard-v2',
        rawArtStyle,
        model,
        sceneCount: sceneContents.length,
        panelCount: packets.reduce((sum, packet) => sum + packet.panels.length, 0),
        sheetCount: this.sheetManifest.length,
        localImageCount: this.localImages.length,
        failedSlots: this.failedSlots,
        advisoryQaWarnings: this.advisoryQaWarnings,
        requiredSlotFailures,
        imageCompleteness,
      },
    };
  }

  private enrichImageJobEvent(event: ImageJobEvent): ImageJobEvent {
    if (event.type !== 'job_updated' || !event.updates?.imageUrl) return event;
    const localPath = this.localImages.find((image) => image.imageUrl === event.updates.imageUrl)?.imagePath;
    if (!localPath) return event;
    return {
      ...event,
      updates: {
        ...event.updates,
        imagePath: localPath,
        localPath,
      },
    };
  }

  private collectRequiredSlotFailures(params: {
    brief: StoryboardV2Brief;
    packets: StoryboardScenePacket[];
    beatImages: Map<string, string>;
    encounterImages: StoryboardV2Result['encounterImageResults']['encounterImages'];
    storyletImages: StoryboardV2Result['encounterImageResults']['storyletImages'];
  }): StoryboardRequiredSlotFailure[] {
    const failures: StoryboardRequiredSlotFailure[] = [];
    for (const packet of params.packets) {
      for (const chunk of this.buildSheetChunks(packet)) {
        for (const panel of chunk.panels) {
          let url: string | undefined;
          if (panel.family === 'story-beat') {
            url = params.beatImages.get(mapBeatKey(params.brief, panel.sceneId, panel.beatId));
          } else if (panel.family === 'encounter-setup') {
            url = params.encounterImages.get(panel.sceneId)?.setupImages.get(panel.beatId);
          } else if (panel.family === 'encounter-situation' && panel.situationKey) {
            url = params.encounterImages.get(panel.sceneId)?.setupImages.get(panel.situationKey);
          } else if (panel.family === 'encounter-outcome' && panel.choiceMapKey && panel.outcomeTier) {
            url = params.encounterImages.get(panel.sceneId)?.outcomeImages.get(panel.choiceMapKey)?.[panel.outcomeTier];
          } else if (panel.family === 'storylet-aftermath' && panel.outcomeName) {
            url = params.storyletImages.get(panel.sceneId)?.get(panel.outcomeName)?.get(panel.beatId);
          }

          if (url) continue;
          failures.push({
            slotId: this.registrySlotId(panel),
            family: panel.family,
            sceneId: panel.sceneId,
            scopedSceneId: panel.scopedSceneId,
            beatId: panel.beatId,
            sheetId: chunk.sheetId,
            error: 'Required storyboard panel image was not bound; scene background fallback does not satisfy beat-level coverage.',
          });
        }
      }
    }
    return failures;
  }

  private async generateEpisodeStyleLockReference(
    brief: StoryboardV2Brief,
    scenes: SceneContent[],
    rawArtStyle: string,
  ): Promise<ReferenceImage | undefined> {
    const prompt: ImagePrompt = {
      prompt: [
        `ART STYLE: ${rawArtStyle}`,
        'Create one compact wordless vertical 9:16 episodeStyleLockRef for this episode.',
        'This is the canonical style-lock reference for palette, lighting, rendering language, brush/line/texture cues, finish, and mood only.',
        'Do not include character identity, character sheets, faces, bodies, panel grids, typography, UI, captions, labels, symbols, logos, watermarks, or story action.',
        `Story: ${sanitizeStoryboardText(brief.story.title, rawArtStyle).text}. Episode: ${sanitizeStoryboardText(brief.episode.title, rawArtStyle).text}.`,
        `Genre/tone: ${sanitizeStoryboardText(brief.story.genre, rawArtStyle).text}, ${sanitizeStoryboardText(brief.story.tone, rawArtStyle).text}.`,
        `Emotional arc: ${scenes.map((scene) => `${sanitizeStoryboardText(scene.sceneName, rawArtStyle).text}: ${(scene.moodProgression || []).map((mood) => sanitizeStoryboardText(mood, rawArtStyle).text).filter(Boolean).join(' -> ')}`).join(' | ')}`,
        'Leave the lower 30-40% calm and darker so the reference reinforces reader-overlay-safe value structure.',
      ].join('\n'),
      style: rawArtStyle,
      aspectRatio: '9:16',
      composition: 'vertical episode style lock, palette lighting texture finish mood, overlay-safe lower third',
    };
    const result = await this.safeGenerate(prompt, `storyboard-v2-episode-${brief.episode.number}-style-lock-ref`, { type: 'episode-style-lock' }, undefined);
    if (!hasImageData(result)) return undefined;
    return {
      data: result.imageData,
      mimeType: result.mimeType,
      role: 'episode-style-lock',
      governs: ['palette', 'lighting', 'texture', 'rendering', 'finish', 'mood'],
      prohibited: ['character identity', 'composition', 'story action'],
      viewType: 'style',
    };
  }

  private async ensureCharacterRef(character: CharacterProfile, rawArtStyle: string): Promise<ReferenceImage | undefined> {
    const existing = this.characterRefs.get(character.id);
    if (existing) return existing;
    const prompt: ImagePrompt = {
      prompt: [
        `ART STYLE: ${rawArtStyle}`,
        `Create a clean visual reference image for ${character.name}.`,
        `Canonical appearance: ${sanitizeStoryboardText(character.physicalDescription || character.description || character.overview, rawArtStyle).text}`,
        character.typicalAttire ? `Typical attire: ${sanitizeStoryboardText(character.typicalAttire, rawArtStyle).text}` : '',
        character.distinctiveFeatures?.length ? `Distinctive features: ${character.distinctiveFeatures.map((feature) => sanitizeStoryboardText(feature, rawArtStyle).text).filter(Boolean).join(', ')}` : '',
        'Show the character clearly in a natural, readable pose. No text, labels, captions, borders, logos, or watermark.',
        'This is an identity reference only. Downstream prompts must not use it as a style reference, palette reference, rendering reference, or visual inspiration.',
      ].filter(Boolean).join('\n'),
      style: rawArtStyle,
      aspectRatio: '9:16',
      composition: 'single-character visual reference, clear face and full silhouette',
    };
    const result = await this.safeGenerate(prompt, `storyboard-v2-ref-${safeId(character.id)}`, { characterId: character.id }, undefined);
    if (!hasImageData(result)) return undefined;
    const ref: ReferenceImage = {
      data: result.imageData,
      mimeType: result.mimeType,
      role: 'character-reference',
      governs: ['identity', 'face', 'hair', 'body type', 'silhouette', 'wardrobe language'],
      prohibited: ['rendering style', 'palette', 'lighting', 'composition', 'story action'],
      characterId: character.id,
      characterName: character.name,
      viewType: 'front',
      visualAnchors: [
        character.physicalDescription,
        character.typicalAttire,
        ...(character.distinctiveFeatures || []),
      ].filter(Boolean).slice(0, 6) as string[],
    };
    this.characterRefs.set(character.id, ref);
    return ref;
  }

  private async ensureAllCharacterRefs(characterBible: CharacterBible, rawArtStyle: string): Promise<void> {
    for (const character of characterBible.characters || []) {
      if (!character?.id) continue;
      await this.ensureCharacterRef(character, rawArtStyle);
    }
  }

  private layoutForPanelCount(panelCount: number): StoryboardSheetLayout {
    if (panelCount <= 1) return { columns: 1, rows: 1, aspectRatio: '9:16', panelAspectRatio: '9:16' };
    if (panelCount <= 3) return { columns: panelCount, rows: 1, aspectRatio: `${panelCount * 9}:16`, panelAspectRatio: '9:16' };
    if (panelCount <= 4) return { columns: 2, rows: 2, aspectRatio: '18:32', panelAspectRatio: '9:16' };
    if (panelCount <= 6) return { columns: 3, rows: 2, aspectRatio: '27:32', panelAspectRatio: '9:16' };
    if (panelCount <= 8) return { columns: 4, rows: 2, aspectRatio: '9:8', panelAspectRatio: '9:16' };
    if (panelCount <= 9) return { columns: 3, rows: 3, aspectRatio: '27:48', panelAspectRatio: '9:16' };
    return { columns: 4, rows: 3, aspectRatio: '36:48', panelAspectRatio: '9:16' };
  }

  private maxPanelsPerSheet(): number {
    const configured = this.config.imageGen?.storyboardV2?.maxPanelsPerSheet;
    if (!Number.isFinite(configured) || !configured) return STORYBOARD_DEFAULT_PANELS_PER_SHEET;
    return Math.max(1, Math.min(STORYBOARD_MAX_PANELS_PER_SHEET, Math.floor(configured)));
  }

  private cropInsetRatio(): number {
    const configured = this.config.imageGen?.storyboardV2?.cropInsetRatio;
    if (!Number.isFinite(configured)) return STORYBOARD_CROP_INSET_RATIO;
    return Math.max(0, Math.min(0.2, configured || 0));
  }

  private refineCroppedPanels(): boolean {
    return this.config.imageGen?.storyboardV2?.refineCroppedPanels !== false;
  }

  private mapStoryboardQaIssues(report: ImageDefectReport): string[] {
    const labels = new Set<string>();
    for (const issue of report.issues || []) {
      if (issue === 'style_drift') labels.add('style_contract_drift');
      if (issue === 'photorealism') labels.add('rendering_language_mismatch');
      if (issue === 'environment_photorealism') labels.add('texture_mismatch');
      if (issue === 'visible_text') labels.add('visible_text');
      if (issue === 'duplicate_body') labels.add('duplicate_body');
      if (issue === 'extra_limbs' || issue === 'floating_character') labels.add('character_identity_drift');
      if (issue === 'panel_leakage' || issue === 'reference_sheet_artifact') labels.add('panel_border_leakage');
      if (issue === 'first_person_pov') labels.add('composition_mismatch');
    }
    if ((report.issues || []).length > 0 && labels.size === 0) labels.add('style_contract_drift');
    return Array.from(labels);
  }

  private isSheetAdvisoryQaIssue(issue: string): boolean {
    return issue === 'panel_border_leakage'
      || issue === 'character_identity_drift'
      || issue === 'duplicate_body';
  }

  private recordAdvisoryQaWarning(qa: StoryboardVisualQaSummary): void {
    if (!qa.advisoryIssues?.length) return;
    this.advisoryQaWarnings.push({
      identifier: qa.identifier,
      stage: qa.stage,
      issues: qa.advisoryIssues,
      reason: qa.reason,
    });
  }

  private recordSheetFailure(chunk: StoryboardSheetChunk, identifier: string, message: string): void {
    this.failedSlots.push({ slotId: identifier, error: message });
    for (const panel of chunk.panels) {
      this.failedSlots.push({ slotId: this.registrySlotId(panel), error: `Skipped because storyboard sheet ${chunk.sheetId} failed: ${message}` });
    }
    this.emit('warning', 'images', `Storyboard v2 sheet failed for ${identifier}: ${message}`);
  }

  private chooseStoryboardRepairMode(issues: string[], skipped?: boolean): StoryboardRepairMode {
    if (skipped || issues.length === 0) return 'none';
    const styleOnlyIssues = new Set([
      'style_contract_drift',
      'style_reference_mismatch',
      'rendering_language_mismatch',
      'palette_mismatch',
      'linework_mismatch',
      'lighting_mismatch',
      'texture_mismatch',
      'detail_density_mismatch',
    ]);
    return issues.every((issue) => styleOnlyIssues.has(issue)) ? 'edit' : 'regenerate';
  }

  private summarizeStoryboardQa(params: {
    stage: 'sheet' | 'panel';
    identifier: string;
    report: ImageDefectReport;
    attempt: number;
    retryOf?: string;
  }): StoryboardVisualQaSummary {
    const issues = this.mapStoryboardQaIssues(params.report);
    const advisoryIssues = params.stage === 'sheet'
      ? issues.filter((issue) => this.isSheetAdvisoryQaIssue(issue))
      : [];
    const blockingIssues = params.stage === 'sheet'
      ? issues.filter((issue) => !this.isSheetAdvisoryQaIssue(issue))
      : issues;
    const passed = params.report.passed || (params.stage === 'sheet' && blockingIssues.length === 0);
    const repairMode = passed ? 'none' : this.chooseStoryboardRepairMode(blockingIssues, params.report.skipped);
    const styleDriftReason = issues.some((issue) => /style|rendering|palette|linework|lighting|texture|detail/.test(issue))
      ? params.report.reason
      : undefined;
    return {
      stage: params.stage,
      identifier: params.identifier,
      passed,
      skipped: params.report.skipped,
      issues,
      rawIssues: params.report.issues,
      advisory: advisoryIssues.length > 0,
      advisoryIssues,
      blockingIssues,
      reason: params.report.reason,
      styleDriftReason,
      repairMode,
      attempt: params.attempt,
      retryOf: params.retryOf,
    };
  }

  private async runStoryboardVisualQa(params: {
    stage: 'sheet' | 'panel';
    result: GeneratedImage;
    prompt: ImagePrompt;
    identifier: string;
    rawArtStyle: string;
    attempt: number;
    retryOf?: string;
    allowStoryboardSheet?: boolean;
  }): Promise<StoryboardVisualQaSummary> {
    if (!hasImageData(params.result) || typeof (this.imageService as any).checkImageForDefects !== 'function') {
      return {
        stage: params.stage,
        identifier: params.identifier,
        passed: true,
        skipped: true,
        issues: [],
        rawIssues: [],
        reason: 'Storyboard visual QA skipped because image data or QA service is unavailable.',
        repairMode: 'none',
        attempt: params.attempt,
        retryOf: params.retryOf,
      };
    }
    const qaPrompt = {
      ...params.prompt,
      styleContract: { source: 'raw-season-style' as const, text: params.rawArtStyle },
      allowStoryboardSheet: params.allowStoryboardSheet,
      prompt: [
        params.prompt.prompt,
        params.stage === 'sheet'
          ? 'STORYBOARD SHEET QA CONTEXT: This is intentionally a multi-panel storyboard sheet. Judge style compliance against the declared ART STYLE and episode style lock. Do not fail merely because a clean panel grid exists; fail only accidental panel/layout defects, visible text/labels, broken panel count/order, character/ref issues, or style-contract drift.'
          : 'FINAL PANEL QA CONTEXT: This is a single reader image refined from a storyboard crop. Judge style compliance against the declared ART STYLE, episode style lock, character references, crop composition, and reader overlay safe-zone constraints.',
      ].join('\n\n'),
    } as ImagePrompt;
    const report = await this.imageService.checkImageForDefects(
      params.result.imageData,
      params.result.mimeType || 'image/png',
      qaPrompt,
      params.identifier,
    );
    return this.summarizeStoryboardQa({
      stage: params.stage,
      identifier: params.identifier,
      report,
      attempt: params.attempt,
      retryOf: params.retryOf,
    });
  }

  private buildStoryboardQaRepairPrompt(params: {
    prompt: ImagePrompt;
    qa: StoryboardVisualQaSummary;
    stage: 'sheet' | 'panel';
    repairMode: StoryboardRepairMode;
  }): ImagePrompt {
    const repairLines = params.qa.issues.length > 0
      ? params.qa.issues.map((issue) => `- ${issue}: ${params.qa.reason || 'Repair this issue relative to the declared style contract and references.'}`)
      : ['- Repair the QA issue relative to the declared style contract and references.'];
    const preserveLines = params.stage === 'sheet'
      ? [
        '- same panel count and panel order',
        '- same story moments',
        '- same compositions, poses, camera angles, and visible characters where they worked',
        '- same approved character identities, including wardrobe essentials and distinguishing marks',
        '- same declared art style target',
      ]
      : [
        '- same crop-based composition and staging where it worked',
        '- same story moment and camera angle',
        '- same approved character identities, wardrobe essentials, distinguishing marks, and visible character count',
        '- same declared art style target',
      ];
    const targetedRepairLines = [
      params.qa.issues.includes('visible_text')
        ? '- visible_text targeted fix: remove the failure source, not just the glyphs. Replace every readable phone screen, notification, UI panel, sign, label, book, paper, badge, tattoo lettering, or decorative mark with a blank/dark/reflective/glare-obscured/face-down surface, or crop/angle it so no characters are legible.'
        : '',
      params.qa.issues.includes('character_identity_drift')
        ? `- character_identity_drift targeted fix: ${WARDROBE_IDENTITY_POLICY}`
        : '',
      params.qa.issues.includes('duplicate_body')
        ? '- duplicate_body targeted fix: exactly one body per intended character in each panel; remove cloned figures, extra hands, extra arms, repeated silhouettes, and ambiguous partial duplicates.'
        : '',
    ].filter(Boolean);
    const correctiveInstruction = [
      'STORYBOARD V2 QA REPAIR:',
      params.repairMode === 'edit'
        ? 'Use image edit repair. Preserve the existing structure and repair only the listed deviations.'
        : 'Regenerate from the original prompt and references because QA found structural, identity, layout, text, or blocking defects.',
      'Preserve:',
      ...preserveLines,
      'Repair only these QA deviations:',
      ...repairLines,
      ...targetedRepairLines,
      SCREEN_TEXT_POLICY,
      WARDROBE_IDENTITY_POLICY,
      'Do not introduce a new style. Do not overcorrect. Match the raw style contract and episode style lock exactly.',
    ].join('\n');
    return {
      ...params.prompt,
      prompt: [params.prompt.prompt, correctiveInstruction].filter(Boolean).join('\n\n'),
      negativePrompt: [
        params.prompt.negativePrompt,
        params.qa.issues.includes('visible_text') ? 'visible text, letters, labels, captions, speech bubbles, watermarks, readable phone UI, notifications, app icons, readable screen text, readable signage, readable papers, readable labels, symbols pretending to be text' : '',
        params.qa.issues.includes('character_identity_drift') ? 'changed wardrobe, missing canonical outfit, missing occupational marker, wrong hair, changed face, wrong skin tone, changed silhouette, missing distinguishing marks' : '',
        params.qa.issues.includes('duplicate_body') ? 'duplicate body, cloned character, repeated figure, same character twice, extra arms, extra hands, ambiguous partial duplicate' : '',
        params.qa.issues.includes('panel_border_leakage') && params.stage === 'panel' ? 'panel borders, split-screen, collage, inset frame' : '',
      ].filter(Boolean).join(', '),
    };
  }

  private async runSheetQaAndRepair(params: {
    result: GeneratedImage;
    prompt: ImagePrompt;
    identifier: string;
    metadata: Record<string, unknown>;
    refs: ReferenceImage[];
    rawArtStyle: string;
    chunk: StoryboardSheetChunk;
  }): Promise<GeneratedImage | undefined> {
    const firstQa = await this.runStoryboardVisualQa({
      stage: 'sheet',
      result: params.result,
      prompt: params.prompt,
      identifier: params.identifier,
      rawArtStyle: params.rawArtStyle,
      attempt: 1,
      allowStoryboardSheet: true,
    });
    params.result.metadata = {
      ...(params.result.metadata || {}),
      storyboardV2SheetQa: { attempts: [firstQa], final: firstQa },
    } as any;
    this.recordAdvisoryQaWarning(firstQa);
    if (firstQa.passed || firstQa.skipped) return params.result;

    const repairMode = firstQa.repairMode;
    const repairPrompt = this.buildStoryboardQaRepairPrompt({
      prompt: params.prompt,
      qa: firstQa,
      stage: 'sheet',
      repairMode,
    });
    const repairIdentifier = `${params.identifier}-${repairMode === 'edit' ? 'style-repair' : 'qa-regenerate'}-2`;
    const repairRefs = repairMode === 'edit' && hasImageData(params.result)
      ? [
        {
          data: params.result.imageData,
          mimeType: params.result.mimeType || 'image/png',
          role: 'composition-reference',
          governs: ['panel layout', 'composition', 'staging'],
          prohibited: ['style override', 'character identity override'],
          viewType: 'sheet-qa-repair-source',
        } as ReferenceImage,
        ...params.refs,
      ]
      : params.refs;
    const retryResult = await this.safeGenerate(repairPrompt, repairIdentifier, {
      ...params.metadata,
      renderRoute: repairMode === 'edit' ? 'storyboard-sheet-style-edit-repair' : 'storyboard-sheet-qa-regenerate',
      storyboardV2SheetQa: { attempts: [firstQa], repairMode },
      qaRetryOf: params.identifier,
      regeneration: 1,
    }, repairRefs.length > 0 ? repairRefs : undefined);
    if (!retryResult) return undefined;

    const retryQa = await this.runStoryboardVisualQa({
      stage: 'sheet',
      result: retryResult,
      prompt: repairPrompt,
      identifier: repairIdentifier,
      rawArtStyle: params.rawArtStyle,
      attempt: 2,
      retryOf: params.identifier,
      allowStoryboardSheet: true,
    });
    const finalQa = {
      ...retryQa,
      repairMode,
    };
    this.recordAdvisoryQaWarning(finalQa);
    retryResult.metadata = {
      ...(retryResult.metadata || {}),
      storyboardV2SheetQa: { attempts: [firstQa, finalQa], final: finalQa, repairMode },
    } as any;
    if (!retryQa.passed && !retryQa.skipped) {
      const message = `Storyboard sheet QA failed after ${repairMode} repair: ${retryQa.issues.join(', ') || retryQa.reason || 'unknown issue'}`;
      this.styleConsistencyFailures.push({ identifier: params.identifier, error: message });
      this.failedSlots.push({ slotId: params.chunk.sheetId, error: message });
      this.emit('warning', 'images', message);
      return undefined;
    }
    return retryResult;
  }

  private branchPathForPanel(panel: StoryboardPanelSlot): string | undefined {
    if (panel.family === 'story-beat') return panel.branchLabel;
    if (panel.family === 'storylet-aftermath') return `storylet:${panel.outcomeName || 'unknown'}`;
    if (panel.family === 'encounter-setup') return 'encounter:setup';
    if (panel.family === 'encounter-outcome') return `encounter:${panel.choiceMapKey || 'choice'}:${panel.outcomeTier || 'outcome'}`;
    if (panel.family === 'encounter-situation') return `encounter:${panel.choiceMapKey || 'choice'}:${panel.outcomeTier || 'situation'}:${panel.situationKey || 'next'}`;
    return undefined;
  }

  private buildSheetChunks(packet: StoryboardScenePacket): StoryboardSheetChunk[] {
    const groups = new Map<string, { branchPath?: string; panels: StoryboardPanelSlot[] }>();
    for (const panel of packet.panels) {
      const branchPath = this.branchPathForPanel(panel);
      const key = branchPath || 'root';
      const existing = groups.get(key) || { branchPath, panels: [] };
      existing.panels.push(panel);
      groups.set(key, existing);
    }

    const chunks: StoryboardSheetChunk[] = [];
    for (const group of groups.values()) {
      const maxPanels = this.maxPanelsPerSheet();
      for (let index = 0; index < group.panels.length; index += maxPanels) {
        const panels = group.panels.slice(index, index + maxPanels);
        const chunkIndex = chunks.length + 1;
        chunks.push({
          sheetId: safeId(`${packet.scopedSceneId}-sheet-${chunkIndex}${group.branchPath ? `-${group.branchPath}` : ''}`),
          sceneId: packet.sceneId,
          scopedSceneId: packet.scopedSceneId,
          chunkIndex,
          branchPath: group.branchPath,
          panels,
          layout: this.layoutForPanelCount(panels.length),
        });
      }
    }
    return chunks;
  }

  private async generateSheet(params: {
    brief: StoryboardV2Brief;
    packet: StoryboardScenePacket;
    chunk: StoryboardSheetChunk;
    characterBible: CharacterBible;
    rawArtStyle: string;
  }): Promise<GeneratedImage | undefined> {
    const { brief, packet, chunk, characterBible, rawArtStyle } = params;
    const refs: ReferenceImage[] = [];
    const visibleCharacterIds = Array.from(new Set(chunk.panels.flatMap((panel) => panel.visibleCharacterIds)));
    for (const characterId of visibleCharacterIds) {
      const character = characterBible.characters.find((candidate) => candidate.id === characterId);
      if (!character) continue;
      const ref = await this.ensureCharacterRef(character, rawArtStyle);
      if (ref) refs.push(ref);
    }
    if (!this.episodeStyleLockRef) throw new Error('Missing required episodeStyleLockRef for storyboard sheet generation.');
    refs.push(this.episodeStyleLockRef);

    const prompt = this.buildSheetPrompt(brief, packet, chunk, rawArtStyle);
    const identifier = safeId(`sheets/storyboard-v2-${chunk.sheetId}`);
    const referenceAudit = this.referenceAudit(chunk.panels, refs);
    const promptAudit = this.auditPromptInvariants({
      identifier,
      rawArtStyle,
      prompt,
      refs,
      packet,
      panels: chunk.panels,
      mode: 'sheet',
    });
    if (!promptAudit.passed) {
      this.recordSheetFailure(chunk, identifier, `Prompt audit failed: ${promptAudit.errors.join(' ') || 'unknown prompt audit error'}`);
      return undefined;
    }
    const metadata = {
      type: 'storyboard-sheet',
      sheetId: chunk.sheetId,
      sceneId: packet.scopedSceneId,
      family: 'storyboard-sheet',
      panelCount: chunk.panels.length,
      panelSlotIds: chunk.panels.map((panel) => this.registrySlotId(panel)),
      visibleCharacterIds,
      referenceRoles: refs.map((ref) => ref.role),
      referenceAudit,
      promptAudit,
    };
    const result = await this.safeGenerate(prompt, identifier, metadata, refs.length > 0 ? refs : undefined);
    const finalResult = result
      ? await this.runSheetQaAndRepair({
        result,
        prompt,
        identifier,
        metadata,
        refs,
        rawArtStyle,
        chunk,
      })
      : undefined;
    const sheetFailure = !finalResult
      ? 'Image service returned no storyboard sheet.'
      : !hasImageData(finalResult)
        ? 'Storyboard sheet result did not include image data for cropping.'
        : undefined;
    if (sheetFailure) {
      this.recordSheetFailure(chunk, identifier, sheetFailure);
    }

    await this.saveJson(`images/storyboard-v2/prompts/${chunk.sheetId}.sheet.json`, {
      identifier,
      sheetId: chunk.sheetId,
      sceneId: chunk.sceneId,
      scopedSceneId: chunk.scopedSceneId,
      chunkIndex: chunk.chunkIndex,
      branchPath: chunk.branchPath,
      panelOrder: this.panelOrder(chunk, rawArtStyle),
      rawArtStyle,
      prompt,
      refs: refs.map((ref) => ({
        role: ref.role,
        governs: ref.governs,
        prohibited: ref.prohibited,
        characterId: ref.characterId,
        characterName: ref.characterName,
        viewType: ref.viewType,
      })),
      referenceAudit,
      promptAudit,
      storyboardV2SheetQa: (finalResult?.metadata as any)?.storyboardV2SheetQa,
      failure: sheetFailure,
      result: finalResult ? {
        imageUrl: finalResult.imageUrl,
        imagePath: finalResult.imagePath,
        provider: finalResult.metadata?.provider,
        model: finalResult.metadata?.model,
      } : undefined,
    });

    return sheetFailure ? undefined : finalResult;
  }

  private buildSheetPrompt(
    brief: StoryboardV2Brief,
    packet: StoryboardScenePacket,
    chunk: StoryboardSheetChunk,
    rawArtStyle: string,
  ): ImagePrompt {
    const visualGrammar = this.visualGrammarDirectives(chunk.panels, rawArtStyle, packet.mood);
    const panelLines = chunk.panels.map((panel, index) => {
      const visibleCharacters = panel.visibleCharacterIds
        .map((id) => packet.characters.find((character) => character.id === id))
        .filter(Boolean)
        .map((character) => `${character!.name} (${character!.id}): ${sanitizeStoryboardText(character!.description, rawArtStyle).text}${character!.attire ? `; attire: ${sanitizeStoryboardText(character!.attire, rawArtStyle).text}` : ''}${character!.features?.length ? `; features: ${character!.features.map((feature) => sanitizeStoryboardText(feature, rawArtStyle).text).filter(Boolean).join(', ')}` : ''}`)
        .join(' | ');
      return [
        `Panel ${index + 1} (${panel.family}, beat ${panel.beatId}): ${this.sanitizePanelField(panel.narrativeText, rawArtStyle, packet, panel)}`,
        formatVisualGrammarDirective(visualGrammar[index]),
        this.sanitizedPanelLine('Speaker', panel.speaker, rawArtStyle, packet, panel),
        this.sanitizedPanelLine('Primary action', panel.primaryAction, rawArtStyle, packet, panel),
        this.sanitizedPanelLine('Visual moment', panel.visualMoment, rawArtStyle, packet, panel),
        this.sanitizedPanelLine('Emotional read', panel.emotionalRead, rawArtStyle, packet, panel),
        this.sanitizedPanelLine('Must show detail', panel.mustShowDetail, rawArtStyle, packet, panel),
        this.sanitizedPanelLine('Relationship dynamic', panel.relationshipDynamic, rawArtStyle, packet, panel),
        this.sanitizedPanelLine('Visible cost', panel.visibleCost, rawArtStyle, packet, panel),
        this.sanitizedPanelLine('Visual narrative', panel.visualNarrative, rawArtStyle, packet, panel),
        this.sanitizedPanelLine('Encounter storyboard role', panel.storyboardRole, rawArtStyle, packet, panel),
        this.sanitizedPanelLine('Encounter storyboard frame', panel.storyboardFrameId, rawArtStyle, packet, panel),
        this.sanitizedPanelLine('Branch context', panel.branchLabel, rawArtStyle, packet, panel),
        panel.outcomeTier ? `Outcome tier: ${panel.outcomeTier}` : '',
        visibleCharacters ? `Visible canonical characters, match character references exactly as identity anchors and render each one exactly once: ${visibleCharacters}` : 'No named character reference is attached for this panel; do not invent a new recurring character design unless the panel is environment-only or object-only.',
        this.offscreenCharacterInstruction(packet, panel),
      ].filter(Boolean).join(' ');
    });

    const prompt = [
      `ART STYLE: ${rawArtStyle}`,
      'The ART STYLE line above is authoritative. Do not reinterpret it, embellish it with another genre style, or let any reference image override it.',
      STYLE_HIERARCHY_BLOCK,
      WARDROBE_IDENTITY_POLICY,
      `Create one clean storyboard sheet for this scene chunk with exactly ${chunk.panels.length} separate portrait panels.`,
      `GRID: ${chunk.layout.columns} columns x ${chunk.layout.rows} rows. Overall sheet aspect ratio must be ${chunk.layout.aspectRatio} so every grid cell is exactly ${chunk.layout.panelAspectRatio}. Each panel is a distinct ${chunk.layout.panelAspectRatio} portrait rectangle, ordered left-to-right then top-to-bottom. Keep all rows, including the bottom row, the same panel shape and height. Use narrow dark neutral gutters or no visible panel borders. Never use white mats, white gutters, white borders, or white frames. Do not draw panel numbers or labels inside the image.`,
      DUPLICATE_CHARACTER_RULE,
      'READER OVERLAY COMPOSITION FOR EVERY PANEL: keep the lower 30-40% visually calmer and darker, with no important faces, hands, props, readable text, key action, or high-contrast details in that lower zone.',
      'No captions, no speech bubbles, no UI, no watermarks, and no decorative typography.',
      'Do not render readable text anywhere in the image, including in-world signage, prop labels, clothing logos, phone notifications, app UI, books, papers, tattoos, badges, or symbolic pseudo-letters.',
      SCREEN_TEXT_POLICY,
      `Story: ${sanitizeStoryboardText(brief.story.title, rawArtStyle).text}. Episode ${brief.episode.number}: ${sanitizeStoryboardText(brief.episode.title, rawArtStyle).text}. Scene: ${sanitizeStoryboardText(packet.sceneName, rawArtStyle).text}.`,
      sanitizedLine('Setting', packet.setting, rawArtStyle),
      sanitizedLine('Scene mood arc', packet.mood, rawArtStyle),
      sanitizedLine('Branch/path context for this sheet', chunk.branchPath, rawArtStyle),
      'Make the staging expressive and alive: asymmetric poses, active hands, clear body language, and specific story moments rather than static portraits.',
      'SHEET STYLE CONSISTENCY GATE: every panel on this sheet must share the same rendering language, palette logic, line/edge treatment, lighting language, texture density, and finish required by the ART STYLE and episodeStyleLockRef. Do not drift toward a different renderer or compensate by overcorrecting into a new style.',
      chunk.panels.some((panel) => panel.family.startsWith('encounter') || panel.family === 'storylet-aftermath')
        ? 'ENCOUNTER VISUAL DIRECTION: treat this as an escalating sequence from an action scene, heist, tense confrontation, or highly dramatic argument. Show back-and-forth pressure, reversals, movement, tactical changes, emotional intensity, and rising stakes across the panels.'
        : '',
      'Each panel below includes one VISUAL STORYTELLING DIRECTIVE. Use it only for composition, staging, camera, rhythm, attention, subject scale, and in-style lighting/color emphasis.',
      'PANEL CONTENT:',
      panelLines.join('\n'),
    ].filter(Boolean).join('\n');

    return {
      prompt,
      style: rawArtStyle,
      aspectRatio: chunk.layout.aspectRatio,
      composition: `${chunk.layout.columns}x${chunk.layout.rows} storyboard contact sheet of ${chunk.layout.panelAspectRatio} reader-safe portrait panels`,
      negativePrompt: 'captions, speech bubbles, UI, watermark, logo, panel numbers, decorative typography, readable text, letters, numbers, labels, phone notifications, app UI, readable screen text, readable signage, readable papers, duplicate character, same character twice, cloned character, repeated figure, second copy of same character, changed wardrobe, missing canonical outfit, stiff pose, mannequin pose, lower-third clutter',
    };
  }

  private panelCropBoxes(chunk: StoryboardSheetChunk, sourceWidth: number, sourceHeight: number): StoryboardSheetCrop[] {
    const cellWidth = sourceWidth / chunk.layout.columns;
    const cellHeight = sourceHeight / chunk.layout.rows;
    const targetRatio = DERIVED_PANEL_WIDTH / DERIVED_PANEL_HEIGHT;
    const insetRatio = this.cropInsetRatio();
    return chunk.panels.map((panel, index) => {
      const col = index % chunk.layout.columns;
      const row = Math.floor(index / chunk.layout.columns);
      const cellBox = {
        x: Math.round(col * cellWidth),
        y: Math.round(row * cellHeight),
        width: Math.floor(cellWidth),
        height: Math.floor(cellHeight),
      };
      const insetX = Math.floor(cellBox.width * insetRatio);
      const insetY = Math.floor(cellBox.height * insetRatio);
      const innerX = cellBox.x + insetX;
      const innerY = cellBox.y + insetY;
      const innerWidth = Math.max(1, cellBox.width - insetX * 2);
      const innerHeight = Math.max(1, cellBox.height - insetY * 2);
      const maxWidth = Math.floor(innerWidth);
      const maxHeight = Math.floor(innerHeight);
      const cropWidth = Math.max(1, Math.min(maxWidth, Math.floor(maxHeight * targetRatio)));
      const cropHeight = Math.max(1, Math.min(maxHeight, Math.floor(cropWidth / targetRatio)));
      const x = Math.max(0, Math.round(innerX + (innerWidth - cropWidth) / 2));
      const y = Math.max(0, Math.round(innerY + (innerHeight - cropHeight) / 2));
      return {
        slotId: this.registrySlotId(panel),
        panelIndex: index,
        cellBox,
        cropBox: { x, y, width: cropWidth, height: cropHeight },
        sourceWidthBeforeResize: cropWidth,
        sourceHeightBeforeResize: cropHeight,
        visibleCharacterIds: panel.visibleCharacterIds,
      };
    });
  }

  private panelOrder(chunk: StoryboardSheetChunk, rawArtStyle?: string): Array<{
    index: number;
    sequenceIndex?: number;
    slotId: string;
    family: StoryboardPanelSlot['family'];
    beatId: string;
    label: string;
    visibleCharacterIds?: string[];
    unresolvedCharacterIds?: string[];
    characterResolutionWarnings?: string[];
    visualGrammar?: VisualGrammarDirective;
  }> {
    const visualGrammar = rawArtStyle ? this.visualGrammarDirectives(chunk.panels, rawArtStyle) : [];
    return chunk.panels.map((panel, index) => ({
      index: index + 1,
      sequenceIndex: panel.sequenceIndex,
      slotId: this.registrySlotId(panel),
      family: panel.family,
      beatId: panel.beatId,
      label: panel.label,
      visibleCharacterIds: panel.visibleCharacterIds,
      unresolvedCharacterIds: panel.unresolvedCharacterIds,
      characterResolutionWarnings: panel.characterResolutionWarnings,
      visualGrammar: visualGrammar[index],
    }));
  }

  private visualGrammarDirectives(
    panels: StoryboardPanelSlot[],
    rawArtStyle: string,
    sceneMood?: string,
  ): VisualGrammarDirective[] {
    let previousDirective: VisualGrammarDirective | undefined;
    return panels.map((panel, index) => {
      const directive = buildVisualGrammarDirective({
        panel,
        previousPanel: panels[index - 1],
        previousDirective,
        nextPanel: panels[index + 1],
        rawArtStyle,
        sceneMood,
        index,
        panelCount: panels.length,
      });
      previousDirective = directive;
      return directive;
    });
  }

  private async derivePanelFromSheet(params: {
    brief: StoryboardV2Brief;
    packet: StoryboardScenePacket;
    chunk: StoryboardSheetChunk;
    panel: StoryboardPanelSlot;
    sheetResult: GeneratedImage;
    rawArtStyle: string;
    characterBible: CharacterBible;
  }): Promise<GeneratedImage | undefined> {
    const { brief, packet, chunk, panel, sheetResult, rawArtStyle, characterBible } = params;
    if (!nodeFs || !sharp || !sheetResult.imageData) {
      const message = `Cannot derive ${panel.id}: sharp or sheet image data is unavailable.`;
      this.failedSlots.push({ slotId: this.registrySlotId(panel), error: message });
      this.emit('warning', 'images', message);
      return undefined;
    }

    try {
      const sourceBuffer = Buffer.from(sheetResult.imageData, 'base64');
      const metadata = await sharp(sourceBuffer).metadata();
      const sourceWidth = metadata.width || 0;
      const sourceHeight = metadata.height || 0;
      if (!sourceWidth || !sourceHeight) throw new Error('Storyboard sheet has no readable dimensions.');

      let manifest = this.sheetManifest.find((sheet) => sheet.sheetId === chunk.sheetId);
      if (!manifest) {
        manifest = {
          sheetId: chunk.sheetId,
          sceneId: chunk.sceneId,
          scopedSceneId: chunk.scopedSceneId,
          chunkIndex: chunk.chunkIndex,
          branchPath: chunk.branchPath,
          imageUrl: sheetResult.imageUrl,
          imagePath: sheetResult.imagePath,
          sourceWidth,
          sourceHeight,
          panelOrder: this.panelOrder(chunk, rawArtStyle),
          layout: chunk.layout,
          crops: this.panelCropBoxes(chunk, sourceWidth, sourceHeight),
          sheetQa: (sheetResult.metadata as any)?.storyboardV2SheetQa,
        };
        this.sheetManifest.push(manifest);
      }

      const crop = manifest.crops.find((candidate) => candidate.slotId === this.registrySlotId(panel));
      if (!crop) throw new Error(`No crop box for ${panel.id}`);

      const cropBuffer = await sharp(sourceBuffer)
        .extract({
          left: crop.cropBox.x,
          top: crop.cropBox.y,
          width: crop.cropBox.width,
          height: crop.cropBox.height,
        })
        .png()
        .toBuffer();
      const draftImageData = cropBuffer.toString('base64');
      const draftIdentifier = safeId(`crops/storyboard-v2-crop-${panel.family}-${packet.scopedSceneId}-${panel.beatId}-${panel.outcomeName || ''}-${panel.choiceMapKey || ''}-${panel.outcomeTier || ''}-${panel.situationKey || ''}`);
      const identifier = safeId(`panels/storyboard-v2-${panel.family}-${packet.scopedSceneId}-${panel.beatId}-${panel.outcomeName || ''}-${panel.choiceMapKey || ''}-${panel.outcomeTier || ''}-${panel.situationKey || ''}`);
      const draftImagePath = normalizeManagedOutputPath(`${this.outputDirectory || ''}images/storyboard-v2/${draftIdentifier}.png`);
      const draftFullPath = this.outputDirectory
        ? `${this.outputDirectory}images/storyboard-v2/${draftIdentifier}.png`
        : draftImagePath;
      await nodeFs.mkdir(draftFullPath.split('/').slice(0, -1).join('/'), { recursive: true });
      await nodeFs.writeFile(draftFullPath, cropBuffer);
      const draftImageUrl = toServedImageUrl(draftImagePath);
      const prompt = this.buildPanelPrompt(brief, packet, panel, rawArtStyle);
      const draftResult: GeneratedImage = {
        prompt,
        imagePath: draftImagePath,
        imageUrl: draftImageUrl,
        imageData: draftImageData,
        mimeType: 'image/png',
        metadata: {
          format: 'png',
          provider: 'local-crop',
          model: 'sharp',
        },
      };
      crop.draftCropImageUrl = draftImageUrl;
      crop.draftCropImagePath = draftImagePath;
      crop.sourceWidthBeforeResize = crop.cropBox.width;
      crop.sourceHeightBeforeResize = crop.cropBox.height;
      crop.visibleCharacterIds = panel.visibleCharacterIds;
      crop.unresolvedCharacterIds = panel.unresolvedCharacterIds;
      crop.characterResolutionWarnings = panel.characterResolutionWarnings;

      const result = this.refineCroppedPanels()
        ? await this.refinePanelCrop({
          brief,
          packet,
          panel,
          draftResult,
          identifier,
          rawArtStyle,
          characterBible,
          crop,
        })
        : await this.resizeDraftCropLocally(draftResult, identifier);
      if (!result?.imageUrl) return undefined;

      crop.finalImageUrl = result.imageUrl;
      crop.finalImagePath = result.imagePath;
      crop.panelQa = (result.metadata as any)?.storyboardV2PanelQa;

      await this.saveJson(`images/storyboard-v2/prompts/${identifier.replace(/^panels\//, '')}.json`, {
        identifier,
        draftIdentifier,
        slotId: panel.id,
        family: panel.family,
        rawArtStyle,
        prompt: result.prompt || prompt,
        sourceSheet: {
          sheetId: chunk.sheetId,
          imageUrl: sheetResult.imageUrl,
          imagePath: sheetResult.imagePath,
          cellBox: crop.cellBox,
          cropBox: crop.cropBox,
          sourceWidth,
          sourceHeight,
        },
        referenceAudit: this.referenceAudit([panel], crop.referenceRoles || []),
        characterResolution: {
          visibleCharacterIds: panel.visibleCharacterIds,
          unresolvedCharacterIds: panel.unresolvedCharacterIds || [],
          aliases: panel.characterAliases || [],
          warnings: panel.characterResolutionWarnings || [],
        },
        result: {
          imageUrl: result.imageUrl,
          imagePath: result.imagePath,
          draftImageUrl,
          draftImagePath,
          provider: result.metadata?.provider || 'local-crop',
          model: result.metadata?.model || 'sharp',
          duplicateQa: (result.metadata as any)?.storyboardV2DuplicateQa,
          panelQa: (result.metadata as any)?.storyboardV2PanelQa,
          duplicateCharacterRetryOf: (result.metadata as any)?.duplicateCharacterRetryOf,
        },
      });

      if ((result.metadata?.provider || 'local-crop') === 'local-crop') {
        this.emitDerivedPanelJob(panel, identifier, prompt, result, chunk.sheetId);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failedSlots.push({ slotId: this.registrySlotId(panel), error: message });
      this.emit('warning', 'images', `Storyboard v2 crop failed for ${panel.id}: ${message}`);
      return undefined;
    }
  }

  private visibleCharacterNames(packet: StoryboardScenePacket, panel: StoryboardPanelSlot): string[] {
    return panel.visibleCharacterIds
      .map((id) => packet.characters.find((character) => character.id === id)?.name)
      .filter((name): name is string => Boolean(name));
  }

  private async panelRefinementReferences(
    panel: StoryboardPanelSlot,
    characterBible: CharacterBible,
    draftResult: GeneratedImage,
    rawArtStyle: string,
  ): Promise<ReferenceImage[]> {
    const refs: ReferenceImage[] = [];
    if (draftResult.imageData) {
      refs.push({
        data: draftResult.imageData,
        mimeType: draftResult.mimeType || 'image/png',
        role: 'storyboard-panel-crop',
        governs: ['composition', 'staging', 'pose', 'camera', 'action'],
        prohibited: ['rendering style', 'palette', 'character identity'],
        viewType: 'draft-crop',
      });
    }
    for (const characterId of panel.visibleCharacterIds) {
      const character = characterBible.characters.find((candidate) => candidate.id === characterId);
      if (!character) continue;
      const ref = await this.ensureCharacterRef(character, rawArtStyle);
      if (ref) refs.push(ref);
    }
    if (!this.episodeStyleLockRef) throw new Error('Missing required episodeStyleLockRef for panel refinement.');
    refs.push(this.episodeStyleLockRef);
    return refs;
  }

  private referenceAudit(panels: StoryboardPanelSlot[], refs: ReferenceImage[] | string[]): {
    visibleCharacterIds: string[];
    unresolvedCharacterIds: string[];
    referenceRoles: string[];
    warnings: string[];
  } {
    const referenceRoles = refs.map((ref: any) => typeof ref === 'string' ? ref : ref.role).filter(Boolean);
    const visibleCharacterIds = Array.from(new Set(panels.flatMap((panel) => panel.visibleCharacterIds || [])));
    const unresolvedCharacterIds = Array.from(new Set(panels.flatMap((panel) => panel.unresolvedCharacterIds || [])));
    const warnings = Array.from(new Set(panels.flatMap((panel) => panel.characterResolutionWarnings || [])));
    const hasCharacterRef = referenceRoles.includes('character-reference');
    const hasNamedText = panels.some((panel) => {
      const text = [panel.label, panel.narrativeText, panel.speaker, panel.visualMoment, panel.primaryAction].filter(Boolean).join(' ');
      return containsNonGenericCapitalizedName(text);
    });

    if (visibleCharacterIds.length > 0 && !hasCharacterRef) {
      warnings.push(`Visible canonical character ids have no character-reference image attached: ${visibleCharacterIds.join(', ')}`);
    }
    if (hasNamedText && visibleCharacterIds.length === 0) {
      warnings.push('Panel text appears to name a character, but zero canonical visibleCharacterIds resolved.');
    }
    if (referenceRoles.includes('storyboard-panel-crop') && hasNamedText && !hasCharacterRef) {
      warnings.push('Refinement would use only crop/style refs for a named-character panel.');
    }
    if (!referenceRoles.includes('episode-style-lock')) {
      warnings.push('Missing required episodeStyleLockRef.');
    }
    if (referenceRoles.some((role) => /style/i.test(role) && role !== 'episode-style-lock')) {
      warnings.push(`Only episodeStyleLockRef may be labeled as a style reference; got roles: ${referenceRoles.join(', ')}`);
    }

    for (const warning of warnings) {
      this.emit('warning', 'images', `Storyboard v2 reference audit: ${warning}`);
    }

    return {
      visibleCharacterIds,
      unresolvedCharacterIds,
      referenceRoles,
      warnings,
    };
  }

  private sanitizePanelField(
    value: unknown,
    rawArtStyle: string,
    packet: StoryboardScenePacket,
    panel: StoryboardPanelSlot,
  ): string {
    let text = sanitizeStoryboardText(value, rawArtStyle).text;
    if (!text) return '';
    const visibleIds = new Set(panel.visibleCharacterIds || []);
    const offscreenNames: string[] = [];
    for (const character of packet.characters) {
      if (visibleIds.has(character.id)) continue;
      offscreenNames.push(...characterMentionAliases(character.name));
    }
    for (const alias of Array.from(new Set(offscreenNames))) {
      if (alias.length < 3) continue;
      text = text.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'gi'), 'the offscreen character');
    }
    return text.replace(/\s{2,}/g, ' ').trim();
  }

  private sanitizedPanelLine(
    label: string,
    value: unknown,
    rawArtStyle: string,
    packet: StoryboardScenePacket,
    panel: StoryboardPanelSlot,
  ): string {
    const text = this.sanitizePanelField(value, rawArtStyle, packet, panel);
    return text ? `${label}: ${text}` : '';
  }

  private offscreenCharacterInstruction(packet: StoryboardScenePacket, panel: StoryboardPanelSlot): string {
    const visibleIds = new Set(panel.visibleCharacterIds || []);
    const offscreen = packet.characters.filter((character) => !visibleIds.has(character.id));
    if (offscreen.length === 0) return '';
    return `OFFSCREEN CHARACTER RULE: story characters outside the visible canonical ID list are not visible in this panel and must not be rendered as people. If sanitized story text refers to an offscreen character, imply that reaction only through the visible character's posture, expression, distance, props, or empty space. Offscreen canonical IDs: ${offscreen.map((character) => character.id).join(', ')}.`;
  }

  private collectSanitizationAudit(
    packet: StoryboardScenePacket,
    panels: StoryboardPanelSlot[],
    rawArtStyle: string,
  ): Array<{ field: string; original: string; sanitized: string; terms: string[] }> {
    const entries: Array<{ field: string; value: unknown }> = [
      { field: 'sceneName', value: packet.sceneName },
      { field: 'setting', value: packet.setting },
      { field: 'mood', value: packet.mood },
    ];
    for (const panel of panels) {
      entries.push(
        { field: `${panel.id}.narrativeText`, value: panel.narrativeText },
        { field: `${panel.id}.speaker`, value: panel.speaker },
        { field: `${panel.id}.primaryAction`, value: panel.primaryAction },
        { field: `${panel.id}.visualMoment`, value: panel.visualMoment },
        { field: `${panel.id}.emotionalRead`, value: panel.emotionalRead },
        { field: `${panel.id}.mustShowDetail`, value: panel.mustShowDetail },
        { field: `${panel.id}.relationshipDynamic`, value: panel.relationshipDynamic },
        { field: `${panel.id}.visibleCost`, value: panel.visibleCost },
        { field: `${panel.id}.visualNarrative`, value: panel.visualNarrative },
        { field: `${panel.id}.storyboardRole`, value: panel.storyboardRole },
        { field: `${panel.id}.storyboardFrameId`, value: panel.storyboardFrameId },
        { field: `${panel.id}.branchLabel`, value: panel.branchLabel },
      );
    }
    return entries.flatMap((entry) => {
      if (typeof entry.value !== 'string' || !entry.value.trim()) return [];
      const sanitized = sanitizeStoryboardText(entry.value, rawArtStyle);
      if (!sanitized.sanitizedTerms.length && sanitized.text === entry.value.trim()) return [];
      return [{
        field: entry.field,
        original: entry.value,
        sanitized: sanitized.text,
        terms: sanitized.sanitizedTerms,
      }];
    });
  }

  private auditPromptInvariants(params: {
    identifier: string;
    rawArtStyle: string;
    prompt: ImagePrompt;
    refs: ReferenceImage[];
    packet: StoryboardScenePacket;
    panels: StoryboardPanelSlot[];
    mode: 'sheet' | 'refinement';
  }): { passed: boolean; errors: string[]; sanitization: ReturnType<StoryboardV2Pipeline['collectSanitizationAudit']> } {
    const { identifier, rawArtStyle, prompt, refs, packet, panels, mode } = params;
    const promptText = prompt.prompt || '';
    const errors: string[] = [];
    const firstLine = promptText.split('\n')[0] || '';
    if (firstLine !== `ART STYLE: ${rawArtStyle}`) errors.push('raw ART STYLE is missing, changed, or not first.');
    if (!promptText.includes(STYLE_HIERARCHY_BLOCK)) errors.push('style hierarchy block is missing.');
    if (!promptText.includes(DUPLICATE_CHARACTER_RULE)) errors.push('duplicate-character rule is missing.');
    if (!refs.some((ref) => ref.role === 'episode-style-lock')) errors.push('episodeStyleLockRef is not attached.');
    if (mode === 'refinement' && !refs.some((ref) => ref.role === 'storyboard-panel-crop')) {
      errors.push('storyboard-panel-crop ref is required for crop refinement.');
    }
    const illegalStyleRefs = refs.filter((ref) => /style/i.test(ref.role) && ref.role !== 'episode-style-lock');
    if (illegalStyleRefs.length > 0) errors.push(`non-style-lock refs are described as style refs: ${illegalStyleRefs.map((ref) => ref.role).join(', ')}`);
    for (const ref of refs) {
      if (ref.role === 'character-reference' && ref.governs?.some((value) => /style|palette|render/i.test(value))) {
        errors.push(`character ref ${ref.characterId || ref.characterName || '(unknown)'} is allowed to govern style.`);
      }
      if (ref.role === 'storyboard-panel-crop' && ref.governs?.some((value) => /style|palette|render/i.test(value))) {
        errors.push('storyboard crop is allowed to govern rendering style.');
      }
    }
    const promptWithoutRawStyle = promptText.replace(`ART STYLE: ${rawArtStyle}`, '');
    const leakedTerms = STORYBOARD_BLOCKED_STYLE_TERMS
      .filter((rule) => !rawStyleAllowsTerm(rawArtStyle, rule.label) && rule.pattern.test(promptWithoutRawStyle))
      .map((rule) => {
        rule.pattern.lastIndex = 0;
        return rule.label;
      });
    if (leakedTerms.length > 0) errors.push(`sanitized prompt still contains blocked style terms: ${Array.from(new Set(leakedTerms)).join(', ')}`);
    const sanitization = this.collectSanitizationAudit(packet, panels, rawArtStyle);
    const audit = {
      identifier,
      mode,
      passed: errors.length === 0,
      errors,
      rawArtStyleHash: styleHash(rawArtStyle),
      episodeStyleLockHash: referenceHash(this.episodeStyleLockRef),
      referenceRoles: refs.map((ref) => ref.role),
      sanitization,
    };
    this.promptAudits.push(audit);
    if (errors.length > 0) {
      this.styleConsistencyFailures.push({ identifier, error: errors.join(' ') });
      this.failedSlots.push({ slotId: identifier, error: errors.join(' ') });
    }
    return { passed: errors.length === 0, errors, sanitization };
  }

  private async refinePanelCrop(params: {
    brief: StoryboardV2Brief;
    packet: StoryboardScenePacket;
    panel: StoryboardPanelSlot;
    draftResult: GeneratedImage;
    identifier: string;
    rawArtStyle: string;
    characterBible: CharacterBible;
    crop: StoryboardSheetCrop;
  }): Promise<GeneratedImage | undefined> {
    const { brief, packet, panel, draftResult, identifier, rawArtStyle, characterBible, crop } = params;
    const refs = await this.panelRefinementReferences(panel, characterBible, draftResult, rawArtStyle);
    crop.referenceRoles = refs.map((ref) => ref.role);
    const prompt = this.buildRefinementPrompt(brief, packet, panel, rawArtStyle);
    const characterNames = this.visibleCharacterNames(packet, panel);
    const referenceAudit = this.referenceAudit([panel], refs);
    const promptAudit = this.auditPromptInvariants({
      identifier,
      rawArtStyle,
      prompt,
      refs,
      packet,
      panels: [panel],
      mode: 'refinement',
    });
    if (!promptAudit.passed) return undefined;
    const metadata = {
      type: this.imageTypeForFamily(panel.family),
      renderRoute: 'storyboard-sheet-crop-refine',
      family: panel.family,
      sceneId: panel.scopedSceneId,
      beatId: panel.beatId,
      sequenceIndex: panel.sequenceIndex,
      characterNames,
      visibleCharacterIds: panel.visibleCharacterIds,
      draftCropImagePath: draftResult.imagePath,
      draftCropImageUrl: draftResult.imageUrl,
      sourceCropWidth: crop.cropBox.width,
      sourceCropHeight: crop.cropBox.height,
      expectedVisibleCharacterCount: panel.visibleCharacterIds.length,
      referenceRoles: refs.map((ref) => ref.role),
      referenceAudit,
      promptAudit,
      unresolvedCharacterIds: panel.unresolvedCharacterIds || [],
      characterResolutionWarnings: panel.characterResolutionWarnings || [],
    };
    const firstResult = await this.safeGenerate(prompt, identifier, metadata, refs);
    return this.runPanelQaAndRepair({
      firstResult,
      prompt,
      identifier,
      metadata,
      refs,
      panel,
      rawArtStyle,
    });
  }

  private async runPanelQaAndRepair(params: {
    firstResult: GeneratedImage | undefined;
    prompt: ImagePrompt;
    identifier: string;
    metadata: Record<string, unknown>;
    refs: ReferenceImage[];
    panel: StoryboardPanelSlot;
    rawArtStyle: string;
  }): Promise<GeneratedImage | undefined> {
    const { firstResult, prompt, identifier, metadata, refs, panel, rawArtStyle } = params;
    if (!hasImageData(firstResult)) return firstResult;
    const firstQa = await this.runStoryboardVisualQa({
      stage: 'panel',
      result: firstResult,
      prompt,
      identifier,
      rawArtStyle,
      attempt: 1,
    });
    firstResult.metadata = {
      ...(firstResult.metadata || {}),
      storyboardV2PanelQa: { attempts: [firstQa], final: firstQa },
      storyboardV2DuplicateQa: firstQa.rawIssues?.includes('duplicate_body') ? firstQa : undefined,
    } as any;
    if (firstQa.passed || firstQa.skipped) return firstResult;

    const repairMode = firstQa.repairMode;
    const retryPrompt = this.buildStoryboardQaRepairPrompt({
      prompt,
      qa: firstQa,
      stage: 'panel',
      repairMode,
    });
    const retryIdentifier = `${identifier}-${repairMode === 'edit' ? 'style-repair' : firstQa.rawIssues?.includes('duplicate_body') ? 'duplicate-character-retry' : 'qa-regenerate-2'}`;
    const retryRefs = repairMode === 'edit'
      ? [
        {
          data: firstResult.imageData,
          mimeType: firstResult.mimeType || 'image/png',
          role: 'composition-reference',
          governs: ['final panel composition', 'staging', 'framing'],
          prohibited: ['style override', 'character identity override'],
          viewType: 'panel-qa-repair-source',
        } as ReferenceImage,
        ...refs,
      ]
      : refs;
    const retryResult = await this.safeGenerate(retryPrompt, retryIdentifier, {
      ...metadata,
      renderRoute: repairMode === 'edit'
        ? 'storyboard-sheet-crop-refine-style-edit-repair'
        : firstQa.rawIssues?.includes('duplicate_body')
          ? 'storyboard-sheet-crop-refine-duplicate-retry'
          : 'storyboard-sheet-crop-refine-qa-regenerate',
      storyboardV2PanelQa: { attempts: [firstQa], repairMode },
      duplicateCharacterRetryOf: firstQa.rawIssues?.includes('duplicate_body') ? identifier : undefined,
      qaRetryOf: identifier,
      regeneration: 1,
    }, retryRefs);
    if (!hasImageData(retryResult)) {
      this.failedSlots.push({ slotId: this.registrySlotId(panel), error: `Panel QA failed and ${repairMode} retry did not produce an image.` });
      return undefined;
    }
    const retryQa = await this.runStoryboardVisualQa({
      stage: 'panel',
      result: retryResult,
      prompt: retryPrompt,
      identifier: retryIdentifier,
      rawArtStyle,
      attempt: 2,
      retryOf: identifier,
    });
    retryResult.metadata = {
      ...(retryResult.metadata || {}),
      storyboardV2PanelQa: { attempts: [firstQa, retryQa], final: retryQa, repairMode },
      storyboardV2DuplicateQa: retryQa.rawIssues?.includes('duplicate_body') ? retryQa : undefined,
      duplicateCharacterRetryOf: firstQa.rawIssues?.includes('duplicate_body') ? identifier : undefined,
    } as any;
    if (!retryQa.passed && !retryQa.skipped) {
      const message = `Panel QA remained unresolved after ${repairMode} retry: ${retryQa.issues.join(', ') || retryQa.reason || 'unknown issue'}`;
      this.failedSlots.push({ slotId: this.registrySlotId(panel), error: message });
      this.styleConsistencyFailures.push({ identifier, error: message });
      return undefined;
    }
    return retryResult;
  }

  private async resizeDraftCropLocally(draftResult: GeneratedImage, identifier: string): Promise<GeneratedImage> {
    if (!nodeFs || !sharp || !draftResult.imageData) return draftResult;
    const outputBuffer = await sharp(Buffer.from(draftResult.imageData, 'base64'))
      .resize({
        width: DERIVED_PANEL_WIDTH,
        height: DERIVED_PANEL_HEIGHT,
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
    const imageData = outputBuffer.toString('base64');
    const imagePath = normalizeManagedOutputPath(`${this.outputDirectory || ''}images/storyboard-v2/${identifier}.png`);
    const fullPath = this.outputDirectory
      ? `${this.outputDirectory}images/storyboard-v2/${identifier}.png`
      : imagePath;
    await nodeFs.mkdir(fullPath.split('/').slice(0, -1).join('/'), { recursive: true });
    await nodeFs.writeFile(fullPath, outputBuffer);
    return {
      ...draftResult,
      imageData,
      imagePath,
      imageUrl: toServedImageUrl(imagePath),
      mimeType: 'image/png',
      metadata: {
        ...(draftResult.metadata || {}),
        provider: 'local-crop',
        model: 'sharp',
      },
    };
  }

  private emitDerivedPanelJob(
    panel: StoryboardPanelSlot,
    identifier: string,
    prompt: ImagePrompt,
    result: GeneratedImage,
    sheetId: string,
  ): void {
    const id = `${identifier}-${Date.now()}`;
    const metadata = {
      type: this.imageTypeForFamily(panel.family),
      pipelineMode: 'storyboard-v2',
      renderRoute: 'storyboard-sheet-crop',
      sheetId,
      sceneId: panel.scopedSceneId,
      beatId: panel.beatId,
      sequenceIndex: panel.sequenceIndex,
      family: panel.family,
      imagePath: result.imagePath,
      localPath: result.imagePath,
    };
    (this.imageService as any).emitExternalEvent?.({
      type: 'job_added',
      job: {
        id,
        identifier,
        prompt: JSON.stringify(prompt, null, 2),
        status: 'pending',
        maxRetries: 0,
        metadata,
      },
    });
    (this.imageService as any).emitExternalEvent?.({
      type: 'job_updated',
      id,
      updates: {
        status: 'completed',
        progress: 100,
        imageUrl: result.imageUrl,
        imagePath: result.imagePath,
        localPath: result.imagePath,
        endTime: Date.now(),
      },
    });
  }

  private buildPanelPrompt(
    brief: StoryboardV2Brief,
    packet: StoryboardScenePacket,
    panel: StoryboardPanelSlot,
    rawArtStyle: string,
  ): ImagePrompt {
    const visibleCharacters = panel.visibleCharacterIds
      .map((id) => packet.characters.find((character) => character.id === id))
      .filter(Boolean)
      .map((character) => `${character!.name} (${character!.id}): ${sanitizeStoryboardText(character!.description, rawArtStyle).text}${character!.attire ? `; attire: ${sanitizeStoryboardText(character!.attire, rawArtStyle).text}` : ''}${character!.features?.length ? `; features: ${character!.features.map((feature) => sanitizeStoryboardText(feature, rawArtStyle).text).filter(Boolean).join(', ')}` : ''}`);
    const panelIndex = Math.max(0, packet.panels.findIndex((candidate) => candidate.id === panel.id));
    const visualGrammar = this.visualGrammarDirectives(packet.panels, rawArtStyle, packet.mood)[panelIndex] || buildVisualGrammarDirective({
      panel,
      rawArtStyle,
      sceneMood: packet.mood,
      index: panelIndex,
      panelCount: packet.panels.length || 1,
    });
    const prompt = [
      `ART STYLE: ${rawArtStyle}`,
      'The ART STYLE line above is authoritative. Do not reinterpret it, embellish it with another genre style, or let any reference image override it.',
      STYLE_HIERARCHY_BLOCK,
      formatVisualGrammarDirective(visualGrammar),
      'Generate a single finished storyboard panel as a full-size reader image.',
      'FORMAT: portrait 9:16, 1024x1536 composition.',
      WARDROBE_IDENTITY_POLICY,
      DUPLICATE_CHARACTER_RULE,
      `EXPECTED VISIBLE CHARACTER COUNT: ${panel.visibleCharacterIds.length}. Render exactly these visible canonical character IDs once each: ${panel.visibleCharacterIds.length ? panel.visibleCharacterIds.join(', ') : '(none)'}.`,
      'READER OVERLAY COMPOSITION: keep the lower 30-40% visually calmer and darker, with no important faces, hands, props, readable text, key action, or high-contrast details in that lower zone.',
      'No captions, no speech bubbles, no UI, no decorative typography, no panel borders, no watermarks, and no readable in-world text.',
      SCREEN_TEXT_POLICY,
      `Story: ${sanitizeStoryboardText(brief.story.title, rawArtStyle).text}. Episode ${brief.episode.number}: ${sanitizeStoryboardText(brief.episode.title, rawArtStyle).text}. Scene: ${sanitizeStoryboardText(packet.sceneName, rawArtStyle).text}.`,
      sanitizedLine('Setting', packet.setting, rawArtStyle),
      sanitizedLine('Scene mood arc', packet.mood, rawArtStyle),
      visibleCharacters.length ? `Visible canonical characters, match supplied character references exactly as hard identity anchors and render each one exactly once: ${visibleCharacters.join(' | ')}` : 'No named character reference is attached for this panel; do not invent a new recurring character design unless the panel is environment-only or object-only.',
      this.offscreenCharacterInstruction(packet, panel),
      `Beat: ${this.sanitizePanelField(panel.narrativeText, rawArtStyle, packet, panel)}`,
      this.sanitizedPanelLine('Speaker', panel.speaker, rawArtStyle, packet, panel),
      this.sanitizedPanelLine('Primary action', panel.primaryAction, rawArtStyle, packet, panel),
      this.sanitizedPanelLine('Visual moment', panel.visualMoment, rawArtStyle, packet, panel),
      this.sanitizedPanelLine('Emotional read', panel.emotionalRead, rawArtStyle, packet, panel),
      this.sanitizedPanelLine('Must show detail', panel.mustShowDetail, rawArtStyle, packet, panel),
      this.sanitizedPanelLine('Relationship dynamic', panel.relationshipDynamic, rawArtStyle, packet, panel),
      this.sanitizedPanelLine('Visible cost', panel.visibleCost, rawArtStyle, packet, panel),
      this.sanitizedPanelLine('Visual narrative', panel.visualNarrative, rawArtStyle, packet, panel),
      this.sanitizedPanelLine('Encounter storyboard role', panel.storyboardRole, rawArtStyle, packet, panel),
      this.sanitizedPanelLine('Encounter storyboard frame', panel.storyboardFrameId, rawArtStyle, packet, panel),
      this.sanitizedPanelLine('Branch context', panel.branchLabel, rawArtStyle, packet, panel),
      panel.outcomeTier ? `Outcome tier: ${panel.outcomeTier}` : '',
      panel.family.startsWith('encounter') || panel.family === 'storylet-aftermath'
        ? 'Encounter direction: preserve escalating back-and-forth intensity, movement, tactical reversals, emotional pressure, and dramatic action appropriate to this choice path.'
        : '',
      'Make the staging expressive and alive: asymmetric poses, active hands, clear body language, and a specific story moment rather than a static portrait.',
    ].filter(Boolean).join('\n');

    return {
      prompt,
      style: rawArtStyle,
      aspectRatio: '9:16',
      composition: 'reader overlay safe portrait panel, calm dark lower third',
      negativePrompt: 'text, captions, speech bubbles, UI, readable phone UI, notifications, app icons, readable signage, readable papers, watermark, logo, border, duplicate character, same character twice, cloned character, repeated figure, second copy of same character, changed wardrobe, missing canonical outfit, stiff pose, mannequin pose, lower-third clutter',
    };
  }

  private buildRefinementPrompt(
    brief: StoryboardV2Brief,
    packet: StoryboardScenePacket,
    panel: StoryboardPanelSlot,
    rawArtStyle: string,
  ): ImagePrompt {
    const panelPrompt = this.buildPanelPrompt(brief, packet, panel, rawArtStyle);
    return {
      ...panelPrompt,
      prompt: [
        `ART STYLE: ${rawArtStyle}`,
        'Refine the provided cropped storyboard panel into the final full-size reader image.',
        STYLE_HIERARCHY_BLOCK,
        'Preserve the cropped panel closely for staging, but do not let it override supplied character identity references.',
        'Clean crop-edge artifacts, remove gutters or border remnants, sharpen/detail the image, and improve full-resolution finish.',
        'Match visible characters exactly to their provided character reference images: face, hair, body type, silhouette, wardrobe language, and recognizable design must stay consistent. Do not introduce characters whose references were not provided.',
        WARDROBE_IDENTITY_POLICY,
        'Use episodeStyleLockRef only for palette, lighting, texture, rendering finish, and mood continuity. No reference image may override or reinterpret the raw ART STYLE.',
        DUPLICATE_CHARACTER_RULE,
        'FORMAT: portrait 9:16, 1024x1536.',
        'READER OVERLAY COMPOSITION: keep the lower 30-40% visually calmer and darker, with no important faces, hands, props, readable text, key action, or high-contrast details in that lower zone.',
        'No captions, no speech bubbles, no UI, no decorative typography, no panel borders, no watermarks, and no readable in-world text.',
        SCREEN_TEXT_POLICY,
        panelPrompt.prompt,
      ].join('\n'),
      aspectRatio: '9:16',
      composition: 'refined full-size reader image from cropped storyboard panel',
      negativePrompt: 'captions, speech bubbles, UI, readable phone UI, notifications, app icons, readable signage, readable papers, watermark, white border, white gutter, white mat, panel frame, duplicate character, same character twice, cloned character, repeated figure, second copy of same character, changed wardrobe, missing canonical outfit, stiff pose, mannequin pose, lower-third clutter',
    };
  }

  private bindPanelResult(
    brief: StoryboardV2Brief,
    panel: StoryboardPanelSlot,
    result: GeneratedImage,
    beatImages: Map<string, string>,
    sceneImages: Map<string, string>,
    encounterImages: StoryboardV2Result['encounterImageResults']['encounterImages'],
    storyletImages: StoryboardV2Result['encounterImageResults']['storyletImages'],
  ): void {
    if (!result.imageUrl) return;
    this.recordLocalImage(panel, result);

    if (panel.family === 'story-beat') {
      beatImages.set(mapBeatKey(brief, panel.sceneId, panel.beatId), result.imageUrl);
      if (!sceneImages.has(panel.scopedSceneId)) sceneImages.set(panel.scopedSceneId, result.imageUrl);
      this.markRegistry(panel, result, 'story-beat');
      if (!this.assetRegistry.get(`story-scene:${panel.scopedSceneId}`)) {
        this.assetRegistry.planSlot({
          slotId: `story-scene:${panel.scopedSceneId}`,
          family: 'story-scene',
          imageType: 'scene',
          sceneId: panel.sceneId,
          scopedSceneId: panel.scopedSceneId,
          beatId: panel.beatId,
          storyFieldPath: `episodes[].scenes[id=${panel.sceneId}].backgroundImage`,
          baseIdentifier: `scene-${panel.scopedSceneId}-bg`,
          required: false,
          qualityTier: 'standard',
          coverageKey: `scene:${panel.sceneId}`,
        });
      }
      this.assetRegistry.markSuccess(`story-scene:${panel.scopedSceneId}`, result);
      return;
    }

    const maps = encounterImages.get(panel.sceneId) || {
      setupImages: new Map<string, string>(),
      outcomeImages: new Map<string, { success?: string; complicated?: string; failure?: string }>(),
    };
    encounterImages.set(panel.sceneId, maps);

    if (panel.family === 'encounter-setup') {
      maps.setupImages.set(panel.beatId, result.imageUrl);
      this.markRegistry(panel, result, 'encounter-setup');
      return;
    }

    if (panel.family === 'encounter-situation' && panel.situationKey) {
      maps.setupImages.set(panel.situationKey, result.imageUrl);
      this.markRegistry(panel, result, 'encounter-situation');
      return;
    }

    if (panel.family === 'encounter-outcome' && panel.choiceMapKey && panel.outcomeTier) {
      const outcomeMap = maps.outcomeImages.get(panel.choiceMapKey) || {};
      outcomeMap[panel.outcomeTier] = result.imageUrl;
      maps.outcomeImages.set(panel.choiceMapKey, outcomeMap);
      this.markRegistry(panel, result, 'encounter-outcome');
      return;
    }

    if (panel.family === 'storylet-aftermath' && panel.outcomeName) {
      const sceneMap = storyletImages.get(panel.sceneId) || new Map<string, Map<string, string>>();
      const beatMap = sceneMap.get(panel.outcomeName) || new Map<string, string>();
      beatMap.set(panel.beatId, result.imageUrl);
      sceneMap.set(panel.outcomeName, beatMap);
      storyletImages.set(panel.sceneId, sceneMap);
      this.markRegistry(panel, result, 'storylet-aftermath');
    }
  }

  private markRegistry(panel: StoryboardPanelSlot, result: GeneratedImage, family: StoryboardPanelSlot['family']): void {
    const slotId = this.registrySlotId(panel);
    if (!this.assetRegistry.get(slotId)) {
      this.assetRegistry.planSlot({
        slotId,
        family,
        imageType: this.imageTypeForFamily(family),
        sceneId: panel.sceneId,
        scopedSceneId: panel.scopedSceneId,
        beatId: panel.beatId,
        outcomeName: panel.outcomeName,
        outcomeTier: panel.outcomeTier,
        choiceMapKey: panel.choiceMapKey,
        situationKey: panel.situationKey,
        storyFieldPath: this.storyFieldPath(panel),
        baseIdentifier: safeId(panel.id),
        required: false,
        qualityTier: 'standard',
        coverageKey: panel.id,
        metadata: {
          pipelineMode: 'storyboard-v2',
          visibleCharacterIds: panel.visibleCharacterIds,
        },
      });
    }
    this.assetRegistry.markSuccess(slotId, result, {
      prompt: result.prompt,
      referencePack: this.referencePack(slotId),
      provider: result.metadata?.provider || 'openai',
      model: result.metadata?.model || this.config.imageGen?.openaiImageModel || 'gpt-image-2',
    });
  }

  private recordLocalImage(panel: StoryboardPanelSlot, result: GeneratedImage): void {
    this.localImages.push({
      slotId: this.registrySlotId(panel),
      family: panel.family,
      sceneId: panel.sceneId,
      scopedSceneId: panel.scopedSceneId,
      beatId: panel.beatId,
      sequenceIndex: panel.sequenceIndex,
      imageUrl: result.imageUrl,
      imagePath: result.imagePath,
    });
  }

  private registrySlotId(panel: StoryboardPanelSlot): string {
    if (panel.family === 'story-beat') return `story-beat:${panel.scopedSceneId}::${panel.beatId}`;
    if (panel.family === 'encounter-setup') return `encounter-setup:${panel.scopedSceneId}::${panel.beatId}`;
    if (panel.family === 'encounter-outcome') return `encounter-outcome:${panel.scopedSceneId}::${panel.beatId}::${panel.choiceMapKey}::${panel.outcomeTier}`;
    if (panel.family === 'encounter-situation') return `encounter-situation:${panel.scopedSceneId}::${panel.beatId}::${panel.situationKey}`;
    return `storylet-aftermath:${panel.scopedSceneId}::${panel.outcomeName}::${panel.beatId}`;
  }

  private storyFieldPath(panel: StoryboardPanelSlot): string {
    if (panel.family === 'story-beat') return `episodes[].scenes[id=${panel.sceneId}].beats[id=${panel.beatId}].image`;
    if (panel.family === 'encounter-setup') return `episodes[].scenes[id=${panel.sceneId}].encounter.beats[id=${panel.beatId}].situationImage`;
    if (panel.family === 'encounter-outcome') return `episodes[].scenes[id=${panel.sceneId}].encounter.outcomes[${panel.choiceMapKey}].${panel.outcomeTier}.outcomeImage`;
    if (panel.family === 'encounter-situation') return `episodes[].scenes[id=${panel.sceneId}].encounter.situations[${panel.situationKey}].situationImage`;
    return `episodes[].scenes[id=${panel.sceneId}].encounter.storylets[${panel.outcomeName}].beats[id=${panel.beatId}].image`;
  }

  private referencePack(slotId: string): SlotReferencePack {
    const references = [
      ...this.characterRefs.values(),
      ...(this.episodeStyleLockRef ? [this.episodeStyleLockRef] : []),
    ];
    return {
      slotId,
      totalCount: references.length,
      references,
      summary: references.map((ref) => ({
        role: ref.role,
        governs: ref.governs,
        prohibited: ref.prohibited,
        characterId: ref.characterId,
        characterName: ref.characterName,
        viewType: ref.viewType,
      })),
    };
  }

  private async safeGenerate(
    prompt: ImagePrompt,
    identifier: string,
    metadata: Record<string, unknown>,
    references?: ReferenceImage[],
  ): Promise<GeneratedImage | undefined> {
    try {
      return await this.imageService.generateImage(prompt, identifier, {
        type: 'beat',
        pipelineMode: 'storyboard-v2',
        ...metadata,
      } as any, references);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failedSlots.push({ slotId: identifier, error: message });
      this.emit('warning', 'images', `Storyboard v2 image failed for ${identifier}: ${message}`);
      return undefined;
    }
  }

  private emit(type: string, phase: string, message: string, data?: unknown): void {
    this.emitEvent?.({ type, phase, message, data });
  }

  private imageTypeForFamily(family: StoryboardPanelSlot['family']): 'beat' | 'encounter-setup' | 'encounter-outcome' | 'storylet-aftermath' {
    if (family === 'story-beat') return 'beat';
    if (family === 'encounter-situation') return 'encounter-setup';
    return family;
  }

  private async saveJson(path: string, payload: unknown): Promise<void> {
    if (!this.outputDirectory || !nodeFs) return;
    const fullPath = `${this.outputDirectory}${path}`;
    await nodeFs.mkdir(fullPath.split('/').slice(0, -1).join('/'), { recursive: true });
    await nodeFs.writeFile(fullPath, JSON.stringify(payload, null, 2), 'utf8');
  }
}
