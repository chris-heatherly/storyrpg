import { describe, it, expect } from 'vitest';
import {
  detectAnonymousPlantStaging,
  ensembleObligationsFromContractText,
  forbiddenNpcNames,
  introducedNpcIds,
  isIntroducedNpc,
  npcIdsNamedInProse,
  plannedIntroductionsForEpisode,
  resolveCharacterIntroMode,
  resolveEnsembleNpcIdsFromText,
} from './npcIntroductionLedger';

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
    expect(isIntroducedNpc(met, 'char-stela')).toBe(true);
    // Scheduled for THIS episode and not yet staged → not met yet.
    expect(isIntroducedNpc(met, 'char-victor')).toBe(false);
    // Unscheduled roster member past episode 1 → assumed met.
    expect(isIntroducedNpc(met, 'char-mika')).toBe(true);
  });

  it('treats episode 1 with no plan data as nobody-met until staged', () => {
    const met = introducedNpcIds({
      episodeNumber: 1,
      rosterNpcIds: roster.map((c) => c.id),
      alreadyStagedNpcIds: ['char-stela'],
    });
    expect(isIntroducedNpc(met, 'char-stela')).toBe(true);
    expect(isIntroducedNpc(met, 'char-victor')).toBe(false);
  });

  it('bridges id vocabularies: display names, char- prefixes, and bare slugs are one character', () => {
    const met = introducedNpcIds({
      episodeNumber: 1,
      rosterNpcIds: roster.map((c) => c.id),
      // Planned cast uses the display name; queries use the roster id.
      alreadyStagedNpcIds: ['Stela Pavel'],
    });
    expect(isIntroducedNpc(met, 'char-stela-pavel')).toBe(true);
    expect(isIntroducedNpc(met, 'stela-pavel')).toBe(true);
    expect(isIntroducedNpc(met, 'char-victor')).toBe(false);
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

describe('npcIdsNamedInProse', () => {
  const fullRoster = [
    { id: 'char-stela-pavel', name: 'Stela Pavel' },
    { id: 'char-victor-valcescu', name: 'Victor Vâlcescu' },
    { id: 'char-mika-dragan', name: 'Mika Dragan' },
  ];

  it('detects an NPC named in prose even when cast metadata omits them (storyrpg-lite 2026-07-04 s1-2)', () => {
    const prose = "Inside, the air smells of aging paper. 'Bun venit, I'm Stela,' the woman says.";
    expect(npcIdsNamedInProse(prose, fullRoster)).toEqual(['char-stela-pavel']);
  });

  it('matches full names accent-insensitively', () => {
    const prose = 'Victor Valcescu steps between you and the dark.';
    expect(npcIdsNamedInProse(prose, fullRoster)).toEqual(['char-victor-valcescu']);
  });

  it('returns nothing when no roster NPC is named', () => {
    const prose = 'A woman with hair like spun obsidian looks up from her work.';
    expect(npcIdsNamedInProse(prose, fullRoster)).toEqual([]);
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

  it('dedupes alias slugs from introducesCharacters against the roster', () => {
    const biteMeRoster = [
      { id: 'victor-valcescu', name: 'Victor Valcescu' },
      { id: 'mika-dragan', name: 'Mika Dragan' },
      { id: 'stela-pavel', name: 'Stela Pavel' },
      { id: 'radu-stoian', name: 'Radu Stoian' },
    ];
    const intros = plannedIntroductionsForEpisode({
      episodeNumber: 1,
      roster: biteMeRoster,
      protagonistId: 'kylie-marinescu',
      introducesCharacters: [
        'char-victor-valcescu-mr-midnight',
        'char-radu-stoian-the-mountain',
        'char-mika-dragan-the-samantha',
        'char-stela-pavel',
        'char-victor-valcescu',
        'char-radu-stoian',
        'char-mika-dragan',
      ],
      characterIntroductions: [
        { characterId: 'kylie-marinescu', characterName: 'Kylie Marinescu', introducedInEpisode: 1, role: 'protagonist' },
        { characterId: 'victor-valcescu', characterName: 'Victor Valcescu', introducedInEpisode: 1, role: 'antagonist' },
        { characterId: 'mika-dragan', characterName: 'Mika Dragan', introducedInEpisode: 1, role: 'ally' },
        { characterId: 'stela-pavel', characterName: 'Stela Pavel', introducedInEpisode: 1, role: 'ally' },
      ],
    });
    expect(intros.map((entry) => entry.id).sort()).toEqual([
      'mika-dragan',
      'radu-stoian',
      'stela-pavel',
      'victor-valcescu',
    ]);
  });
});

describe('detectAnonymousPlantStaging / resolveCharacterIntroMode', () => {
  it('detects stranger / charcoal-suit / rescuer staging without a roster name as anonymous_plant', () => {
    const staging =
      'In the park at 1am a stranger in a charcoal suit intervenes — the rescuer pulls you free of the shadow.';
    expect(detectAnonymousPlantStaging({ characterName: 'Victor Valcescu', stagingText: staging })).toBe(true);
    expect(resolveCharacterIntroMode({ characterName: 'Victor Valcescu', stagingText: staging })).toBe('anonymous_plant');
  });

  it('returns named when staging clearly introduces them by roster name', () => {
    const staging = 'In Cișmigiu Gardens at 1am, the shadow pins Kylie before Victor Valcescu intervenes.';
    expect(detectAnonymousPlantStaging({ characterName: 'Victor Valcescu', stagingText: staging })).toBe(false);
    expect(resolveCharacterIntroMode({ characterName: 'Victor Valcescu', stagingText: staging })).toBe('named');
  });

  it('returns named when staging uses a distinctive first name', () => {
    const staging = 'Victor steps between you and the dark, charcoal suit catching the streetlight.';
    expect(resolveCharacterIntroMode({ characterName: 'Victor Valcescu', stagingText: staging })).toBe('named');
  });

  it('returns named when there are no anonymous descriptors', () => {
    const staging = 'A woman with silver-streaked hair sets down her glass and offers a hand.';
    expect(detectAnonymousPlantStaging({ characterName: 'Stela Pavel', stagingText: staging })).toBe(false);
    expect(resolveCharacterIntroMode({ characterName: 'Stela Pavel', stagingText: staging })).toBe('named');
  });
});

describe('resolveEnsembleNpcIdsFromText / ensembleObligationsFromContractText', () => {
  it('binds named multi-party friendship beats to roster ids', () => {
    const fullRoster = [
      { id: 'char-mika', name: 'Mika Dragan' },
      { id: 'char-stela', name: 'Stela Pavel' },
      { id: 'char-kylie', name: 'Kylie Marinescu' },
    ];
    const ids = resolveEnsembleNpcIdsFromText({
      stagingText: 'At the club, Mika, Stela, and Kylie become friends and toast the night.',
      roster: fullRoster,
      excludeIds: ['char-kylie'],
    });
    expect(ids.sort()).toEqual(['char-mika', 'char-stela']);
  });

  it('ignores collective cues that do not name roster members', () => {
    const ids = resolveEnsembleNpcIdsFromText({
      stagingText: 'The three become friends over drinks.',
      roster: [
        { id: 'char-mika', name: 'Mika Dragan' },
        { id: 'char-stela', name: 'Stela Pavel' },
      ],
    });
    expect(ids).toEqual([]);
  });

  it('derives ensemble obligations from planned contract text', () => {
    const obligations = ensembleObligationsFromContractText({
      plannedSceneContractText: new Map([
        ['s1-3', 'Mika and Stela become friends with the newcomer at Valescu Club.'],
        ['s1-4', 'A quiet walk home alone.'],
      ]),
      roster: [
        { id: 'char-mika', name: 'Mika Dragan' },
        { id: 'char-stela', name: 'Stela Pavel' },
      ],
    });
    expect(obligations).toHaveLength(1);
    expect(obligations[0].sceneId).toBe('s1-3');
    expect(obligations[0].requiredNpcIds.sort()).toEqual(['char-mika', 'char-stela']);
  });
});
