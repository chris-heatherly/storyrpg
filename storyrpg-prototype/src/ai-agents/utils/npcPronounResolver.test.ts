import { describe, it, expect } from 'vitest';
import { findNpcPronounInconsistencies, findInternalPronounConflicts } from './npcPronounResolver';
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

  // ── G10 precision guards (2026-06-09 audit): kill the dominant false-positive classes ──

  it('does NOT scan the NPC-roster bio subtree (a bio names other cast)', () => {
    // Thorne's own description narrates him while merely mentioning Lysandra; the old walk
    // matched Lysandra (she/her) + "his" and false-flagged. The roster subtree is skipped.
    const story = storyWith(['A quiet scene.']) as unknown as { npcs: Array<Record<string, unknown>> };
    story.npcs[1] = {
      id: 'char-lysandra-brightwell', name: 'Lysandra Brightwell', pronouns: 'she/her',
      description: 'A commander who fought beside Lysandra and never lowered his guard.',
    };
    const res = findNpcPronounInconsistencies(story as unknown as Story);
    expect(res.findings).toHaveLength(0);
  });

  it('skips when the pronoun precedes the NPC name (name is not the antecedent)', () => {
    const res = findNpcPronounInconsistencies(
      storyWith(['His blade already drawn, the figure turns out to be Lysandra.']),
    );
    expect(res.findings).toHaveLength(0);
  });

  it('skips when an unnamed third party can be the referent', () => {
    const res = findNpcPronounInconsistencies(
      storyWith(['Lysandra watches the stranger leave, wondering where he learned to move like that.']),
    );
    expect(res.findings).toHaveLength(0);
  });

  it('skips a dialogue speaker tag (the pronoun is the speaker, not the named NPC)', () => {
    const res = findNpcPronounInconsistencies(
      storyWith(["'Vraxxan,' she says, naming the thing in the dark."]),
    );
    expect(res.findings).toHaveLength(0);
  });

  it('still flags a real misgendering once the guards pass', () => {
    const res = findNpcPronounInconsistencies(
      storyWith(['Lysandra tightens his jaw and steps onto the rampart.']),
    );
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].npcId).toBe('char-lysandra-brightwell');
  });
});

describe('findInternalPronounConflicts (roster-independent)', () => {
  it('flags an undeclared character narrated with conflicting genders (Stela case)', () => {
    // Stela is NOT in the roster, so findNpcPronounInconsistencies cannot see her.
    const conflicts = findInternalPronounConflicts(
      storyWith([
        'Mika watches as Stela tilts her head, weighing the offer.',
        'Stela cracks a smile; his eyes never warm, though.',
      ]),
    );
    const stela = conflicts.find((c) => c.name === 'Stela');
    expect(stela).toBeDefined();
    expect(stela!.genders).toEqual(expect.arrayContaining(['f', 'm']));
  });

  it('does not flag a character referred to consistently', () => {
    const conflicts = findInternalPronounConflicts(
      storyWith([
        'Mika tilts her head, weighing the offer.',
        'Mika cracks a smile; her eyes never warm, though.',
      ]),
    );
    expect(conflicts.find((c) => c.name === 'Mika')).toBeUndefined();
  });
});
