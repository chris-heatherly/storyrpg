import { describe, expect, it } from 'vitest';
import { deriveEpisodeContextOut } from './episodeContext';

function graphWithEvent() {
  return {
    events: [{
      id: 'event:writing', episodeNumber: 1, sourceOrder: 0,
      sourceText: 'Kylie writes the first post about the rescue.',
      realizationMode: 'depiction', ownerSceneId: 's1', evidenceRequirements: [],
    }],
    realizationTasks: [{
      id: 'task:event:writing:owner-event', contractId: 'event:writing', eventId: 'event:writing',
      episodeNumber: 1, ownerStage: 'scene_writer', repairHandler: 'scene_prose', sceneId: 's1',
      evidenceAtoms: [{ id: 'event:writing:source', description: 'writing', acceptedPatterns: ['Kylie writes the first post about the rescue.'], kind: 'semantic', required: true }],
      target: { scope: 'owner', surfaces: ['beat_text'] }, sourceContractIds: [], blocking: true,
    }],
    dependencies: [],
  } as any;
}

function episodeWithText(text: string): any {
  return {
    number: 1,
    scenes: [{
      id: 's1', beats: [{ id: 'b1', text }],
      sceneEventOwnership: { ownedEvents: [{ eventContractId: 'event:writing', text: 'Kylie writes the first post about the rescue.' }] },
    }],
  };
}

describe('deriveEpisodeContextOut canonical realization status', () => {
  it('does not mark a generic depiction event resolved from ownership metadata alone', () => {
    const output = deriveEpisodeContextOut({ storyId: 'story', episode: episodeWithText('Kylie walks home beneath the streetlights.'), graph: graphWithEvent() });
    expect(output.blockedEventIds).toEqual(['event:writing']);
    expect(output.materializedEventIds).toEqual([]);
  });

  it('materializes the event when owner-surface evidence is present', () => {
    const output = deriveEpisodeContextOut({ storyId: 'story', episode: episodeWithText('Kylie opens her laptop and writes the first post about the rescue.'), graph: graphWithEvent() });
    expect(output.materializedEventIds).toEqual(['event:writing']);
    expect(output.blockedEventIds).toEqual([]);
  });
});
