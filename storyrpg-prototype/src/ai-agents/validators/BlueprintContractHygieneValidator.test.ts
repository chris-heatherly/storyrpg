import { describe, expect, it } from 'vitest';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { BlueprintContractHygieneValidator } from './BlueprintContractHygieneValidator';

function blueprint(scene: Record<string, unknown>): EpisodeBlueprint {
  return {
    episodeId: 'ep1',
    title: 'Synthetic',
    synopsis: '',
    arc: { hook: '', plotTurn1: '', pinch1: '', midpoint: '', pinch2: '', climax: '', resolution: '' },
    themes: [],
    scenes: [scene],
    startingSceneId: String(scene.id || 's1'),
    bottleneckScenes: [],
    suggestedFlags: [],
    suggestedScores: [],
    suggestedTags: [],
    narrativePromises: [],
  } as unknown as EpisodeBlueprint;
}

describe('BlueprintContractHygieneValidator', () => {
  it('blocks raw third-person synopsis cards in scene contract fields', () => {
    const report = new BlueprintContractHygieneValidator().validate(blueprint({
      id: 's1',
      name: 'Opening',
      description: 'Jordan, a guarded engineer, arrives in the capital to start over.',
      dramaticQuestion: 'Can Jordan find the missing map?',
      narrativeFunction: 'setup',
      keyBeats: [],
      npcsPresent: [],
      leadsTo: [],
    }));

    expect(report.passed).toBe(false);
    expect(report.blockingIssues[0]?.type).toBe('raw_synopsis_card');
  });

  it('blocks generic choice scaffolds before SceneWriter sees them', () => {
    const report = new BlueprintContractHygieneValidator().validate(blueprint({
      id: 's2',
      name: 'Choice',
      description: 'A room changes.',
      dramaticQuestion: 'What changes?',
      narrativeFunction: 'turn',
      keyBeats: [],
      npcsPresent: [],
      leadsTo: [],
      choicePoint: {
        type: 'strategic',
        description: 'Choose how the protagonist responds to the pressure already mounting.',
        stakes: { want: 'escape', cost: 'trust', identity: 'control' },
        optionHints: [],
      },
    }));

    expect(report.passed).toBe(false);
    expect(report.blockingIssues.some((issue) => issue.type === 'generic_choice_scaffold')).toBe(true);
  });
});
