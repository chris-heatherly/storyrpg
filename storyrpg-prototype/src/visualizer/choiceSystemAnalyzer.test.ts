import { describe, expect, it } from 'vitest';
import type { Choice, Story } from '../types';
import { transformStoryToGraph } from './storyGraphTransformer';
import {
  DEFAULT_CHOICE_SYSTEM_FILTERS,
  enrichStoryGraphWithChoiceSystems,
  shouldShowEdge,
  summarizeChoice,
} from './choiceSystemAnalyzer';

function makeStory(choice: Choice): Story {
  return {
    id: 'story-1',
    metadata: { id: 'story-1', title: 'Test', genre: 'fantasy' } as any,
    title: 'Test',
    genre: 'fantasy',
    synopsis: '',
    npcs: [{ id: 'mara', name: 'Mara' } as any],
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        title: 'Episode 1',
        synopsis: '',
        scenes: [
          {
            id: 'scene-a',
            title: 'Scene A',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                text: 'Beat 1',
                choices: [choice],
              } as any,
              { id: 'beat-2', text: 'Beat 2' } as any,
            ],
          } as any,
        ],
      } as any,
    ],
  } as any;
}

describe('choiceSystemAnalyzer', () => {
  it('extracts relationship gates and relationship consequences', () => {
    const summary = summarizeChoice({
      id: 'choice-1',
      text: 'Trust Mara',
      choiceType: 'relationship',
      nextBeatId: 'beat-2',
      conditions: { type: 'relationship', npcId: 'mara', dimension: 'trust', operator: '>=', value: 25 },
      consequences: [{ type: 'relationship', npcId: 'mara', dimension: 'respect', change: 10 }],
    });

    expect(summary.facets).toContain('relationship');
    expect(summary.relationshipNpcIds).toEqual(['mara']);
    expect(summary.conditions[0].authorLabel).toContain('Mara Trust >= 25');
    expect(summary.effects[0].authorLabel).toContain('Mara Respect +10');
    expect(summary.playerSummary).toContain('Mara remembers this');
  });

  it('extracts stat conditions and stat checks without leaking numbers in player copy', () => {
    const summary = summarizeChoice({
      id: 'choice-1',
      text: 'Force the door',
      choiceType: 'strategic',
      nextBeatId: 'beat-2',
      conditions: { type: 'attribute', attribute: 'courage', operator: '>=', value: 40 },
      statCheck: { attribute: 'resolve', difficulty: 65 },
    });

    expect(summary.facets).toContain('stat');
    expect(summary.conditions[0].authorLabel).toBe('Courage >= 40');
    expect(summary.check?.authorLabel).toBe('tests Resolve (65)');
    expect(summary.playerSummary).not.toMatch(/\d/);
    expect(summary.check?.playerLabel).not.toMatch(/\d/);
  });

  it('extracts delayed callbacks, memorable moments, and residue hints', () => {
    const summary = summarizeChoice({
      id: 'choice-1',
      text: 'Spare the herald',
      nextBeatId: 'beat-2',
      delayedConsequences: [
        {
          description: 'Mara mentions mercy later',
          consequence: { type: 'setFlag', flag: 'spared_herald', value: true },
        },
      ],
      memorableMoment: { id: 'spared-herald', summary: 'You spared the herald.' },
      residueHints: [{ kind: 'relationship_behavior', description: 'Mara softens.', targetNpcId: 'mara' }],
    } as any);

    expect(summary.facets).toContain('delayed');
    expect(summary.hasDelayedCallback).toBe(true);
    expect(summary.effects.map((effect) => effect.kind)).toEqual(
      expect.arrayContaining(['delayed', 'memory', 'residue']),
    );
  });

  it('tolerates legacy consequences with missing optional fields', () => {
    const summary = summarizeChoice({
      id: 'choice-legacy',
      text: 'Follow the old thread',
      consequences: [
        { type: 'relationship', change: 1 },
        { type: 'skill', change: 1 },
        { type: 'setFlag', value: true },
        { type: 'removeItem' },
      ],
    } as any);

    expect(summary.effects.map((effect) => effect.authorLabel)).toEqual(
      expect.arrayContaining([
        'Relationship Affinity +1',
        'Skill +1',
        'Story Flag set',
        'removes Item',
      ]),
    );
  });

  it('preserves compound condition summaries and nested condition facts', () => {
    const summary = summarizeChoice({
      id: 'choice-1',
      text: 'Reveal the plan',
      nextBeatId: 'beat-2',
      conditions: {
        type: 'and',
        conditions: [
          { type: 'relationship', npcId: 'mara', dimension: 'trust', operator: '>=', value: 30 },
          {
            type: 'not',
            condition: { type: 'flag', flag: 'betrayed_mara', value: true },
          },
        ],
      },
    });

    expect(summary.conditions.some((condition) => condition.kind === 'compound')).toBe(true);
    expect(summary.conditions.some((condition) => condition.kind === 'relationship')).toBe(true);
    expect(summary.conditions.some((condition) => condition.kind === 'flag')).toBe(true);
  });

  it('enriches graph nodes, edges, and npc overlay summaries', () => {
    const story = makeStory({
      id: 'choice-1',
      text: 'Trust Mara',
      choiceType: 'relationship',
      nextBeatId: 'beat-2',
      conditions: { type: 'relationship', npcId: 'mara', dimension: 'trust', operator: '>=', value: 25 },
      consequences: [{ type: 'relationship', npcId: 'mara', dimension: 'respect', change: 10 }],
    });

    const graph = enrichStoryGraphWithChoiceSystems(story, transformStoryToGraph(story));
    const node = graph.nodes.find((candidate) => candidate.choiceSystem?.choices.length);
    const edge = graph.edges.find((candidate) => candidate.choiceSystem?.choiceId === 'choice-1');

    expect(node?.choiceSystem?.badges.some((badge) => badge.facet === 'relationship')).toBe(true);
    expect(edge?.choiceSystem?.relationshipNpcIds).toEqual(['mara']);
    expect(graph.choiceSystem?.npcs[0].dimensions.trust.gates).toBe(1);
    expect(graph.choiceSystem?.npcs[0].dimensions.respect.effects).toBe(1);
  });

  it('filters locked paths while npc overlays remain highlight-only', () => {
    const story = makeStory({
      id: 'choice-1',
      text: 'Trust Mara',
      choiceType: 'relationship',
      nextBeatId: 'beat-2',
      conditions: { type: 'relationship', npcId: 'mara', dimension: 'trust', operator: '>=', value: 25 },
    });
    const graph = enrichStoryGraphWithChoiceSystems(story, transformStoryToGraph(story));
    const edge = graph.edges.find((candidate) => candidate.choiceSystem?.choiceId === 'choice-1');

    expect(edge).toBeTruthy();
    expect(shouldShowEdge(edge!, { ...DEFAULT_CHOICE_SYSTEM_FILTERS, showLockedPaths: false })).toBe(false);
    expect(shouldShowEdge(edge!, undefined, 'other-npc')).toBe(true);
  });

  it('uses concise effect labels for choice edges instead of internal route summaries', () => {
    const story = makeStory({
      id: 'choice-1',
      text: 'Answer carefully',
      nextBeatId: 'beat-2',
      consequences: [{ type: 'setFlag', flag: 'composed_response', value: true }],
    } as any);

    const graph = enrichStoryGraphWithChoiceSystems(story, transformStoryToGraph(story));
    const edge = graph.edges.find((candidate) => candidate.choiceSystem?.choiceId === 'choice-1');

    expect(edge?.choiceSystem?.authorLabel).toBe('Composed Response');
  });
});
