/**
 * Episode turn firewall — reject turns/tokens that belong only to other
 * episodes' synopses (plus curated future-season patterns).
 */

import { isFutureSeasonEpisodeTurn } from './authoredLiteTurnFilter';

const PROPER_NOUN_RE = /\b([A-ZÀ-ÖØ-ÞȘȚĂÂÎ][\p{L}'’-]{2,}(?:\s+[A-ZÀ-ÖØ-ÞȘȚĂÂÎ][\p{L}'’-]{2,}){0,2})\b/gu;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9'\s]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 4),
  );
}

function extractProperNouns(text: string): string[] {
  const matches = text.match(PROPER_NOUN_RE) ?? [];
  return matches.map((match) => match.trim()).filter((match) => match.length >= 3);
}

/**
 * Drop episode turns that are future-season planning register OR whose
 * distinctive tokens appear only in other episodes' synopsis text.
 */
export function filterEpisodeScopedTurns(
  turns: string[],
  episodeNumber: number,
  episodeSynopses: Record<number, string>,
  totalEpisodes = 8,
): string[] {
  const ownSynopsis = episodeSynopses[episodeNumber] ?? '';
  const ownTokens = tokenize(ownSynopsis);
  const foreignTokens = new Set<string>();
  for (const [epRaw, synopsis] of Object.entries(episodeSynopses)) {
    const ep = Number(epRaw);
    if (ep === episodeNumber || !synopsis?.trim()) continue;
    for (const token of tokenize(synopsis)) {
      if (!ownTokens.has(token)) foreignTokens.add(token);
    }
  }

  return turns.filter((turn) => {
    if (isFutureSeasonEpisodeTurn(turn, episodeNumber, totalEpisodes)) return false;
    const turnTokens = tokenize(turn);
    if (turnTokens.size === 0) return true;
    // Reject when a majority of distinctive turn tokens are foreign-only.
    const foreignHits = [...turnTokens].filter((token) => foreignTokens.has(token));
    if (foreignHits.length >= 2 && foreignHits.length / turnTokens.size >= 0.5 && ownTokens.size > 0) {
      return false;
    }
    return true;
  });
}

/**
 * Strip proper nouns from next-episode pressure text for non-final SceneWriter
 * context so forward pressure cannot restage later-episode cast/locations.
 */
export function scrubNextEpisodePressureProperNouns(
  pressure: string | undefined,
  options: { isFinalScene?: boolean } = {},
): string | undefined {
  if (!pressure?.trim()) return pressure;
  if (options.isFinalScene) return pressure;
  let scrubbed = pressure;
  for (const noun of extractProperNouns(pressure)) {
    // Keep generic connectors; strip named entities that pull later-episode cast.
    if (/^(The|A|An|Next|Episode|Season)$/i.test(noun)) continue;
    scrubbed = scrubbed.replace(new RegExp(`\\b${noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), 'forward pressure');
  }
  return scrubbed.replace(/\s+/g, ' ').trim();
}
