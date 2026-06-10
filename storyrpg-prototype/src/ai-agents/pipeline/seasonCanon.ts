/**
 * Season Canon store + freezer (Season Canon, Phase 3).
 *
 * The frozen, append-only "reality" of a season. Generation drifts when the same
 * fact is re-derived by multiple LLM calls, each guessing; the cure is to FREEZE
 * facts into a deterministic, read-only record as soon as an episode is validated
 * ("sealed"), and have every downstream prompt READ them rather than reinvent.
 *
 *   - sealEpisode(N, deltas): append episode N's established facts. Append-only —
 *     a fact's establishedEpisode is fixed; existing facts are never mutated, and
 *     re-sealing the same episode is rejected (immutability by construction).
 *   - canonForPrompt(asOfEpisode): a read-only snapshot of everything established
 *     up to and including an episode, formatted "ESTABLISHED CANON — do not
 *     contradict", served to SceneWriter/ChoiceAuthor.
 *   - knownAsOf(characterId, episode): the knowledge a character has acquired by
 *     a given episode (who-knows-what-when), the substrate for the
 *     canon-consistency / impossible-knowledge gate (see canonConsistencyValidator).
 *
 * Facts are keyed (factId) rather than free prose so consistency checks are
 * deterministic; the LLM extraction step (Phase 4 runner) assigns the keys. Pure
 * data + pure transforms; persistence (season-canon.json) is the runner's job.
 */

export interface CanonWorldFact {
  id: string;
  statement: string;
  establishedEpisode: number;
}

/** A discrete fact a character KNOWS, established as of an episode. */
export interface CanonKnowledgeEntry {
  characterId: string;
  factId: string;
  summary: string;
  asOfEpisode: number;
}

export interface CanonCharacterState {
  id: string;
  /** Sealed arc/identity state by episode (append-only per episode). */
  arcStateByEpisode: Record<number, string>;
}

export interface CanonRelationshipEntry {
  pairKey: string; // canonical "a|b" (sorted)
  dimension: string;
  valueByEpisode: Record<number, number>;
}

/** Structured facts extracted from a validated episode, ready to freeze. */
export interface EpisodeCanonDeltas {
  worldFacts?: Array<{ id: string; statement: string }>;
  knowledge?: Array<{ characterId: string; factId: string; summary: string }>;
  arcStates?: Array<{ characterId: string; state: string }>;
  relationships?: Array<{ a: string; b: string; dimension: string; value: number }>;
}

export interface SerializedSeasonCanon {
  version: 1;
  storyId?: string;
  sealedEpisodes: number[];
  worldFacts: CanonWorldFact[];
  knowledge: CanonKnowledgeEntry[];
  characters: CanonCharacterState[];
  relationships: CanonRelationshipEntry[];
}

export function relationshipPairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export class CanonSealError extends Error {}

export class SeasonCanon {
  private storyId?: string;
  private sealedEpisodes = new Set<number>();
  private worldFacts: CanonWorldFact[] = [];
  private knowledge: CanonKnowledgeEntry[] = [];
  private characters = new Map<string, CanonCharacterState>();
  private relationships = new Map<string, CanonRelationshipEntry>(); // key: pairKey + '::' + dimension

  constructor(options?: { storyId?: string }) {
    this.storyId = options?.storyId;
  }

  isSealed(episode: number): boolean {
    return this.sealedEpisodes.has(episode);
  }

  sealedEpisodeNumbers(): number[] {
    return [...this.sealedEpisodes].sort((a, b) => a - b);
  }

  /**
   * Freeze a validated episode's facts into canon. Append-only and idempotent-by-
   * rejection: re-sealing an episode throws (a sealed episode is never reopened).
   */
  sealEpisode(episode: number, deltas: EpisodeCanonDeltas): void {
    if (this.sealedEpisodes.has(episode)) {
      throw new CanonSealError(`Episode ${episode} is already sealed; sealed episodes are immutable.`);
    }
    for (const wf of deltas.worldFacts ?? []) {
      // Append-only: ignore a re-declared id (the first establishment stands).
      if (!this.worldFacts.some((f) => f.id === wf.id)) {
        this.worldFacts.push({ id: wf.id, statement: wf.statement, establishedEpisode: episode });
      }
    }
    for (const k of deltas.knowledge ?? []) {
      if (!this.knowledge.some((e) => e.characterId === k.characterId && e.factId === k.factId)) {
        this.knowledge.push({ characterId: k.characterId, factId: k.factId, summary: k.summary, asOfEpisode: episode });
      }
    }
    for (const a of deltas.arcStates ?? []) {
      const c = this.characters.get(a.characterId) ?? { id: a.characterId, arcStateByEpisode: {} };
      c.arcStateByEpisode[episode] = a.state;
      this.characters.set(a.characterId, c);
    }
    for (const r of deltas.relationships ?? []) {
      const pairKey = relationshipPairKey(r.a, r.b);
      const key = `${pairKey}::${r.dimension}`;
      const entry = this.relationships.get(key) ?? { pairKey, dimension: r.dimension, valueByEpisode: {} };
      entry.valueByEpisode[episode] = r.value;
      this.relationships.set(key, entry);
    }
    this.sealedEpisodes.add(episode);
  }

  /** All knowledge a character has acquired as of (<=) an episode. */
  knownAsOf(characterId: string, episode: number): CanonKnowledgeEntry[] {
    return this.knowledge.filter((e) => e.characterId === characterId && e.asOfEpisode <= episode);
  }

  /** Whether a character knows a fact (by id) as of an episode. */
  knows(characterId: string, factId: string, episode: number): boolean {
    return this.knowledge.some(
      (e) => e.characterId === characterId && e.factId === factId && e.asOfEpisode <= episode,
    );
  }

  /** The episode a fact became known to a character, or undefined if never. */
  knowledgeEstablishedEpisode(characterId: string, factId: string): number | undefined {
    return this.knowledge.find((e) => e.characterId === characterId && e.factId === factId)?.asOfEpisode;
  }

  worldFactsAsOf(episode: number): CanonWorldFact[] {
    return this.worldFacts.filter((f) => f.establishedEpisode <= episode);
  }

  /** Latest sealed arc state per character as of (<=) an episode. */
  arcStatesAsOf(episode: number): Array<{ characterId: string; episode: number; state: string }> {
    const out: Array<{ characterId: string; episode: number; state: string }> = [];
    for (const c of this.characters.values()) {
      const eps = Object.keys(c.arcStateByEpisode)
        .map(Number)
        .filter((n) => n <= episode);
      if (eps.length === 0) continue;
      const latest = Math.max(...eps);
      out.push({ characterId: c.id, episode: latest, state: c.arcStateByEpisode[latest] });
    }
    return out.sort((a, b) => a.characterId.localeCompare(b.characterId));
  }

  /** Latest sealed relationship value per pair+dimension as of (<=) an episode. */
  relationshipsAsOf(episode: number): Array<{ pairKey: string; dimension: string; episode: number; value: number }> {
    const out: Array<{ pairKey: string; dimension: string; episode: number; value: number }> = [];
    for (const r of this.relationships.values()) {
      const eps = Object.keys(r.valueByEpisode)
        .map(Number)
        .filter((n) => n <= episode);
      if (eps.length === 0) continue;
      const latest = Math.max(...eps);
      out.push({ pairKey: r.pairKey, dimension: r.dimension, episode: latest, value: r.valueByEpisode[latest] });
    }
    return out.sort((a, b) => a.pairKey.localeCompare(b.pairKey) || a.dimension.localeCompare(b.dimension));
  }

  /**
   * Read-only canon snapshot for prompt injection, established up to `asOfEpisode`
   * (defaults to everything). Marked as authoritative so downstream prompts treat
   * it as fixed. Includes the latest sealed character arc states and relationship
   * standings: prior-episode remediation may have shifted where a character landed,
   * and the writer of episode N must continue from the SEALED state, not the plan
   * (cross-episode arc drift otherwise).
   */
  canonForPrompt(asOfEpisode?: number): string {
    const cap = asOfEpisode ?? Number.MAX_SAFE_INTEGER;
    const facts = this.worldFacts.filter((f) => f.establishedEpisode <= cap);
    const know = this.knowledge.filter((e) => e.asOfEpisode <= cap);
    const arcs = this.arcStatesAsOf(cap);
    const rels = this.relationshipsAsOf(cap);
    if (facts.length === 0 && know.length === 0 && arcs.length === 0 && rels.length === 0) return '';
    const lines: string[] = ['ESTABLISHED CANON — do not contradict:'];
    for (const f of facts) lines.push(`- [ep${f.establishedEpisode}] ${f.statement}`);
    for (const e of know) lines.push(`- [ep${e.asOfEpisode}] ${e.characterId} knows: ${e.summary}`);
    for (const a of arcs) lines.push(`- [ep${a.episode}] ${a.characterId} arc state: ${a.state}`);
    for (const r of rels) {
      const [a, b] = r.pairKey.split('|');
      lines.push(`- [ep${r.episode}] relationship ${a} & ${b} — ${r.dimension} stands at ${r.value} (continue from this, not the plan)`);
    }
    return lines.join('\n');
  }

  serialize(): SerializedSeasonCanon {
    return {
      version: 1,
      storyId: this.storyId,
      sealedEpisodes: this.sealedEpisodeNumbers(),
      worldFacts: [...this.worldFacts],
      knowledge: [...this.knowledge],
      characters: [...this.characters.values()],
      relationships: [...this.relationships.values()],
    };
  }

  static deserialize(raw: SerializedSeasonCanon | string): SeasonCanon {
    const parsed: SerializedSeasonCanon = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const canon = new SeasonCanon({ storyId: parsed.storyId });
    for (const e of parsed.sealedEpisodes ?? []) canon.sealedEpisodes.add(e);
    canon.worldFacts = [...(parsed.worldFacts ?? [])];
    canon.knowledge = [...(parsed.knowledge ?? [])];
    for (const c of parsed.characters ?? []) canon.characters.set(c.id, c);
    for (const r of parsed.relationships ?? []) canon.relationships.set(`${r.pairKey}::${r.dimension}`, r);
    return canon;
  }
}
