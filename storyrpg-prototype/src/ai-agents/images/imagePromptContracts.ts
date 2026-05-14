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
  { pattern: /\brender(?:ed)? in (?:an? )?[^.]{0,80}?(?:style|aesthetic)\b/gi, replacement: '', label: 'alternate render style clause' },
  { pattern: /\b(?:cinematic\s+)?story frame\b/gi, replacement: 'story moment', label: 'cinematic story frame' },
  { pattern: /\boil painting texture\b/gi, replacement: 'surface texture', label: 'oil painting texture' },
];

const CHARACTER_REDESIGN_TERMS = /\b(change(?:d)? (?:hair|face|eyes|skin|build|body)|different (?:face|hair|eyes|skin|body|outfit)|redesign(?:ed)?|new look|make (?:her|him|them) look)\b/i;

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function sanitizeStyleContaminationText(value: string | undefined): SanitizedText {
  if (!value) return { text: '', sanitizedTerms: [] };
  let text = value;
  const sanitizedTerms: string[] = [];
  if (/\[object Object\]/i.test(text)) {
    sanitizedTerms.push('[object Object]');
    text = text.replace(/\[object Object\]/gi, 'structured identity details');
  }
  const protectedNegativeClauses = new Map<string, string>();
  text = text.replace(/(^|[.!?;,]\s*)((?:avoid|never|no|not|without|forbid|forbidden|do not|don't)\b[^.!?;]*)/gi, (match) => {
    const token = `__NEG_STYLE_CLAUSE_${protectedNegativeClauses.size}__`;
    protectedNegativeClauses.set(token, match);
    return token;
  });
  for (const rule of STYLE_CONTAMINATION) {
    if (rule.pattern.test(text)) {
      sanitizedTerms.push(rule.label);
      text = text.replace(rule.pattern, rule.replacement);
    }
    rule.pattern.lastIndex = 0;
  }
  for (const [token, clause] of protectedNegativeClauses) {
    text = text.replace(token, clause);
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
    'This style contract is supreme for rendering, palette, lighting, linework, texture, finish, camera language, and visual polish.',
    'If any reference image or scene detail conflicts with this style contract, obey the style contract.',
  ].join(' ');
}
