import { describe, expect, it } from 'vitest';
import type {
  AuthoredEventSemanticIR,
  NarrativeCharacterPresenceContract,
  NarrativeEventContract,
  NarrativeTransitionContract,
} from '../../types/narrativeContract';
import type { PlannedScene } from '../../types/scenePlan';
import {
  compileEncounterParticipationContracts,
  compileFirstAppearanceContracts,
  compileLexicalArtifactContracts,
  compileRouteRealizationContracts,
  compileSceneStateContracts,
} from './narrativeContinuityCompiler';

function scene(id: string, order: number, overrides: Partial<PlannedScene> = {}): PlannedScene {
  return {
    id,
    episodeNumber: 1,
    order,
    kind: 'standard',
    title: id,
    dramaticPurpose: `${id} changes the situation`,
    narrativeRole: 'development',
    locations: ['Apartment'],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    ...overrides,
  };
}

function event(id: string, sourceOrder: number, ownerSceneId: string): NarrativeEventContract {
  return {
    id,
    episodeNumber: 1,
    sourceOrder,
    sourceText: id,
    sourceContractIds: [id],
    realizationMode: 'depiction',
    ownershipPolicy: 'exactly_one_scene',
    prerequisiteEventIds: [],
    targetSceneIds: [ownerSceneId],
    targetSpineUnitIds: [],
    ownerSceneId,
    provenance: { source: 'episode_spine', confidence: 'authoritative' },
  };
}

describe('narrativeContinuityCompiler', () => {
  it('schedules a coined term after its exact creator proposition', () => {
    const scenes = [scene('s1', 0), scene('s2', 1), scene('s3', 2)];
    const events = [event('event-name', 1, 's2')];
    const semanticIr: AuthoredEventSemanticIR = {
      version: 1,
      policyVersion: 'semantic-contract-ir-v2',
      provider: 'test',
      model: 'test',
      sourceHash: 'hash',
      events: [{
        eventId: 'event-name',
        sourceText: 'event-name',
        sources: [{ id: 'source', text: 'Kylie coins the name Mr. Midnight.' }],
        propositions: [{
          id: 'event-name:semantic:1',
          sourceId: 'source',
          sourceSpan: 'Kylie coins the name Mr. Midnight.',
          proposition: 'Kylie coins the name Mr. Midnight.',
          semanticRole: 'decision',
          participantIds: ['kylie'],
          semanticCriteria: ['Kylie originates the exact name.'],
          prerequisitePropositionIds: [],
          referencedLocations: [],
          required: true,
          createdLexicalArtifacts: [{
            id: 'event-name:semantic:1:lexical:1',
            kind: 'coined_term',
            canonicalValue: 'Mr. Midnight',
            creatorParticipantId: 'kylie',
            routePolicy: 'source_invariant',
            allowedAlternatives: [],
          }],
        }],
      }],
    };

    expect(compileLexicalArtifactContracts({ semanticIr, events, scenes })).toEqual([
      expect.objectContaining({
        creatorSceneId: 's2',
        canonicalValue: 'Mr. Midnight',
        forbiddenBeforeSceneIds: ['s1'],
        routePolicy: 'source_invariant',
      }),
    ]);
  });

  it('projects local history without crossing episode boundaries', () => {
    const scenes = [
      scene('ep1-a', 0),
      scene('ep1-b', 1),
      scene('ep2-a', 0, { episodeNumber: 2 }),
    ];
    const events = [
      event('ep1-event-a', 0, 'ep1-a'),
      event('ep1-event-b', 1, 'ep1-b'),
      { ...event('ep2-event-a', 0, 'ep2-a'), episodeNumber: 2 },
    ];
    const contracts = compileSceneStateContracts({ scenes, events });
    expect(contracts.find((contract) => contract.sceneId === 'ep1-b')?.priorEventIdsWithinEpisode).toEqual(['ep1-event-a']);
    expect(contracts.find((contract) => contract.sceneId === 'ep2-a')?.priorEventIdsWithinEpisode).toEqual([]);
  });

  it('lets an authoritative anonymous first-sighting anchor own the appearance', () => {
    const scenes = [scene('street', 0), scene('rooftop', 1)];
    const presence: NarrativeCharacterPresenceContract[] = [{
      id: 'presence:radu',
      characterId: 'radu',
      characterName: 'Radu',
      episodeNumber: 1,
      sceneId: 'street',
      mode: 'anonymous_plant',
      readerNameAllowed: false,
      requiredEvidence: ['a rough man'],
      forbiddenEvidence: ['Radu'],
      sourceContractIds: ['treatment'],
      provenance: { source: 'treatment', confidence: 'authoritative' },
    }];
    const contracts = compileFirstAppearanceContracts({
      scenes,
      presenceContracts: presence,
      firstSightingAnchors: [{ id: 'anchor:radu', episodeNumber: 1, owningSceneId: 'rooftop', npcName: 'Radu', firstSighting: true, appearanceMode: 'anonymous_plant' }],
    });
    expect(contracts).toEqual([expect.objectContaining({ owningSceneId: 'rooftop', mode: 'anonymous_plant', earlierSceneIds: ['street'] })]);
  });

  it('B1: attaches treatment visual identity to first-appearance contracts by normalized name', () => {
    const scenes = [scene('club', 0)];
    const presence: NarrativeCharacterPresenceContract[] = [{
      id: 'presence:stela',
      characterId: 'char-stela-pavel',
      characterName: 'Stela Pavel',
      episodeNumber: 1,
      sceneId: 'club',
      mode: 'named_on_page',
      readerNameAllowed: true,
      requiredEvidence: [],
      forbiddenEvidence: [],
      sourceContractIds: ['treatment'],
      provenance: { source: 'treatment', confidence: 'authoritative' },
    }];
    const contracts = compileFirstAppearanceContracts({
      scenes,
      presenceContracts: presence,
      npcVisualIdentities: [
        { name: 'Stela Pavel', visualIdentity: 'platinum bob; stag-crest signet ring' },
        { name: 'Nobody Matching', visualIdentity: 'never attached' },
      ],
    });
    expect(contracts).toEqual([expect.objectContaining({
      characterName: 'Stela Pavel',
      visualIdentity: 'platinum bob; stag-crest signet ring',
    })]);
  });

  it('requires visible residue for every non-expression planned choice', () => {
    const choiceScene = scene('choice', 0, { hasChoice: true, choiceType: 'relationship' });
    const transition: NarrativeTransitionContract = {
      id: 'transition', episodeNumber: 1, fromSceneId: 'choice', toSceneId: 'next',
      bridgePolicy: 'orientation_only', requiredBridgeEvidence: [], stateContracts: [], blocking: false, sourceContractIds: [],
    };
    expect(compileRouteRealizationContracts({ scenes: [choiceScene], events: [], transitions: [transition] }))
      .toEqual([expect.objectContaining({ requiresVisibleResidue: true, allowedTargetSceneIds: ['next'] })]);
  });

  it('derives encounter participants from the canonical planned cast', () => {
    const encounter = scene('encounter', 0, {
      kind: 'encounter',
      npcsInvolved: ['attacker', 'rescuer'],
      encounter: { type: 'combat', difficulty: 'moderate', relevantSkills: ['athletics'], isBranchPoint: false },
    });
    expect(compileEncounterParticipationContracts([encounter])).toEqual([
      expect.objectContaining({ canonicalParticipantIds: ['attacker', 'rescuer'], protagonistRequired: true }),
    ]);
  });
});
