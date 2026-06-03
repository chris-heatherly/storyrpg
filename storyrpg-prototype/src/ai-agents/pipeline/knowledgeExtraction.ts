/**
 * Episode knowledge extraction (Season Canon, Phase B2).
 *
 * Produces the structured facts + claims that populate the SeasonCanon at seal time
 * — the producer the seal plumbing was already waiting for (`sealAndPersistEpisode`
 * accepts `claims` + `extraDeltas` but nothing supplied them, so the canon held only
 * flag-derived + capability facts and the canon-consistency gate ran over zero claims).
 *
 * Deterministic seed (no new LLM call): reuse the QA bundles the pipeline already
 * builds — the per-character knowledge (`buildContinuityCharacterKnowledge`) and the
 * scene timeline (`buildContinuityTimeline`) — plus the flags this episode's beats
 * gate on. Keys (`factId`) are deterministic slugs per the seasonCanon contract so a
 * later reference to the same fact resolves across episodes.
 */

import type { EpisodeCanonDeltas } from './seasonCanon';
import type { KnowledgeClaim } from '../validators/canonConsistencyValidator';

export interface EpisodeKnowledgeInputs {
  episodeNumber: number;
  protagonistId: string;
  /** From buildContinuityCharacterKnowledge: what each character knows. */
  characterKnowledge?: Array<{ characterId: string; knows?: string[]; doesNotKnow?: string[] }>;
  /** From buildContinuityTimeline: ordered "what happens when". */
  timelineEvents?: Array<{ event: string; when: string }>;
  /** Flags this episode's beats/choices gate on (the basis for knowledge claims). */
  referencedFlags?: string[];
}

export interface EpisodeKnowledgeResult {
  /** worldFacts + knowledge to merge into the seal's extraDeltas. */
  deltas: EpisodeCanonDeltas;
  /** Claims for the canon-consistency gate (who references what, this episode). */
  claims: KnowledgeClaim[];
}

/** Deterministic slug for a factId (stable across episodes for the same statement). */
export function factSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'fact';
}

export function extractEpisodeKnowledge(input: EpisodeKnowledgeInputs): EpisodeKnowledgeResult {
  const worldFacts: NonNullable<EpisodeCanonDeltas['worldFacts']> = [];
  const knowledge: NonNullable<EpisodeCanonDeltas['knowledge']> = [];
  const claims: KnowledgeClaim[] = [];
  const seenWF = new Set<string>();
  const seenK = new Set<string>();
  const seenClaim = new Set<string>();

  // World facts from the scene timeline (bounded by scene count).
  for (const t of input.timelineEvents ?? []) {
    if (!t?.event) continue;
    const id = `wf:${factSlug(t.event)}`;
    if (seenWF.has(id)) continue;
    seenWF.add(id);
    worldFacts.push({ id, statement: t.when ? `${t.when}: ${t.event}` : t.event });
  }

  // Knowledge: what each character knows → who-knows-what facts (bounded by roster).
  for (const ck of input.characterKnowledge ?? []) {
    if (!ck?.characterId) continue;
    for (const k of ck.knows ?? []) {
      if (!k) continue;
      const factId = `know:${factSlug(k)}`;
      const key = `${ck.characterId}|${factId}`;
      if (seenK.has(key)) continue;
      seenK.add(key);
      knowledge.push({ characterId: ck.characterId, factId, summary: k });
    }
  }

  // Claims: each flag the episode gates on is referenced by the protagonist NOW. The
  // canon-consistency gate flags it impossible if that fact is established later.
  for (const flag of input.referencedFlags ?? []) {
    if (!flag) continue;
    const factId = `flag:${flag}`;
    const key = `${input.protagonistId}|${factId}`;
    if (seenClaim.has(key)) continue;
    seenClaim.add(key);
    claims.push({ characterId: input.protagonistId, factId, episode: input.episodeNumber, summary: `references ${flag}` });
  }

  return { deltas: { worldFacts, knowledge }, claims };
}

interface FlagCondishScene {
  beats?: Array<{
    conditions?: unknown;
    choices?: Array<{ conditions?: unknown; condition?: unknown }>;
    textVariants?: Array<{ condition?: unknown }>;
  }>;
}
interface FlagCondishEpisode {
  scenes?: FlagCondishScene[];
}

/** Pull the flag names referenced by any condition in the episode (beats/choices/variants). */
export function collectReferencedFlags(episode: FlagCondishEpisode | undefined): string[] {
  const flags = new Set<string>();
  const visit = (cond: unknown): void => {
    if (!cond || typeof cond !== 'object') return;
    const c = cond as { type?: string; flag?: string; conditions?: unknown[]; and?: unknown[]; or?: unknown[] };
    if (c.type === 'flag' && typeof c.flag === 'string') flags.add(c.flag);
    for (const arr of [c.conditions, c.and, c.or]) {
      if (Array.isArray(arr)) for (const sub of arr) visit(sub);
    }
  };
  for (const scene of episode?.scenes ?? []) {
    for (const beat of scene.beats ?? []) {
      visit(beat.conditions);
      for (const ch of beat.choices ?? []) { visit(ch.conditions); visit(ch.condition); }
      for (const v of beat.textVariants ?? []) visit(v.condition);
    }
  }
  return [...flags];
}
