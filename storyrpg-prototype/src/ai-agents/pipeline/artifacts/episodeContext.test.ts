import { describe, expect, it } from 'vitest';
import type { Episode } from '../../../types';
import { buildEpisodeContextIn, deriveEpisodeContextOut } from './episodeContext';

const episode = (): Episode => ({
  id: 'ep-1',
  number: 1,
  title: 'Episode 1',
  synopsis: 'Test',
  coverImage: '',
  scenes: [
    {
      id: 's1',
      name: 'Opening',
      beats: [
        {
          id: 'b1',
          text: 'A promise is made.',
          callbackHookIds: ['promise-a'],
          choices: [
            {
              id: 'choice-1',
              text: 'Trust Mara',
              nextSceneId: 's2',
              conditions: { type: 'flag', flag: 'met_mara', value: true },
              consequences: [
                { type: 'relationship', npcId: 'mara', dimension: 'trust', change: 5 },
                { type: 'setFlag', flag: 'arc:courage:bold', value: true },
                { type: 'changeScore', score: 'reputation', change: 1 },
                { type: 'addTag', tag: 'protector' },
              ],
            },
          ],
        },
        {
          id: 'b2',
          text: 'The promise returns.',
          textVariants: [
            {
              condition: { type: 'flag', flag: 'arc:courage:bold', value: true },
              callbackHookId: 'promise-a',
              text: 'Mara remembers.',
            },
          ],
          choices: [],
        },
      ],
      startingBeatId: 'b1',
      branchType: 'hopeful',
    },
  ],
  startingSceneId: 's1',
}) as Episode;

describe('episode context artifacts', () => {
  it('derives gameplay, branch, callback, NPC, and arc residue from a runtime episode', () => {
    const contextOut = deriveEpisodeContextOut({ storyId: 'story', episode: episode() });

    expect(contextOut.callbackPlants.map((o) => o.id)).toContain('promise-a');
    expect(contextOut.callbackPayoffs.map((o) => o.id)).toContain('promise-a');
    expect(contextOut.branchOutcomes.map((o) => o.id)).toEqual(expect.arrayContaining(['branch:s1', 'choice-1']));
    expect(contextOut.relationshipDeltas).toContainEqual({ npcId: 'mara', dimension: 'trust', change: 5, sourceChoiceId: 'choice-1' });
    expect(contextOut.identityDeltas).toContainEqual({ axis: 'courage', direction: 'bold', sourceChoiceId: 'choice-1' });
    expect(contextOut.flagsIntroduced).toContain('arc:courage:bold');
    expect(contextOut.flagsConsumed).toContain('met_mara');
    expect(contextOut.scoresChanged).toContain('reputation');
    expect(contextOut.tagsIntroduced).toContain('protector');
  });

  it('builds the next context from prior unresolved obligations and state residue', () => {
    const previous = deriveEpisodeContextOut({ storyId: 'story', episode: episode() });
    previous.unresolvedObligations.push({
      id: 'npc-debt',
      kind: 'npc_payoff',
      description: 'Mara is owed a payoff.',
      sourceEpisode: 1,
      dueEpisode: 2,
      targetNpcId: 'mara',
    });

    const contextIn = buildEpisodeContextIn({ storyId: 'story', episodeNumber: 2, previousContextOut: previous });

    expect(contextIn.npcPayoffObligations.map((o) => o.id)).toContain('npc-debt');
    expect(contextIn.flags).toContain('arc:courage:bold');
    expect(contextIn.visibleConsequences).toContain('mara:trust:5');
    expect(contextIn.previousEpisodeHandoff).toBe('s1/b2');
  });
});
