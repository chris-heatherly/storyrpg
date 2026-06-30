import { describe, expect, it } from 'vitest';

import { authoredInformationLedgerEntries, parseInformationLedgerGuidance } from './informationLedgerContracts';

const SECTION = `
- **INFO-A: Mika is a succubus contracted to Victor's coven, placed in Kylie's life before she arrived.**
  - What it is: Mika was made/contracted in 1968 and has been "running into" Kylie since the sublet was signed; she set up the rooftop bar and the cab breakdown, steering Kylie toward Victor while genuinely loving her.
  - Audience/player knowledge state: Selective — tells shown as comic glamour from ep 1, recontextualized as dramatic irony, fully revealed to Kylie in ep 7.
  - Who knows: Mika, Victor, Stela (suspects from ep 5/6).
  - Who does not know: Kylie (until she reads the tells or ep 7).
  - Tension mode: dramatic irony → revelation.
  - Introduced episode: 1. Setup touch episodes: 2, 3, 4, 6. Planned reveal/payoff episode: 7 (confession), 8 (salt circle).
  - Opened question IDs: Q1 (who is steering Kylie, and can the friendship survive the truth). Closed question IDs: closes Q1 at the salt circle.
  - Payoff plan: Gentle reading shifts Mika's loyalty and unlocks her freedom and the Witness ending.
`;

describe('informationLedgerContracts', () => {
  it('parses authored INFO blocks into structured guidance', () => {
    const guidance = parseInformationLedgerGuidance(SECTION);

    expect(guidance?.entries).toHaveLength(1);
    expect(guidance?.entries[0]).toMatchObject({
      id: 'INFO-A',
      label: "Mika is a succubus contracted to Victor's coven, placed in Kylie's life before she arrived.",
      introducedEpisode: 1,
      setupTouchEpisodes: [2, 3, 4, 6],
      plannedRevealEpisode: 7,
      plannedPayoffEpisode: 8,
      opensQuestionIds: ['Q1'],
      closesQuestionIds: ['Q1'],
    });
    expect(guidance?.entries[0].knownByNames).toEqual(expect.arrayContaining(['Mika', 'Victor']));
    expect(guidance?.entries[0].withheldFromNames).toEqual(['Kylie']);
  });

  it('converts authored guidance into durable ledger metadata', () => {
    const entries = authoredInformationLedgerEntries({
      totalEstimatedEpisodes: 8,
      treatmentSeasonGuidance: {
        informationLedger: SECTION,
      },
    }, 8);

    expect(entries).toHaveLength(1);
    expect(entries[0].authoredId).toBe('INFO-A');
    expect(entries[0].sourceText).toContain('What it is');
    expect(entries[0].factualAtoms?.some((atom) => atom.phase === 'reveal' && atom.text.includes('1968'))).toBe(true);
    expect(entries[0].setupTouchDetails?.map((touch) => touch.episodeNumber)).toEqual([1, 2, 3, 4, 6]);
    expect(entries[0].namedKnowledge?.knownByNames).toEqual(expect.arrayContaining(['Mika', 'Victor']));
  });
});
