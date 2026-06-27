import { describe, expect, it } from 'vitest';

import { planAgentMemoryQueries, planValidatorMemoryQueries } from './memoryQueryPlanner';

describe('MemoryQueryPlanner', () => {
  it('plans granular facts-first SceneWriter queries', () => {
    const plans = planAgentMemoryQueries({
      agentRole: 'SceneWriter',
      lifecycle: 'scene-authoring',
      storyId: 'Bite Me',
      episodeNumber: 2,
      sceneId: 'scene-4',
      artifactKinds: ['episode-blueprint', 'scene-content'],
    });

    expect(plans.length).toBeGreaterThan(1);
    expect(plans.flatMap((plan) => plan.factKinds || [])).toEqual(expect.arrayContaining([
      'scene-canon',
      'episode-canon',
      'callback-obligation',
      'residue-obligation',
      'source-obligation',
      'validator-failure',
    ]));
    expect(plans[0].query).toContain('scene scene-4');
    expect(plans[0].query).toContain('artifact kinds episode-blueprint, scene-content');
  });

  it('keeps validator evidence queries fact scoped', () => {
    const plans = planValidatorMemoryQueries({
      validator: 'TreatmentFidelityValidator',
      lifecycle: 'final-contract',
      storyId: 'Bite Me',
      artifactKinds: ['source-analysis', 'story-json'],
      evidenceMode: 'corroborated-evidence',
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].factKinds).toEqual(expect.arrayContaining([
      'validator-failure',
      'repair-learning',
      'source-obligation',
    ]));
    expect(plans[0].query).toContain('TreatmentFidelityValidator final-contract');
  });
});
