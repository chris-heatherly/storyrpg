import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import { stripProtagonistFromEncounters } from './encounterProtagonistGuard';

function storyWithEncounter(enc: Record<string, unknown>): Story {
  return {
    episodes: [{ id: 'ep1', scenes: [{ id: 's1', beats: [], encounter: enc }] }],
  } as unknown as Story;
}

describe('stripProtagonistFromEncounters (G12)', () => {
  it('removes the protagonist from npcStates by display name AND char-id', () => {
    const story = storyWithEncounter({
      id: 'e1',
      npcStates: [
        { npcId: 'Kylie Marinescu', initialDisposition: 'wary' },
        { npcId: 'char-kylie-marinescu', initialDisposition: 'wary' },
        { npcId: 'Mika Drăgan', initialDisposition: 'warm' },
      ],
    });
    const r = stripProtagonistFromEncounters(story, { id: 'char-kylie-marinescu', name: 'Kylie Marinescu' });
    expect(r.npcStatesRemoved).toBe(2);
    const enc = (story.episodes[0].scenes[0] as { encounter?: { npcStates?: Array<{ npcId: string }> } }).encounter!;
    expect(enc.npcStates!.map((s) => s.npcId)).toEqual(['Mika Drăgan']);
  });

  it('drops relationship consequences paying the protagonist, deep in the choice tree', () => {
    const story = storyWithEncounter({
      id: 'e1',
      phases: [{
        beats: [{
          choices: [{
            outcomes: {
              success: {
                consequences: [
                  { type: 'relationship', npcId: 'char-kylie-marinescu', dimension: 'affection', change: 20 },
                  { type: 'relationship', npcId: 'char-mika-drgan', dimension: 'trust', change: 5 },
                  { type: 'setFlag', flag: 'x', value: true },
                ],
              },
            },
          }],
        }],
      }],
    });
    const r = stripProtagonistFromEncounters(story, { id: 'char-kylie-marinescu', name: 'Kylie Marinescu' });
    expect(r.relationshipConsequencesRemoved).toBe(1);
    const enc = (story.episodes[0].scenes[0] as { encounter?: Record<string, never> }).encounter as never as {
      phases: Array<{ beats: Array<{ choices: Array<{ outcomes: { success: { consequences: Array<{ type: string; npcId?: string }> } } }> }> }>;
    };
    const remaining = enc.phases[0].beats[0].choices[0].outcomes.success.consequences;
    expect(remaining).toHaveLength(2);
    expect(remaining.some((c) => c.npcId === 'char-kylie-marinescu')).toBe(false);
  });

  it('never strips when given only the documentParser placeholder identity', () => {
    const story = storyWithEncounter({
      id: 'e1',
      npcStates: [{ npcId: 'Kylie Marinescu', initialDisposition: 'wary' }],
    });
    const r = stripProtagonistFromEncounters(story, { id: 'protagonist', name: 'The Hero' });
    expect(r.npcStatesRemoved).toBe(0);
  });

  it('is idempotent', () => {
    const story = storyWithEncounter({
      id: 'e1',
      npcStates: [{ npcId: 'Kylie Marinescu' }, { npcId: 'Stela Pavel' }],
    });
    const ident = { name: 'Kylie Marinescu' };
    stripProtagonistFromEncounters(story, ident);
    const r2 = stripProtagonistFromEncounters(story, ident);
    expect(r2.npcStatesRemoved).toBe(0);
    expect(r2.relationshipConsequencesRemoved).toBe(0);
  });
});
