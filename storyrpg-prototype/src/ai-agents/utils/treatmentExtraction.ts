import type {
  EndingStateDriverType,
  StoryEndingTarget,
  StructuralRole,
  TreatmentBranchGuidance,
  TreatmentEpisodeGuidance,
  TreatmentSeasonGuidance,
} from '../../types/sourceAnalysis';

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
const EPISODE_HEADING_RE = /^(?:(?:#{3,5}\s+)(?:\*\*)?(?:(?:Scene\s*Episode|SceneEpisode|SceneEp|Episode|Scene|Ep\.?|SE|E)\s*#?\s*)?(\d+)(?:\s*[.):\-—–]\s*|\s+)(?:"?([^"\n*]+?)"?)(?:\*\*)?\s*|(?:(?:Scene\s*Episode|SceneEpisode|SceneEp|Episode|Scene|Ep\.?|SE|E)\s*#?\s*)?(\d+)(?:\s*[.):\-—–]\s*|\s+)(?:\*\*)?([^*\n]+?)(?:\*\*)?\s*)$/gim;
const NUMBER_AND_TITLE_RE = /^(?:-\s*)?(?:\*\*)?(Scene\s*Episode|SceneEpisode|SceneEp|Episode)\s+number\s+and\s+title(?:\s*\([^)]*\))?(?:\s*:\*\*|\*\*\s*:|\s*:)\s*(?:\*\*)?(?:(?:Scene\s*Episode|SceneEpisode|SceneEp|Episode|Scene|Ep\.?|SE|E)\s*#?\s*)?(\d+)(?:(?:\s*[.):\-—–]\s*|\s+)([^*\n]+?))?(?:\*\*)?\s*$/gim;
const BRANCH_HEADING_RE = /^#{3,5}\s+(?:(?:Branch|Consequence Chain)\s+[A-Z0-9]*\s*)?(?:[—–:-]\s+)?(.+)$/gim;
const ENDING_HEADING_RE = /^#{3,5}\s+Ending\s+(?:\d+|[A-Z])\s*(?:[—–:-]\s*)"?([^"\n(]+)"?(?:\s+\(([^)]+)\))?/gim;

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
  /\bFailure Mode Audit\b/i,
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

function getBulletValue(body: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boldMatch = body.match(new RegExp(`^(?:-\\s+)?\\*\\*${escaped}(?:\\s*\\([^)]*\\))?:\\*\\*\\s*(.+)$`, 'im'));
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
  const boldRe = new RegExp(`^-\\s+\\*\\*${escaped}[^:]*:\\*\\*\\s*(.+)$`, 'gim');
  const plainRe = new RegExp(`^-\\s+${escaped}[^:]*:\\s*(.+)$`, 'gim');
  return [
    ...[...body.matchAll(boldRe)].map((match) => match[1]?.trim()).filter(Boolean),
    ...[...body.matchAll(plainRe)].map((match) => match[1]?.trim()).filter(Boolean),
  ] as string[];
}

function getBulletValueWithLabelPrefix(body: string, labelPrefix: string): string | undefined {
  const escaped = labelPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boldMatch = body.match(new RegExp(`^(?:-\\s+)?\\*\\*${escaped}[^*]*:\\*\\*\\s*(.+)$`, 'im'));
  if (boldMatch?.[1]) return boldMatch[1].trim();
  const plainMatch = body.match(new RegExp(`^(?:-\\s+)?${escaped}[^:]*:\\s*(.+)$`, 'im'));
  return plainMatch?.[1]?.trim();
}

function getIndentedBulletList(body: string, label: string): string[] {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelRe = new RegExp(`^-\\s+(?:\\*\\*${escaped}:\\*\\*|${escaped}:)\\s*$`, 'im');
  const match = labelRe.exec(body);
  if (!match) return [];

  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const nextTopLevel = rest.search(/\n-\s+\*\*[^:\n]+:\*\*|\n#{3,5}\s+/);
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

function getFlexibleInlineOrIndentedList(body: string, labels: string[]): string[] {
  const combined: string[] = [];
  for (const label of labels) {
    combined.push(...getInlineOrIndentedList(body, label));
    combined.push(...getAllBulletValues(body, label));
  }
  return Array.from(new Set(combined.map((item) => item.trim()).filter(Boolean)));
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
  const normalizedSection = normalizeEpisodeNumberTitleLines(section);

  for (const guidance of splitByMatches(normalizedSection, EPISODE_HEADING_RE, (match, body) => {
    const episodeNumber = Number(match[1] || match[3]);
    const authoredTitle = (match[2] || match[4] || '').trim().replace(/^["“”]+|["“”]+$/g, '');
    const rawStructuralRole = getBulletValue(body, 'Structural role')
      || getBulletValueWithLabelPrefix(body, 'Structural role')
      || getAllBulletValues(body, 'Structural role')[0];
    const encounterAnchors = [
      ...getAllBulletValues(body, 'Encounter anchor'),
      ...getInlineOrIndentedList(body, 'Encounter anchors'),
    ];
    const endingTurnout = getFlexibleBulletValue(body, ['Ending turnout', 'SceneEpisode ending', 'Scene episode ending']);
    const consequenceResidue = getFlexibleBulletValue(body, ['Consequence residue', 'Residue']);
    const nextEpisodeCausality = getFlexibleBulletValue(body, [
      'Why the next sceneEpisode exists because of this one',
      'Why the next scene episode exists because of this one',
      'Why next sceneEp exists',
      'Why next scene episode exists',
      'Next sceneEpisode pressure',
      'Next episode pressure',
    ]);
    const endingPressure = getBulletValue(body, 'Ending pressure')
      || getBulletValue(body, 'Cliffhanger')
      || getBulletValue(body, 'Cliffhanger / closing image')
      || endingTurnout
      || nextEpisodeCausality
      || consequenceResidue;

    return {
      episodeNumber,
      guidance: {
        authoredTitle: authoredTitle || undefined,
        actLabel: getBulletValue(body, 'Act') || getBulletValue(body, 'Act/Arc')?.split('/')[0]?.trim(),
        arcLabel: getBulletValue(body, 'Arc') || getBulletValue(body, 'Act/Arc')?.split('/').slice(1).join('/').trim(),
        rawStructuralRole,
        normalizedStructuralRoles: normalizeTreatmentStructuralRoles(rawStructuralRole),
        dramaticQuestion: getFlexibleBulletValue(body, ['Episode dramatic question', 'SceneEpisode dramatic question', 'Dramatic question']),
        episodePromise: getBulletValue(body, 'Episode promise'),
        coldOpenFunction: getFlexibleBulletValue(body, ['Cold open function', 'Opening image / hook function', 'Opening image/hook function']),
        openingImage: getFlexibleBulletValue(body, ['Opening image', 'Visual opening']),
        episodeTurns: getInlineOrIndentedList(body, 'Episode turns'),
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
        aPressure: getFlexibleBulletValue(body, ['A pressure lane', 'A pressure']),
        bPressure: getFlexibleBulletValue(body, ['B pressure lane', 'B pressure']),
        cSeed: getFlexibleBulletValue(body, ['C seed', 'C pressure lane', 'C pressure']),
        entryGoal: getBulletValue(body, 'Entry goal'),
        obstacle: getBulletValue(body, 'Obstacle'),
        forcedChoice: getBulletValue(body, 'Forced choice'),
        exitShift: getBulletValue(body, 'Exit shift'),
        powerShift: getFlexibleBulletValue(body, ['Power shift', 'Power dynamic shift']),
        subtextGap: getFlexibleBulletValue(body, ['Subtext gap', 'Subtext']),
        informationMovement: getBulletValue(body, 'Information movement'),
        majorChoicePressures: getFlexibleInlineOrIndentedList(body, ['Major choice pressure', 'Meaningful choice pressure', 'Meaningful choices', 'Choice pressure']),
        alternativePaths: getFlexibleInlineOrIndentedList(body, ['Alternative paths', 'Alternative path or branchlet', 'Branchlet']),
        consequenceSeeds: getInlineOrIndentedList(body, 'Consequence seeds'),
        consequenceResidue,
        visualAnchor: getBulletValue(body, 'Visual anchor'),
        endingTurnout,
        endingPressure,
        authoredCliffhanger: endingPressure,
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

function inferEpisodeStructureMode(markdown: string): TreatmentSeasonGuidance['episodeStructureMode'] {
  return /\bscene\s*episodes?\b|\bsceneepisodes?\b/i.test(markdown) ? 'sceneEpisodes' : 'standard';
}

function parseSeasonGuidance(markdown: string): TreatmentSeasonGuidance | undefined {
  if (!looksLikeTreatmentMarkdown(markdown)) return undefined;
  const sections: TreatmentSeasonGuidance = {
    episodeStructureMode: inferEpisodeStructureMode(markdown),
    seasonPromiseAndDramaticEngine: getFlexibleSection(markdown, ['season promise and dramatic engine', 'season promise']),
    characterArchitecture: getFlexibleSection(markdown, ['character architecture', 'protagonist brief']),
    stakesArchitecture: getFlexibleSection(markdown, ['stakes architecture']),
    informationLedger: getFlexibleSection(markdown, ['information ledger']),
    seasonSpine: getFlexibleSection(markdown, ['3-act / 7-point season spine', '7-point season spine']),
    arcPlan: getFlexibleSection(markdown, ['arc plan', 'arc-level rules']),
    scenePlanningNotes: getFlexibleSection(markdown, ['scene planning notes']),
    branchAndConsequenceChains: getFlexibleSection(markdown, ['cross-sceneepisode branches', 'cross-sceneepisode branches and consequence chains', 'cross-episode branches', 'cross-episode branches and consequence chains']),
    failForward: getFlexibleSection(markdown, ['capability, growth, and fail-forward']),
    endings: getFlexibleSection(markdown, ['alternate endings']),
    failureModeAudit: getFlexibleSection(markdown, ['failure mode audit']),
  };
  sections.rawSectionSummary = Object.entries(sections)
    .filter(([key, value]) => key !== 'episodeStructureMode' && key !== 'rawSectionSummary' && typeof value === 'string' && value.trim().length > 0)
    .map(([key]) => key);
  return sections.rawSectionSummary.length > 0 ? sections : undefined;
}

export function extractTreatmentFromMarkdown(markdown: string): ExtractedTreatment {
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
  const episodes = episodeSection ? parseEpisodeGuidance(episodeSection) : {};
  const endings = endingSection ? parseEndings(endingSection) : [];
  const seasonGuidance = parseSeasonGuidance(markdown);
  const warnings: string[] = [];
  if (looksLikeTreatment && Object.keys(episodes).length === 0) warnings.push('No episode guidance could be parsed from the treatment.');
  if (looksLikeTreatment && endings.length === 0) warnings.push('No ending targets could be parsed from the treatment.');
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
    branches: parseBranches(branchSection),
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
  return markerCount >= 3 || (
    /story treatment/i.test(markdown)
    && (resettableTest(EPISODE_HEADING_RE, markdown) || /\*\*(?:Episode|SceneEpisode) promise(?:\s*\([^)]*\))?:\*\*/i.test(markdown))
  );
}
