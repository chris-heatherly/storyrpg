import { describe, expect, it, vi } from 'vitest';
import type { NarrativeContractGraph } from '../../types/narrativeContract';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { SemanticContractCompilerAgent } from './SemanticContractCompilerAgent';

function scenePlan(): SeasonScenePlan {
  const sourceText = 'Kylie rescues Iulia in the park, then writes about the attack at home.';
  const graph: NarrativeContractGraph = {
    version: 1,
    compilerVersion: 'bootstrap',
    storyId: 'bite-me',
    sourceHash: 'bootstrap',
    events: [{
      id: 'event:ep1:rescue',
      episodeNumber: 1,
      sourceOrder: 1,
      sourceContractIds: ['ep1:rescue'],
      sourceText,
      realizationMode: 'depiction',
      ownershipPolicy: 'exactly_one_scene',
      prerequisiteEventIds: [],
      targetSceneIds: ['scene-1'],
      targetSpineUnitIds: [],
      ownerSceneId: 'scene-1',
      realizationAtoms: [{
        id: 'bootstrap:1',
        description: sourceText,
        acceptedPatterns: [sourceText],
        sourceText,
        kind: 'semantic',
        required: true,
      }],
      provenance: { source: 'treatment_contract', confidence: 'authoritative' },
    }],
    characterPresenceContracts: [],
    dependencies: [],
    validation: { passed: true, issues: [] },
  };
  return {
    scenes: [{
      id: 'scene-1',
      episodeNumber: 1,
      order: 1,
      kind: 'standard',
      title: 'Park rescue',
      dramaticPurpose: sourceText,
      narrativeRole: 'turn',
      locations: ['Carol Park', 'Kylie home'],
      npcsInvolved: ['Iulia'],
      setsUp: [],
      paysOff: [],
    }],
    byEpisode: { 1: ['scene-1'] },
    setupPayoffEdges: [],
    narrativeContractGraph: graph,
  };
}

describe('SemanticContractCompilerAgent', () => {
  it('produces stable source-grounded semantic IR through structured output', async () => {
    const agent = new SemanticContractCompilerAgent({
      provider: 'gemini',
      model: 'gemini-test',
      apiKey: 'test',
      maxTokens: 4096,
      temperature: 0,
    });
    const call = vi.fn(async (..._args: unknown[]) => JSON.stringify({
      events: [{
        eventId: 'event:ep1:rescue',
        propositions: [
          {
            propositionId: 'p1',
            sourceId: 'event:ep1:rescue:source:1',
            sourceSpan: 'Kylie rescues Iulia in the park',
            proposition: 'Kylie completes Iulia\'s rescue in the park.',
            semanticRole: 'action',
            participantIds: ['Kylie', 'Iulia'],
            semanticCriteria: ['Kylie performs the rescue', 'Iulia is rescued', 'The rescue is completed in the park'],
            prerequisitePropositionIds: [],
            stagedLocation: 'Carol Park',
            referencedLocations: [],
            required: true,
          },
          {
            propositionId: 'p2',
            sourceId: 'event:ep1:rescue:source:1',
            sourceSpan: 'then writes about the attack at home',
            proposition: 'After the rescue, Kylie writes about the attack at home.',
            semanticRole: 'aftermath',
            participantIds: ['Kylie'],
            semanticCriteria: ['Writing occurs after the rescue', 'The writing concerns the attack', 'Kylie writes at home'],
            prerequisitePropositionIds: ['p1'],
            stagedLocation: 'Kylie home',
            referencedLocations: [],
            required: true,
          },
        ],
      }],
    }));
    (agent as any).callLLM = call;

    const result = await agent.execute(scenePlan());
    expect(result.success).toBe(true);
    expect(result.data?.events[0].propositions.map((proposition) => proposition.id)).toEqual([
      'event:ep1:rescue:semantic:1',
      'event:ep1:rescue:semantic:2',
    ]);
    expect(result.data?.events[0].propositions[1].prerequisitePropositionIds).toEqual([
      'event:ep1:rescue:semantic:1',
    ]);
    const options = call.mock.calls[0]?.[2] as { jsonSchema?: { name?: string } } | undefined;
    expect(options?.jsonSchema?.name).toBe('authored_event_semantic_contracts');
  });

  it('retries the same bounded batch when source provenance is invalid', async () => {
    const agent = new SemanticContractCompilerAgent({
      provider: 'gemini', model: 'gemini-test', apiKey: 'test', maxTokens: 4096, temperature: 0,
    });
    const validEvent = {
      eventId: 'event:ep1:rescue',
      propositions: [{
        propositionId: 'p1', sourceId: 'event:ep1:rescue:source:1',
        sourceSpan: 'Kylie rescues Iulia in the park',
        proposition: 'Kylie completes Iulia\'s rescue in the park.', semanticRole: 'action',
        participantIds: ['Kylie', 'Iulia'], semanticCriteria: ['Kylie completes the rescue'],
        prerequisitePropositionIds: [], referencedLocations: [], required: true,
      }, {
        propositionId: 'p2', sourceId: 'event:ep1:rescue:source:1',
        sourceSpan: 'then writes about the attack at home',
        proposition: 'Kylie later writes about the attack at home.', semanticRole: 'aftermath',
        participantIds: ['Kylie'], semanticCriteria: ['Kylie writes about the attack after the rescue'],
        prerequisitePropositionIds: ['p1'], referencedLocations: [], required: true,
      }],
    };
    const call = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ events: [{
        ...validEvent,
        propositions: [{ ...validEvent.propositions[0], sourceSpan: 'invented rescue wording' }],
      }] }))
      .mockResolvedValueOnce(JSON.stringify({ events: [validEvent] }));
    (agent as any).callLLM = call;

    const result = await agent.execute(scenePlan());
    expect(result.success).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1]?.[0]?.[1]?.content).toContain('source span is not an exact substring');
  });
});
