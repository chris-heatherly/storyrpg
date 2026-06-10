import { describe, it, expect } from 'vitest';
import { forbiddenNpcNames, introducedNpcIds, plannedIntroductionsForEpisode } from './npcIntroductionLedger';

const roster = [
  { id: 'char-victor', name: 'Victor Vâlcescu' },
  { id: 'char-stela', name: 'Stela' },
  { id: 'char-mika', name: 'Mika' },
];

describe('introducedNpcIds', () => {
  it('counts plan-scheduled earlier-episode introductions as met', () => {
    const met = introducedNpcIds({
      episodeNumber: 3,
      rosterNpcIds: roster.map((c) => c.id),
      characterIntroductions: [
        { characterId: 'char-stela', introducedInEpisode: 1 },
        { characterId: 'char-victor', introducedInEpisode: 3 },
      ],
      alreadyStagedNpcIds: [],
    });
    expect(met.has('char-stela')).toBe(true);
    // Scheduled for THIS episode and not yet staged → not met yet.
    expect(met.has('char-victor')).toBe(false);
    // Unscheduled roster member past episode 1 → assumed met.
    expect(met.has('char-mika')).toBe(true);
  });

  it('treats episode 1 with no plan data as nobody-met until staged', () => {
    const met = introducedNpcIds({
      episodeNumber: 1,
      rosterNpcIds: roster.map((c) => c.id),
      alreadyStagedNpcIds: ['char-stela'],
    });
    expect(met.has('char-stela')).toBe(true);
    expect(met.has('char-victor')).toBe(false);
  });

  it('falls back to all-met for later episodes with no plan data', () => {
    const met = introducedNpcIds({
      episodeNumber: 2,
      rosterNpcIds: roster.map((c) => c.id),
      alreadyStagedNpcIds: [],
    });
    expect(met.size).toBe(roster.length);
  });
});

describe('forbiddenNpcNames', () => {
  it('bans unmet, off-cast roster names only', () => {
    const banned = forbiddenNpcNames({
      roster,
      introduced: new Set(['char-stela']),
      sceneCastIds: ['char-mika'],
    });
    expect(banned).toEqual(['Victor Vâlcescu']);
  });
});

describe('plannedIntroductionsForEpisode', () => {
  it('unions episode introducesCharacters with plan characterIntroductions, resolving names', () => {
    const intros = plannedIntroductionsForEpisode({
      episodeNumber: 2,
      roster,
      introducesCharacters: ['Stela'],
      characterIntroductions: [
        { characterId: 'char-victor', characterName: 'Victor Vâlcescu', introducedInEpisode: 2 },
        { characterId: 'char-mika', introducedInEpisode: 1 },
      ],
    });
    expect(intros).toEqual([
      { id: 'char-stela', name: 'Stela' },
      { id: 'char-victor', name: 'Victor Vâlcescu' },
    ]);
  });
});
