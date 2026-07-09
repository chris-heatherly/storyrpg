import { describe, expect, it } from 'vitest';
import { EpisodeSpineContractValidator } from './EpisodeSpineContractValidator';
import type { EpisodeSpineContract } from '../../types/episodeSpine';

function spine(overrides: Partial<EpisodeSpineContract> = {}): EpisodeSpineContract {
  return {
    episodeNumber: 1,
    sourceHash: 'abc',
    episodeStoryCircleBeats: ['you'],
    polarityFacets: [],
    units: [{
      id: 'ep1-u1',
      order: 0,
      text: 'She arrives in Bucharest.',
      kind: 'arrival',
      locationId: 'Bucharest',
      storyCircleFacets: ['you'],
      prerequisites: [],
      sceneKind: 'standard',
    }],
    ...overrides,
  };
}

describe('EpisodeSpineContractValidator', () => {
  it('passes a minimal valid spine', () => {
    const result = new EpisodeSpineContractValidator().validate({ spine: spine() });
    expect(result.valid).toBe(true);
  });

  it('fails bond units without test prerequisites', () => {
    const contract = spine({
      units: [
        {
          id: 'ep1-u1', order: 0, text: 'Friends form the Dusk Club.', kind: 'bond',
          locationId: 'Club', storyCircleFacets: ['you'], prerequisites: [], sceneKind: 'standard',
        },
      ],
    });
    const result = new EpisodeSpineContractValidator().validate({ spine: contract });
    expect(result.valid).toBe(true);
  });

  it('requires relationship pacing when group formation is staged', () => {
    const result = new EpisodeSpineContractValidator().validate({
      spine: spine(),
      scenes: [{
        id: 's1-3',
        episodeNumber: 1,
        order: 2,
        kind: 'standard',
        title: 'Club',
        dramaticPurpose: 'They form the Dusk Club together.',
        narrativeRole: 'development',
        locations: ['Club'],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
        requiredBeats: [],
      }],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('relationshipPacing'))).toBe(true);
  });

  it('fails when projected scene order inverts ESC unit order', () => {
    const contract = spine({
      units: [
        {
          id: 'ep1-u1', order: 0, text: 'Testing Kylie.', kind: 'test',
          locationId: 'Club', storyCircleFacets: ['you'], prerequisites: [], sceneKind: 'standard',
        },
        {
          id: 'ep1-u2', order: 1, text: 'Friends form the Dusk Club.', kind: 'bond',
          locationId: 'Club', storyCircleFacets: ['you'], prerequisites: ['ep1-u1'], sceneKind: 'standard',
        },
      ],
    });
    const result = new EpisodeSpineContractValidator().validate({
      spine: contract,
      scenes: [
        {
          id: 's1-bond', episodeNumber: 1, order: 0, kind: 'standard', title: 'Bond',
          dramaticPurpose: 'Club', narrativeRole: 'development', locations: ['Club'],
          npcsInvolved: [], setsUp: [], paysOff: [], requiredBeats: [], spineUnitId: 'ep1-u2',
          relationshipPacing: [{
            id: 'rp1',
            source: 'treatment',
            groupId: 'dusk-club',
            startStage: 'acquaintance',
            targetStage: 'friend',
            allowedLabels: ['friend'],
            blockedLabels: [],
            requiredEvidence: ['shared loyalty'],
            minScenesSinceIntroduction: 1,
            maxDeltaThisScene: 1,
            mechanicDimensions: ['trust'],
          }],
        },
        {
          id: 's1-test', episodeNumber: 1, order: 1, kind: 'standard', title: 'Test',
          dramaticPurpose: 'Test', narrativeRole: 'development', locations: ['Club'],
          npcsInvolved: [], setsUp: [], paysOff: [], requiredBeats: [], spineUnitId: 'ep1-u1',
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => /out of ESC order|prerequisite/i.test(issue.message))).toBe(true);
  });

  it('fails when a load-bearing spine unit has no projected scene', () => {
    const contract = spine({
      units: [
        {
          id: 'ep1-u1', order: 0, text: 'Testing Kylie.', kind: 'test',
          locationId: 'Club', storyCircleFacets: ['you'], prerequisites: [], sceneKind: 'standard',
        },
        {
          id: 'ep1-u2', order: 1, text: 'Friends form the Dusk Club.', kind: 'bond',
          locationId: 'Club', storyCircleFacets: ['you'], prerequisites: ['ep1-u1'], sceneKind: 'standard',
          obligations: [{ id: 'thread_setup-6', kind: 'thread_setup', text: 'Form the Dusk Club' }],
        },
      ],
    });
    const result = new EpisodeSpineContractValidator().validate({
      spine: contract,
      scenes: [{
        id: 's1-5', episodeNumber: 1, order: 0, kind: 'standard', title: 'Test',
        dramaticPurpose: 'Test', narrativeRole: 'development', locations: ['Club'],
        npcsInvolved: [], setsUp: [], paysOff: [], requiredBeats: [], spineUnitId: 'ep1-u1',
      }],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => /ep1-u2/.test(issue.message) && /no projected scene/i.test(issue.message))).toBe(true);
  });

  it('fails when bond projects before its test prerequisite scene', () => {
    const contract = spine({
      units: [
        {
          id: 'ep1-u1', order: 0, text: 'Testing Kylie.', kind: 'test',
          locationId: 'Club', storyCircleFacets: ['you'], prerequisites: [], sceneKind: 'standard',
        },
        {
          id: 'ep1-u2', order: 1, text: 'Friends form the Dusk Club.', kind: 'bond',
          locationId: 'Club', storyCircleFacets: ['you'], prerequisites: ['ep1-u1'], sceneKind: 'standard',
        },
      ],
    });
    const result = new EpisodeSpineContractValidator().validate({
      spine: contract,
      scenes: [
        {
          id: 's1-bond', episodeNumber: 1, order: 0, kind: 'standard', title: 'Bond',
          dramaticPurpose: 'They form the Dusk Club together.', narrativeRole: 'development',
          locations: ['Club'], npcsInvolved: [], setsUp: [], paysOff: [], requiredBeats: [],
          spineUnitId: 'ep1-u2',
          relationshipPacing: [{
            id: 'rp1', source: 'treatment', groupId: 'dusk-club',
            startStage: 'acquaintance', targetStage: 'friend',
            allowedLabels: ['friend'], blockedLabels: [], requiredEvidence: ['shared loyalty'],
            minScenesSinceIntroduction: 1, maxDeltaThisScene: 1, mechanicDimensions: ['trust'],
          }],
        },
        {
          id: 's1-test', episodeNumber: 1, order: 1, kind: 'standard', title: 'Test',
          dramaticPurpose: 'Test', narrativeRole: 'development', locations: ['Club'],
          npcsInvolved: [], setsUp: [], paysOff: [], requiredBeats: [], spineUnitId: 'ep1-u1',
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => /before test unit/i.test(issue.message) || /out of ESC order/i.test(issue.message))).toBe(true);
  });
});
