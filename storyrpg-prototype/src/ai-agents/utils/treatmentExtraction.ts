import type {
  EndingStateDriverType,
  StoryEndingTarget,
  StructuralRole,
  TreatmentBranchGuidance,
  TreatmentEpisodeGuidance,
} from '../../types/sourceAnalysis';

export interface ExtractedTreatment {
  isTreatment: boolean;
  episodes: Record<number, TreatmentEpisodeGuidance>;
  branches: TreatmentBranchGuidance[];
  endings: StoryEndingTarget[];
  metadata: {
    detected: boolean;
    confidence: 'low' | 'medium' | 'high';
    formatVersion: 'legacy' | 'storyrpg-treatment-v2';
    warnings: string[];
  };
}

const SECTION_HEADING_RE = /^##\s+(?:\d+\.\s+)?(.+)$/gm;
const EPISODE_HEADING_RE = /^###\s+(?:(?:Episode|Ep\.?)\s*)?(\d+)(?:\s*[.:\-—–]\s*|\s+)(?:"?([^"\n]+?)"?)\s*$/gim;
const BRANCH_HEADING_RE = /^###\s+Branch\s+[A-Z0-9]*\s*(?:[—–:-]\s+)?(.+)$/gim;
const ENDING_HEADING_RE = /^###\s+Ending\s+(?:\d+|[A-Z])\s*(?:[—–:-]\s*)"?([^"\n(]+)"?(?:\s+\(([^)]+)\))?/gim;

const TREATMENT_MARKERS = [
  /branching[-\s]narrative season treatment/i,
  /storyrpg structure model/i,
  /3-act\s*\/\s*7-point season spine/i,
  /choose-your-own-adventure/i,
  /^###\s+(?:Episode\s+)?\d+/im,
  /\bEpisode Outline\b/i,
  /\*\*Structural role(?:\s*:\s*anchor, fused anchors, or buffer)?(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*Episode turns?(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*How the encounter manifests the central conflict(?:\s*\([^)]*\))?:\*\*/i,
  /\bCapability,\s*Growth,\s*And\s*Fail-Forward\b/i,
  /\bEpisode Endings\b/i,
  /\*\*Episode promise(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*Tone register(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*Major choice pressure(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*Alternative paths(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*Consequence seeds(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*Cliffhanger(?:\s*\/\s*closing image)?(?:\s*\([^)]*\))?:\*\*/i,
  /^###\s+Branch\s+[A-Z]\s+[—-]/im,
  /^###\s+Ending\s+\d+\s+[—-]/im,
  /^##\s+\d+\.\s+Alternate endings/im,
];

const EMPTY_METADATA: ExtractedTreatment['metadata'] = {
  detected: false,
  confidence: 'low',
  formatVersion: 'legacy',
  warnings: [],
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function splitByMatches<T>(
  text: string,
  re: RegExp,
  build: (match: RegExpExecArray, body: string) => T,
): T[] {
  const matches = [...text.matchAll(re)];
  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
    return build(match, text.slice(start, end).trim());
  });
}

function getFlexibleSection(markdown: string, labels: string[]): string {
  const matches = [...markdown.matchAll(SECTION_HEADING_RE)];
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const foundIndex = matches.findIndex((match) => {
    const heading = (match[1] || '').trim().toLowerCase();
    return normalizedLabels.some((label) => heading.includes(label));
  });
  if (foundIndex < 0) return '';
  const start = (matches[foundIndex].index || 0) + matches[foundIndex][0].length;
  const end = foundIndex + 1 < matches.length ? matches[foundIndex + 1].index || markdown.length : markdown.length;
  return markdown.slice(start, end).trim();
}

function getBulletValue(body: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`^(?:-\\s+)?\\*\\*${escaped}(?:\\s*\\([^)]*\\))?:\\*\\*\\s*(.+)$`, 'im'));
  return match?.[1]?.trim();
}

function getAllBulletValues(body: string, labelPrefix: string): string[] {
  const escaped = labelPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^-\\s+\\*\\*${escaped}[^:]*:\\*\\*\\s*(.+)$`, 'gim');
  return [...body.matchAll(re)].map((match) => match[1]?.trim()).filter(Boolean) as string[];
}

function getBulletValueWithLabelPrefix(body: string, labelPrefix: string): string | undefined {
  const escaped = labelPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`^(?:-\\s+)?\\*\\*${escaped}[^*]*:\\*\\*\\s*(.+)$`, 'im'));
  return match?.[1]?.trim();
}

function getIndentedBulletList(body: string, label: string): string[] {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelRe = new RegExp(`^-\\s+\\*\\*${escaped}:\\*\\*\\s*$`, 'im');
  const match = labelRe.exec(body);
  if (!match) return [];

  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const nextTopLevel = rest.search(/\n-\s+\*\*[^:\n]+:\*\*|\n###\s+/);
  const block = nextTopLevel >= 0 ? rest.slice(0, nextTopLevel) : rest;

  return block
    .split('\n')
    .map((line) => line.match(/^\s{2,}-\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean) as string[];
}

function getInlineOrIndentedList(body: string, label: string): string[] {
  const inline = getBulletValue(body, label);
  const list = getIndentedBulletList(body, label);
  const splitInline = inline
    ? inline.split(/\s*(?:\n|;|\s+\|\s+)\s*/).map((part) => part.trim()).filter(Boolean)
    : [];
  return [...splitInline, ...list];
}

export function normalizeTreatmentStructuralRoles(raw: string | undefined): StructuralRole[] {
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const roles: StructuralRole[] = [];
  const add = (role: StructuralRole) => {
    if (!roles.includes(role)) roles.push(role);
  };
  if (/\bhook\b/.test(lower)) add('hook');
  if (/plot\s*turn\s*1|plotturn1|inciting|commitment/.test(lower)) add('plotTurn1');
  if (/pinch\s*1|first\s+pinch/.test(lower)) add('pinch1');
  if (/midpoint|mirror|reversal/.test(lower)) add('midpoint');
  if (/pinch\s*2|second\s+pinch|crisis/.test(lower)) add('pinch2');
  if (/climax|final confrontation/.test(lower)) add('climax');
  if (/resolution|aftermath|legacy/.test(lower)) add('resolution');
  if (/falling|final-pressure|final pressure|processing|recovery/.test(lower)) add('falling');
  if (/rising|buffer|setup|escalat/.test(lower) && roles.length === 0) add('rising');
  return roles;
}

function parseEpisodeGuidance(section: string): Record<number, TreatmentEpisodeGuidance> {
  const episodes: Record<number, TreatmentEpisodeGuidance> = {};

  for (const guidance of splitByMatches(section, EPISODE_HEADING_RE, (match, body) => {
    const episodeNumber = Number(match[1]);
    const authoredTitle = (match[2] || '').trim().replace(/^["“”]+|["“”]+$/g, '');
    const rawStructuralRole = getBulletValue(body, 'Structural role')
      || getBulletValueWithLabelPrefix(body, 'Structural role')
      || getAllBulletValues(body, 'Structural role')[0];
    const encounterAnchors = [
      ...getAllBulletValues(body, 'Encounter anchor'),
      ...getInlineOrIndentedList(body, 'Encounter anchors'),
    ];
    const endingPressure = getBulletValue(body, 'Ending pressure')
      || getBulletValue(body, 'Cliffhanger')
      || getBulletValue(body, 'Cliffhanger / closing image');

    return {
      episodeNumber,
      guidance: {
        authoredTitle: authoredTitle || undefined,
        actLabel: getBulletValue(body, 'Act'),
        rawStructuralRole,
        normalizedStructuralRoles: normalizeTreatmentStructuralRoles(rawStructuralRole),
        episodePromise: getBulletValue(body, 'Episode promise'),
        episodeTurns: getInlineOrIndentedList(body, 'Episode turns'),
        toneRegister: getBulletValue(body, 'Tone register'),
        encounterAnchors,
        encounterCentralConflict: getBulletValue(body, 'How the encounter manifests the central conflict')
          || getBulletValue(body, 'Encounter central conflict')
          || getBulletValue(body, 'Central conflict'),
        encounterBuildup: getBulletValue(body, 'Encounter buildup'),
        encounterAftermath: getBulletValue(body, 'Aftermath / consequence')
          || getBulletValue(body, 'Encounter aftermath')
          || getBulletValue(body, 'Aftermath'),
        majorChoicePressures: getInlineOrIndentedList(body, 'Major choice pressure'),
        alternativePaths: getInlineOrIndentedList(body, 'Alternative paths'),
        consequenceSeeds: getInlineOrIndentedList(body, 'Consequence seeds'),
        endingPressure,
        authoredCliffhanger: endingPressure,
        resolutionAftermath: getBulletValue(body, 'Resolution / aftermath')
          || getBulletValue(body, 'Resolution aftermath'),
        capabilityGrowthGuidance: getInlineOrIndentedList(body, 'Capability, Growth, And Fail-Forward')
          .concat(getInlineOrIndentedList(body, 'Capability growth')),
      } satisfies TreatmentEpisodeGuidance,
    };
  })) {
    if (Number.isFinite(guidance.episodeNumber)) {
      episodes[guidance.episodeNumber] = guidance.guidance;
    }
  }

  return episodes;
}

function firstEpisodeMention(text: string): number | undefined {
  const match = text.match(/Episode\s+(\d+)/i) || text.match(/\bep(?:isode)?\.?\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function parseBranches(section: string): TreatmentBranchGuidance[] {
  return splitByMatches(section, BRANCH_HEADING_RE, (match, body) => {
    const name = (match[1] || '').trim();
    const searchable = `${name}\n${body}`;
    const originEpisode = firstEpisodeMention(searchable);
    const reconvergenceEpisode = Number(searchable.match(/(?:→|to|through)\s*(?:Episode|ep)\s*(\d+)\s*reconvergence|reconverges?\s+(?:at|in|by)?\s*(?:the\s+)?(?:mirror moment\s+in\s+)?(?:episode|ep)\s*(\d+)/i)?.slice(1).find(Boolean));
    return {
      id: `treatment-branch-${slugify(name)}`,
      name,
      summary: body.replace(/\s+/g, ' ').trim(),
      originEpisode,
      reconvergenceEpisode: Number.isFinite(reconvergenceEpisode) ? reconvergenceEpisode : undefined,
    };
  });
}

function normalizeDriverType(raw: string): EndingStateDriverType {
  const lower = raw.toLowerCase();
  if (lower.includes('relationship')) return 'relationship';
  if (lower.includes('identity') || lower.includes('self')) return 'identity';
  if (lower.includes('flag')) return 'flag';
  if (lower.includes('encounter')) return 'encounter_outcome';
  if (lower.includes('faction')) return 'faction';
  if (lower.includes('resource') || lower.includes('blog')) return 'resource';
  if (lower.includes('choice') || lower.includes('pattern')) return 'choice_pattern';
  return 'theme';
}

function splitSentences(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/(?<=\.)\s+|;\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseEndings(section: string): StoryEndingTarget[] {
  return splitByMatches(section, ENDING_HEADING_RE, (match, body) => {
    const name = (match[1] || '').trim();
    const parenthetical = (match[2] || '').trim();
    const summary = getBulletValue(body, 'Summary') || body.split('\n').find((line) => line.trim())?.trim() || name;
    const drivers = splitSentences(getBulletValue(body, 'State drivers'));
    return {
      id: `ending-${slugify(parenthetical || name)}`,
      name: parenthetical ? `${name} (${parenthetical})` : name,
      summary,
      emotionalRegister: getBulletValue(body, 'Emotional register') || 'thematically distinct',
      themePayoff: getBulletValue(body, 'Theme payoff') || summary,
      stateDrivers: drivers.map((driver) => ({
        type: normalizeDriverType(driver),
        label: driver,
        details: driver,
      })),
      targetConditions: splitSentences(getBulletValue(body, 'Target conditions')),
      sourceConfidence: 'explicit',
    };
  });
}

export function extractTreatmentFromMarkdown(markdown: string): ExtractedTreatment {
  const episodeSection = getFlexibleSection(markdown, ['episode outline']);
  const branchSection = getFlexibleSection(markdown, ['cross-episode branches', 'branch', 'consequence chains']);
  const endingSection = getFlexibleSection(markdown, ['alternate endings', 'episode endings', 'endings']);
  const looksLikeTreatment = looksLikeTreatmentMarkdown(markdown);
  const episodes = episodeSection ? parseEpisodeGuidance(episodeSection) : {};
  const endings = endingSection ? parseEndings(endingSection) : [];
  const warnings: string[] = [];
  if (looksLikeTreatment && Object.keys(episodes).length === 0) warnings.push('No episode guidance could be parsed from the treatment.');
  if (looksLikeTreatment && endings.length === 0) warnings.push('No ending targets could be parsed from the treatment.');
  const markerCount = TREATMENT_MARKERS.reduce((count, marker) => count + (marker.test(markdown) ? 1 : 0), 0);
  const formatVersion = /storyrpg structure model|episode turns?|central conflict|episode endings/i.test(markdown)
    ? 'storyrpg-treatment-v2'
    : 'legacy';
  const confidence: ExtractedTreatment['metadata']['confidence'] = markerCount >= 6 && Object.keys(episodes).length > 0
    ? 'high'
    : markerCount >= 3
      ? 'medium'
      : 'low';
  const isTreatment = looksLikeTreatment && Boolean(episodeSection) && Object.keys(episodes).length > 0;

  if (!isTreatment) {
    return { isTreatment: false, episodes: {}, branches: [], endings: [], metadata: { ...EMPTY_METADATA, detected: looksLikeTreatment, warnings } };
  }

  return {
    isTreatment: true,
    episodes,
    branches: parseBranches(branchSection),
    endings,
    metadata: {
      detected: true,
      confidence,
      formatVersion,
      warnings,
    },
  };
}

export function looksLikeTreatmentMarkdown(markdown: string): boolean {
  const markerCount = TREATMENT_MARKERS.reduce((count, marker) => count + (marker.test(markdown) ? 1 : 0), 0);
  return markerCount >= 3 || (
    /story treatment/i.test(markdown)
    && (/^###\s+Episode\s+\d+/im.test(markdown) || /\*\*Episode promise(?:\s*\([^)]*\))?:\*\*/i.test(markdown))
  );
}
