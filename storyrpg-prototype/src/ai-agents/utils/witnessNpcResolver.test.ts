import { describe, it, expect } from 'vitest';
import { resolveWitnessNpcId, canonicalizeStoryWitnessReactions, canonicalizeWitnessReactions, ensureWitnessNpcsInScenes } from './witnessNpcResolver';

// Roster mirrors a real bite-me run's story.npcs (canonical char- ids).
const ROSTER = [
  { id: 'char-mihaela-mika-drgan', name: "Mihaela 'Mika' Drăgan" },
  { id: 'char-carmen-iliescu', name: 'Carmen Iliescu' },
  { id: 'char-radu-stoian', name: 'Radu Stoian' },
  { id: 'char-andrei-vlcescu', name: 'Andrei Vâlcescu' },
  { id: 'char-lena-marinescu', name: 'Lena Marinescu' },
];

describe('resolveWitnessNpcId', () => {
  it('resolves a short nickname slug via unique name-token overlap', () => {
    expect(resolveWitnessNpcId('mika', ROSTER)).toBe('char-mihaela-mika-drgan');
  });

  it('resolves a first-name slug via unique token', () => {
    expect(resolveWitnessNpcId('carmen', ROSTER)).toBe('char-carmen-iliescu');
    expect(resolveWitnessNpcId('radu', ROSTER)).toBe('char-radu-stoian');
    expect(resolveWitnessNpcId('andrei', ROSTER)).toBe('char-andrei-vlcescu');
  });

  it('resolves a full display name via normalized equality (diacritics stripped)', () => {
    expect(resolveWitnessNpcId('Andrei Vâlcescu', ROSTER)).toBe('char-andrei-vlcescu');
    expect(resolveWitnessNpcId("Mihaela 'Mika' Drăgan", ROSTER)).toBe('char-mihaela-mika-drgan');
  });

  it('passes an already-canonical id through unchanged', () => {
    expect(resolveWitnessNpcId('char-radu-stoian', ROSTER)).toBe('char-radu-stoian');
  });

  it('returns undefined for a genuinely unknown NPC', () => {
    expect(resolveWitnessNpcId('dorin', ROSTER)).toBeUndefined();
  });

  it('returns undefined for an ambiguous shared surname (no mis-bind)', () => {
    const dupRoster = [
      { id: 'char-lena-marinescu', name: 'Lena Marinescu' },
      { id: 'char-kylie-marinescu', name: 'Kylie Marinescu' },
    ];
    expect(resolveWitnessNpcId('marinescu', dupRoster)).toBeUndefined();
  });
});

describe('canonicalizeStoryWitnessReactions', () => {
  const makeStory = () => ({
    npcs: ROSTER,
    episodes: [
      {
        scenes: [
          {
            id: 's1-3',
            beats: [
              { id: 'b1', choices: [
                { id: 'choice-warm-open', witnessReactions: [{ npcId: 'mika', reactionText: 'x' }] },
              ] },
            ],
            choices: [
              { id: 'choice-1', witnessReactions: [
                { npcId: 'carmen', reactionText: 'y' },
                { npcId: 'dorin', reactionText: 'z' },        // unknown -> dropped
                { npcId: 'char-radu-stoian', reactionText: 'w' }, // already canonical
              ] },
            ],
          },
        ],
      },
    ],
  });

  it('remaps resolvable ids and drops unknowns across all nesting levels', () => {
    const story = makeStory();
    const res = canonicalizeStoryWitnessReactions(story);
    expect(res.total).toBe(4);
    expect(res.remapped).toBe(2); // mika, carmen
    expect(res.dropped).toBe(1);  // dorin

    const beatChoice = story.episodes[0].scenes[0].beats[0].choices[0];
    expect(beatChoice.witnessReactions[0].npcId).toBe('char-mihaela-mika-drgan');

    const sceneChoice = story.episodes[0].scenes[0].choices[0];
    expect(sceneChoice.witnessReactions.map((w: any) => w.npcId)).toEqual([
      'char-carmen-iliescu',
      'char-radu-stoian',
    ]);
  });

  it('is idempotent (second pass changes nothing)', () => {
    const story = makeStory();
    canonicalizeStoryWitnessReactions(story);
    const res2 = canonicalizeStoryWitnessReactions(story);
    expect(res2.remapped).toBe(0);
    expect(res2.dropped).toBe(0);
  });

  it('no-ops when there is no authoritative roster', () => {
    const story = { npcs: [], episodes: [{ scenes: [{ id: 's1', choices: [{ id: 'c', witnessReactions: [{ npcId: 'mika' }] }] }] }] };
    const res = canonicalizeStoryWitnessReactions(story);
    expect(res).toEqual({ total: 0, remapped: 0, dropped: 0 });
    expect(story.episodes[0].scenes[0].choices[0].witnessReactions[0].npcId).toBe('mika');
  });
});

describe('canonicalizeWitnessReactions on raw choiceSets (pre-episode-validation path)', () => {
  it('canonicalizes witnessReactions on a choiceSets array against an explicit roster', () => {
    // Mirrors prepareValidationInput: choiceSets + roster from characterBible.characters.
    const choiceSets = [
      { sceneId: 's1-3', choices: [{ id: 'choice-warm-open', witnessReactions: [{ npcId: 'mika', reactionText: 'x' }] }] },
      { sceneId: 's1-4', choices: [{ id: 'choice-1', witnessReactions: [{ npcId: 'carmen' }, { npcId: 'dorin' }] }] },
    ];
    const res = canonicalizeWitnessReactions(choiceSets, ROSTER);
    expect(res).toEqual({ total: 3, remapped: 2, dropped: 1 });
    expect(choiceSets[0].choices[0].witnessReactions[0].npcId).toBe('char-mihaela-mika-drgan');
    expect(choiceSets[1].choices[0].witnessReactions.map((w: any) => w.npcId)).toEqual(['char-carmen-iliescu']);
  });
});

describe('ensureWitnessNpcsInScenes', () => {
  const KNOWN = new Set(ROSTER.map((r) => r.id));

  it('adds a known witness NPC to its scene roster (resolved by beatId)', () => {
    const scenes = [{ sceneId: 's1-1', beats: [{ id: 'b1' }], charactersInvolved: ['char-radu-stoian'] }];
    const choiceSets = [{ beatId: 'b1', choices: [{ witnessReactions: [{ npcId: 'char-carmen-iliescu' }] }] }];
    const res = ensureWitnessNpcsInScenes(scenes, choiceSets, KNOWN);
    expect(res.added).toBe(1);
    expect(scenes[0].charactersInvolved).toContain('char-carmen-iliescu');
  });

  it('resolves the scene by explicit choice.sceneId when present', () => {
    const scenes = [{ sceneId: 's1-3', beats: [], charactersInvolved: [] }];
    const choiceSets = [{ choices: [{ sceneId: 's1-3', witnessReactions: [{ npcId: 'char-mihaela-mika-drgan' }] }] }];
    const res = ensureWitnessNpcsInScenes(scenes, choiceSets, KNOWN);
    expect(res.added).toBe(1);
    expect(scenes[0].charactersInvolved).toEqual(['char-mihaela-mika-drgan']);
  });

  it('does not duplicate an NPC already in the roster', () => {
    const scenes = [{ sceneId: 's1', beats: [{ id: 'b1' }], charactersInvolved: ['char-carmen-iliescu'] }];
    const choiceSets = [{ beatId: 'b1', choices: [{ witnessReactions: [{ npcId: 'char-carmen-iliescu' }] }] }];
    const res = ensureWitnessNpcsInScenes(scenes, choiceSets, KNOWN);
    expect(res.added).toBe(0);
    expect(scenes[0].charactersInvolved).toEqual(['char-carmen-iliescu']);
  });

  it('never adds an unknown NPC (not in the roster)', () => {
    const scenes = [{ sceneId: 's1', beats: [{ id: 'b1' }], charactersInvolved: [] }];
    const choiceSets = [{ beatId: 'b1', choices: [{ witnessReactions: [{ npcId: 'char-ghost' }] }] }];
    const res = ensureWitnessNpcsInScenes(scenes, choiceSets, KNOWN);
    expect(res.added).toBe(0);
    expect(scenes[0].charactersInvolved).toEqual([]);
  });

  it('creates charactersInvolved when the scene lacks it', () => {
    const scenes = [{ sceneId: 's1', beats: [{ id: 'b1' }] } as any];
    const choiceSets = [{ beatId: 'b1', choices: [{ witnessReactions: [{ npcId: 'char-radu-stoian' }] }] }];
    const res = ensureWitnessNpcsInScenes(scenes, choiceSets, KNOWN);
    expect(res.added).toBe(1);
    expect(scenes[0].charactersInvolved).toEqual(['char-radu-stoian']);
  });
});
