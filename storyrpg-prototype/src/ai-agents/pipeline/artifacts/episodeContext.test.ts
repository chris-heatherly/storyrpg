import { describe, expect, it } from 'vitest';
import { deriveEpisodeContextOut } from './episodeContext';
import type { Episode } from '../../../types';
import type { NarrativeContractGraph } from '../../../types/narrativeContract';

describe('deriveEpisodeContextOut', () => {
  it('ignores malformed consequences without throwing while deriving context artifacts', () => {
    const episode = {
      id: 'ep-test',
      number: 1,
      title: 'Test',
      scenes: [
        {
          id: 'scene-1',
          name: 'Scene 1',
          beats: [
            {
              id: 'beat-1',
              text: 'You choose.',
              choices: [
                {
                  id: 'choice-1',
                  text: 'Act',
                  consequences: [
                    { type: 'setFlag', value: true },
                    { type: 'setScore', value: 2 },
                    { type: 'addTag' },
                    { type: 'relationship', dimension: 'trust', change: 1 },
                    { type: 'setFlag', flag: 'valid_flag', value: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Episode;

    const contextOut = deriveEpisodeContextOut({ storyId: 'story', episode });

    expect(contextOut.flagsIntroduced).toEqual(['valid_flag']);
    expect(contextOut.scoresChanged).toEqual([]);
    expect(contextOut.tagsIntroduced).toEqual([]);
    expect(contextOut.relationshipDeltas).toEqual([]);
  });

  it('records a downstream payoff as resolved while preserving the upstream event as local history only', () => {
    const graph: NarrativeContractGraph = {
      version: 1,
      compilerVersion: 'test',
      storyId: 'story',
      sourceHash: 'graph-hash',
      events: [
        { id: 'ep1-rescue', episodeNumber: 1, sourceOrder: 0, sourceText: 'Rescue', sourceContractIds: ['rescue'], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [], targetSceneIds: ['s1'], targetSpineUnitIds: [], ownerSceneId: 's1', provenance: { source: 'episode_spine', confidence: 'authoritative' } },
        { id: 'ep3-discovery', episodeNumber: 3, sourceOrder: 0, sourceText: 'Discovery', sourceContractIds: ['discovery'], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [], targetSceneIds: ['s3'], targetSpineUnitIds: [], ownerSceneId: 's3', provenance: { source: 'episode_spine', confidence: 'authoritative' } },
      ],
      dependencies: [{ id: 'dep-rescue-payoff', fromEventId: 'ep1-rescue', toEventId: 'ep3-discovery', relation: 'pays_off', sourceEpisodeNumber: 1, targetEpisodeNumbers: [3], targetSceneIds: ['s3'], branchConditionKeys: [], requiredSurfaces: ['scene_turn'], priority: 'major', sourceContractIds: ['rescue'] }],
      characterPresenceContracts: [],
      validation: { passed: true, issues: [] },
    };
    const contextOut = deriveEpisodeContextOut({
      storyId: 'story',
      episode: { id: 'ep3', number: 3, title: 'Three', scenes: [{ id: 's3', name: 'Discovery', beats: [], sceneEventOwnership: { ownedEvents: [{ key: 'ep3-discovery', eventContractId: 'ep3-discovery', text: 'Discovery', cue: 'blogAftermath', sourceContractIds: [] }] } }] } as unknown as Episode,
      contextIn: { storyId: 'story', episodeNumber: 3, canonFacts: [], activeCharacterArcs: [], npcPayoffObligations: [], unresolvedCallbacks: [], informationObligations: [], branchAxes: [], visibleConsequences: [], encounterResidue: [], flags: [], scores: [], tags: [], visualContinuity: [], sourceTreatmentObligations: [], dueContractIds: ['dep-rescue-payoff'], activeContractIds: ['dep-rescue-payoff'] },
      graph,
    });
    expect(contextOut.materializedEventIds).toEqual(['ep3-discovery']);
    expect(contextOut.resolvedObligationIds).toEqual(['dep-rescue-payoff']);
    expect(contextOut.unresolvedObligations.some((obligation) => obligation.id === 'dep-rescue-payoff')).toBe(false);
  });
});
