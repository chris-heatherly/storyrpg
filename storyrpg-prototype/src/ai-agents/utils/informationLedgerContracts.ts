import type { SourceMaterialAnalysis, TreatmentSeasonGuidance } from '../../types/sourceAnalysis';
import type {
  AudienceKnowledgeState,
  InformationFactualAtom,
  InformationKnowledgeHolder,
  InformationLedgerEntry,
  InformationTensionMode,
} from '../../types/seasonPlan';

type AuthoredInfoGuidanceEntry = NonNullable<TreatmentSeasonGuidance['informationLedgerGuidance']>['entries'][number];

const INFO_HEADING_RE = /(?:^|\n)\s*-\s*\*\*(INFO-[A-Z0-9_-]+)\s*:\s*([^*\n]+?)\*\*/gi;
const FIELD_RE = /^\s*-\s*(?:\*\*)?([^:\n]+?)(?:\*\*)?\s*:\s*(.+)$/gm;
const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'their', 'they', 'them', 'have',
  'has', 'had', 'will', 'would', 'about', 'what', 'when', 'where', 'which', 'while',
  'because', 'after', 'before', 'over', 'under', 'then', 'than', 'your', 'you', 'her',
  'his', 'him', 'she', 'who', 'whom', 'whose', 'for', 'are', 'was', 'were', 'been',
  'episode', 'episodes', 'planned', 'payoff', 'reveal', 'setup', 'touch',
]);

function normalizeFieldName(value: string): string {
  return value.toLowerCase().replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
}

function splitList(value: string): string[] {
  return value
    .split(/,|;|\band\b/i)
    .map((part) => part.replace(/\([^)]*\)/g, '').replace(/[.\s]+$/g, '').trim())
    .filter(Boolean);
}

function parseEpisodes(value: string): number[] {
  const out = new Set<number>();
  for (const match of value.matchAll(/\b(?:ep(?:isode)?\.?\s*)?(\d+)\b/gi)) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function parseQuestionIds(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const ids = [...value.matchAll(/\bQ\d+[A-Z0-9_-]*\b/gi)].map((m) => m[0]);
  return ids.length > 0 ? unique(ids) : undefined;
}

function firstEpisode(value: string | undefined): number | undefined {
  if (!value) return undefined;
  return parseEpisodes(value)[0];
}

function normalizeAudienceKnowledgeState(value: string | undefined): AudienceKnowledgeState | undefined {
  const text = String(value ?? '').toLowerCase();
  if (/\bwithheld\b/.test(text)) return 'withheld';
  if (/\bselective|dramatic irony|shown as|misread|tells\b/.test(text)) return 'selective';
  if (/\bshared|known\b/.test(text)) return 'shared';
  return undefined;
}

function normalizeTensionMode(value: string | undefined): InformationTensionMode | undefined {
  const text = String(value ?? '').toLowerCase();
  if (/dramatic irony/.test(text)) return 'dramatic_irony';
  if (/revelation|reveal/.test(text)) return 'revelation';
  if (/foreshadow/.test(text)) return 'foreshadowing';
  if (/mystery/.test(text)) return 'mystery';
  if (/surprise/.test(text)) return 'surprise';
  if (/suspense|tension/.test(text)) return 'suspense';
  return undefined;
}

function mapNamedKnowledgeToHolder(name: string): InformationKnowledgeHolder {
  const n = name.toLowerCase();
  if (/\bkylie|protagonist|heroine|hero\b/.test(n)) return 'protagonist';
  if (/\bvictor|antagonist|villain|enemy\b/.test(n)) return 'antagonist';
  if (/\baudience|player|reader\b/.test(n)) return 'player';
  if (/\bworld|city|public|everyone\b/.test(n)) return 'world';
  return 'ally';
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function significantAtoms(text: string | undefined, phase: 'setup' | 'reveal' | 'payoff'): InformationFactualAtom[] {
  if (!text) return [];
  const clauses = text
    .split(/(?<=[.!?])\s+|;\s+|\s+—\s+|\s+->\s+|\s+→\s+/)
    .map((part) => part.trim())
    .filter((part) => {
      const tokens = part.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOPWORDS.has(t));
      return tokens.length >= 3;
    })
    .slice(0, 8);
  return clauses.map((clause, index) => ({
    id: `${phase}-${index + 1}`,
    text: clause,
    phase,
    blockingLevel: 'treatment',
  }));
}

function blockRange(section: string, matches: RegExpMatchArray[]): string[] {
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const next = matches[index + 1]?.index ?? section.length;
    return section.slice(start, next).trim();
  });
}

export function parseInformationLedgerGuidance(section: string | undefined): TreatmentSeasonGuidance['informationLedgerGuidance'] | undefined {
  if (!section?.trim()) return undefined;
  const matches = [...section.matchAll(INFO_HEADING_RE)];
  if (matches.length === 0) return undefined;

  const entries: AuthoredInfoGuidanceEntry[] = [];
  for (const block of blockRange(section, matches as RegExpMatchArray[])) {
    const heading = block.match(/-\s*\*\*(INFO-[A-Z0-9_-]+)\s*:\s*([^*\n]+?)\*\*/i);
    if (!heading) continue;
    const fields = new Map<string, string>();
    for (const field of block.matchAll(FIELD_RE)) {
      fields.set(normalizeFieldName(field[1]), field[2].trim());
    }

    const setupText = fields.get('setup touch episodes')
      ?? fields.get('setup touch episode')
      ?? block.match(/setup touch episodes?\s*:\s*([^.\n]+)/i)?.[1]
      ?? '';
    const revealPayoffText = fields.get('planned reveal/payoff episode')
      ?? fields.get('planned reveal/payoff episodes')
      ?? block.match(/planned reveal\/payoff episodes?\s*:\s*([^\n]+)/i)?.[1]
      ?? '';
    const revealPayoffEpisodes = parseEpisodes(revealPayoffText);
    const revealText = fields.get('planned reveal episode') ?? revealPayoffText;
    const payoffText = fields.get('planned payoff episode') ?? revealPayoffText;
    const opened = block.match(/opened question ids?\s*:\s*([\s\S]*?)(?=closed question ids?\s*:|\n\s*-\s*payoff plan\s*:|$)/i)?.[1]
      ?? fields.get('opened question ids')
      ?? fields.get('opened question id');
    const closed = block.match(/closed question ids?\s*:\s*([\s\S]*?)(?=\n\s*-\s*payoff plan\s*:|$)/i)?.[1]
      ?? fields.get('closed question ids')
      ?? fields.get('closed question id');

    entries.push({
      id: heading[1].trim(),
      label: heading[2].trim(),
      sourceText: block,
      description: fields.get('what it is'),
      audienceKnowledgeState: normalizeAudienceKnowledgeState(fields.get('audience/player knowledge state')) ?? fields.get('audience/player knowledge state'),
      tensionMode: normalizeTensionMode(fields.get('tension mode')) ?? fields.get('tension mode'),
      knownByNames: splitList(fields.get('who knows') ?? ''),
      withheldFromNames: splitList(fields.get('who does not know') ?? ''),
      introducedEpisode: firstEpisode(fields.get('introduced episode')),
      setupTouchEpisodes: parseEpisodes(setupText),
      plannedRevealEpisode: firstEpisode(revealText),
      plannedPayoffEpisode: fields.has('planned payoff episode')
        ? firstEpisode(payoffText)
        : revealPayoffEpisodes[1] ?? firstEpisode(payoffText),
      opensQuestionIds: parseQuestionIds(opened),
      closesQuestionIds: parseQuestionIds(closed),
      payoffPlan: fields.get('payoff plan'),
    });
  }

  return entries.length > 0 ? { rawSection: section, entries } : undefined;
}

function authoredToLedgerEntry(
  authored: AuthoredInfoGuidanceEntry,
  index: number,
  totalEpisodes: number,
): InformationLedgerEntry {
  const introducedEpisode = Math.max(1, Math.min(totalEpisodes, authored.introducedEpisode ?? 1));
  const setupTouchEpisodes = unique([
    introducedEpisode,
    ...(authored.setupTouchEpisodes ?? []),
  ]).filter((episode) => episode >= introducedEpisode && episode <= totalEpisodes);
  const knownBy = unique((authored.knownByNames ?? []).map(mapNamedKnowledgeToHolder));
  const withheldFrom = unique((authored.withheldFromNames ?? []).map(mapNamedKnowledgeToHolder));
  const reveal = authored.plannedRevealEpisode
    ? Math.max(introducedEpisode, Math.min(totalEpisodes, authored.plannedRevealEpisode))
    : undefined;
  const payoff = authored.plannedPayoffEpisode
    ? Math.max(introducedEpisode, Math.min(totalEpisodes, authored.plannedPayoffEpisode))
    : reveal;
  return {
    id: authored.id || `INFO-${index + 1}`,
    label: authored.label || `Information ${index + 1}`,
    description: authored.description || authored.label || '',
    audienceKnowledgeState: normalizeAudienceKnowledgeState(authored.audienceKnowledgeState) ?? 'selective',
    tensionMode: normalizeTensionMode(authored.tensionMode) ?? 'foreshadowing',
    knownBy: knownBy.length > 0 ? knownBy : ['world'],
    withheldFrom,
    introducedEpisode,
    plannedRevealEpisode: reveal,
    plannedPayoffEpisode: payoff,
    setupTouchEpisodes,
    payoffPlan: authored.payoffPlan || `Pay off ${authored.label} in the authored reveal/payoff window.`,
    isBoxQuestion: Boolean((authored.opensQuestionIds?.length ?? 0) > 0 || /mystery/i.test(String(authored.tensionMode ?? ''))),
    opensQuestionIds: authored.opensQuestionIds ?? [],
    closesQuestionIds: authored.closesQuestionIds ?? [],
    sourceText: authored.sourceText,
    authoredId: authored.id,
    factualAtoms: [
      ...significantAtoms(authored.description, 'reveal'),
      ...significantAtoms(authored.payoffPlan, 'payoff'),
    ],
    namedKnowledge: {
      knownByNames: authored.knownByNames ?? [],
      withheldFromNames: authored.withheldFromNames ?? [],
    },
    knowledgePhases: setupTouchEpisodes.map((episode) => ({
      episodeNumber: episode,
      audienceKnowledgeState: 'selective' as const,
      tensionMode: 'foreshadowing' as const,
      allowedSurface: episode === reveal ? 'revelation' as const : 'hint' as const,
    })),
    setupTouchDetails: setupTouchEpisodes.map((episode) => ({
      episodeNumber: episode,
      requiredSurface: authored.description || authored.label || authored.id,
    })),
  };
}

export function authoredInformationLedgerEntries(
  analysis: Pick<SourceMaterialAnalysis, 'treatmentSeasonGuidance' | 'totalEstimatedEpisodes'>,
  totalEpisodes: number,
): InformationLedgerEntry[] {
  const guidance = analysis.treatmentSeasonGuidance?.informationLedgerGuidance
    ?? parseInformationLedgerGuidance(analysis.treatmentSeasonGuidance?.informationLedger);
  const entries = guidance?.entries ?? [];
  return entries.map((entry, index) => authoredToLedgerEntry(entry, index, Math.max(1, totalEpisodes || analysis.totalEstimatedEpisodes || 1)));
}

export function mergeAuthoredInformationLedger(
  generatedEntries: InformationLedgerEntry[],
  authoredEntries: InformationLedgerEntry[],
): InformationLedgerEntry[] {
  if (authoredEntries.length === 0) return generatedEntries;
  const generatedById = new Map(generatedEntries.map((entry) => [entry.id.toLowerCase(), entry]));
  const merged: InformationLedgerEntry[] = [];
  for (const authored of authoredEntries) {
    const generated = generatedById.get(authored.id.toLowerCase());
    merged.push(generated ? {
      ...generated,
      ...authored,
      description: authored.description || generated.description,
      payoffPlan: authored.payoffPlan || generated.payoffPlan,
      knownBy: authored.knownBy.length > 0 ? authored.knownBy : generated.knownBy,
      withheldFrom: authored.withheldFrom?.length ? authored.withheldFrom : generated.withheldFrom,
      factualAtoms: authored.factualAtoms?.length ? authored.factualAtoms : generated.factualAtoms,
    } : authored);
  }
  const authoredIds = new Set(authoredEntries.map((entry) => entry.id.toLowerCase()));
  for (const generated of generatedEntries) {
    if (!authoredIds.has(generated.id.toLowerCase())) merged.push(generated);
  }
  return merged;
}
