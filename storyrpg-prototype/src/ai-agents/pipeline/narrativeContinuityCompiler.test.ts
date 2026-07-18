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

  it('forbids a coined term in every earlier episode', () => {
    const scenes = [
      scene('ep1-a', 0),
      scene('ep1-b', 1),
      scene('ep2-a', 0, { episodeNumber: 2 }),
      scene('ep2-b', 1, { episodeNumber: 2 }),
    ];
    const events = [{ ...event('event-name', 1, 'ep2-b'), episodeNumber: 2 }];
    const semanticIr: AuthoredEventSemanticIR = {
      version: 1,
      policyVersion: 'semantic-contract-ir-v2',
      provider: 'test',
      model: 'test',
      sourceHash: 'hash',
      events: [{
        eventId: 'event-name',
        sourceText: 'Kylie coins The Mountain.',
        sources: [{ id: 'source', text: 'Kylie coins The Mountain.' }],
        propositions: [{
          id: 'event-name:semantic:1',
          sourceId: 'source',
          sourceSpan: 'Kylie coins The Mountain.',
          proposition: 'Kylie coins The Mountain.',
          semanticRole: 'decision',
          participantIds: ['kylie'],
          semanticCriteria: ['Kylie originates the exact name.'],
          prerequisitePropositionIds: [],
          referencedLocations: [],
          required: true,
          createdLexicalArtifacts: [{
            id: 'event-name:semantic:1:lexical:1',
            kind: 'codeword',
            canonicalValue: 'The Mountain',
            creatorParticipantId: 'kylie',
            routePolicy: 'source_invariant',
            allowedAlternatives: [],
          }],
        }],
      }],
    };

    expect(compileLexicalArtifactContracts({ semanticIr, events, scenes })[0].forbiddenBeforeSceneIds)
      .toEqual(['ep1-a', 'ep1-b', 'ep2-a']);
  });

  it('r115: a later episode wrongly re-claiming creation of an earlier value is dropped, not shipped as a second contradicting contract', () => {
    // Exact shape of the run r115 blocker: Episode 1 genuinely creates
    // "Dating After Dusk" (naming the blog); Episode 5's proposition
    // merely REFERENCES the already-existing blog ("Victor asks Kylie to
    // wind down Dating After Dusk") but the semantic-contract LLM tagged it
    // as createdLexicalArtifacts too. Before this fix, the per-episode-only
    // duplicate check in narrativeContractCompiler.ts's validateGraph could
    // never see this collision, and Episode 5's forbiddenBeforeSceneIds
    // (computed from ITS OWN position) forbade the term in the Episode 1
    // scene the first contract required it in — unsatisfiable by
    // construction.
    const scenes = [
      scene('s1-1', 0),
      scene('s1-6', 1),
      scene('s5-2', 0, { episodeNumber: 5 }),
    ];
    const events = [
      event('event-ep1-u7', 0, 's1-6'),
      { ...event('event-ep5-u2', 0, 's5-2'), episodeNumber: 5 },
    ];
    const makeArtifactEvent = (eventId: string, episodeNumber: number, ownerSceneId: string) => ({
      eventId,
      sourceText: eventId,
      sources: [{ id: 'source', text: eventId }],
      propositions: [{
        id: `${eventId}:semantic:1`,
        sourceId: 'source',
        sourceSpan: eventId,
        proposition: eventId,
        semanticRole: 'action' as const,
        participantIds: ['kylie'],
        semanticCriteria: [eventId],
        prerequisitePropositionIds: [],
        referencedLocations: [],
        required: true,
        createdLexicalArtifacts: [{
          id: `${eventId}:semantic:1:lexical:1`,
          kind: 'title' as const,
          canonicalValue: 'Dating After Dusk',
          creatorParticipantId: 'kylie',
          routePolicy: 'source_invariant' as const,
          allowedAlternatives: [],
        }],
      }],
    });
    const semanticIr: AuthoredEventSemanticIR = {
      version: 1,
      policyVersion: 'semantic-contract-ir-v2',
      provider: 'test',
      model: 'test',
      sourceHash: 'hash',
      events: [
        makeArtifactEvent('event-ep1-u7', 1, 's1-6'),
        makeArtifactEvent('event-ep5-u2', 5, 's5-2'),
      ],
    };

    const contracts = compileLexicalArtifactContracts({ semanticIr, events, scenes });

    // Only the EARLIEST (Episode 1) creator survives.
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({ creatorEventId: 'event-ep1-u7', creatorSceneId: 's1-6' });
    // The scene the surviving contract requires the term in is NOT in its
    // own forbidden list (self-consistency), and the dropped Episode-5
    // "creator" can never contradict it.
    expect(contracts[0].forbiddenBeforeSceneIds).not.toContain('s1-6');
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

  it('matches parenthetical aliases to canonical cast ids and keeps the earliest anchor owner', () => {
    const scenes = [
      scene('street', 0),
      scene('rooftop', 1),
      scene('cab', 0, { episodeNumber: 2 }),
    ];
    const contracts = compileFirstAppearanceContracts({
      scenes,
      presenceContracts: [{
        id: 'presence-radu',
        characterId: 'char-radu-stoian',
        characterName: 'Radu Stoian',
        episodeNumber: 2,
        sceneId: 'cab',
        mode: 'named_on_page',
        readerNameAllowed: true,
        requiredEvidence: ['Radu Stoian'],
        forbiddenEvidence: [],
        sourceContractIds: [],
        provenance: { source: 'season_plan', confidence: 'authoritative' },
      }],
      firstSightingAnchors: [{
        id: 'anchor-ep1-radu',
        episodeNumber: 1,
        owningSceneId: 'rooftop',
        npcName: 'Radu Stoian ("The Mountain")',
        firstSighting: true,
        appearanceMode: 'anonymous_plant',
      }, {
        id: 'anchor-ep2-radu',
        episodeNumber: 2,
        owningSceneId: 'cab',
        npcName: 'Radu Stoian ("The Mountain")',
        firstSighting: true,
        appearanceMode: 'named_on_page',
      }],
    });

    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({
      characterId: 'char-radu-stoian',
      characterName: 'Radu Stoian',
      episodeNumber: 1,
      owningSceneId: 'rooftop',
      mode: 'anonymous_plant',
      earlierSceneIds: ['street'],
    });
    expect(contracts[0].sourceContractIds).toEqual(expect.arrayContaining([
      'presence-radu',
      'anchor-ep1-radu',
      'anchor-ep2-radu',
    ]));
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
