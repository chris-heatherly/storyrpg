import {
  EndingMode,
  EndingSourceConfidence,
  EndingStateDriver,
  StoryEndingTarget,
  SourceMaterialAnalysis,
} from '../../types/sourceAnalysis';
import { slugify } from './idUtils';

type EndingSeed = {
  title?: string;
  tone?: string;
  themes?: string[];
  protagonistName?: string;
  protagonistArc?: string;
  storyArcs?: Array<{ name: string; description: string }>;
};

type PartialEnding = Partial<StoryEndingTarget> & {
  name?: string;
  summary?: string;
};

function normalizeDrivers(value: unknown): EndingStateDriver[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((driver): EndingStateDriver | null => {
      if (typeof driver === 'string') {
        return {
          type: 'choice_pattern',
          label: driver,
        };
      }
      if (!driver || typeof driver !== 'object') return null;
      const record = driver as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : 'choice_pattern';
      const label = typeof record.label === 'string'
        ? record.label
        : typeof record.name === 'string'
          ? record.name
          : typeof record.description === 'string'
            ? record.description
            : '';
      if (!label.trim()) return null;
      return {
        type: (
          type === 'relationship' ||
          type === 'identity' ||
          type === 'flag' ||
          type === 'encounter_outcome' ||
          type === 'faction' ||
          type === 'theme' ||
          type === 'choice_pattern' ||
          type === 'resource'
        ) ? type : 'choice_pattern',
        label: label.trim(),
        details: typeof record.details === 'string' ? record.details.trim() : undefined,
      };
    })
    .filter((driver): driver is EndingStateDriver => Boolean(driver));
}

function normalizeConditions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((condition) => typeof condition === 'string' ? condition.trim() : '')
    .filter(Boolean);
}

function fallbackDrivers(seed: EndingSeed, theme: string): EndingStateDriver[] {
  return [
    {
      type: 'theme',
      label: theme,
      details: 'Theme that the route resolves at the finale.',
    },
    {
      type: 'identity',
      label: seed.protagonistArc?.trim() || `${seed.protagonistName || 'The protagonist'} chooses who to become`,
      details: 'Identity pressure that the player has been shaping across the season.',
    },
  ];
}

function createEndingId(name: string, index: number): string {
  return `ending-${index + 1}-${slugify(name || `route-${index + 1}`)}`;
}

export function normalizeEndingTargets(
  endings: unknown,
  sourceConfidence: EndingSourceConfidence,
  seed: EndingSeed,
): StoryEndingTarget[] {
  if (!Array.isArray(endings)) return [];
  return endings
    .map((ending, index): StoryEndingTarget | null => {
      if (!ending || typeof ending !== 'object') return null;
      const record = ending as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
      if (!name || !summary) return null;
      const theme = typeof record.themePayoff === 'string' && record.themePayoff.trim()
        ? record.themePayoff.trim()
        : seed.themes?.[index % Math.max(seed.themes?.length || 1, 1)] || 'Change has a cost';
      const emotionalRegister = typeof record.emotionalRegister === 'string' && record.emotionalRegister.trim()
        ? record.emotionalRegister.trim()
        : seed.tone?.trim() || 'Bittersweet';

      const normalized: StoryEndingTarget = {
        id: typeof record.id === 'string' && record.id.trim()
          ? record.id.trim()
          : createEndingId(name, index),
        name,
        summary,
        emotionalRegister,
        themePayoff: theme,
        stateDrivers: normalizeDrivers(record.stateDrivers),
        targetConditions: normalizeConditions(record.targetConditions),
        sourceConfidence,
      };

      if (normalized.stateDrivers.length === 0) {
        normalized.stateDrivers = fallbackDrivers(seed, theme);
      }
      if (normalized.targetConditions.length === 0) {
        normalized.targetConditions = [`Choices that pay off ${theme.toLowerCase()}.`];
      }
      return normalized;
    })
    .filter((ending): ending is StoryEndingTarget => Boolean(ending));
}

export function buildPrimaryEnding(seed: EndingSeed, existing: StoryEndingTarget[] = []): StoryEndingTarget {
  if (existing.length > 0) {
    const primary = existing[0];
    return {
      ...primary,
      sourceConfidence: primary.sourceConfidence === 'generated' ? 'inferred' : primary.sourceConfidence,
    };
  }

  const leadTheme = seed.themes?.[0] || 'identity';
  const protagonist = seed.protagonistName || 'The protagonist';
  const summary = seed.protagonistArc?.trim()
    ? `${protagonist} reaches a decisive version of ${seed.protagonistArc.trim().replace(/\.$/, '')}.`
    : `${protagonist} resolves the central conflict in a way that pays off the story's main promise.`;

  return {
    id: createEndingId('primary-ending', 0),
    name: `Primary Ending: ${leadTheme}`,
    summary,
    emotionalRegister: seed.tone?.trim() || 'Earned and conclusive',
    themePayoff: `The finale lands the story's strongest theme: ${leadTheme}.`,
    stateDrivers: fallbackDrivers(seed, leadTheme),
    targetConditions: [
      `Major choices converge toward the story's central promise around ${leadTheme}.`,
    ],
    sourceConfidence: 'inferred',
  };
}

export function buildGeneratedAlternateEndings(seed: EndingSeed, count = 4): StoryEndingTarget[] {
  const themes = seed.themes && seed.themes.length > 0
    ? seed.themes
    : ['identity', 'trust', 'power', 'sacrifice'];
  const protagonist = seed.protagonistName || 'The protagonist';
  const arc = seed.protagonistArc?.trim() || 'their defining conflict';
  const arcs = seed.storyArcs && seed.storyArcs.length > 0 ? seed.storyArcs : [{ name: 'Core Conflict', description: arc }];
  const templates: Array<{ suffix: string; emotional: string; conditionVerb: string }> = [
    { suffix: 'Ascendant Path', emotional: 'Triumphant but costly', conditionVerb: 'maximize momentum toward' },
    { suffix: 'Reconciled Path', emotional: 'Tender and restorative', conditionVerb: 'protect relationships around' },
    { suffix: 'Defiant Path', emotional: 'Sharp, risky, and liberating', conditionVerb: 'reject the expected cost of' },
    { suffix: 'Bittersweet Path', emotional: 'Poignant and unresolved in a satisfying way', conditionVerb: 'accept sacrifice in service of' },
    { suffix: 'Transformative Path', emotional: 'Intimate and identity-driven', conditionVerb: 'reshape identity around' },
  ];

  return Array.from({ length: Math.max(3, Math.min(5, count)) }, (_, index) => {
    const theme = themes[index % themes.length];
    const arcBeat = arcs[index % arcs.length];
    const template = templates[index % templates.length];
    return {
      id: createEndingId(`${theme}-${template.suffix}`, index),
      name: `${theme.charAt(0).toUpperCase()}${theme.slice(1)} ${template.suffix}`,
      summary: `${protagonist} resolves ${arcBeat.name.toLowerCase()} by leaning into ${theme.toLowerCase()}, turning ${arc} into a distinct final outcome.`,
      emotionalRegister: template.emotional,
      themePayoff: `${theme} becomes the lens through which the finale is judged.`,
      stateDrivers: [
        {
          type: 'theme',
          label: theme,
          details: 'Core thematic route that distinguishes this ending.',
        },
        {
          type: 'identity',
          label: arc,
          details: 'How the protagonist changes by the finale.',
        },
        {
          type: 'choice_pattern',
          label: arcBeat.description || arcBeat.name,
          details: 'Season-long decision pattern that pushes toward this route.',
        },
      ],
      targetConditions: [
        `Major choices ${template.conditionVerb} ${theme.toLowerCase()}.`,
        `Late-season scenes reinforce ${arcBeat.name.toLowerCase()}.`,
      ],
      sourceConfidence: 'generated',
    };
  });
}

export function applyEndingModeToAnalysis(
  analysis: SourceMaterialAnalysis,
  override?: EndingMode | null,
): SourceMaterialAnalysis {
  const seed: EndingSeed = {
    title: analysis.sourceTitle,
    tone: analysis.tone,
    themes: analysis.themes,
    protagonistName: analysis.protagonist?.name,
    protagonistArc: analysis.protagonist?.arc,
    storyArcs: analysis.storyArcs.map((arc) => ({ name: arc.name, description: arc.description })),
  };
  const extracted = analysis.extractedEndings || [];
  const generated = analysis.generatedEndings && analysis.generatedEndings.length > 0
    ? analysis.generatedEndings
    : buildGeneratedAlternateEndings(seed);
  const detectedMode: EndingMode = analysis.detectedEndingMode || (extracted.length > 1 ? 'multiple' : 'single');
  const resolvedMode: EndingMode = override || analysis.resolvedEndingMode || detectedMode;

  const resolvedEndings = resolvedMode === 'multiple'
    ? (extracted.length > 0 ? extracted : generated)
    : [buildPrimaryEnding(seed, extracted.length > 0 ? extracted : generated)];

  return {
    ...analysis,
    detectedEndingMode: detectedMode,
    resolvedEndingMode: resolvedMode,
    generatedEndings: generated,
    resolvedEndings,
  };
}

export function buildAnalysisFromEndingSeeds(
  seed: EndingSeed,
  extractedEndings: StoryEndingTarget[],
  detectedMode: EndingMode,
  override?: EndingMode,
): Pick<
  SourceMaterialAnalysis,
  'detectedEndingMode' | 'resolvedEndingMode' | 'extractedEndings' | 'generatedEndings' | 'resolvedEndings'
> {
  const generatedEndings = buildGeneratedAlternateEndings(seed);
  const resolvedMode = override || detectedMode;
  const resolvedEndings = resolvedMode === 'multiple'
    ? (extractedEndings.length > 0 ? extractedEndings : generatedEndings)
    : [buildPrimaryEnding(seed, extractedEndings.length > 0 ? extractedEndings : generatedEndings)];

  return {
    detectedEndingMode: detectedMode,
    resolvedEndingMode: resolvedMode,
    extractedEndings,
    generatedEndings,
    resolvedEndings,
  };
}
