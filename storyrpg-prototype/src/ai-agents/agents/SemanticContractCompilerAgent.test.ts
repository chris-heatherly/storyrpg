import { describe, expect, it, vi } from 'vitest';
import type { NarrativeContractGraph } from '../../types/narrativeContract';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { SemanticContractCompilerAgent } from './SemanticContractCompilerAgent';
import { TruncatedLLMResponseError } from './BaseAgent';

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
    expect(options?.jsonSchema?.outputBudget).toMatchObject({
      visibleTokens: 3072,
      reasoningProfile: 'minimal',
      safetyTokens: 512,
    });
  });

  it('compiles authored premises into complete propositions instead of vocabulary atoms', async () => {
    const plan = scenePlan();
    plan.narrativeContractGraph!.premiseContracts = [{
      id: 'premise:kylie-starting-identity',
      episodeNumber: 1,
      fieldName: 'Starting identity',
      fieldKind: 'starting_identity',
      sourceText: 'Kylie watches the room and second-guesses herself before acting.',
      evidencePatterns: ['watches', 'second-guesses'],
      minimumEvidenceHits: 1,
      targetSceneIds: ['scene-1'],
      requiredSurface: ['beat_text'],
      sourceContractIds: ['treatment:kylie'],
      blocking: true,
      provenance: { source: 'treatment', confidence: 'authoritative' },
    }];
    const agent = new SemanticContractCompilerAgent({
      provider: 'gemini', model: 'gemini-test', apiKey: 'test', maxTokens: 4096, temperature: 0,
    });
    const call = vi.fn(async (_messages: unknown, _attempts: unknown, options: { jsonSchema?: { name?: string } }) => {
      if (options.jsonSchema?.name === 'authored_premise_semantic_contracts') {
        return JSON.stringify({ premises: [{
          premiseId: 'premise:kylie-starting-identity',
          minimumEvidenceHits: 1,
          propositions: [{
            propositionId: 'p1',
            sourceSpan: 'Kylie watches the room and second-guesses herself before acting.',
            proposition: 'Kylie habitually observes and doubts herself before she acts.',
            semanticCriteria: ['Kylie observes before participating', 'Her self-doubt delays action'],
            verificationAuthority: 'semantic_judge',
            required: true,
          }],
        }] });
      }
      return JSON.stringify({ events: [{
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
      }] });
    });
    (agent as any).callLLM = call;

    const result = await agent.execute(plan);

    expect(result.success).toBe(true);
    expect(result.data?.premises?.[0]).toMatchObject({
      premiseId: 'premise:kylie-starting-identity',
      minimumEvidenceHits: 1,
      propositions: [{
        id: 'premise:kylie-starting-identity:semantic:1',
        proposition: 'Kylie habitually observes and doubts herself before she acts.',
      }],
    });
    expect(result.data?.premises?.[0].propositions.some((proposition) => proposition.proposition === 'herself')).toBe(false);
    expect(call).toHaveBeenCalledTimes(2);
    const premiseOptions = call.mock.calls[1]?.[2] as { jsonSchema?: { name?: string; outputBudget?: unknown } } | undefined;
    expect(premiseOptions?.jsonSchema?.name).toBe('authored_premise_semantic_contracts');
    expect(premiseOptions?.jsonSchema?.outputBudget).toMatchObject({
      visibleTokens: 3072,
      reasoningProfile: 'minimal',
      safetyTokens: 512,
    });
  });

  it('splits a truncated premise batch without dropping any authored premise', async () => {
    const plan = scenePlan();
    plan.narrativeContractGraph!.events = [];
    plan.narrativeContractGraph!.premiseContracts = [
      {
        id: 'premise:kylie-observer',
        episodeNumber: 1,
        fieldName: 'Starting identity',
        fieldKind: 'starting_identity',
        sourceText: 'Kylie watches the room before she acts.',
        evidencePatterns: ['watches the room'],
        minimumEvidenceHits: 1,
        targetSceneIds: ['scene-1'],
        requiredSurface: ['beat_text'],
        sourceContractIds: ['treatment:kylie'],
        blocking: true,
        provenance: { source: 'treatment', confidence: 'authoritative' },
      },
      {
        id: 'premise:kylie-wound',
        episodeNumber: 1,
        fieldName: 'Origin pressure',
        fieldKind: 'origin_pressure',
        sourceText: 'Her cancelled engagement left Kylie publicly humiliated.',
        evidencePatterns: ['cancelled engagement'],
        minimumEvidenceHits: 1,
        targetSceneIds: ['scene-1'],
        requiredSurface: ['beat_text'],
        sourceContractIds: ['treatment:kylie'],
        blocking: true,
        provenance: { source: 'treatment', confidence: 'authoritative' },
      },
    ];
    const agent = new SemanticContractCompilerAgent({
      provider: 'gemini', model: 'gemini-test', apiKey: 'test', maxTokens: 32768, temperature: 0,
    });
    const call = vi.fn(async (messages: Array<{ content: string }>) => {
      const prompt = messages[0].content;
      if (prompt.includes('premise:kylie-observer') && prompt.includes('premise:kylie-wound')) {
        throw new TruncatedLLMResponseError('Truncated LLM response from Gemini: finishReason=MAX_TOKENS', 'gemini', 'MAX_TOKENS', 5472);
      }
      const observer = prompt.includes('premise:kylie-observer');
      return JSON.stringify({ premises: [{
        premiseId: observer ? 'premise:kylie-observer' : 'premise:kylie-wound',
        minimumEvidenceHits: 1,
        propositions: [{
          propositionId: 'p1',
          sourceSpan: observer ? 'Kylie watches the room before she acts.' : 'Her cancelled engagement left Kylie publicly humiliated.',
          proposition: observer
            ? 'Kylie observes the room before taking action.'
            : 'Kylie remains publicly humiliated by her cancelled engagement.',
          semanticCriteria: observer
            ? ['Kylie observes before acting']
            : ['Her cancelled engagement causes public humiliation'],
          verificationAuthority: 'semantic_judge',
          required: true,
        }],
      }] });
    });
    (agent as any).callLLM = call;

    const result = await agent.execute(plan);

    expect(result.success).toBe(true);
    expect(result.data?.premises?.map((premise) => premise.premiseId)).toEqual([
      'premise:kylie-observer',
      'premise:kylie-wound',
    ]);
    expect(call).toHaveBeenCalledTimes(3);
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
    expect(call.mock.calls[1]?.[0]?.[1]?.content).toContain('"sourceSpan": "invented rescue wording"');
  });

  it('isolates a persistently invalid multi-event batch before failing the season', async () => {
    const plan = scenePlan();
    plan.narrativeContractGraph!.events.push({
      id: 'event:ep1:post',
      episodeNumber: 1,
      sourceOrder: 2,
      sourceContractIds: ['ep1:post'],
      sourceText: 'Kylie opens her laptop, then posts the story.',
      realizationMode: 'depiction',
      ownershipPolicy: 'exactly_one_scene',
      prerequisiteEventIds: ['event:ep1:rescue'],
      targetSceneIds: ['scene-1'],
      targetSpineUnitIds: [],
      ownerSceneId: 'scene-1',
      realizationAtoms: [{
        id: 'bootstrap:2',
        description: 'Kylie opens her laptop, then posts the story.',
        acceptedPatterns: ['Kylie opens her laptop, then posts the story.'],
        sourceText: 'Kylie opens her laptop, then posts the story.',
        kind: 'semantic',
        required: true,
      }],
      provenance: { source: 'treatment_contract', confidence: 'authoritative' },
    });
    const agent = new SemanticContractCompilerAgent({
      provider: 'gemini', model: 'gemini-test', apiKey: 'test', maxTokens: 4096, temperature: 0,
    });
    const rescueEvent = {
      eventId: 'event:ep1:rescue',
      propositions: [{
        propositionId: 'p1', sourceId: 'event:ep1:rescue:source:1',
        sourceSpan: 'Kylie rescues Iulia in the park',
        proposition: 'Kylie rescues Iulia in the park.', semanticRole: 'action',
        participantIds: ['Kylie', 'Iulia'], semanticCriteria: ['Kylie rescues Iulia'],
        prerequisitePropositionIds: [], referencedLocations: [], required: true,
      }, {
        propositionId: 'p2', sourceId: 'event:ep1:rescue:source:1',
        sourceSpan: 'then writes about the attack at home',
        proposition: 'Kylie later writes about the attack at home.', semanticRole: 'aftermath',
        participantIds: ['Kylie'], semanticCriteria: ['Kylie writes after the rescue'],
        prerequisitePropositionIds: ['p1'], referencedLocations: [], required: true,
      }],
    };
    const invertedRescueEvent = {
      ...rescueEvent,
      propositions: [
        { ...rescueEvent.propositions[1], propositionId: 'p1', prerequisitePropositionIds: [] },
        { ...rescueEvent.propositions[0], propositionId: 'p2', prerequisitePropositionIds: ['p1'] },
      ],
    };
    const postEvent = {
      eventId: 'event:ep1:post',
      propositions: [{
        propositionId: 'p1', sourceId: 'event:ep1:post:source:1',
        sourceSpan: 'Kylie opens her laptop, then posts the story.',
        proposition: 'Kylie opens her laptop and posts the story.', semanticRole: 'action',
        participantIds: ['Kylie'], semanticCriteria: ['Kylie posts the story'],
        prerequisitePropositionIds: [], referencedLocations: [], required: true,
      }],
    };
    const call = vi.fn(async (messages: Array<{ content: string }>) => {
      const prompt = messages[0].content;
      const hasRescue = prompt.includes('event:ep1:rescue');
      const hasPost = prompt.includes('event:ep1:post');
      if (hasRescue && hasPost) return JSON.stringify({ events: [invertedRescueEvent, postEvent] });
      return JSON.stringify({ events: [hasRescue ? rescueEvent : postEvent] });
    });
    (agent as any).callLLM = call;

    const result = await agent.execute(plan);

    expect(result.success).toBe(true);
    expect(result.data?.events.map((event) => event.eventId).sort()).toEqual([
      'event:ep1:post',
      'event:ep1:rescue',
    ]);
    expect(call).toHaveBeenCalledTimes(4);
  });

  it('still fails closed after bounded correction of one invalid event', async () => {
    const agent = new SemanticContractCompilerAgent({
      provider: 'gemini', model: 'gemini-test', apiKey: 'test', maxTokens: 4096, temperature: 0,
    });
    const call = vi.fn(async () => JSON.stringify({ events: [{
      eventId: 'event:ep1:rescue',
      propositions: [{
        propositionId: 'p1', sourceId: 'event:ep1:rescue:source:1',
        sourceSpan: 'invented rescue wording',
        proposition: 'Kylie rescues Iulia.', semanticRole: 'action',
        participantIds: ['Kylie', 'Iulia'], semanticCriteria: ['Kylie rescues Iulia'],
        prerequisitePropositionIds: [], referencedLocations: [], required: true,
      }],
    }] }));
    (agent as any).callLLM = call;

    const result = await agent.execute(scenePlan());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Semantic contract batch failed bounded structured correction');
    expect(call).toHaveBeenCalledTimes(2);
  });
});
