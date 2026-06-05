import { describe, expect, it } from 'vitest';
import { synthesizeTreatmentGuidance } from './synthesizeTreatmentGuidance';
import type { SeasonPlan, SeasonEpisode } from '../../types/seasonPlan';

function episode(num: number, opts: Partial<SeasonEpisode> = {}): SeasonEpisode {
  return {
    episodeNumber: num,
    title: `Episode ${num}`,
    synopsis: `Synopsis ${num}`,
    sourceChapters: [],
    sourceSummary: '',
    plotPoints: [],
    mainCharacters: [],
    supportingCharacters: [],
    locations: [],
    estimatedSceneCount: 5,
    estimatedChoiceCount: 3,
    structuralRole: ['hook'],
    narrativeFunction: { setup: '', conflict: '', resolution: '' },
    status: 'planned',
    dependsOn: [],
    setupsForEpisodes: [],
    resolvesPlotsFrom: [],
    introducesCharacters: [],
    ...opts,
  } as SeasonEpisode;
}

function plan(episodes: SeasonEpisode[], arcs: SeasonPlan['arcs'] = []): SeasonPlan {
  return { episodes, arcs } as unknown as SeasonPlan;
}

describe('synthesizeTreatmentGuidance', () => {
  it('fills missing guidance from synopsis, arc, and plot points', () => {
    const ep = episode(2, {
      plotPoints: [
        { id: 'p1', description: 'The betrayal lands', type: 'twist', importance: 'major', targetEpisode: 2, charactersInvolved: [] },
        { id: 'p2', description: 'A door opens', type: 'rising_action', importance: 'minor', targetEpisode: 3, charactersInvolved: [] },
      ],
    });
    const p = plan([ep], [
      { id: 'a1', name: 'The Descent', description: '', episodeRange: { start: 1, end: 3 }, keyMoments: [], status: 'not_started', completionPercentage: 0 },
    ]);

    const count = synthesizeTreatmentGuidance(p);
    expect(count).toBe(1);
    expect(ep.treatmentGuidance?.arcLabel).toBe('The Descent');
    expect(ep.treatmentGuidance?.synopsis).toBe('Synopsis 2');
    // Only the plot point targeting THIS episode becomes a turn.
    expect(ep.treatmentGuidance?.episodeTurns).toEqual(['The betrayal lands']);
  });

  it('leaves authored guidance untouched', () => {
    const ep = episode(1, { treatmentGuidance: { authoredTitle: 'Hand-authored' } });
    const count = synthesizeTreatmentGuidance(plan([ep]));
    expect(count).toBe(0);
    expect(ep.treatmentGuidance?.authoredTitle).toBe('Hand-authored');
  });
});
