import type {
  EndingStateDriverType,
  StoryEndingTarget,
  StructuralRole,
  TreatmentBranchGuidance,
  TreatmentEpisodeGuidance,
  TreatmentSeasonGuidance,
  ProtagonistTreatmentGuidance,
  WorldLocationTreatmentGuidance,
  WorldLocationTreatmentLocationGuidance,
} from '../../types/sourceAnalysis';
import { extractBeatEpisodeAnchors } from './treatmentFingerprint';
import { parseInformationLedgerGuidance } from './informationLedgerContracts';

export interface ExtractedTreatment {
  isTreatment: boolean;
  episodes: Record<number, TreatmentEpisodeGuidance>;
  branches: TreatmentBranchGuidance[];
  endings: StoryEndingTarget[];
  seasonGuidance?: TreatmentSeasonGuidance;
  metadata: {
    detected: boolean;
    confidence: 'low' | 'medium' | 'high';
    formatVersion: 'legacy' | 'storyrpg-treatment-v2';
    warnings: string[];
  };
}

const SECTION_HEADING_RE = /^##\s+(?:\d+\.\s+)?(.+)$/gm;
const HEADED_EPISODE_RE = /^#{3,5}\s+(?:\*\*)?(?:(?:Scene\s*Episode|SceneEpisode|SceneEp|Episode|Scene|Ep\.?|SE|E)\s*#?\s*)?\d+(?:\s*[.):\-—–]\s*|\s+)/gim;
const EPISODE_HEADING_RE = /^(?:(?:#{3,5}\s+)(?:\*\*)?(?:(?:Scene\s*Episode|SceneEpisode|SceneEp|Episode|Scene|Ep\.?|SE|E)\s*#?\s*)?(\d+)(?:\s*[.):\-—–]\s*|\s+)(.+?)(?:\*\*)?\s*|(?:(?:Scene\s*Episode|SceneEpisode|SceneEp|Episode|Scene|Ep\.?|SE|E)\s*#?\s*)?(\d+)(?:\s*[.):\-—–]\s*|\s+)(?:\*\*)?(.+?)(?:\*\*)?\s*)$/gim;
const NUMBER_AND_TITLE_RE = /^(?:-\s*)?(?:\*\*)?(Scene\s*Episode|SceneEpisode|SceneEp|Episode)\s+number\s+and\s+title(?:\s*\([^)]*\))?(?:\s*:\*\*|\*\*\s*:|\s*:)\s*(?:\*\*)?(?:(?:Scene\s*Episode|SceneEpisode|SceneEp|Episode|Scene|Ep\.?|SE|E)\s*#?\s*)?(\d+)(?:(?:\s*[.):\-—–]\s*|\s+)([^*\n]+?))?(?:\*\*)?\s*$/gim;
const BRANCH_HEADING_RE = /^(?:#{3,5}\s+|\*\*)(?:(?:Branch|Consequence Chain)\s+[A-Z0-9]*\s*)?(?:[—–:-]\s+)?(.+?)(?:\*\*)?\s*$/gim;
const ENDING_HEADING_RE = /^#{3,5}\s+Ending\s+(?:\d+|[A-Z])\s*(?:[.):—–:-]\s*)"?([^"\n(]+)"?(?:\s+\(([^)]+)\))?/gim;

const TREATMENT_MARKERS = [
  /branching[-\s]narrative season treatment/i,
  /storyrpg treatment prompt/i,
  /regular episode version/i,
  /sceneepisode version/i,
  /storyrpg structure model/i,
  /3-act\s*\/\s*7-point season spine/i,
  /choose-your-own-adventure/i,
  /^#{3,5}\s+(?:(?:Scene\s*)?Episode\s+|SceneEp\s+|Scene\s+|Ep\.?\s+|SE\s*)?\d+/im,
  /\bEpisode Outline\b/i,
  /\bSceneEpisode Outline\b/i,
  /\*\*Structural role(?:\s*:\s*anchor, fused anchors, or buffer)?(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*Entry goal(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*Forced choice(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*Exit shift(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*Episode turns?(?:\s*\([^)]*\))?:\*\*/i,
  /\*\*How the encounter manifests the central conflict(?:\s*\([^)]*\))?:\*\*/i,
  /\bCapability,\s*Growth,\s*And\s*Fail-Forward\b/i,
  /\bInformation Ledger\b/i,
  /\bArc\s+\d+:\s+.+?\(Episodes?\s+\d+\s*[-–]\s*\d+\)/i,
  /\bArc dramatic question\b/i,
  /\bScene Planning Notes\b/i,
  /^-\s+Scene\s*:/im,
  /\bFailure Mode Audit\b/i,
  /\bEpisode Endings\b/i,
  /\bWorld\s+(?:And|\+)\s+Location Brief\b/i,
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

const TOP_LEVEL_BULLET_FIELD_RE = /\n-\s+(?:\*\*[^:\n]+:\*\*|[^:\n]{1,120}:)/;

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

function resettableTest(re: RegExp, value: string): boolean {
  re.lastIndex = 0;
  const matched = re.test(value);
  re.lastIndex = 0;
  return matched;
}

function isPromptGuideMarkdown(markdown: string): boolean {
  return /\bcopy-paste prompt\b/i.test(markdown)
    || /\buse this prompt guide\b/i.test(markdown)
    || /\bcreate a treatment with these sections\b/i.test(markdown)
    || /\brequired treatment sections\b/i.test(markdown);
}

function getFlexibleSection(markdown: string, labels: string[]): string {
  const matches = [...markdown.matchAll(SECTION_HEADING_RE)];
  let foundIndex = -1;
  for (const label of labels.map((value) => value.toLowerCase())) {
    foundIndex = matches.findIndex((match) => (match[1] || '').trim().toLowerCase().includes(label));
    if (foundIndex >= 0) break;
  }
  if (foundIndex < 0) return '';
  const start = (matches[foundIndex].index || 0) + matches[foundIndex][0].length;
  const end = foundIndex + 1 < matches.length ? matches[foundIndex + 1].index || markdown.length : markdown.length;
  return markdown.slice(start, end).trim();
}

function getFlexibleHeadingSection(markdown: string, labels: string[], levels = '3,5'): string {
  const headingRe = new RegExp(`^#{${levels}}\\s+(.+)$`, 'gm');
  const matches = [...markdown.matchAll(headingRe)];
  let foundIndex = -1;
  for (const label of labels.map((value) => value.toLowerCase())) {
    foundIndex = matches.findIndex((match) => (match[1] || '').trim().toLowerCase().includes(label));
    if (foundIndex >= 0) break;
  }
  if (foundIndex < 0) return '';
  const start = (matches[foundIndex].index || 0) + matches[foundIndex][0].length;
  const end = foundIndex + 1 < matches.length ? matches[foundIndex + 1].index || markdown.length : markdown.length;
  return markdown.slice(start, end).trim();
}

function getBulletValue(body: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boldMatch = body.match(new RegExp(`^(?:-\\s+)?\\*\\*${escaped}(?:\\s*\\([^)]*\\))?:\\*\\*[ \\t]*(.*?)(?=[ \\t]+\\*\\*[^*]+:\\*\\*|$)`, 'im'))
    || body.match(new RegExp(`\\*\\*${escaped}(?:\\s*\\([^)]*\\))?:\\*\\*[ \\t]*(.*?)(?=[ \\t]+\\*\\*[^*]+:\\*\\*|\\n|$)`, 'i'));
  if (boldMatch?.[1]) return boldMatch[1].trim();
  const plainMatch = body.match(new RegExp(`^(?:-\\s+)?${escaped}(?:\\s*\\([^)]*\\))?\\s*:\\s*(.+)$`, 'im'));
  return plainMatch?.[1]?.trim();
}

function getFlexibleBulletValue(body: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const value = getBulletValue(body, label) || getBulletValueWithLabelPrefix(body, label);
    if (value) return value;
  }
  return undefined;
}

function getAllBulletValues(body: string, labelPrefix: string): string[] {
  const escaped = labelPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boldRe = new RegExp(`^-\\s+\\*\\*${escaped}[^:]*:\\*\\*[ \\t]*(.+)$`, 'gim');
  const plainRe = new RegExp(`^-\\s+${escaped}[^:]*:[ \\t]*(.+)$`, 'gim');
  return [
    ...[...body.matchAll(boldRe)].map((match) => match[1]?.trim()).filter(Boolean),
    ...[...body.matchAll(plainRe)].map((match) => match[1]?.trim()).filter(Boolean),
  ] as string[];
}

function getBulletValueWithLabelPrefix(body: string, labelPrefix: string): string | undefined {
  const escaped = labelPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boldMatch = body.match(new RegExp(`^(?:-\\s+)?\\*\\*${escaped}[^*]*:\\*\\*[ \\t]*(.*?)(?=[ \\t]+\\*\\*[^*]+:\\*\\*|$)`, 'im'))
    || body.match(new RegExp(`\\*\\*${escaped}[^*]*:\\*\\*[ \\t]*(.*?)(?=[ \\t]+\\*\\*[^*]+:\\*\\*|\\n|$)`, 'i'));
  if (boldMatch?.[1]) return boldMatch[1].trim();
  const plainMatch = body.match(new RegExp(`^(?:-\\s+)?${escaped}[^:]*:\\s*(.+)$`, 'im'));
  return plainMatch?.[1]?.trim();
}

function getIndentedBulletList(body: string, label: string): string[] {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelRe = new RegExp(`^-\\s+(?:\\*\\*${escaped}[^:]*:\\*\\*|${escaped}[^:]*:)\\s*$`, 'im');
  const match = labelRe.exec(body);
  if (!match) return [];

  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const nextTopLevel = rest.search(new RegExp(`${TOP_LEVEL_BULLET_FIELD_RE.source}|\\n#{3,5}\\s+`));
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
    ? (/^\s*\(\d+\)/.test(inline)
        ? inline.split(/\s*(?=\(\d+\)\s*)/).map((part) => part.replace(/^\(\d+\)\s*/, '').trim()).filter(Boolean)
        : inline.split(/\s*(?:\n|;|\s+\|\s+)\s*/).map((part) => part.trim()).filter(Boolean))
    : [];
  return [...splitInline, ...list];
}

function getFlexibleInlineOrIndentedList(body: string, labels: string[]): string[] {
  const combined: string[] = [];
  for (const label of labels) {
    const directValues = getInlineOrIndentedList(body, label);
    combined.push(...directValues);
    for (const value of getAllBulletValues(body, label)) {
      if (directValues.length > 0 && directValues.every((direct) => value.includes(direct))) continue;
      combined.push(value);
    }
  }
  return Array.from(new Set(combined.map((item) => item.trim().replace(/^-\s+/, '')).filter(Boolean)));
}

function normalizeEpisodeNumberTitleLines(section: string): string {
  return section.replace(NUMBER_AND_TITLE_RE, (_match, kind: string, number: string, rawTitle: string | undefined) => {
    const canonicalKind = /scene/i.test(kind) ? 'SceneEpisode' : 'Episode';
    const title = (rawTitle || `${canonicalKind} ${number}`)
      .trim()
      .replace(/^["“”]+|["“”]+$/g, '');
    return `### ${canonicalKind} ${number}: ${title}`;
  });
}

function cleanAuthoredTitle(raw: string | undefined): string {
  return (raw || '')
    .trim()
    .replace(/\*\*/g, '')
    .replace(/\s+\((?:finale|season finale|final)\)\s*$/i, '')
    .replace(/^["“”]+|["“”]+$/g, '')
    .trim();
}

export function normalizeTreatmentStructuralRoles(raw: string | undefined): StructuralRole[] {
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const roles: StructuralRole[] = [];
  const add = (role: StructuralRole) => {
    if (!roles.includes(role)) roles.push(role);
  };
  const leadingBufferRole = lower.match(/^\s*(rising|falling|buffer)\b/);
  if (leadingBufferRole) {
    const value = leadingBufferRole[1];
    if (value === 'falling') return ['falling'];
    if (value === 'rising') return ['rising'];
    return /falling|final-pressure|final pressure|processing|recovery/.test(lower) ? ['falling'] : ['rising'];
  }
  if (/\bbuffer\b/.test(lower)) {
    if (/falling|final-pressure|final pressure|processing|recovery/.test(lower)) return ['falling'];
    return ['rising'];
  }
  if (/\brising\b/.test(lower)) return ['rising'];
  if (/\bfalling|final-pressure|final pressure|processing|recovery/.test(lower)) return ['falling'];
  if (/\bhook\b/.test(lower)) add('hook');
  if (/plot\s*turn\s*1|plotturn1|inciting|commitment/.test(lower)) add('plotTurn1');
  if (/pinch\s*1|first\s+pinch/.test(lower)) add('pinch1');
  if (/midpoint|mirror|reversal/.test(lower)) add('midpoint');
  if (/pinch\s*2|second\s+pinch|crisis/.test(lower)) add('pinch2');
  if (/climax|final confrontation/.test(lower)) add('climax');
  if (/resolution|aftermath|legacy/.test(lower)) add('resolution');
  if (/rising|buffer|setup|escalat/.test(lower) && roles.length === 0) add('rising');
  return roles;
}

function normalizeCliffhangerType(raw: string | undefined): TreatmentEpisodeGuidance['cliffhangerType'] | undefined {
  const normalized = raw?.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
  const aliases: Record<string, TreatmentEpisodeGuidance['cliffhangerType']> = {
    reveal: 'revelation',
    revelation: 'revelation',
    danger: 'danger',
    mystery: 'mystery',
    betrayal: 'betrayal',
    arrival: 'arrival',
    departure: 'departure',
    decision: 'decision',
    transformation: 'transformation',
    shock: 'shock',
    emotional: 'emotional_hook',
    emotional_hook: 'emotional_hook',
    reframe: 'reframe',
    loss: 'loss',
  };
  return normalized ? aliases[normalized] : undefined;
}

function cleanTreatmentAnchorCandidate(value: string): string {
  return value
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/^[A-Z][A-Za-z0-9 /&,'’-]{1,80}:\s+/, '')
    .trim();
}

function mergeUniqueList(...lists: Array<string[] | undefined>): string[] {
  const merged: string[] = [];
  for (const list of lists) {
    for (const value of list ?? []) {
      const cleaned = value.trim();
      if (!cleaned) continue;
      if (merged.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) continue;
      merged.push(cleaned);
    }
  }
  return merged;
}

function splitEpisodeBodyIntoAnchorCandidates(body: string): string[] {
  return body
    .split(/\r?\n+/)
    .flatMap((line) => {
      const cleaned = cleanTreatmentAnchorCandidate(line);
      if (!cleaned) return [];
      return cleaned
        .split(/(?<=[.!?])\s+|;\s+/)
        .map((part) => cleanTreatmentAnchorCandidate(part))
        .filter(Boolean);
    });
}

function hasAuthoredSocialProofAnchor(value: string): boolean {
  return /\b(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*[kKmM]|(?:eighty|ninety|hundred|thousand|million)\b)/.test(value)
    && /\b(blog|post|readership|reads?|readers?|dashboard|viral|traffic|views?|followers?|subscribers?|clicks?|brand deals?)\b/i.test(value);
}

function hasAuthoredLineageNameAnchor(value: string): boolean {
  return /\b[A-Z][a-z][A-Za-z'’-]*\b/.test(value)
    && /\b(grandmother|grandfather|mother|father|parent|maiden name|family name|surname|heirloom|letter|chain|locket|ring|inheritance|ancestor|lineage|bloodline)\b/i.test(value);
}

function extractLiteralEpisodeFactAnchors(body: string): string[] {
  let socialProofAnchor: string | undefined;
  let lineageNameAnchor: string | undefined;
  for (const candidate of splitEpisodeBodyIntoAnchorCandidates(body)) {
    if (candidate.length > 320) continue;
    if (!socialProofAnchor && hasAuthoredSocialProofAnchor(candidate)) {
      socialProofAnchor = candidate;
    }
    if (!lineageNameAnchor && hasAuthoredLineageNameAnchor(candidate)) {
      lineageNameAnchor = candidate;
    }
    if (socialProofAnchor && lineageNameAnchor) break;
  }
  return mergeUniqueList([socialProofAnchor, lineageNameAnchor].filter(Boolean) as string[]);
}

function parseEpisodeGuidance(section: string): Record<number, TreatmentEpisodeGuidance> {
  const episodes: Record<number, TreatmentEpisodeGuidance> = {};
  const normalizedSection = normalizeEpisodeNumberTitleLines(section);

  for (const guidance of splitByMatches(normalizedSection, EPISODE_HEADING_RE, (match, body) => {
    const episodeNumber = Number(match[1] || match[3]);
    const authoredTitle = cleanAuthoredTitle(match[2] || match[4]);
    const rawStructuralRole = getBulletValue(body, 'Structural role')
      || getBulletValueWithLabelPrefix(body, 'Structural role')
      || getAllBulletValues(body, 'Structural role')[0];
    const structuralNote = getFlexibleBulletValue(body, ['Structural note', 'Role note']);
    const encounterAnchors = [
      ...getAllBulletValues(body, 'Encounter anchor'),
      ...getInlineOrIndentedList(body, 'Encounter anchors'),
    ];
    const endingTurnout = getFlexibleBulletValue(body, ['Ending turnout', 'SceneEpisode ending', 'Scene episode ending']);
    const consequenceResidue = getFlexibleBulletValue(body, ['Consequence residue', 'Residue']);
    const resolvedEpisodeTension = getFlexibleBulletValue(body, [
      'Resolved episode tension',
      'Immediate question closed',
      'Immediate tension resolved',
    ]);
    const cliffhangerHook = getFlexibleBulletValue(body, [
      'Cliffhanger hook',
      'Cliffhanger',
      'Cliffhanger / closing image',
      'Forward-pressure hook',
    ]);
    const cliffhangerQuestion = getFlexibleBulletValue(body, [
      'Cliffhanger question',
      'Next episode question',
      'Bigger question opened',
      'New open question',
    ]);
    const nextEpisodePressureField = getFlexibleBulletValue(body, [
      'Next episode pressure',
      'Forward pressure',
      'Pressure carried forward',
      'What carries forward',
    ]);
    const nextEpisodeCausality = getFlexibleBulletValue(body, [
      'Why the next sceneEpisode exists because of this one',
      'Why the next scene episode exists because of this one',
      'Why next sceneEp exists',
      'Why next scene episode exists',
      'Next sceneEpisode pressure',
      'Next episode pressure',
    ]);
    const endingPressure = getFlexibleBulletValue(body, ['Ending pressure'])
      || cliffhangerHook
      || cliffhangerQuestion
      || nextEpisodePressureField
      || nextEpisodeCausality
      || endingTurnout
      || consequenceResidue;
    const literalFactAnchors = extractLiteralEpisodeFactAnchors(body);
    const informationMovement = getBulletValue(body, 'Information movement');
    const consequenceSeeds = mergeUniqueList(
      getFlexibleInlineOrIndentedList(body, ['Consequence seeds', 'Consequence seed']),
      literalFactAnchors,
    );

    return {
      episodeNumber,
      guidance: {
        authoredTitle: authoredTitle || undefined,
        actLabel: getBulletValue(body, 'Act') || getBulletValue(body, 'Act/Arc')?.split('/')[0]?.trim(),
        arcLabel: getBulletValue(body, 'Arc') || getBulletValue(body, 'Act/Arc')?.split('/').slice(1).join('/').trim(),
        rawStructuralRole,
        normalizedStructuralRoles: normalizeTreatmentStructuralRoles(rawStructuralRole),
        structuralNote,
        dramaticQuestion: getFlexibleBulletValue(body, ['Episode dramatic question', 'SceneEpisode dramatic question', 'Dramatic question']),
        episodePromise: getBulletValue(body, 'Episode promise'),
        coldOpenFunction: getFlexibleBulletValue(body, ['Cold open function', 'Opening image / hook function', 'Opening image/hook function']),
        openingImage: getFlexibleBulletValue(body, ['Opening image', 'Visual opening']),
        episodeTurns: getFlexibleInlineOrIndentedList(body, ['Episode turns', 'Turns']),
        synopsis: getBulletValue(body, 'Synopsis'),
        openingSituation: getBulletValue(body, 'Opening situation'),
        toneRegister: getBulletValue(body, 'Tone register'),
        encounterAnchors,
        encounterCentralConflict: getBulletValue(body, 'How the encounter manifests the central conflict')
          || getBulletValue(body, 'Encounter central conflict')
          || getBulletValue(body, 'Central conflict'),
        encounterBuildup: getBulletValue(body, 'Encounter buildup'),
        encounterAftermath: getBulletValue(body, 'Aftermath / consequence')
          || getBulletValue(body, 'Encounter aftermath')
          || getBulletValue(body, 'Aftermath'),
        stakesLayers: getFlexibleInlineOrIndentedList(body, ['Stakes layers present in the major scene/encounter', 'Stakes layers present', 'Stakes layers']),
        themePressure: getFlexibleBulletValue(body, ['Theme pressure', 'Theme angle']),
        liePressure: getBulletValue(body, 'Lie pressure'),
        aPressure: getFlexibleBulletValue(body, ['A pressure lane', 'A pressure', 'A lane']),
        bPressure: getFlexibleBulletValue(body, ['B pressure lane', 'B pressure', 'B lane']),
        cSeed: getFlexibleBulletValue(body, ['C seed', 'C pressure lane', 'C pressure', 'C lane']),
        entryGoal: getBulletValue(body, 'Entry goal'),
        obstacle: getBulletValue(body, 'Obstacle'),
        forcedChoice: getBulletValue(body, 'Forced choice'),
        exitShift: getBulletValue(body, 'Exit shift'),
        powerShift: getFlexibleBulletValue(body, ['Power shift', 'Power dynamic shift']),
        subtextGap: getFlexibleBulletValue(body, ['Subtext gap', 'Subtext']),
        informationMovement: mergeScalar(informationMovement, literalFactAnchors.join(' | ')),
        majorChoicePressures: getFlexibleInlineOrIndentedList(body, ['Major choice pressure', 'Major choices', 'Meaningful choice pressure', 'Meaningful choices', 'Choice pressure']),
        alternativePaths: getFlexibleInlineOrIndentedList(body, ['Alternative paths', 'Alternative path or branchlet', 'Branchlet']),
        consequenceSeeds,
        consequenceResidue,
        visualAnchor: getBulletValue(body, 'Visual anchor'),
        endingTurnout,
        endingPressure,
        authoredCliffhanger: endingPressure,
        resolvedEpisodeTension,
        cliffhangerHook,
        cliffhangerQuestion,
        nextEpisodePressure: nextEpisodePressureField || nextEpisodeCausality,
        cliffhangerSetup: getFlexibleBulletValue(body, ['Cliffhanger setup', 'Setup that earns it', 'Setup']),
        cliffhangerType: normalizeCliffhangerType(getFlexibleBulletValue(body, ['Cliffhanger type', 'Cliffhanger mode'])),
        emotionalCharge: getFlexibleBulletValue(body, ['Emotional charge', 'Emotional hook']),
        nextEpisodeCausality,
        endStateChange: getFlexibleBulletValue(body, ['End-state change', 'End state change']),
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

function episodeMentions(text: string): number[] {
  const mentions: number[] = [];
  const patterns = [
    /\b(?:Episodes?|Eps?\.?|E)\s*(\d+)(?:\s*[-–—]\s*(?:Episodes?|Eps?\.?|E)?\s*(\d+))?/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (Number.isFinite(start)) mentions.push(start);
      if (Number.isFinite(end)) mentions.push(end);
    }
  }
  return mentions;
}

function firstEpisodeMention(text: string): number | undefined {
  return episodeMentions(text)[0];
}

function lastEpisodeMention(text: string): number | undefined {
  const mentions = episodeMentions(text);
  return mentions.length > 0 ? mentions[mentions.length - 1] : undefined;
}

function splitBranchStateChanges(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return Array.from(new Set(value
    .replace(/\s+(?:and|plus)\s+ending eligibility\b/gi, '; ending eligibility')
    .split(/\s*(?:;|\n|\s+\|\s+)\s*/g)
    .flatMap((part) => {
      const trimmed = part.trim().replace(/^-\s+/, '').replace(/\.$/, '');
      if (!trimmed) return [];
      if (trimmed.length > 180) return [trimmed];
      return trimmed.split(/\s*,\s+(?=(?:access|resource|relationship|identity|information|reputation|route|ending|item|flag|score)\b|(?:and\s+)?ending eligibility\b)/i);
    })
    .map((part) => part.trim().replace(/^and\s+/i, '').replace(/\.$/, ''))
    .filter(Boolean)));
}

function branchPathVariantsFromText(input: {
  branchId: string;
  createdBy?: string;
  laterEpisodeChange?: string;
  stateChanges?: string[];
}): NonNullable<TreatmentBranchGuidance['pathVariants']> {
  const source = [input.createdBy, input.laterEpisodeChange].filter(Boolean).join(' ');
  const variants: NonNullable<TreatmentBranchGuidance['pathVariants']> = [];
  const add = (label: string, conditionText: string, resultText: string, stateChanges: string[] = []) => {
    const cleanedLabel = label.trim().replace(/^[-–—:,]+|[-–—:,]+$/g, '') || `Path ${variants.length + 1}`;
    const id = `${input.branchId}-${slugify(cleanedLabel)}`;
    if (variants.some((variant) => variant.id === id || variant.conditionText === conditionText)) return;
    variants.push({
      id,
      label: cleanedLabel,
      conditionText: conditionText.trim(),
      resultText: resultText.trim() || conditionText.trim(),
      stateChanges: Array.from(new Set([...(stateChanges ?? []), ...(input.stateChanges ?? [])].filter(Boolean))),
    });
  };

  const canonical = source.match(/\baccept(?:s|ed|ing)?\b[^.;]*(?:canonical)?/i);
  if (canonical) add('accepted', canonical[0], input.laterEpisodeChange || canonical[0], input.stateChanges);
  const refusal = source.match(/\b(?:declin(?:es|ed|ing)|refus(?:es|ed|ing))\b[^.;]*/i);
  if (refusal) add('refused', refusal[0], input.laterEpisodeChange || refusal[0], input.stateChanges);
  const lost = source.match(/\b(?:lost|discard(?:s|ed|ing)|toss(?:es|ed|ing))\b[^.;]*/i);
  if (lost) add('lost', lost[0], input.laterEpisodeChange || lost[0], input.stateChanges);
  const buy = source.match(/\bbuy(?:s|ing)?\b[^.;]*/i);
  if (buy) add('bought_or_discarded', buy[0], input.laterEpisodeChange || buy[0], input.stateChanges);

  const withClauses = [...source.matchAll(/\bWith\s+([^.;]+?)(?=(?:\.\s+With\b|$))/gi)];
  for (const match of withClauses) {
    const clause = match[1]?.trim();
    if (!clause) continue;
    const label = clause.slice(0, 48);
    add(label, `With ${clause}`, `With ${clause}`, splitBranchStateChanges(clause));
  }
  const withoutClauses = [...source.matchAll(/\bWith(?:out)?\s+([^.;]+?)(?:,|\s+the\s+)([^.;]+?)(?=(?:\.\s+With|$))/gi)];
  for (const match of withoutClauses) {
    const clause = match[0]?.trim();
    if (!clause) continue;
    add(clause.slice(0, 48), clause, clause, splitBranchStateChanges(clause));
  }

  if (variants.length === 0 && input.createdBy?.trim()) {
    add('authored', input.createdBy, input.laterEpisodeChange || input.createdBy, input.stateChanges);
  }
  return variants;
}

function parseBranches(section: string): TreatmentBranchGuidance[] {
  return splitByMatches(section, BRANCH_HEADING_RE, (match, body) => {
    const name = (match[1] || '').trim();
    const searchable = `${name}\n${body}`;
    const createdBy = getFlexibleBulletValue(body, ['What creates it', 'Created by', 'Trigger', 'Origin choice']);
    const laterEpisodeChange = getFlexibleBulletValue(body, [
      'How it changes a later episode',
      'How it changes later episode',
      'Later episode change',
      'Later change',
    ]);
    const originEpisode = getFlexibleBulletValue(body, ['Origin episode', 'Created episode', 'Created in episode'])
      ? firstEpisodeMention(getFlexibleBulletValue(body, ['Origin episode', 'Created episode', 'Created in episode'])!)
      : firstEpisodeMention(searchable);
    const explicitReconvergence = getFlexibleBulletValue(body, ['Reconvergence episode', 'Rejoins episode', 'Where it reconverges']);
    const reconvergenceEpisode = explicitReconvergence
      ? lastEpisodeMention(explicitReconvergence)
      : lastEpisodeMention(searchable.match(/(?:reconverges?|rejoins?|bottlenecks?).{0,120}/i)?.[0] || '')
        || lastEpisodeMention(searchable.match(/(?:→|to|through)\s*(?:Episodes?|Eps?\.?|E)\s*\d+(?:\s*[-–—]\s*(?:Episodes?|Eps?\.?|E)?\s*\d+)?/i)?.[0] || '');
    const reconvergenceResidue = getFlexibleBulletValue(body, [
      'What residue remains after reconvergence',
      'Residue after reconvergence',
      'Reconvergence residue',
      'Residue',
    ]);
    const stateChanges = splitBranchStateChanges(getFlexibleBulletValue(body, [
      'What state it changes',
      'Which state it changes',
      'State it changes',
      'State changes',
    ]));
    const branchId = `treatment-branch-${slugify(name)}`;
    const pathVariants = branchPathVariantsFromText({
      branchId,
      createdBy,
      laterEpisodeChange,
      stateChanges,
    });
    return {
      id: branchId,
      name,
      summary: body.replace(/\s+/g, ' ').trim(),
      sourceText: `${match[0]}\n${body}`.trim(),
      originEpisode,
      createdBy,
      laterEpisodeChange,
      reconvergenceEpisode: Number.isFinite(reconvergenceEpisode) ? reconvergenceEpisode : undefined,
      reconvergenceResidue,
      stateChanges,
      pathVariants,
      canonicalPathId: pathVariants.find((variant) => /canonical|accept/i.test(`${variant.label} ${variant.conditionText}`))?.id,
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
      targetConditions: splitSentences(getFlexibleBulletValue(body, ['Target conditions', 'Target conditions in plain language'])),
      repeatedChoicePattern: getFlexibleBulletValue(body, [
        'What repeated choice pattern this ending pays off',
        'Repeated choice pattern this ending pays off',
        'Repeated choice pattern',
      ]),
      finalVoiceoverLine: getFlexibleBulletValue(body, ['Final voiceover line', 'Final line', 'Voiceover line']),
      sourceText: `${match[0]}\n${body}`.trim(),
      sourceConfidence: 'explicit',
    };
  });
}

const FAILURE_MODE_LABELS: Array<{
  code: NonNullable<TreatmentSeasonGuidance['failureModeAuditGuidance']>['rows'][number]['code'];
  patterns: RegExp[];
}> = [
  { code: 'escalation_trap', patterns: [/escalation trap/i] },
  { code: 'mystery_box_collapse', patterns: [/mystery box/i] },
  { code: 'character_drift', patterns: [/character drift/i] },
  { code: 'shaggy_dog', patterns: [/shaggy dog/i] },
  { code: 'passive_protagonist', patterns: [/passive protagonist/i] },
  { code: 'reset_disease', patterns: [/reset disease/i] },
  { code: 'theme_drift', patterns: [/theme drift/i] },
  { code: 'unmotivated_escalation', patterns: [/unmotivated escalation/i] },
  { code: 'snowglobe_arc', patterns: [/snowglobe arcs?/i] },
  { code: 'inverted_thematic_rhyme', patterns: [/inverted thematic rhyme/i] },
  { code: 'convenient_coincidence', patterns: [/convenient coincidence/i] },
  { code: 'telegraphed_twist', patterns: [/telegraphed twist/i] },
  { code: 'cheating_twist', patterns: [/cheating twist/i] },
];

function failureModeCodeForLabel(label: string): NonNullable<TreatmentSeasonGuidance['failureModeAuditGuidance']>['rows'][number]['code'] {
  return FAILURE_MODE_LABELS.find((entry) => entry.patterns.some((pattern) => pattern.test(label)))?.code
    ?? 'unmotivated_escalation';
}

function parseFailureModeStatus(value: string): NonNullable<TreatmentSeasonGuidance['failureModeAuditGuidance']>['rows'][number]['status'] {
  if (/^\s*watch\s+item\b/i.test(value)) return 'watch_item';
  if (/^\s*avoided\b/i.test(value)) return 'avoided';
  return 'unknown';
}

function parseFailureModeMitigation(value: string): string | undefined {
  const watch = value.match(/\bmitigated\s+by\s+([\s\S]+)$/i);
  if (watch?.[1]?.trim()) return watch[1].trim();
  const because = value.match(/\b(?:because|driven by|flows from|fixed by|earned by)\s+([\s\S]+)$/i);
  if (because?.[1]?.trim()) return because[1].trim();
  const dash = value.match(/(?:avoided|watch item)\s*[—–-]\s*([\s\S]+)$/i);
  return dash?.[1]?.trim();
}

function parseFailureModeAuditGuidance(section: string | undefined): TreatmentSeasonGuidance['failureModeAuditGuidance'] | undefined {
  if (!section?.trim()) return undefined;
  const rows: NonNullable<TreatmentSeasonGuidance['failureModeAuditGuidance']>['rows'] = [];
  const bulletRe = /^\s*-\s+(?:\*\*([^:\n]+):\*\*|([^:\n]{1,120}):)\s*([\s\S]*?)(?=\n\s*-\s+(?:\*\*[^:\n]+:\*\*|[^:\n]{1,120}:)|$)/gm;
  for (const match of section.matchAll(bulletRe)) {
    const label = (match[1] || match[2] || '').replace(/\*\*/g, '').trim();
    const body = (match[3] || '').trim();
    if (!label || !body) continue;
    rows.push({
      label,
      code: failureModeCodeForLabel(label),
      status: parseFailureModeStatus(body),
      sourceText: `${label}: ${body}`.replace(/\s+/g, ' ').trim(),
      episodeMentions: Array.from(new Set(episodeMentions(body))),
      mitigationText: parseFailureModeMitigation(body),
    });
  }
  return rows.length > 0 ? { rawSection: section, rows } : undefined;
}

function inferEpisodeStructureMode(markdown: string): TreatmentSeasonGuidance['episodeStructureMode'] {
  return /\bscene\s*episodes?\b|\bsceneepisodes?\b/i.test(markdown) ? 'sceneEpisodes' : 'standard';
}

function parseTopLevelSeasonPromiseFields(markdown: string): Partial<TreatmentSeasonGuidance> {
  return {
    genre: getFlexibleBulletValue(markdown, ['Genre']),
    tone: getFlexibleBulletValue(markdown, ['Tone']),
    logline: getFlexibleBulletValue(markdown, ['Logline']),
    coreFantasy: getFlexibleBulletValue(markdown, ['Core fantasy', 'Core Fantasy']),
    audiencePromise: getFlexibleBulletValue(markdown, ['Audience promise', 'Audience Promise']),
    premisePromise: getFlexibleBulletValue(markdown, ['Premise promise', 'Premise Promise']),
    themeQuestion: getFlexibleBulletValue(markdown, ['Theme question', 'Theme Question']),
    inactionPressure: getFlexibleBulletValue(markdown, [
      'What pressure makes inaction impossible',
      'Pressure makes inaction impossible',
      'Inaction pressure',
    ]),
  };
}

function parseSeasonPromiseEngineFields(section: string): Partial<TreatmentSeasonGuidance> {
  if (!section.trim()) return {};
  return {
    seasonDramaticQuestion: getFlexibleBulletValue(section, [
      "Season dramatic question framed around the protagonist's Lie",
      'Season dramatic question',
    ]),
    centralPressure: getFlexibleBulletValue(section, ['Central pressure']),
    playerPromise: getFlexibleBulletValue(section, ['Player promise']),
    emotionalPromise: getFlexibleBulletValue(section, ['Emotional promise']),
    freshVariationPlan: getFlexibleBulletValue(section, ['Fresh variation plan']),
    typicalEpisodeDeliverables: getFlexibleBulletValue(section, [
      'What a typical episode delivers after the pilot',
      'Typical episode delivers after the pilot',
      'Typical episode delivers',
    ]),
    seasonMustResolve: getFlexibleBulletValue(section, ['What the season must resolve', 'Season must resolve']),
    futureOpenThreads: getFlexibleBulletValue(section, [
      'What can remain open for future seasons',
      'Can remain open for future seasons',
      'Future seasons',
    ]),
  };
}

function parseProtagonistGuidance(markdown: string): ProtagonistTreatmentGuidance | undefined {
  const protagonistSection = getFlexibleHeadingSection(markdown, ['protagonist']);
  if (!protagonistSection.trim()) return undefined;
  const guidance: ProtagonistTreatmentGuidance = {
    rawSection: protagonistSection,
    nameAndPronouns: getFlexibleBulletValue(protagonistSection, ['Name and pronouns', 'Name/pronouns', 'Name']),
    roleInWorld: getFlexibleBulletValue(protagonistSection, ['Role in the world', 'Role']),
    want: getFlexibleBulletValue(protagonistSection, ['Want']),
    need: getFlexibleBulletValue(protagonistSection, ['Need']),
    lie: getFlexibleBulletValue(protagonistSection, ['Lie']),
    wound: getFlexibleBulletValue(protagonistSection, ['Wound', 'Origin pressure']),
    truth: getFlexibleBulletValue(protagonistSection, ['Truth']),
    arcMode: getFlexibleBulletValue(protagonistSection, ['Arc mode', 'Arc']),
    startingIdentity: getFlexibleBulletValue(protagonistSection, ['Starting identity', 'Starting state']),
    possibleEndStates: getFlexibleInlineOrIndentedList(protagonistSection, ['Possible end states']),
    climaxChoice: getFlexibleBulletValue(protagonistSection, ['Climax choice', 'Final choice']),
    pressurePoints: getFlexibleInlineOrIndentedList(protagonistSection, ['Pressure points']),
    visualIdentity: getFlexibleBulletValue(protagonistSection, ['Visual identity', 'Visual profile']),
  };
  const hasField = Object.entries(guidance).some(([key, value]) =>
    key !== 'rawSection' && (Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0)
  );
  return hasField ? guidance : undefined;
}

function splitListish(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(/\s*(?:\n|;|\s+\|\s+)\s*/g)
    .map((part) => part.trim().replace(/^-\s+/, ''))
    .filter((part) => part.length > 0);
}

function sectionListWithIntro(section: string, labels: string[]): string[] {
  const out: string[] = [];
  const intro = getFlexibleBulletValue(section, labels);
  out.push(...splitListish(intro));
  out.push(...getFlexibleInlineOrIndentedList(section, labels));
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const labelRe = new RegExp(`^-\\s+(?:\\*\\*${escaped}[^:]*:\\*\\*|${escaped}[^:]*:).*?$`, 'im');
    const match = labelRe.exec(section);
    if (!match) continue;
    const rest = section.slice(match.index + match[0].length);
    const nextTopLevel = rest.search(new RegExp(`${TOP_LEVEL_BULLET_FIELD_RE.source}|\\n#{3,5}\\s+`));
    const block = nextTopLevel >= 0 ? rest.slice(0, nextTopLevel) : rest;
    out.push(...block
      .split('\n')
      .map((line) => line.match(/^\s{2,}-\s+(.+)$/)?.[1]?.trim())
      .filter(Boolean) as string[]);
  }
  return Array.from(new Set(out.map((item) => item.trim()).filter(Boolean)));
}

function fieldFromLocationLine(line: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = line.match(new RegExp(`${escaped}\\s*:\\s*([\\s\\S]*?)(?=\\s+(?:Purpose|Mood|History|Choice pressure)\\s*:|$)`, 'i'));
  return match?.[1]?.trim().replace(/\s+$/, '') || undefined;
}

function parseWorldLocationLine(line: string): WorldLocationTreatmentLocationGuidance | undefined {
  const cleaned = line.trim().replace(/^-\s+/, '');
  if (!cleaned) return undefined;
  const split = cleaned.split(/\s+[—–-]\s+/);
  const rawName = (split[0] || '').replace(/\*\*/g, '').trim();
  if (!rawName || rawName.length > 120) return undefined;
  return {
    name: rawName,
    sourceText: cleaned,
    purpose: fieldFromLocationLine(cleaned, 'Purpose'),
    mood: fieldFromLocationLine(cleaned, 'Mood'),
    history: fieldFromLocationLine(cleaned, 'History'),
    choicePressure: fieldFromLocationLine(cleaned, 'Choice pressure'),
  };
}

function parseWorldLocationGuidance(markdown: string): WorldLocationTreatmentGuidance | undefined {
  const section = getFlexibleSection(markdown, [
    'world and location brief',
    'world + location brief',
    'world + location',
    'location brief',
  ]);
  if (!section.trim()) return undefined;

  const keyLocationLines = getFlexibleInlineOrIndentedList(section, ['3-6 key locations', 'Key locations', 'Locations']);
  const keyLocations = keyLocationLines
    .map(parseWorldLocationLine)
    .filter(Boolean) as WorldLocationTreatmentLocationGuidance[];

  const guidance: WorldLocationTreatmentGuidance = {
    rawSection: section,
    worldPremise: getFlexibleBulletValue(section, ['World premise', 'World']),
    timePeriod: getFlexibleBulletValue(section, ['Time period', 'Period']),
    supernaturalRules: sectionListWithIntro(section, [
      'Technology/magic/supernatural rules, if any',
      'Technology/magic/supernatural rules',
      'Magic/supernatural rules',
      'World rules',
    ]),
    powerStructures: splitListish(getFlexibleBulletValue(section, ['Power structures', 'Factions'])),
    dramaticRules: sectionListWithIntro(section, ['Rules that create drama', 'Drama rules']),
    costsAndTaboos: splitListish(getFlexibleBulletValue(section, [
      'What is forbidden, scarce, dangerous, sacred, expensive, humiliating, or socially costly',
      'Forbidden, scarce, dangerous, sacred, expensive, humiliating, or socially costly',
      'Forbidden or scarce',
      'Taboos and costs',
    ])),
    keyLocations,
  };
  const hasField = Boolean(
    guidance.worldPremise?.trim()
    || guidance.timePeriod?.trim()
    || guidance.supernaturalRules?.length
    || guidance.powerStructures?.length
    || guidance.dramaticRules?.length
    || guidance.costsAndTaboos?.length
    || guidance.keyLocations?.length
  );
  return hasField ? guidance : undefined;
}

function splitStakeList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const arrowExpanded = value.replace(/\s*(?:→|->)\s*/g, '\n');
  return Array.from(new Set(arrowExpanded
    .split(/\s*(?:\n|;|\s+\|\s+)\s*/g)
    .flatMap((part) => {
      const trimmed = part.trim().replace(/^-\s+/, '');
      if (!trimmed) return [];
      // Keep long explanatory clauses intact; split compact list fields.
      if (trimmed.length > 180) return [trimmed];
      return trimmed.split(/\s*,\s+(?=(?:the\s+)?[A-Z0-9"']|[a-z]+(?:'s)?\s+(?:freedom|trust|humanity|voice|life|legacy|friendship|blog|apartment|letter|line|readership|column|sanctuary|choice|promise|name))/);
    })
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter((part) => part.length > 0)));
}

function parseStakesArchitectureGuidance(markdown: string): TreatmentSeasonGuidance['stakesArchitectureGuidance'] | undefined {
  const section = getFlexibleSection(markdown, ['stakes architecture']);
  if (!section.trim()) return undefined;
  const guidance: NonNullable<TreatmentSeasonGuidance['stakesArchitectureGuidance']> = {
    rawSection: section,
    primaryMaterialStakes: splitStakeList(getFlexibleBulletValue(section, ['Primary material stakes', 'Material stakes'])),
    primaryRelationalStakes: splitStakeList(getFlexibleBulletValue(section, ['Primary relational stakes', 'Relational stakes'])),
    primaryIdentityStakes: splitStakeList(getFlexibleBulletValue(section, ['Primary identity stakes', 'Identity stakes'])),
    primaryExistentialStakes: splitStakeList(getFlexibleBulletValue(section, ['Primary existential stakes', 'Existential stakes'])),
    escalationLadder: splitStakeList(getFlexibleBulletValue(section, ['How stakes escalate gradually', 'Stakes escalate gradually', 'Stakes escalation'])),
    personalBeforeLarger: getFlexibleBulletValue(section, [
      'How personal stakes are established before larger stakes',
      'Personal stakes are established before larger stakes',
      'Personal before larger stakes',
    ]),
    emotionalLegibilityAnchors: splitStakeList(getFlexibleBulletValue(section, [
      'Which relationships/places/promises make the stakes emotionally legible',
      'Relationships/places/promises make the stakes emotionally legible',
      'Emotionally legible stakes',
      'Emotional stakes anchors',
    ])),
  };
  const hasField = Boolean(
    guidance.primaryMaterialStakes?.length
    || guidance.primaryRelationalStakes?.length
    || guidance.primaryIdentityStakes?.length
    || guidance.primaryExistentialStakes?.length
    || guidance.escalationLadder?.length
    || guidance.personalBeforeLarger?.trim()
    || guidance.emotionalLegibilityAnchors?.length
  );
  return hasField ? guidance : undefined;
}

function parseArcEpisodeRange(value: string | undefined): { start: number; end: number } | undefined {
  if (!value?.trim()) return undefined;
  const match = value.match(/\b(?:Episodes?|Eps?|Ep\.?)?\s*(\d+)\s*[-–—]\s*(\d+)\b/i)
    || value.match(/\b(\d+)\s*[-–—]\s*(\d+)\b/);
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) return undefined;
  return { start, end };
}

function inferArcTurnoutType(value: string | undefined): string | undefined {
  const text = value ?? '';
  if (/\brevelation|reveals?|revealed|discovery|discovers?\b/i.test(text)) return 'revelation';
  if (/\bescalat|second suitor|more dangerous|tighten|raises?\b/i.test(text)) return 'escalation';
  if (/\bwrong-note|wrong note|cost|crack|lost|loss|warning|missing\b/i.test(text)) return 'cost';
  if (/\bchoice|chooses?|decision\b/i.test(text)) return 'choice';
  if (/\bcrisis|all-is-lost|collapse|failure|betray\b/i.test(text)) return 'crisis';
  if (/\brecontextual|reframe|actually|underneath|really\b/i.test(text)) return 'recontextualization';
  if (/\bfinale|answer|returns?|ends?\b/i.test(text)) return 'finale';
  if (/\bhandoff|carry forward|next arc|next\b/i.test(text)) return 'handoff';
  return undefined;
}

function parseArcTurnouts(block: string): Array<{ episodeNumber: number; sourceText: string; description: string; turnType?: string }> {
  const lines = getFlexibleInlineOrIndentedList(block, ['Episode turnouts', 'Episode turnout']);
  const out: Array<{ episodeNumber: number; sourceText: string; description: string; turnType?: string }> = [];
  for (const line of lines) {
    const match = line.match(/^(?:E|Ep(?:isode)?\.?\s*)\s*(\d+)\s+(?:ends?\s+on\s+)?(.+)$/i)
      || line.match(/\b(?:E|Ep(?:isode)?\.?\s*)\s*(\d+)\b[:\s-]+(.+)$/i);
    if (!match) continue;
    const episodeNumber = Number(match[1]);
    if (!Number.isFinite(episodeNumber)) continue;
    const description = (match[2] || line).trim();
    out.push({
      episodeNumber,
      sourceText: line.trim(),
      description,
      turnType: inferArcTurnoutType(description),
    });
  }
  return out;
}

function splitArcBlocks(section: string): Array<{ index: number; heading: string; block: string }> {
  const headingRe = /^#{3,5}\s+Arc\s+(\d+)\s*:?\s*(.+?)\s*$/gim;
  const matches = [...section.matchAll(headingRe)];
  return matches.map((match, idx) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = idx + 1 < matches.length ? matches[idx + 1].index ?? section.length : section.length;
    return {
      index: Number(match[1]) || idx + 1,
      heading: (match[2] || '').trim(),
      block: section.slice(start, end).trim(),
    };
  });
}

function parseArcPlanGuidance(markdown: string): TreatmentSeasonGuidance['arcGuidance'] | undefined {
  const section = getFlexibleSection(markdown, ['arc plan', 'arc-level rules']) || markdown;
  const blocks = splitArcBlocks(section);
  if (blocks.length === 0) return undefined;
  const arcs = blocks.map(({ index, heading, block }) => {
    const headingRange = parseArcEpisodeRange(heading);
    const range = parseArcEpisodeRange(getFlexibleBulletValue(block, ['Episode range', 'Episodes'])) ?? headingRange;
    const cleanHeadingTitle = heading
      .replace(/\([^)]*Episodes?\s+\d+\s*[-–—]\s*\d+[^)]*\)/i, '')
      .replace(/^[-:–—\s]+|[-:–—\s]+$/g, '')
      .trim();
    const title = getFlexibleBulletValue(block, ['Arc title', 'Title']) || cleanHeadingTitle || `Arc ${index}`;
    return {
      arcIndex: index,
      title,
      sourceText: [`Arc ${index}: ${heading}`, block].filter(Boolean).join('\n').trim(),
      episodeRange: range,
      arcDramaticQuestion: getFlexibleBulletValue(block, ['Arc dramatic question', 'Dramatic question']),
      relationToSeasonQuestion: getFlexibleBulletValue(block, ['Relation to season question', 'Relation to season dramatic question']),
      lieFacet: getFlexibleBulletValue(block, [
        'Facet of protagonist Lie under pressure',
        "Facet of protagonist's Lie under pressure",
        'Lie facet',
      ]),
      midpointRecontextualization: getFlexibleBulletValue(block, ['Midpoint recontextualization']),
      lateArcCrisis: getFlexibleBulletValue(block, [
        'Late-arc crisis / all-is-lost beat',
        'Late arc crisis / all-is-lost beat',
        'Late-arc crisis',
        'All-is-lost beat',
      ]),
      finaleAnswer: getFlexibleBulletValue(block, ['Arc finale answer', 'Finale answer']),
      handoffPressure: getFlexibleBulletValue(block, ['Handoff pressure to next arc or finale', 'Handoff pressure']),
      episodeTurnouts: parseArcTurnouts(block),
    };
  }).filter((arc) => Boolean(
    arc.episodeRange
    || arc.arcDramaticQuestion
    || arc.relationToSeasonQuestion
    || arc.lieFacet
    || arc.midpointRecontextualization
    || arc.lateArcCrisis
    || arc.finaleAnswer
    || arc.handoffPressure
    || (arc.episodeTurnouts?.length ?? 0) > 0
  ));

  return arcs.length > 0 ? { rawSection: section, arcs } : undefined;
}

function cleanScenePlanningTitle(raw: string): string {
  return raw
    .replace(/\*\*/g, '')
    .replace(/\([^)]*\bEpisode\s+\d+[^)]*\)/i, '')
    .replace(/\([^)]*\bEp\.?\s*\d+[^)]*\)/i, '')
    .replace(/^[-:–—\s]+|[-:–—\s]+$/g, '')
    .trim();
}

function splitScenePlanningStakesLayers(values: string[]): string[] {
  return Array.from(new Set(values
    .flatMap((value) => value.split(/\s*,\s*/g))
    .map((value) => value.trim())
    .filter(Boolean)));
}

function parseScenePlanningGuidance(markdown: string): TreatmentSeasonGuidance['scenePlanningGuidance'] | undefined {
  const section = getFlexibleSection(markdown, ['scene planning notes']);
  if (!section.trim()) return undefined;

  const sceneStartRe = /^\s*-\s+(?:\*\*)?Scene\s*:\s*(.+?)\s*$/gim;
  const matches = [...section.matchAll(sceneStartRe)];
  if (matches.length === 0) return undefined;

  const scenes = matches.map((match, index) => {
    const header = (match[1] || '').trim();
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? section.length : section.length;
    const rawBody = section.slice(start, end).trim();
    const body = rawBody
      .split(/\r?\n/)
      .map((line) => line.trim())
      .join('\n');
    return {
      sceneTitle: cleanScenePlanningTitle(header) || `Scene ${index + 1}`,
      episodeNumber: firstEpisodeMention(header) ?? firstEpisodeMention(body),
      sourceText: [match[0].trim(), rawBody].filter(Boolean).join('\n'),
      entryGoal: getFlexibleBulletValue(body, ['Entry goal']),
      obstacle: getFlexibleBulletValue(body, ['Obstacle']),
      forcedChoice: getFlexibleBulletValue(body, ['Forced choice']),
      exitShift: getFlexibleBulletValue(body, ['Exit shift']),
      powerShift: getFlexibleBulletValue(body, ['Power shift', 'Power dynamic shift']),
      subtextGap: getFlexibleBulletValue(body, ['Subtext gap', 'Subtext']),
      stakesLayers: splitScenePlanningStakesLayers(getFlexibleInlineOrIndentedList(body, ['Stakes layers present in the major scene/encounter', 'Stakes layers present', 'Stakes layers'])),
      connectsBy: getFlexibleBulletValue(body, ['Connects by', 'Connects through', 'Connection', 'Branch connection']),
    };
  }).filter((scene) => Boolean(
    scene.sceneTitle
    && (scene.entryGoal
      || scene.obstacle
      || scene.forcedChoice
      || scene.exitShift
      || scene.powerShift
      || scene.subtextGap
      || scene.stakesLayers.length > 0
      || scene.connectsBy)
  ));

  return scenes.length > 0 ? { rawSection: section, scenes } : undefined;
}

function parseSeasonGuidance(markdown: string): TreatmentSeasonGuidance | undefined {
  if (!looksLikeTreatmentMarkdown(markdown)) return undefined;
  const topLevelPromiseFields = parseTopLevelSeasonPromiseFields(markdown);
  const seasonPromiseAndDramaticEngine = getFlexibleSection(markdown, ['season promise and dramatic engine', 'season promise']);
  const engineFields = parseSeasonPromiseEngineFields(seasonPromiseAndDramaticEngine);
  const protagonistGuidance = parseProtagonistGuidance(markdown);
  const worldLocationGuidance = parseWorldLocationGuidance(markdown);
  const stakesArchitecture = getFlexibleSection(markdown, ['stakes architecture']);
  const stakesArchitectureGuidance = parseStakesArchitectureGuidance(markdown);
  const informationLedger = getFlexibleSection(markdown, ['information ledger']);
  const informationLedgerGuidance = parseInformationLedgerGuidance(informationLedger);
  const arcPlan = getFlexibleSection(markdown, ['arc plan', 'arc-level rules']);
  const arcGuidance = parseArcPlanGuidance(markdown);
  const scenePlanningNotes = getFlexibleSection(markdown, ['scene planning notes']);
  const scenePlanningGuidance = parseScenePlanningGuidance(markdown);
  const failureModeAudit = getFlexibleSection(markdown, ['failure mode audit']);
  const failureModeAuditGuidance = parseFailureModeAuditGuidance(failureModeAudit);
  const sections: TreatmentSeasonGuidance = {
    episodeStructureMode: inferEpisodeStructureMode(markdown),
    seasonPromiseAndDramaticEngine,
    ...topLevelPromiseFields,
    ...engineFields,
    protagonistGuidance,
    worldLocationGuidance,
    characterArchitecture: getFlexibleSection(markdown, ['character architecture', 'protagonist brief']),
    stakesArchitecture,
    stakesArchitectureGuidance,
    informationLedger,
    informationLedgerGuidance,
    seasonSpine: getFlexibleSection(markdown, ['3-act / 7-point season spine', '7-point season spine']),
    arcPlan,
    arcGuidance,
    scenePlanningNotes,
    scenePlanningGuidance,
    branchAndConsequenceChains: getFlexibleSection(markdown, ['cross-sceneepisode branches', 'cross-sceneepisode branches and consequence chains', 'cross-episode branches', 'cross-episode branches and consequence chains']),
    failForward: getFlexibleSection(markdown, ['capability, growth, and fail-forward']),
    endings: getFlexibleSection(markdown, ['alternate endings']),
    failureModeAudit,
    failureModeAuditGuidance,
  };
  // Step 1.1: decompose the Section-7 free-text spine (e.g. `Plot turn 1 (Ep3)`)
  // into a structured beat→episode anchor map. Reuses the Phase-0 parser so the
  // map and the version fingerprint stay in lockstep.
  const beatEpisodeAnchors = extractBeatEpisodeAnchors(sections.seasonSpine);
  if (Object.keys(beatEpisodeAnchors).length > 0) {
    sections.beatEpisodeAnchors = beatEpisodeAnchors;
  }
  sections.rawSectionSummary = Object.entries(sections)
    .filter(([key, value]) => key !== 'episodeStructureMode' && key !== 'rawSectionSummary' && typeof value === 'string' && value.trim().length > 0)
    .map(([key]) => key);
  if (protagonistGuidance) sections.rawSectionSummary.push('protagonistGuidance');
  if (worldLocationGuidance) sections.rawSectionSummary.push('worldLocationGuidance');
  if (stakesArchitectureGuidance) sections.rawSectionSummary.push('stakesArchitectureGuidance');
  if (informationLedgerGuidance) sections.rawSectionSummary.push('informationLedgerGuidance');
  if (arcGuidance) sections.rawSectionSummary.push('arcGuidance');
  if (scenePlanningGuidance) sections.rawSectionSummary.push('scenePlanningGuidance');
  if (failureModeAuditGuidance) sections.rawSectionSummary.push('failureModeAuditGuidance');
  return sections.rawSectionSummary.length > 0 || Object.keys(beatEpisodeAnchors).length > 0 ? sections : undefined;
}

function appendUnique(values: string[] | undefined, value: string | undefined): string[] | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return values;
  const existing = values ?? [];
  if (existing.some((candidate) => candidate.trim().toLowerCase() === cleaned.toLowerCase())) return existing;
  return [...existing, cleaned];
}

function mergeScalar(existing: string | undefined, value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return existing;
  if (!existing?.trim()) return cleaned;
  if (existing.toLowerCase().includes(cleaned.toLowerCase())) return existing;
  return `${existing} Scene note: ${cleaned}`;
}

function shouldTreatConnectsByAsInformation(value: string | undefined): boolean {
  return /\b(lie|truth|confess|confession|reveal|reveals|learn|learns|know|knows|warning|warned|secret|tell|tells|information|clue|suspect|suspects|read|catchable)\b/i
    .test(value ?? '');
}

function mergeScenePlanningGuidanceIntoEpisodes(
  episodes: Record<number, TreatmentEpisodeGuidance>,
  seasonGuidance: TreatmentSeasonGuidance | undefined,
): Record<number, TreatmentEpisodeGuidance> {
  const sceneNotes = seasonGuidance?.scenePlanningGuidance?.scenes ?? [];
  if (sceneNotes.length === 0) return episodes;

  const merged: Record<number, TreatmentEpisodeGuidance> = { ...episodes };
  for (const note of sceneNotes) {
    if (!note.episodeNumber || !Number.isFinite(note.episodeNumber)) continue;
    const existing = merged[note.episodeNumber] ?? {};
    const next: TreatmentEpisodeGuidance = { ...existing };
    next.scenePlanningTargets = appendUnique(next.scenePlanningTargets, note.sceneTitle);
    next.entryGoal = mergeScalar(next.entryGoal, note.entryGoal);
    next.obstacle = mergeScalar(next.obstacle, note.obstacle);
    next.forcedChoice = mergeScalar(next.forcedChoice, note.forcedChoice);
    next.exitShift = mergeScalar(next.exitShift, note.exitShift);
    next.powerShift = mergeScalar(next.powerShift, note.powerShift);
    next.subtextGap = mergeScalar(next.subtextGap, note.subtextGap);
    next.connectsBy = mergeScalar(next.connectsBy, note.connectsBy);

    for (const layer of note.stakesLayers ?? []) {
      next.stakesLayers = appendUnique(next.stakesLayers, layer);
    }

    // Reuse existing enforcement surfaces. A scene note's forced choice should
    // become real major choice pressure; its connection/residue should become
    // branch/consequence/information pressure rather than prompt-only prose.
    next.majorChoicePressures = appendUnique(next.majorChoicePressures, note.forcedChoice);
    next.alternativePaths = appendUnique(next.alternativePaths, note.connectsBy);
    next.consequenceSeeds = appendUnique(next.consequenceSeeds, note.connectsBy);
    next.consequenceResidue = mergeScalar(next.consequenceResidue, note.connectsBy);
    if (shouldTreatConnectsByAsInformation(note.connectsBy)) {
      next.informationMovement = mergeScalar(next.informationMovement, note.connectsBy);
    }
    next.bPressure = mergeScalar(next.bPressure, note.powerShift);
    next.liePressure = mergeScalar(next.liePressure, note.subtextGap);
    next.themePressure = mergeScalar(next.themePressure, note.subtextGap);

    merged[note.episodeNumber] = next;
  }
  return merged;
}

function getEpisodeHeadingNumbers(section: string): number[] {
  const normalizedSection = normalizeEpisodeNumberTitleLines(section);
  return [...normalizedSection.matchAll(EPISODE_HEADING_RE)]
    .map((match) => Number(match[1] || match[3]))
    .filter(Number.isFinite);
}

/**
 * Thrown by {@link validateExtractedTreatment} when `strict` is enabled and a
 * structural episode-integrity warning (non-contiguous numbering;
 * heading-count > parsed-count) is detected. Default behavior (strict off) is
 * unchanged — these surface as warnings only.
 */
export class TreatmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TreatmentValidationError';
  }
}

export function validateExtractedTreatment(
  markdown: string,
  treatment: Pick<ExtractedTreatment, 'episodes' | 'branches' | 'endings' | 'seasonGuidance'>,
  sections?: { episodeSection?: string; branchSection?: string; endingSection?: string },
  strict = false,
): string[] {
  const warnings: string[] = [];
  const episodeNumbers = Object.keys(treatment.episodes || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (episodeNumbers.length > 0) {
    const missing: number[] = [];
    for (let episodeNumber = 1; episodeNumber <= episodeNumbers[episodeNumbers.length - 1]; episodeNumber++) {
      if (!episodeNumbers.includes(episodeNumber)) missing.push(episodeNumber);
    }
    if (missing.length > 0) {
      const message = `Treatment episode numbering is not contiguous; missing episode(s): ${missing.join(', ')}.`;
      if (strict) throw new TreatmentValidationError(message);
      warnings.push(message);
    }
  }

  const episodeSection = sections?.episodeSection || getFlexibleSection(markdown, ['sceneepisode outline', 'scene episode outline', 'episode outline']);
  const headedEpisodeNumbers = episodeSection ? getEpisodeHeadingNumbers(episodeSection) : [];
  const uniqueHeadedEpisodeCount = new Set(headedEpisodeNumbers).size;
  if (uniqueHeadedEpisodeCount > episodeNumbers.length) {
    const message = `Treatment appears to contain ${uniqueHeadedEpisodeCount} episode heading(s), but only ${episodeNumbers.length} parsed.`;
    if (strict) throw new TreatmentValidationError(message);
    warnings.push(message);
  }

  const branchSection = sections?.branchSection || getFlexibleSection(markdown, ['cross-sceneepisode branches', 'cross-sceneepisode branches and consequence chains', 'cross-episode branches', 'cross-episode branches and consequence chains', 'consequence chains', 'branch']);
  if (branchSection && /(?:^|\n)\s*(?:#{3,5}\s+|\*\*)Branch\s+[A-Z0-9]/i.test(branchSection) && treatment.branches.length === 0) {
    warnings.push('Treatment branch section contains branch headings, but no branches parsed.');
  }

  const endingSection = sections?.endingSection || getFlexibleSection(markdown, ['alternate endings', 'episode endings', 'endings']);
  if (endingSection && /\b(?:exactly\s*)?3\b|alternate endings/i.test(`${endingSection}\n${markdown}`) && treatment.endings.length !== 3) {
    warnings.push(`Treatment should preserve exactly 3 alternate endings; parsed ${treatment.endings.length}.`);
  }

  for (const episodeNumber of episodeNumbers) {
    const guidance = treatment.episodes[episodeNumber];
    if (
      !guidance.dramaticQuestion
      && !guidance.episodePromise
      && !guidance.synopsis
      && !guidance.entryGoal
    ) {
      warnings.push(`Episode ${episodeNumber} parsed without a dramatic question, promise, synopsis, or entry goal.`);
    }
    const isFinale = episodeNumber === episodeNumbers[episodeNumbers.length - 1]
      || guidance.normalizedStructuralRoles?.includes('resolution');
    if (
      !isFinale
      && !guidance.cliffhangerQuestion
      && !guidance.nextEpisodePressure
      && !guidance.nextEpisodeCausality
      && !guidance.endingPressure
      && !guidance.authoredCliffhanger
    ) {
      warnings.push(`Episode ${episodeNumber} is missing a cliffhanger question or next-episode pressure.`);
    }
  }

  return warnings;
}

/** Options for {@link extractTreatmentFromMarkdown}. */
export interface ExtractTreatmentOptions {
  /**
   * When true, structural episode-integrity warnings (non-contiguous numbering;
   * heading-count > parsed-count) throw a {@link TreatmentValidationError}
   * instead of being recorded as warnings. Default OFF (opt-in per run),
   * consistent with the validator-gating pattern.
   */
  strictValidation?: boolean;
}

export function extractTreatmentFromMarkdown(
  markdown: string,
  options?: ExtractTreatmentOptions,
): ExtractedTreatment {
  if (isPromptGuideMarkdown(markdown)) {
    return {
      isTreatment: false,
      episodes: {},
      branches: [],
      endings: [],
      seasonGuidance: undefined,
      metadata: {
        ...EMPTY_METADATA,
        detected: false,
        warnings: ['Input appears to be a treatment prompt guide/template, not a filled story treatment.'],
      },
    };
  }
  const explicitEpisodeSection = getFlexibleSection(markdown, ['sceneepisode outline', 'scene episode outline', 'episode outline']);
  const episodeSection = explicitEpisodeSection || (resettableTest(HEADED_EPISODE_RE, markdown) ? markdown : '');
  const branchSection = getFlexibleSection(markdown, ['cross-sceneepisode branches', 'cross-sceneepisode branches and consequence chains', 'cross-episode branches', 'cross-episode branches and consequence chains', 'consequence chains', 'branch']);
  const endingSection = getFlexibleSection(markdown, ['alternate endings', 'episode endings', 'endings']);
  const looksLikeTreatment = looksLikeTreatmentMarkdown(markdown);
  let episodes = episodeSection ? parseEpisodeGuidance(episodeSection) : {};
  const endings = endingSection ? parseEndings(endingSection) : [];
  const branches = parseBranches(branchSection);
  const seasonGuidance = parseSeasonGuidance(markdown);
  episodes = mergeScenePlanningGuidanceIntoEpisodes(episodes, seasonGuidance);
  const warnings: string[] = [];
  if (looksLikeTreatment && Object.keys(episodes).length === 0) warnings.push('No episode guidance could be parsed from the treatment.');
  if (looksLikeTreatment && endings.length === 0) warnings.push('No ending targets could be parsed from the treatment.');
  warnings.push(...validateExtractedTreatment(markdown, { episodes, branches, endings, seasonGuidance }, { episodeSection, branchSection, endingSection }, options?.strictValidation ?? false));
  const promptGuideWithoutEpisodes = isPromptGuideMarkdown(markdown) && Object.keys(episodes).length === 0;
  const markerCount = TREATMENT_MARKERS.reduce((count, marker) => count + (marker.test(markdown) ? 1 : 0), 0);
  const formatVersion = /storyrpg structure model|episode turns?|sceneepisode|central conflict|episode endings|information ledger/i.test(markdown)
    ? 'storyrpg-treatment-v2'
    : 'legacy';
  const confidence: ExtractedTreatment['metadata']['confidence'] = markerCount >= 6 && Object.keys(episodes).length > 0
    ? 'high'
    : markerCount >= 3
      ? 'medium'
      : 'low';
  const isTreatment = looksLikeTreatment && Boolean(episodeSection) && Object.keys(episodes).length > 0;

  if (!isTreatment) {
    return {
      isTreatment: false,
      episodes: {},
      branches: [],
      endings: [],
      seasonGuidance,
      metadata: {
        ...EMPTY_METADATA,
        detected: promptGuideWithoutEpisodes ? false : looksLikeTreatment,
        warnings: promptGuideWithoutEpisodes
          ? [...warnings, 'Input appears to be a treatment prompt guide/template, not a filled story treatment.']
          : warnings,
      },
    };
  }

  return {
    isTreatment: true,
    episodes,
    branches,
    endings,
    seasonGuidance,
    metadata: {
      detected: true,
      confidence,
      formatVersion,
      warnings,
    },
  };
}

export function looksLikeTreatmentMarkdown(markdown: string): boolean {
  if (isPromptGuideMarkdown(markdown)) return false;
  const markerCount = TREATMENT_MARKERS.reduce((count, marker) => count + (marker.test(markdown) ? 1 : 0), 0);
  const hasWorldLocationBrief = /\bWorld\s+(?:And|\+)\s+Location Brief\b/i.test(markdown);
  const hasTreatmentContext = /\bSeason Promise\b/i.test(markdown)
    || resettableTest(EPISODE_HEADING_RE, markdown)
    || /^###\s+Protagonist\b/im.test(markdown);
  if (hasWorldLocationBrief && hasTreatmentContext) return true;
  return markerCount >= 3 || (
    /story treatment/i.test(markdown)
    && (resettableTest(EPISODE_HEADING_RE, markdown) || /\*\*(?:Episode|SceneEpisode) promise(?:\s*\([^)]*\))?:\*\*/i.test(markdown))
  );
}
