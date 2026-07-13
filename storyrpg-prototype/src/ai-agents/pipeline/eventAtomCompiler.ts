import type { NarrativeEvidenceAtom } from '../../types/narrativeContract';

const ACTION_START = /^(?:arriv(?:e|es|ed)|return(?:s|ed)?|enter(?:s|ed)?|wander(?:s|ed)?|walk(?:s|ed)?|meet(?:s)?|befriend(?:s|ed)?|introduc(?:e|es|ed)|find(?:s)?|discover(?:s|ed)?|learn(?:s|ed)?|write(?:s)?|wrote|publish(?:es|ed)?|rescu(?:e|es|ed)|attack(?:s|ed)?|form(?:s|ed)?|choose(?:s)?|chose|decide(?:s|d)?|catch(?:es)?|test(?:s|ed)?|invite(?:s|d)?|tell(?:s)?|told)\b/i;
const ACTION_CONJUNCTION = /\s+and\s+(?=(?:arriv|return|enter|wander|walk|meet|befriend|introduc|find|discover|learn|writ|publish|rescu|attack|form|choos|decid|catch|test|invit|tell))/i;
const ENTRY_SIGNAL = /\b(?:arriv(?:e|es|ed)(?:\s+at|\s+in)?|return(?:s|ed)?(?:\s+home|\s+to)?|enter(?:s|ed)?|wander(?:s|ed)?\s+into|walk(?:s|ed)?\s+into|step(?:s|ped)?\s+into|reach(?:es|ed)?)\b/i;
const REFERENCE_SIGNAL = /\b(?:introduc(?:e|es|ed).{0,50}\bto|tell(?:s|ing)?\s+.{0,30}\babout|mention(?:s|ed)?|invite(?:s|d)?\s+.{0,30}\bto|world\s+of|points?\s+(?:her|him|them)?\s*toward)\b/i;
const HONORIFIC_PERIOD = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|Gen|Capt|Lt|Col|Rev)\./gi;
const PROTECTED_PERIOD = '\u0000';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function locationAliases(location: string): string[] {
  const normalized = normalize(location);
  const aliases = new Set([normalized]);
  const words = normalized.split(' ').filter((word) => word.length >= 4);
  for (const word of words) aliases.add(word);
  if (words.some((word) => /^books?$/.test(word))) {
    aliases.add('bookshop');
    aliases.add('bookstore');
  }
  if (words.some((word) => /^clubs?$/.test(word))) aliases.add('nightclub');
  if (words.some((word) => /^parks?$/.test(word))) aliases.add('garden');
  return [...aliases].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function locationMatch(text: string, location: string): { index: number; alias: string } | undefined {
  const normalizedText = normalize(text);
  for (const alias of locationAliases(location)) {
    const index = normalizedText.indexOf(alias);
    if (index >= 0) return { index, alias };
  }
  return undefined;
}

function splitCompoundEvent(sourceText: string): string[] {
  const sentences = sourceText
    .replace(HONORIFIC_PERIOD, `$1${PROTECTED_PERIOD}`)
    .split(/[.;]+/)
    .map((part) => part.split(PROTECTED_PERIOD).join('.').trim())
    .filter(Boolean);
  const clauses: string[] = [];
  for (const sentence of sentences) {
    const whoMatch = sentence.match(/^(.*?)\bwho\b\s*(.+)$/i);
    const antecedent = whoMatch?.[1].match(/\b([A-Z][A-Za-z'’-]+)\b(?!.*\b[A-Z][A-Za-z'’-]+\b)/)?.[1];
    const relative = whoMatch
      ? [whoMatch[1], ...whoMatch[2].split(ACTION_CONJUNCTION).map((part) => antecedent ? `${antecedent} ${part}` : part)]
      : [sentence];
    for (const part of relative) {
      const verbSplit = part.split(ACTION_CONJUNCTION);
      if (verbSplit.length > 1 && verbSplit.slice(1).every((candidate) => ACTION_START.test(candidate.trim()))) {
        clauses.push(...verbSplit.map((candidate) => candidate.trim()).filter(Boolean));
      } else {
        clauses.push(part.trim());
      }
    }
  }
  const expandedIntroductions = clauses.flatMap((clause) => {
    const friend = clause.match(/^(.*?\bintroduc(?:e|es|ed)\s+)(.+?)\s+to\s+(.+?)\s+and\s+(?:her|his|their)\s+other\s+friend\s+([A-Z][A-Za-z'’-]+)$/i);
    if (!friend) return [clause];
    const actor = friend[1].replace(/\bintroduc(?:e|es|ed)\s+$/i, '').trim();
    return [
      `${friend[1]}${friend[2]} to ${friend[3]}`.trim(),
      `${actor} introduces ${friend[2]} to ${friend[4]}`.trim(),
    ];
  });
  const expanded = expandedIntroductions.flatMap((clause) => {
    const ownership = clause.match(/^(.*?\b(bookshop|bookstore|club|bar|house|apartment|store|shop|restaurant|hotel|estate|manor))\s+owned\s+by\s+([A-Z][A-Za-z'’-]+)(.*)$/i);
    if (!ownership) return [clause];
    return [
      `${ownership[1]}${ownership[4]}`.trim(),
      `The ${ownership[2]} is owned by ${ownership[3]}`,
    ];
  });
  return expanded.length > 0 ? expanded : [sourceText.trim()];
}

function semanticRole(text: string): NonNullable<NarrativeEvidenceAtom['semanticRole']> {
  if (ENTRY_SIGNAL.test(text)) return 'location_entry';
  if (/\b(?:introduc(?:e|es|ed)|meet(?:s)?)\b/i.test(text)) return 'introduction';
  if (/\bowned\s+by\b/i.test(text)) return 'state_change';
  if (/\b(?:tell(?:s)?|told|learn(?:s|ed)?|discover(?:s|ed)?|reveal(?:s|ed)?|explain(?:s|ed)?|show(?:s|ed)?)\b/i.test(text)) return 'information_transfer';
  if (/\b(?:befriend(?:s|ed)?|become\s+friends?|trust(?:s|ed)?|bond(?:s|ed)?|reconcile(?:s|d)?|forgive(?:s|n)?|betray(?:s|ed)?|form(?:s|ed)?\s+the\s+.+club)\b/i.test(text)) return 'relationship_change';
  if (/\b(?:choose(?:s)?|chose|decide(?:s|d)?|refuse(?:s|d)?|accept(?:s|ed)?|commit(?:s|ted)?)\b/i.test(text)) return 'decision';
  if (/\b(?:aftermath|viral|by evening|by morning|later)\b/i.test(text)) return 'aftermath';
  return 'action';
}

function addLocationMetadata(
  atom: NarrativeEvidenceAtom,
  clause: string,
  knownLocations: string[],
): void {
  const clauseNormalized = normalize(clause);
  for (const location of knownLocations) {
    const match = locationMatch(clause, location);
    if (!match) continue;
    const start = Math.max(0, match.index - 70);
    const context = clauseNormalized.slice(start, match.index + match.alias.length + 15);
    const referenced = REFERENCE_SIGNAL.test(context) && !ENTRY_SIGNAL.test(context.slice(-45));
    if (referenced) {
      atom.referencedLocations = Array.from(new Set([...(atom.referencedLocations ?? []), location]));
      if (atom.semanticRole === 'action') atom.semanticRole = 'location_reference';
      continue;
    }
    const escapedAlias = match.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const explicitlyStaged = new RegExp(`\\b(?:at|in|inside|outside|on|near)\\s+(?:the\\s+)?${escapedAlias}\\b`, 'i')
      .test(clauseNormalized);
    if (ENTRY_SIGNAL.test(clauseNormalized) || ENTRY_SIGNAL.test(context) || explicitlyStaged) {
      atom.stagedLocation ??= location;
      atom.semanticRole = 'location_entry';
    }
  }
}

function capitalizedNames(value: string): string[] {
  return Array.from(new Set((value.match(/\b[A-Z][A-Za-z'’-]+\b/g) ?? [])
    .filter((name) => !['She', 'He', 'They', 'The', 'At', 'By'].includes(name))));
}

function participantNames(value: string, knownLocations: string[]): string[] {
  const excluded = new Set(knownLocations.flatMap((location) => capitalizedNames(location)));
  for (const group of value.matchAll(/\b((?:[A-Z][A-Za-z'’-]+\s+)*(?:Club|Circle|Crew|Society))\b/g)) {
    for (const token of capitalizedNames(group[1])) excluded.add(token);
  }
  for (const alias of value.matchAll(/\b(?:codename|alias|headline|title)\s+((?:[A-Z][A-Za-z'’-]*\.?\s*)+)/g)) {
    for (const token of capitalizedNames(alias[1])) excluded.add(token);
  }
  for (const workTitle of value.matchAll(/\b(?:first|new|latest)\s+((?:[A-Z][A-Za-z'’-]+\s+){1,6})(?=post|article|book|blog|column|song|film)\b/g)) {
    for (const token of capitalizedNames(workTitle[1])) excluded.add(token);
  }
  return capitalizedNames(value).filter((name) => !excluded.has(name));
}

function semanticAlternatives(atom: NarrativeEvidenceAtom, clause: string): string[] {
  const alternatives = new Set([clause]);
  const names = capitalizedNames(clause);
  if (atom.semanticRole === 'location_entry' && atom.stagedLocation) {
    alternatives.add(`enters ${atom.stagedLocation}`);
    alternatives.add(`walks into ${atom.stagedLocation}`);
    alternatives.add(`arrives at ${atom.stagedLocation}`);
  }
  if (atom.semanticRole === 'relationship_change' && /\bbefriend/i.test(clause)) {
    const actor = names[0] ?? '';
    alternatives.add(`${actor} welcomes her`.trim());
    alternatives.add(`${actor} offers her friendship`.trim());
  }
  if (atom.semanticRole === 'relationship_change' && /\bbecome\s+friends?\b/i.test(clause)) {
    alternatives.add('welcome her as a friend');
    alternatives.add('call her a friend');
    alternatives.add('their friendship begins');
    alternatives.add('I like her');
    alternatives.add('she stays');
    alternatives.add('to us');
    alternatives.add('part of something');
    alternatives.add('accept her into the circle');
    alternatives.add('bring her into their circle');
  }
  if (/\b(?:explores?|wanders?|roams?|walks?\s+(?:through|around))\b/i.test(clause)) {
    const location = names.at(-1);
    if (location) {
      alternatives.add(`walks through ${location}`);
      alternatives.add(`wanders through ${location}`);
      alternatives.add(`roams ${location}`);
    }
    alternatives.add('walks the city streets');
    alternatives.add('wanders the city');
    alternatives.add('explores the city');
  }
  const groupFormation = clause.match(/\bform(?:s|ed)?\s+(?:the\s+)?(.+?\b(?:club|circle|crew|society))\b/i);
  if (atom.semanticRole === 'relationship_change' && groupFormation?.[1]) {
    const groupName = groupFormation[1].trim();
    alternatives.add(`name it ${groupName}`);
    alternatives.add(`${groupName} is born`);
    alternatives.add(`start ${groupName}`);
  }
  if (atom.semanticRole === 'introduction' && names.length >= 2) {
    const [actor, ...introduced] = names;
    alternatives.add(`${actor} introduces ${introduced.join(' to ')}`);
    alternatives.add(`${introduced.join(' meets ')} through ${actor}`);
  }
  return [...alternatives].filter(Boolean);
}

/**
 * Deterministically decomposes an authored event into independently verifiable
 * semantic actions. It never invents prose: every atom retains a source clause
 * and the full source text for provenance.
 */
export function compileEventRealizationAtoms(input: {
  eventId: string;
  sourceText: string;
  knownLocations?: string[];
}): NarrativeEvidenceAtom[] {
  const clauses = splitCompoundEvent(input.sourceText);
  const atoms = clauses.map((clause, index): NarrativeEvidenceAtom => {
    const atom: NarrativeEvidenceAtom = {
      id: `${input.eventId}:atom:${index + 1}`,
      description: `Depict authored event action: ${clause}`,
      acceptedPatterns: [clause],
      sourceText: input.sourceText,
      kind: 'semantic',
      semanticRole: semanticRole(clause),
      participantIds: participantNames(clause, input.knownLocations ?? []),
      prerequisiteAtomIds: index > 0 ? [`${input.eventId}:atom:${index}`] : [],
      required: true,
    };
    addLocationMetadata(atom, clause, input.knownLocations ?? []);
    atom.acceptedPatterns = semanticAlternatives(atom, clause);
    if (/\bowned\s+by\b/i.test(clause)) {
      const owner = capitalizedNames(clause)[0];
      const place = clause.match(/\b(bookshop|bookstore|club|bar|house|apartment|store|shop|restaurant|hotel|estate|manor)\b/i)?.[1];
      if (owner && place) {
        atom.acceptedPatterns = Array.from(new Set([
          ...atom.acceptedPatterns,
          `${owner}'s ${place}`,
          `${owner} owns the ${place}`,
          `${owner} runs the ${place}`,
        ]));
      }
      // Static ownership is a canon/identity constraint. Preserve it for
      // provenance and downstream fact checks, but do not make it a required
      // chronological action in the event owner task.
      atom.required = false;
    }
    return atom;
  });
  return atoms.filter((atom, index) => {
    const normalized = normalize(atom.acceptedPatterns[0] ?? '');
    return normalized.length > 0 && atoms.findIndex((candidate) => normalize(candidate.acceptedPatterns[0] ?? '') === normalized) === index;
  });
}

export function stagedLocationsForAtoms(atoms: NarrativeEvidenceAtom[] | undefined): string[] {
  return Array.from(new Set((atoms ?? []).map((atom) => atom.stagedLocation).filter((value): value is string => Boolean(value))));
}
