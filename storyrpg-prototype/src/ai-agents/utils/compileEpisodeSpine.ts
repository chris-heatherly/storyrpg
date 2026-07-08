/**
 * Compiles an Episode Spine Contract from treatment guidance + season Story Circle.
 * Deterministic only — no LLM structural invention.
 */

import { createHash } from 'crypto';
import type { SeasonEpisode } from '../../types/seasonPlan';
import type {
  CompileEpisodeSpineContext,
  EncounterSpineProfile,
  EpisodeSpineContract,
  EpisodeSpineUnit,
  SeasonSpineContract,
  SpineUnitKind,
} from '../../types/episodeSpine';
import type { StoryCircleBeat } from '../../types/sourceAnalysis';
import { storyCircleRoleBeats } from './storyCircleDistribution';
import {
  coalesceFragmentedEpisodeTurns,
  orderAuthoredEpisodeTurns,
  splitCompoundSpatialEpisodeTurns,
  chronologyRankForText,
} from './treatmentTurnOrdering';
import { filterAuthoredLiteEpisodeTurns } from './authoredLiteTurnFilter';
import { filterEpisodeScopedTurns } from './episodeTurnFirewall';
import { isAuthoredLiteEpisode } from './authoredLiteScenePlan';

const POST_CONDITIONAL_RE = /^after\s+(.+?),\s+(.+)$/i;
const TESTING_PRECONDITION_RE = /\btest(?:ing|s)?\b/i;
const GROUP_FORMATION_RE = /\b(?:dusk club|become\s+friends|forms?\s+(?:the\s+)?\w+\s+club)\b/i;
const LATE_NIGHT_WRITING_RE = /\b(?:4\s*am|writes?\s+(?:the\s+)?blog|mr\.?\s*midnight|codename)\b/i;
/** Viral metrics only — do not match bare "evening" or venue "club". */
const VIRAL_AFTERMATH_RE = /\b(?:goes\s+viral|went\s+viral|viral\s+(?:post|blog|attention)|readership|local\s+curiosity)\b/i;
const RESCUE_RE = /\b(?:rescue(?:s|d)?|rescued|victor)\b/i;

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function inferLocationId(text: string, locations: string[]): string | undefined {
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const declared = locations.find((loc) => {
    const locNorm = loc.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return locNorm.length >= 5 && normalized.includes(locNorm.slice(0, Math.min(locNorm.length, 12)));
  });
  if (declared) return declared;
  if (/\b(?:cismigiu|park|gardens?)\b/.test(normalized)) {
    return locations.find((loc) => /\b(?:park|garden)/i.test(loc)) || 'Cișmigiu Gardens';
  }
  if (/\b(?:bookshop|bookstore|lumina)\b/.test(normalized)) {
    return locations.find((loc) => /\b(?:book|shop|store)/i.test(loc)) || 'Lumina Books';
  }
  if (/\b(?:rooftop|terrace)\b/.test(normalized)) {
    return locations.find((loc) => /\b(?:rooftop|terrace|bar)/i.test(loc)) || 'Rooftop Bar';
  }
  if (/\b(?:club|valescu|nightlife)\b/.test(normalized)) {
    return locations.find((loc) => /\bclub/i.test(loc)) || 'Vâlcescu Club';
  }
  if (/\b(?:apartment|flat|home|doorstep|threshold)\b/.test(normalized)) {
    return locations.find((loc) => /\b(?:apartment|flat|home|residence)/i.test(loc));
  }
  return locations[0];
}

function capitalizeFirst(text: string): string {
  if (!text) return text;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** Split synopsis sentences that compress prerequisite + outcome into one line. */
export function splitPostConditionalTurn(text: string): string[] {
  const trimmed = cleanText(text);
  if (!trimmed) return [];
  const match = POST_CONDITIONAL_RE.exec(trimmed);
  if (!match) return [trimmed];
  const precondition = cleanText(match[1]);
  const outcome = cleanText(match[2]);
  if (!precondition || !outcome) return [trimmed];

  if (TESTING_PRECONDITION_RE.test(precondition) || TESTING_PRECONDITION_RE.test(trimmed)) {
    const testText = /^(?:testing|test)\b/i.test(precondition)
      ? capitalizeFirst(precondition)
      : `Testing ${precondition}`;
    return [testText, capitalizeFirst(outcome)];
  }

  if (precondition.length >= 12 && outcome.length >= 12) {
    return [capitalizeFirst(precondition), capitalizeFirst(outcome)];
  }
  return [trimmed];
}

export function decomposeTreatmentTurns(turns: string[]): string[] {
  return turns.flatMap((turn) => splitPostConditionalTurn(turn));
}

function inferUnitKind(text: string): SpineUnitKind {
  const normalized = text.toLowerCase();
  // Set pieces require attack/rescue pressure — walkHome alone is often a
  // choice menu ("cut through the park or take the long way home") and must
  // not invent an encounter slot that steals the signature device.
  if (/\b(?:attack(?:s|ed|ing)?|ambush(?:ed|es)?|rescue(?:s|d)?|rescued|scream(?:s|ed)?|knife|pinned|shadow\s+strikes?)\b/i.test(text)) {
    return 'set_piece';
  }
  // Doorstep/vanish is threshold only when not the attack/rescue set piece.
  if (/\b(?:threshold|doorstep|vanish(?:es|ed)?)\b/.test(normalized)) {
    return 'threshold';
  }
  // Writing/codename is dramatized; viral metrics are aftermath-only.
  if (LATE_NIGHT_WRITING_RE.test(normalized)) return 'late_night_writing';
  if (VIRAL_AFTERMATH_RE.test(normalized) && !LATE_NIGHT_WRITING_RE.test(normalized)) return 'aftermath';
  if (TESTING_PRECONDITION_RE.test(normalized)) return 'test';
  if (GROUP_FORMATION_RE.test(normalized)) return 'bond';
  if (/\b(?:arrives?|arrival|suitcases?|landed)\b/.test(normalized)) return 'arrival';
  if (/\bexplor/.test(normalized)) return 'explore';
  if (/\b(?:bookshop|bookstore|lumina|befriend|stela|mika)\b/.test(normalized)) return 'meet';
  if (/\b(?:rooftop|terrace|suitors?|charcoal suit)\b/.test(normalized)) return 'meet';
  if (/\bwalk(?:s|ed|ing)?\s+(?:home|through|along)\b/.test(normalized)) return 'transition';
  return 'development';
}

function inferEncounterProfile(text: string, kind: SpineUnitKind): EncounterSpineProfile | undefined {
  if (kind !== 'set_piece') return undefined;
  if (RESCUE_RE.test(text)) return 'staged_rescue';
  if (TESTING_PRECONDITION_RE.test(text) || /\b(?:question|dare|prove)\b/i.test(text)) return 'social_test';
  return 'tactical';
}

function isSpineEncounterText(text: string): boolean {
  return /\b(?:attack(?:s|ed|ing)?|ambush(?:ed|es)?|rescue(?:s|d)?|rescued|scream(?:s|ed)?|knife|pinned|shadow\s+strikes?)\b/i.test(text);
}

function prerequisiteKindsFor(kind: SpineUnitKind): SpineUnitKind[] {
  switch (kind) {
    case 'bond': return ['test'];
    case 'threshold': return ['set_piece', 'transition'];
    case 'late_night_writing': return ['threshold', 'set_piece'];
    case 'aftermath': return ['late_night_writing', 'threshold', 'set_piece'];
    default: return [];
  }
}

function buildPrerequisites(
  units: Array<{ id: string; kind: SpineUnitKind }>,
  index: number,
  kind: SpineUnitKind,
): string[] {
  const requiredKinds = prerequisiteKindsFor(kind);
  if (requiredKinds.length === 0) return [];
  const prereqs: string[] = [];
  for (const requiredKind of requiredKinds) {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (units[i].kind === requiredKind) {
        prereqs.push(units[i].id);
        break;
      }
    }
  }
  return prereqs;
}

function collectPolarityFacets(
  ep: SeasonEpisode,
  context: CompileEpisodeSpineContext,
): string[] {
  const facets: string[] = [];
  const guidance = ep.treatmentGuidance;
  if (guidance?.dramaticQuestion?.trim()) facets.push(guidance.dramaticQuestion.trim());
  for (const arc of context.seasonArcs ?? []) {
    if (arc.arcQuestion?.trim()) facets.push(arc.arcQuestion.trim());
    if (arc.identityPressureFacet?.trim()) facets.push(arc.identityPressureFacet.trim());
  }
  return Array.from(new Set(facets));
}

function episodeCircleSlice(
  beats: StoryCircleBeat[],
  seasonStoryCircle: CompileEpisodeSpineContext['seasonStoryCircle'],
): EpisodeSpineContract['episodeCircle'] {
  if (!seasonStoryCircle || beats.length === 0) return undefined;
  const slice: NonNullable<EpisodeSpineContract['episodeCircle']> = {};
  for (const beat of beats) {
    const text = seasonStoryCircle[beat];
    if (text?.trim()) slice[beat] = text.trim();
  }
  return Object.keys(slice).length > 0 ? slice : undefined;
}

function hashSource(ep: SeasonEpisode, turns: string[]): string {
  const payload = JSON.stringify({
    episodeNumber: ep.episodeNumber,
    turns,
    guidance: ep.treatmentGuidance,
    roles: ep.storyCircleRole,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function rawEpisodeTurns(ep: SeasonEpisode): string[] {
  const guidance = ep.treatmentGuidance;
  let turns: string[] = [];
  if (guidance?.episodeTurns?.length) turns = guidance.episodeTurns.filter((turn) => turn?.trim());
  else if (guidance?.majorChoicePressures?.length) turns = guidance.majorChoicePressures.filter((turn) => turn?.trim());
  else if (guidance?.encounterAnchors?.length) turns = guidance.encounterAnchors.filter((turn) => turn?.trim());
  return turns.map(cleanText).filter(Boolean);
}

function normalizeTurnPipeline(
  ep: SeasonEpisode,
  turns: string[],
  seasonSynopses?: Record<number, string>,
): string[] {
  let pipeline = turns;
  if (isAuthoredLiteEpisode(ep)) {
    pipeline = filterAuthoredLiteEpisodeTurns(pipeline, ep.episodeNumber);
    if (seasonSynopses) {
      pipeline = filterEpisodeScopedTurns(pipeline, ep.episodeNumber, seasonSynopses);
    }
    pipeline = coalesceFragmentedEpisodeTurns(pipeline);
  }
  pipeline = splitCompoundSpatialEpisodeTurns(pipeline);
  // Decompose compound conditionals BEFORE chronology sort so test/bond lines
  // get distinct ranks (test < bond) instead of stable-sorting as one unit.
  pipeline = decomposeTreatmentTurns(pipeline);
  if (isAuthoredLiteEpisode(ep)) {
    pipeline = orderAuthoredEpisodeTurns(pipeline);
    // Kind-aware tie-break: when ranks collide, prefer test before bond.
    pipeline = [...pipeline].sort((a, b) => {
      const rankDelta = chronologyRankForText(a) - chronologyRankForText(b);
      if (rankDelta !== 0) return rankDelta;
      const kindA = inferUnitKind(a);
      const kindB = inferUnitKind(b);
      if (kindA === 'test' && kindB === 'bond') return -1;
      if (kindA === 'bond' && kindB === 'test') return 1;
      if (kindA === 'late_night_writing' && kindB === 'aftermath') return -1;
      if (kindA === 'aftermath' && kindB === 'late_night_writing') return 1;
      return 0;
    });
  }
  return pipeline;
}

export function compileEpisodeSpine(
  ep: SeasonEpisode,
  context: CompileEpisodeSpineContext = {},
  seasonSynopses?: Record<number, string>,
): EpisodeSpineContract | undefined {
  if (!ep.treatmentGuidance) return undefined;

  const locations = ep.locations ?? [];
  const episodeStoryCircleBeats = storyCircleRoleBeats(ep.storyCircleRole);
  const turns = normalizeTurnPipeline(ep, rawEpisodeTurns(ep), seasonSynopses);
  if (turns.length === 0) return undefined;
  const polarityFacets = collectPolarityFacets(ep, context);

  const draftUnits: Array<{ id: string; kind: SpineUnitKind }> = [];
  const units: EpisodeSpineUnit[] = turns.map((text, order) => {
    const kind = inferUnitKind(text);
    const id = `ep${ep.episodeNumber}-u${order + 1}`;
    draftUnits.push({ id, kind });
    const encounterProfile = inferEncounterProfile(text, kind);
    const sceneKind = kind === 'set_piece' && isSpineEncounterText(text) ? 'encounter' : 'standard';
    return {
      id,
      order,
      text,
      kind,
      locationId: inferLocationId(text, locations),
      storyCircleFacets: episodeStoryCircleBeats.length > 0
        ? [episodeStoryCircleBeats[Math.min(order, episodeStoryCircleBeats.length - 1)]]
        : [],
      polarityFacet: polarityFacets[0],
      prerequisites: [],
      encounterProfile,
      sceneKind,
    };
  });

  for (let i = 0; i < units.length; i += 1) {
    units[i].prerequisites = buildPrerequisites(draftUnits, i, units[i].kind);
  }

  return {
    episodeNumber: ep.episodeNumber,
    sourceHash: hashSource(ep, turns),
    episodeStoryCircleBeats,
    episodeCircle: episodeCircleSlice(episodeStoryCircleBeats, context.seasonStoryCircle),
    polarityFacets,
    units,
  };
}

export function compileSeasonSpine(
  episodes: SeasonEpisode[],
  context: CompileEpisodeSpineContext = {},
): SeasonSpineContract {
  const seasonSynopses: Record<number, string> = {};
  for (const ep of episodes) {
    seasonSynopses[ep.episodeNumber] = [
      ep.synopsis,
      ep.title,
      ...(ep.treatmentGuidance?.episodeTurns ?? []),
    ].filter(Boolean).join(' ');
  }
  const episodeSpines: Record<number, EpisodeSpineContract> = {};
  for (const ep of episodes) {
    const spine = compileEpisodeSpine(ep, context, seasonSynopses);
    if (spine) episodeSpines[ep.episodeNumber] = spine;
  }
  return { episodeSpines };
}

export function spineTurnTexts(spine: EpisodeSpineContract): string[] {
  return spine.units.map((unit) => unit.text);
}
