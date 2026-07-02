import { describe, expect, it } from 'vitest';
import { StoryArchitect } from './StoryArchitect';
import type { EpisodeBlueprint } from './StoryArchitect';

const config = {
  provider: 'gemini' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0.1,
};

function repair(blueprint: EpisodeBlueprint): void {
  (new StoryArchitect(config) as unknown as {
    repairDramaticStructureCraft(blueprint: EpisodeBlueprint): void;
  }).repairDramaticStructureCraft(blueprint);
}

describe('StoryArchitect.repairDramaticStructureCraft', () => {
  // Live-run regression: the architecture craft gate aborted the episode on
  // residue typed "flags" (not in the enum) and a missing pressurePeak —
  // both deterministically repairable without an LLM retry.
  it('normalizes residue-type aliases like "flags" to enum values', () => {
    const blueprint = {
      scenes: [{
        id: 'scene-1',
        residue: [
          { type: 'flags', description: 'The guild notification flag is set.' },
          { type: 'danger', description: 'The corridor is now watched.' },
        ],
      }],
    } as unknown as EpisodeBlueprint;

    repair(blueprint);

    expect(blueprint.scenes[0].residue?.map((item) => item.type)).toEqual(['information', 'danger']);
  });

  it('defaults a missing pressurePeak from the scene turn', () => {
    const blueprint = {
      scenes: [{
        id: 'scene-1',
        dramaticStructure: {
          question: 'Can the crew still trust the plan?',
          turn: 'Marcus pockets the keycard instead of handing it over.',
          pressurePeak: '',
          changedState: 'The crew knows the plan has a seam.',
        },
      }],
    } as unknown as EpisodeBlueprint;

    repair(blueprint);

    expect(blueprint.scenes[0].dramaticStructure?.pressurePeak)
      .toBe('Marcus pockets the keycard instead of handing it over.');
  });

  it('leaves valid residue and populated pressurePeak untouched', () => {
    const blueprint = {
      scenes: [{
        id: 'scene-1',
        residue: [{ type: 'promise', description: 'A favor is owed.' }],
        dramaticStructure: {
          question: 'q',
          turn: 't',
          pressurePeak: 'the standoff at the vault door',
          changedState: 'c',
        },
      }],
    } as unknown as EpisodeBlueprint;

    repair(blueprint);

    expect(blueprint.scenes[0].residue?.[0].type).toBe('promise');
    expect(blueprint.scenes[0].dramaticStructure?.pressurePeak).toBe('the standoff at the vault door');
  });
});
