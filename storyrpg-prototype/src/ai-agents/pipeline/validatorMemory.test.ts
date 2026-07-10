import { describe, expect, it } from 'vitest';

import { memoryEvidenceModeForValidator } from '../validators/validatorRegistry';
import { buildValidatorEvidenceRequest } from './validatorMemory';

describe('validatorMemory', () => {
  it('uses registry defaults for final blocking validators', () => {
    const request = buildValidatorEvidenceRequest(
      'FinalStoryContractValidator',
      'final-contract',
      { story: { title: 'Story' }, episode: { number: 1, title: 'Pilot', synopsis: '', startingLocation: '' }, protagonist: { id: 'p1', name: 'Hero', description: '' }, npcs: [], userPrompt: '' } as any,
    );
    expect(request.evidenceMode).toBe(memoryEvidenceModeForValidator('FinalStoryContractValidator'));
    expect(request.recallMode).toBe('facts-first');
    expect(request.factKinds).toContain('validator-failure');
  });
});
