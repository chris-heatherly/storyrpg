import type {
  EndingStateDriverType,
  StoryEndingTarget,
  TreatmentBranchGuidance,
  TreatmentEpisodeGuidance,
} from '../../types/sourceAnalysis';

export interface ExtractedTreatment {
  isTreatment: boolean;
  episodes: Record<number, TreatmentEpisodeGuidance>;
  branches: TreatmentBranchGuidance[];
  endings: StoryEndingTarget[];
}

const SECTION_HEADING_RE = /^##\s+\d+\.\s+(.+)$/gm;
const EPISODE_HEADING_RE = /^###\s+Episode\s+(\d+)\s+[—-]\s+"?([^"\n]+?)"?\s*$/gm;
const BRANCH_HEADING_RE = /^###\s+Branch\s+[A-Z]\s+[—-]\s+(.+)$/gm;
const ENDING_HEADING_RE = /^###\s+Ending\s+\d+\s+[—-]\s+"([^"]+)"(?:\s+\(([^)]+)\))?/gm;

const TREATMENT_MARKERS = [
  /branching[-\s]narrative season treatment/i,
  /choose-your-own-adventure/i,
  /^###\s+Episode\s+\d+/im,
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

function getNumberedSection(markdown: string, startsWith: string): string {
  const matches = [...markdown.matchAll(SECTION_HEADING_RE)];
  const foundIndex = matches.findIndex((match) => (match[1] || '').trim().toLowerCase().startsWith(startsWith.toLowerCase()));
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
  return [...(inline ? [inline] : []), ...list];
}

function parseEpisodeGuidance(section: string): Record<number, TreatmentEpisodeGuidance> {
  const episodes: Record<number, TreatmentEpisodeGuidance> = {};

  for (const guidance of splitByMatches(section, EPISODE_HEADING_RE, (match, body) => {
    const episodeNumber = Number(match[1]);
    const encounterAnchors = [
      ...getAllBulletValues(body, 'Encounter anchor'),
      ...getInlineOrIndentedList(body, 'Encounter anchors'),
    ];

    return {
      episodeNumber,
      guidance: {
        episodePromise: getBulletValue(body, 'Episode promise'),
        toneRegister: getBulletValue(body, 'Tone register'),
        encounterAnchors,
        encounterBuildup: getBulletValue(body, 'Encounter buildup'),
        majorChoicePressures: getInlineOrIndentedList(body, 'Major choice pressure'),
        alternativePaths: getInlineOrIndentedList(body, 'Alternative paths'),
        consequenceSeeds: getInlineOrIndentedList(body, 'Consequence seeds'),
        authoredCliffhanger: getBulletValue(body, 'Cliffhanger') || getBulletValue(body, 'Cliffhanger / closing image'),
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
  const episodeSection = getNumberedSection(markdown, 'episode outline');
  const branchSection = getNumberedSection(markdown, 'cross-episode branches');
  const endingSection = getNumberedSection(markdown, 'alternate endings');
  const isTreatment = looksLikeTreatmentMarkdown(markdown)
    && Boolean(episodeSection)
    && Boolean(endingSection);

  if (!isTreatment) {
    return { isTreatment: false, episodes: {}, branches: [], endings: [] };
  }

  return {
    isTreatment: true,
    episodes: parseEpisodeGuidance(episodeSection),
    branches: parseBranches(branchSection),
    endings: parseEndings(endingSection),
  };
}

export function looksLikeTreatmentMarkdown(markdown: string): boolean {
  const markerCount = TREATMENT_MARKERS.reduce((count, marker) => count + (marker.test(markdown) ? 1 : 0), 0);
  return markerCount >= 3 || (
    /story treatment/i.test(markdown)
    && (/^###\s+Episode\s+\d+/im.test(markdown) || /\*\*Episode promise(?:\s*\([^)]*\))?:\*\*/i.test(markdown))
  );
}
