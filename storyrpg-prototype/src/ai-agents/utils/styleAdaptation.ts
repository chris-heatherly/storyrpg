export type SceneWorldMode =
  | 'modern_real_world'
  | 'fantastical_divine'
  | 'fantastical_magical'
  | 'historical'
  | 'mixed'
  | 'unknown';

export interface SceneSettingContext {
  locationId?: string;
  locationName?: string;
  locationType?: string;
  worldMode: SceneWorldMode;
  timePeriod?: string;
  technologyLevel?: string;
  magicSystem?: string;
  architectureAndMaterialCue: string;
  environmentTextureCue: string;
  wardrobeContextCue: string;
  atmosphericCue: string;
  timeOfDay?: 'dawn' | 'day' | 'dusk' | 'night';
  weather?: 'clear' | 'overcast' | 'stormy' | 'foggy';
  keywords: string[];
  summary: string;
}

export interface ConditionalStyleBranch {
  label: string;
  content: string;
  semanticTargets: string[];
}

export interface ParsedConditionalArtStyle {
  originalText: string;
  baseStyleText: string;
  sharedRules: string[];
  branches: ConditionalStyleBranch[];
}

export interface StyleAdaptationSelection {
  branchLabel: string;
  matchedOn: string[];
  notes: string[];
}

export interface ResolveSceneSettingContextInput {
  sceneName: string;
  sceneDescription?: string;
  sceneMood?: string;
  authoredLocationId?: string;
  authoredLocationName?: string;
  authoredLocationType?: string;
  authoredLocationDescription?: string;
  locationThreshold?: boolean;
  worldPremise?: string;
  worldTimePeriod?: string;
  worldTechnologyLevel?: string;
  worldMagicSystem?: string;
  worldRules?: string[];
  worldCustoms?: string[];
  worldBeliefs?: string[];
  timeOfDay?: 'dawn' | 'day' | 'dusk' | 'night';
  weather?: 'clear' | 'overcast' | 'stormy' | 'foggy';
}

const MODERN_KEYWORDS = [
  'modern', 'real world', 'real-world', 'contemporary', 'present day', 'present-day',
  'urban', 'city', 'editorial', 'concrete', 'steel', 'glass', 'traffic', 'subway',
  'apartment', 'office', 'cafe', 'street', 'technology', 'phone', 'car',
];

const DIVINE_KEYWORDS = [
  'olympus', 'divine', 'god', 'goddess', 'celestial', 'immortal', 'heavenly',
  'mythic', 'mythological', 'ambrosia', 'gilded cloud', 'marble palace',
];

const FANTASY_KEYWORDS = [
  'fantastical', 'fantasy', 'magical', 'magic', 'enchanted', 'spell', 'arcane',
  'crystal', 'floating', 'otherworldly', 'mystic', 'sorcery',
];

const HISTORICAL_KEYWORDS = [
  'historical', 'victorian', 'regency', 'medieval', 'renaissance', 'ancient',
  'period', 'horse-drawn', 'gaslight', 'courtly', 'kingdom', 'empire',
];

function normalizeWhitespace(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string | undefined): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9/\-\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function collectKeywordHits(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword));
}

function inferBranchSemanticTargets(label: string, content: string): string[] {
  const combined = `${label} ${content}`.toLowerCase();
  const targets = new Set<string>();

  if (collectKeywordHits(combined, MODERN_KEYWORDS).length > 0) {
    targets.add('modern_real_world');
    targets.add('modern');
  }
  if (collectKeywordHits(combined, DIVINE_KEYWORDS).length > 0) {
    targets.add('fantastical_divine');
    targets.add('divine');
  }
  if (collectKeywordHits(combined, FANTASY_KEYWORDS).length > 0) {
    targets.add('fantastical_magical');
    targets.add('fantastical');
  }
  if (collectKeywordHits(combined, HISTORICAL_KEYWORDS).length > 0) {
    targets.add('historical');
  }

  if (targets.size === 0) {
    targets.add(normalizeWhitespace(label).toLowerCase().replace(/[:\s]+/g, '_'));
  }

  return Array.from(targets);
}

export function parseConditionalArtStyle(styleText: string | undefined): ParsedConditionalArtStyle {
  const originalText = normalizeWhitespace(styleText);
  if (!originalText) {
    return {
      originalText: '',
      baseStyleText: '',
      sharedRules: [],
      branches: [],
    };
  }

  const headingRegex = /((?:For|In)\s+[^:]{2,80}:|(?:General|Global|Universal)(?:\s+\w+){0,3}\s*Rules?:)/g;
  const matches = Array.from(originalText.matchAll(headingRegex));
  if (matches.length === 0) {
    return {
      originalText,
      baseStyleText: originalText,
      sharedRules: [],
      branches: [],
    };
  }

  const baseStyleText = normalizeWhitespace(originalText.slice(0, matches[0].index));
  const sharedRules: string[] = [];
  const branches: ConditionalStyleBranch[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const heading = normalizeWhitespace(match[1]);
    const sectionStart = (match.index || 0) + match[0].length;
    const sectionEnd = i + 1 < matches.length ? (matches[i + 1].index || originalText.length) : originalText.length;
    const content = normalizeWhitespace(originalText.slice(sectionStart, sectionEnd));
    if (!content) continue;

    if (/^(general|global|universal)/i.test(heading)) {
      sharedRules.push(content);
      continue;
    }

    branches.push({
      label: heading.replace(/:$/, ''),
      content,
      semanticTargets: inferBranchSemanticTargets(heading, content),
    });
  }

  return {
    originalText,
    baseStyleText,
    sharedRules,
    branches,
  };
}

function determineWorldMode(text: string): SceneWorldMode {
  const modernHits = collectKeywordHits(text, MODERN_KEYWORDS).length;
  const divineHits = collectKeywordHits(text, DIVINE_KEYWORDS).length;
  const fantasyHits = collectKeywordHits(text, FANTASY_KEYWORDS).length;
  const historicalHits = collectKeywordHits(text, HISTORICAL_KEYWORDS).length;

  if ((modernHits > 0 && (divineHits > 0 || fantasyHits > 0)) || (historicalHits > 0 && (divineHits > 0 || fantasyHits > 0))) {
    return 'mixed';
  }
  if (divineHits > 0) return 'fantastical_divine';
  if (fantasyHits > 0) return 'fantastical_magical';
  if (historicalHits > 0) return 'historical';
  if (modernHits > 0) return 'modern_real_world';
  return 'unknown';
}

function defaultArchitectureCue(worldMode: SceneWorldMode, locationName?: string): string {
  const place = locationName || 'this setting';
  switch (worldMode) {
    case 'modern_real_world':
      return `Use contemporary architecture and believable real-world materials for ${place}, with refined finish quality rather than grit.`;
    case 'fantastical_divine':
      return `Use idealized mythic architecture for ${place}, with elevated monumental forms and transcendent materials that still belong to the same overall style.`;
    case 'fantastical_magical':
      return `Use magical or otherworldly architecture for ${place}, with impossible forms and enchanted materials expressed through the same overall style language.`;
    case 'historical':
      return `Use period-authentic architecture and materials for ${place}, preserving the same base aesthetic while shifting era-specific construction details.`;
    case 'mixed':
      return `Blend real-world and fantastical architecture in ${place} without changing the base style, emphasizing the tension between ordinary and otherworldly materials.`;
    default:
      return `Let the environment details in ${place} shape the setting presentation while preserving the same base style identity.`;
  }
}

function defaultTextureCue(worldMode: SceneWorldMode): string {
  switch (worldMode) {
    case 'modern_real_world':
      return 'Surface treatment should emphasize refined contemporary textures, clean edges, and realistic fabrication details.';
    case 'fantastical_divine':
      return 'Surface treatment should emphasize celestial, idealized, luminous, or divine textures rendered through the same base style.';
    case 'fantastical_magical':
      return 'Surface treatment should emphasize enchanted, crystalline, arcane, or impossible textures while staying inside the same rendering language.';
    case 'historical':
      return 'Surface treatment should emphasize era-authentic wear, craft, and material richness consistent with the base style.';
    case 'mixed':
      return 'Surface treatment should preserve a coherent style while allowing real-world and fantastical textures to coexist in the same frame.';
    default:
      return 'Surface treatment should follow the environment cues of the scene without altering the underlying style identity.';
  }
}

function defaultWardrobeCue(worldMode: SceneWorldMode): string {
  switch (worldMode) {
    case 'modern_real_world':
      return 'If wardrobe is visible, keep silhouettes contemporary and grounded, with luxury expressed through construction, fabric quality, and subtle finishing.';
    case 'fantastical_divine':
      return 'If wardrobe is visible, allow ceremonial or divine opulence, idealized drapery, and elevated ornamentation without changing the core style.';
    case 'fantastical_magical':
      return 'If wardrobe is visible, allow magical embellishment, layered fantasy construction, and heightened symbolic detail inside the same style family.';
    case 'historical':
      return 'If wardrobe is visible, use period-authentic tailoring, silhouettes, and trim appropriate to the era while preserving the same base style.';
    case 'mixed':
      return 'If wardrobe is visible, blend contemporary and fantastical or ceremonial cues carefully so the result feels intentional rather than stylistically split.';
    default:
      return 'If wardrobe is visible, let the scene context guide silhouette and material treatment while preserving the same overall style.';
  }
}

function defaultAtmosphericCue(worldMode: SceneWorldMode): string {
  switch (worldMode) {
    case 'modern_real_world':
      return 'Atmosphere should feel grounded, immediate, and physically believable.';
    case 'fantastical_divine':
      return 'Atmosphere should feel exalted, timeless, and larger than mortal scale.';
    case 'fantastical_magical':
      return 'Atmosphere should feel enchanted, uncanny, and subtly impossible.';
    case 'historical':
      return 'Atmosphere should feel period-rooted and immersive.';
    case 'mixed':
      return 'Atmosphere should preserve a stable style while acknowledging both mundane and otherworldly influences.';
    default:
      return 'Atmosphere should follow the story moment and location cues.';
  }
}

export function resolveSceneSettingContext(input: ResolveSceneSettingContextInput): SceneSettingContext {
  const combinedText = normalizeWhitespace([
    input.sceneName,
    input.sceneDescription,
    input.sceneMood,
    input.authoredLocationName,
    input.authoredLocationType,
    input.authoredLocationDescription,
    input.worldPremise,
    input.worldTimePeriod,
    input.worldTechnologyLevel,
    input.worldMagicSystem,
    ...(input.worldRules || []),
    ...(input.worldCustoms || []),
    ...(input.worldBeliefs || []),
  ].join(' '));

  const worldMode = determineWorldMode(combinedText);
  const keywords = Array.from(new Set([
    ...collectKeywordHits(combinedText, MODERN_KEYWORDS),
    ...collectKeywordHits(combinedText, DIVINE_KEYWORDS),
    ...collectKeywordHits(combinedText, FANTASY_KEYWORDS),
    ...collectKeywordHits(combinedText, HISTORICAL_KEYWORDS),
  ]));

  const summaryParts = [
    input.authoredLocationName ? `Location ${input.authoredLocationName}` : undefined,
    input.authoredLocationType ? `type ${input.authoredLocationType}` : undefined,
    `world mode ${worldMode.replace(/_/g, ' ')}`,
    input.worldTimePeriod ? `time period ${input.worldTimePeriod}` : undefined,
    input.worldTechnologyLevel ? `technology ${input.worldTechnologyLevel}` : undefined,
    input.worldMagicSystem ? `magic ${input.worldMagicSystem}` : undefined,
    input.locationThreshold ? 'threshold location' : undefined,
  ].filter(Boolean);

  return {
    locationId: input.authoredLocationId,
    locationName: input.authoredLocationName,
    locationType: input.authoredLocationType,
    worldMode,
    timePeriod: input.worldTimePeriod,
    technologyLevel: input.worldTechnologyLevel,
    magicSystem: input.worldMagicSystem,
    architectureAndMaterialCue: defaultArchitectureCue(worldMode, input.authoredLocationName),
    environmentTextureCue: defaultTextureCue(worldMode),
    wardrobeContextCue: defaultWardrobeCue(worldMode),
    atmosphericCue: defaultAtmosphericCue(worldMode),
    timeOfDay: input.timeOfDay,
    weather: input.weather,
    keywords,
    summary: summaryParts.join('; '),
  };
}

function branchScore(branch: ConditionalStyleBranch, settingContext: SceneSettingContext): { score: number; matchedOn: string[] } {
  const matchedOn: string[] = [];
  for (const semantic of branch.semanticTargets) {
    if (semantic === settingContext.worldMode || settingContext.keywords.includes(semantic)) {
      matchedOn.push(semantic);
    }
    if (settingContext.worldMode === 'fantastical_divine' && semantic === 'divine') {
      matchedOn.push('divine');
    }
    if (settingContext.worldMode.startsWith('fantastical') && semantic === 'fantastical') {
      matchedOn.push('fantastical');
    }
    if (settingContext.worldMode === 'modern_real_world' && semantic === 'modern') {
      matchedOn.push('modern');
    }
  }
  return { score: matchedOn.length, matchedOn };
}

export function selectStyleAdaptation(
  styleText: string | undefined,
  settingContext?: SceneSettingContext
): StyleAdaptationSelection {
  const parsed = parseConditionalArtStyle(styleText);
  if (!settingContext) {
    return {
      branchLabel: 'shared',
      matchedOn: [],
      notes: parsed.sharedRules,
    };
  }

  let bestBranch: ConditionalStyleBranch | undefined;
  let bestScore = 0;
  let bestMatchedOn: string[] = [];
  for (const branch of parsed.branches) {
    const { score, matchedOn } = branchScore(branch, settingContext);
    if (score > bestScore) {
      bestBranch = branch;
      bestScore = score;
      bestMatchedOn = matchedOn;
    }
  }

  const notes: string[] = [];
  notes.push(
    `Apply any setting-specific treatment as a manifestation of the SAME overall style. Preserve character identity, rendering language, and cross-scene continuity while adapting environment, materials, wardrobe emphasis, and atmosphere to this setting.`
  );
  notes.push(`Resolved scene setting: ${settingContext.summary}.`);
  notes.push(settingContext.architectureAndMaterialCue);
  notes.push(settingContext.environmentTextureCue);
  notes.push(settingContext.wardrobeContextCue);
  notes.push(settingContext.atmosphericCue);

  for (const sharedRule of parsed.sharedRules) {
    notes.push(sharedRule);
  }
  if (bestBranch?.content) {
    notes.push(bestBranch.content);
  }

  return {
    branchLabel: bestBranch?.label || 'shared',
    matchedOn: bestMatchedOn,
    notes: notes.filter(Boolean),
  };
}
