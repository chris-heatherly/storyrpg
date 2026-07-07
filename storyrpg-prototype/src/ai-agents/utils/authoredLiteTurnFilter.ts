const FUTURE_SEASON_TURN_PATTERNS: RegExp[] = [
  /\bsecret\s+contract\b/i,
  /\bsuccubus\b/i,
  /\bbound\s+to\s+victor\b/i,
  /\bplaced\s+in\b.{0,80}\blife\s+before\b/i,
  /\bhunter'?s?\s+moon\b/i,
  /\bstrigoi\s+mama\b/i,
  /\bpricolici\b/i,
  /\bmirror\s+behind\s+victor\b/i,
  /\bradu'?s?\s+confession\b/i,
  /\bbest\s+friend\b.{0,80}\bbetrayal\b/i,
  /\bsalt\s+circle\b/i,
  /\bmountain\s+wife\b/i,
  /\bconsort\b/i,
  /\bcasa\s+lupului\b/i,
  /\bcasa\s+stelarum\b/i,
  /\blikely\s+consequence\b/i,
  /\bmajor\s+pressure\b/i,
  /\bstory\s+circle\s+role\b/i,
];

const EARLY_EPISODE_FUTURE_MARKERS: RegExp[] = [
  /\b(?:ep(?:isode)?\.?\s*)?[3-9]\b/i,
  /\blater\s+episode\b/i,
  /\bfinale\b/i,
  /\bseason\s+finale\b/i,
];

/**
 * Drop episode-turn atoms that belong to future episodes or non-playable
 * planning register (choice pressures mis-extracted as spine turns).
 */
export function isFutureSeasonEpisodeTurn(turn: string, episodeNumber: number, totalEpisodes = 8): boolean {
  const text = turn.trim();
  if (!text) return true;
  if (FUTURE_SEASON_TURN_PATTERNS.some((pattern) => pattern.test(text))) return true;

  const explicitEpisode = text.match(/\b(?:ep(?:isode)?\.?\s*#?\s*)(\d+)\b/i)?.[1];
  if (explicitEpisode && Number(explicitEpisode) !== episodeNumber) return true;

  if (episodeNumber <= 2 && EARLY_EPISODE_FUTURE_MARKERS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (episodeNumber < totalEpisodes && /\b(?:season[-\s]long|future payoff|next episode|later episode)\b/i.test(text)) {
    return true;
  }

  return false;
}

export function filterAuthoredLiteEpisodeTurns(
  turns: string[],
  episodeNumber: number,
  totalEpisodes = 8,
): string[] {
  return turns.filter((turn) => !isFutureSeasonEpisodeTurn(turn, episodeNumber, totalEpisodes));
}
