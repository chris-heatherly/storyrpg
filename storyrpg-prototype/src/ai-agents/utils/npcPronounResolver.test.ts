import { describe, it, expect } from 'vitest';
import { findNpcPronounInconsistencies } from './npcPronounResolver';
import type { Story } from '../../types';

const ROSTER = [
  { id: 'char-captain-rorik-thorne', name: 'Captain Rorik Thorne', pronouns: 'he/him' },
  { id: 'char-lysandra-brightwell', name: 'Lysandra Brightwell', pronouns: 'she/her' },
  { id: 'char-vraxxan', name: 'Vraxxan', pronouns: 'he/him' },
  { id: 'char-sentinel-oracle', name: 'The Oracle', pronouns: 'they/them' },
];

function storyWith(beatTexts: string[]): Story {
  return {
    id: 's', title: 't', genre: 'fantasy', synopsis: '', coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: ROSTER as never,
    episodes: [{
      id: 'ep-3', number: 3, title: 'E3', synopsis: '', coverImage: '',
      startingSceneId: 's3-6',
      scenes: [{
        id: 's3-6', name: 'War Council', startingBeatId: 'b1',
        beats: beatTexts.map((text, i) => ({ id: `b${i + 1}`, text })),
      }],
    }],
  } as unknown as Story;
}

describe('findNpcPronounInconsistencies', () => {
  it('flags a he/him NPC narrated with they/their (Thorne G10 case)', () => {
    const res = findNpcPronounInconsistencies(
      storyWith(['Thorne braces both hands on the map, the shadow-wound dark at their shoulder.']),
    );
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].npcId).toBe('char-captain-rorik-thorne');
    expect(res.findings[0].wrongPronoun.toLowerCase()).toBe('their');
  });

  it('flags a he/him NPC narrated with she/her', () => {
    const res = findNpcPronounInconsistencies(
      storyWith('Vraxxan smiles. Her voice is cold.'.split('|')),
    );
    // "Her voice is cold" names no NPC; only the sentence naming Vraxxan + wrong pronoun flags.
    const res2 = findNpcPronounInconsistencies(
      storyWith(['Vraxxan lifts her hand and the shadows still.']),
    );
    expect(res2.findings).toHaveLength(1);
    expect(res2.findings[0].wrongPronoun.toLowerCase()).toBe('her');
    void res;
  });

  it('does NOT flag correct pronouns', () => {
    const res = findNpcPronounInconsistencies(
      storyWith(['Thorne lifts his gaze from the map.', 'Lysandra steadies her cup.']),
    );
    expect(res.findings).toHaveLength(0);
  });

  it('does NOT flag a they/them NPC narrated with they/their', () => {
    const res = findNpcPronounInconsistencies(
      storyWith(['The Oracle inclines their head, and their voice fills the chamber.']),
    );
    expect(res.findings).toHaveLength(0);
  });

  it('does NOT flag group "they" with a plural antecedent cue', () => {
    const res = findNpcPronounInconsistencies(
      storyWith(['Thorne rallies the soldiers; they hold the breach as the wall buckles.']),
    );
    expect(res.findings).toHaveLength(0);
  });

  it('skips multi-person sentences (ambiguous attribution)', () => {
    const res = findNpcPronounInconsistencies(
      storyWith(['Thorne looks at Lysandra and her jaw tightens.']),
    );
    expect(res.findings).toHaveLength(0);
  });

  it('skips sentences that address the protagonist ("you")', () => {
    const res = findNpcPronounInconsistencies(
      storyWith(['You watch Thorne, and their shoulder sags under the weight.']),
    );
    expect(res.findings).toHaveLength(0);
  });
});
