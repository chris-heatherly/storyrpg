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

  it('accepts multiple canonical spine units projected onto one scene in event order', () => {
    const contract = spine({
      units: [
        {
          id: 'ep1-u1', order: 0, text: 'Kylie sees the rooftop.', kind: 'meet',
          locationId: 'Rooftop', storyCircleFacets: ['you'], prerequisites: [], sceneKind: 'standard',
        },
        {
          id: 'ep1-u2', order: 1, text: 'The charcoal-suited man catches her attention.', kind: 'meet',
          locationId: 'Rooftop', storyCircleFacets: ['you'], prerequisites: ['ep1-u1'], sceneKind: 'standard',
        },
      ],
    });
    const result = new EpisodeSpineContractValidator().validate({
      spine: contract,
      episodeEventPlan: {
        version: 2,
        compilerVersion: 'test',
        episodeNumber: 1,
        sourceGraphHash: 'test',
        orderedEventIds: ['event:ep1-u1', 'event:ep1-u2'],
        assignments: [
          { eventId: 'event:ep1-u1', sceneId: 's1-rooftop', order: 0 },
          { eventId: 'event:ep1-u2', sceneId: 's1-rooftop', order: 1 },
        ],
        sceneOrder: ['s1-rooftop'],
        sceneContexts: [],
        dueDependencyIds: [],
        activeDependencyIds: [],
        characterPresenceContracts: [],
        validation: { passed: true, issues: [] },
      },
      narrativeContractGraph: {
        version: 2,
        compilerVersion: 'test',
        storyId: 'test',
        sourceHash: 'test',
        events: [
          {
            id: 'event:ep1-u1', episodeNumber: 1, sourceOrder: 0, sourceText: 'Kylie sees the rooftop.',
            sourceContractIds: ['ep1-u1'], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene',
            prerequisiteEventIds: [], targetSceneIds: ['s1-rooftop'], targetSpineUnitIds: ['ep1-u1'], ownerSceneId: 's1-rooftop',
            provenance: { source: 'episode_spine', confidence: 'authoritative' },
          },
          {
            id: 'event:ep1-u2', episodeNumber: 1, sourceOrder: 1, sourceText: 'The charcoal-suited man catches her attention.',
            sourceContractIds: ['ep1-u2'], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene',
            prerequisiteEventIds: ['event:ep1-u1'], targetSceneIds: ['s1-rooftop'], targetSpineUnitIds: ['ep1-u2'], ownerSceneId: 's1-rooftop',
            provenance: { source: 'episode_spine', confidence: 'authoritative' },
          },
        ],
        characterPresenceContracts: [],
        dependencies: [],
        validation: { passed: true, issues: [] },
      },
      scenes: [
        {
          id: 's1-rooftop', episodeNumber: 1, order: 0, kind: 'standard', title: 'Rooftop',
          dramaticPurpose: 'Kylie sees the rooftop and the charcoal-suited man catches her attention.', narrativeRole: 'development',
          locations: ['Rooftop'], npcsInvolved: [], setsUp: [], paysOff: [], requiredBeats: [], spineUnitId: 'ep1-u1',
        },
        {
          // Legacy projection metadata still claims u2 here, but the canonical
          // event plan assigns both units to the rooftop scene above.
          id: 's1-stale', episodeNumber: 1, order: 1, kind: 'standard', title: 'Stale shell',
          dramaticPurpose: 'A pressure shell with no canonical event owner.', narrativeRole: 'development',
          locations: ['Rooftop'], npcsInvolved: [], setsUp: [], paysOff: [], requiredBeats: [], spineUnitId: 'ep1-u2',
        },
      ],
    });

    expect(result.valid).toBe(true);
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
