import type { ImagePrompt } from '../agents/ImageGenerator';

export type StyleContractSource =
  | 'user-visual'
  | 'approved-anchor'
  | 'raw-season-style'
  | 'default';

export interface PromptContractOptions {
  style: string;
  styleSource?: StyleContractSource;
  characterIdentity?: string[];
  appearanceState?: string;
  sceneAction?: string;
  composition?: string;
  negativeContract?: string;
  mode: 'character-ref' | 'story-beat' | 'style-anchor' | 'cover' | 'encounter';
  hasVisualCharacterRef?: boolean;
  hasVisualStyleRef?: boolean;
}

export interface SanitizedText {
  text: string;
  sanitizedTerms: string[];
}

const STYLE_CONTAMINATION: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  { pattern: /\breference sheet style\b/gi, replacement: 'clean full-body character identity reference', label: 'reference sheet style' },
  { pattern: /\bcinematic story art\b/gi, replacement: 'story illustration', label: 'cinematic story art' },
  { pattern: /\bcinematic story frame\b/gi, replacement: 'single story image', label: 'cinematic story frame' },
  { pattern: /\bfilm still\b/gi, replacement: 'single story image', label: 'film still' },
  { pattern: /\bmovie still\b/gi, replacement: 'single story image', label: 'movie still' },
  { pattern: /\bconcept art\b/gi, replacement: 'finished illustration', label: 'concept art' },
  { pattern: /\boil painting texture\b/gi, replacement: 'style-consistent finish', label: 'oil painting texture' },
  { pattern: /\bphotoreal(?:istic|ism)?\b/gi, replacement: 'style-consistent', label: 'photorealism' },
  { pattern: /\bgritty realism\b/gi, replacement: 'clean style-consistent realism level', label: 'gritty realism' },
  { pattern: /\bhyper[- ]?detailed\b/gi, replacement: 'clear detailed', label: 'hyper-detailed' },
  { pattern: /\bpainterly environment\b/gi, replacement: 'style-consistent environment', label: 'painterly environment' },
  { pattern: /\bgeneric anime style\b/gi, replacement: 'the specified season style', label: 'generic anime style' },
  { pattern: /\bgeneric illustrated style\b/gi, replacement: 'the specified season style', label: 'generic illustrated style' },
  { pattern: /\bdefault comic[- ]book style\b/gi, replacement: 'the specified season style', label: 'default comic-book style' },
  { pattern: /\bdefault graphic[- ]novel style\b/gi, replacement: 'the specified season style', label: 'default graphic-novel style' },
  { pattern: /\brender(?:ed)? in (?:an? )?[^.]{0,80}?(?:style|aesthetic)\b/gi, replacement: 'rendered in the required season style', label: 'alternate render style clause' },
];

const CHARACTER_REDESIGN_TERMS = /\b(change(?:d)? (?:hair|face|eyes|skin|build|body)|different (?:face|hair|eyes|skin|body|outfit)|redesign(?:ed)?|new look|make (?:her|him|them) look)\b/i;

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function sanitizeStyleContaminationText(value: string | undefined): SanitizedText {
  if (!value) return { text: '', sanitizedTerms: [] };
  let text = value;
  const sanitizedTerms: string[] = [];
  for (const rule of STYLE_CONTAMINATION) {
    if (rule.pattern.test(text)) {
      sanitizedTerms.push(rule.label);
      text = text.replace(rule.pattern, rule.replacement);
    }
    rule.pattern.lastIndex = 0;
  }
  text = text.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  return { text, sanitizedTerms: unique(sanitizedTerms) };
}

export function hasUnauthorizedCharacterRedesign(value: string | undefined): boolean {
  return CHARACTER_REDESIGN_TERMS.test(value || '');
}

export function applyPromptContract(
  prompt: ImagePrompt,
  options: PromptContractOptions,
): ImagePrompt {
  const style = options.style?.trim() || prompt.style?.trim() || '';
  const styleToken = '__RAW_STYLE_CONTRACT_TEXT__';
  const promptTextForSanitizer = style
    ? (prompt.prompt || '').replace(style, styleToken)
    : prompt.prompt;
  const promptCleanRaw = sanitizeStyleContaminationText(promptTextForSanitizer);
  const promptClean = {
    ...promptCleanRaw,
    text: promptCleanRaw.text.replace(styleToken, style),
  };
  const compositionClean = sanitizeStyleContaminationText(options.composition || prompt.composition);
  const negativeClean = {
    text: (prompt.negativePrompt || '').replace(/\breference sheet style\b/gi, 'clean full-body character identity reference'),
    sanitizedTerms: /\breference sheet style\b/i.test(prompt.negativePrompt || '') ? ['reference sheet style'] : [],
  };
  const styleSource = options.styleSource || (style ? 'raw-season-style' : 'default');
  const deterministicRules = [
    'style_contract controls rendering, lighting, palette, linework, finish, and texture',
    'character_identity controls subject identity and stable wardrobe only',
    'appearance_state may change appearance only when story-justified',
    'scene_action controls the depicted moment without changing art direction',
  ];
  const sanitizedTerms = unique([
    ...promptClean.sanitizedTerms,
    ...compositionClean.sanitizedTerms,
    ...negativeClean.sanitizedTerms,
  ]);

  return {
    ...prompt,
    prompt: promptClean.text || prompt.prompt,
    negativePrompt: negativeClean.text || prompt.negativePrompt,
    style,
    styleContract: {
      source: styleSource,
      text: style,
    },
    characterIdentity: options.characterIdentity,
    appearanceState: options.appearanceState,
    sceneAction: options.sceneAction,
    compositionContract: compositionClean.text || options.composition || prompt.composition,
    negativeContract: options.negativeContract || negativeClean.text || prompt.negativePrompt,
    promptContract: {
      ...(prompt.promptContract || {}),
      sanitizedTerms,
      deterministicRules,
      referencePrecedence: options.hasVisualCharacterRef
        ? 'user visual character refs control identity and appearance'
        : 'approved generated character refs control downstream identity; text identity is secondary',
      stylePrecedence: options.hasVisualStyleRef
        ? 'user visual style refs control style'
        : styleSource === 'approved-anchor'
          ? 'approved style anchor plus raw season style control rendering'
          : 'raw season style text controls rendering',
    },
  };
}

export function buildStyleContractDirective(style: string): string {
  const cleaned = style.trim();
  if (!cleaned) return '';
  return [
    `STYLE CONTRACT (authoritative renderer): ${cleaned}`,
    'Render all character, fashion, scene, lighting, and composition details through this style only.',
    'Do not introduce any other unapproved renderer, texture system, finish, or default illustrated look.',
  ].join(' ');
}
