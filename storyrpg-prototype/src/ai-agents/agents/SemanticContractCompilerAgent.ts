import type { AgentConfig } from '../config';
import type {
  AuthoredEventSemanticIR,
  AuthoredEventSemanticRole,
  NarrativeContractGraph,
} from '../../types/narrativeContract';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { AgentResponse, BaseAgent } from './BaseAgent';
import {
  SEMANTIC_CONTRACT_IR_POLICY_VERSION,
  semanticContractEventSeeds,
  semanticContractPremiseSeeds,
  semanticContractPremiseSourceHash,
  semanticContractSourceHash,
  validateAuthoredEventSemanticIR,
  type SemanticContractEventSeed,
  type SemanticContractPremiseSeed,
} from '../pipeline/semanticContractIr';

type RawSemanticProposition = {
  propositionId: string;
  sourceId: string;
  sourceSpan: string;
  proposition: string;
  semanticRole: AuthoredEventSemanticRole;
  participantIds: string[];
  semanticCriteria: string[];
  prerequisitePropositionIds: string[];
  stagedLocation?: string;
  referencedLocations: string[];
  required: boolean;
};

type RawSemanticEvent = {
  eventId: string;
  propositions: RawSemanticProposition[];
};

type RawSemanticBatch = { events: RawSemanticEvent[] };

type RawPremiseProposition = {
  propositionId: string;
  sourceSpan: string;
  proposition: string;
  semanticCriteria: string[];
  verificationAuthority: 'literal' | 'semantic_judge';
  required: boolean;
};

type RawSemanticPremise = {
  premiseId: string;
  minimumEvidenceHits: number;
  propositions: RawPremiseProposition[];
};

type RawPremiseBatch = { premises: RawSemanticPremise[] };

const SEMANTIC_ROLES: AuthoredEventSemanticRole[] = [
  'action',
  'introduction',
  'information_transfer',
  'state_change',
  'relationship_change',
  'location_entry',
  'location_reference',
  'transition_bridge',
  'temporal_transition',
  'decision',
  'aftermath',
];

function semanticContractSchema(eventCount: number) {
  return {
    name: 'authored_event_semantic_contracts',
    description: 'Source-grounded semantic propositions for authored narrative events.',
    maxOutputTokens: Math.min(6144, Math.max(1400, eventCount * 850)),
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['events'],
      properties: {
        events: {
          type: 'array',
          minItems: eventCount,
          maxItems: eventCount,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['eventId', 'propositions'],
            properties: {
              eventId: { type: 'string' },
              propositions: {
                type: 'array',
                minItems: 1,
                maxItems: 8,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'propositionId', 'sourceId', 'sourceSpan', 'proposition', 'semanticRole',
                    'participantIds', 'semanticCriteria', 'prerequisitePropositionIds',
                    'referencedLocations', 'required',
                  ],
                  properties: {
                    propositionId: { type: 'string', maxLength: 8 },
                    sourceId: { type: 'string', maxLength: 240 },
                    sourceSpan: { type: 'string', maxLength: 800 },
                    proposition: { type: 'string', maxLength: 320 },
                    semanticRole: { type: 'string', enum: SEMANTIC_ROLES },
                    participantIds: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 120 } },
                    semanticCriteria: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', maxLength: 240 } },
                    prerequisitePropositionIds: { type: 'array', maxItems: 7, items: { type: 'string', maxLength: 8 } },
                    stagedLocation: { type: 'string', maxLength: 180 },
                    referencedLocations: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 180 } },
                    required: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function premiseContractSchema(premiseCount: number) {
  return {
    name: 'authored_premise_semantic_contracts',
    description: 'Source-grounded, independently judgeable propositions for authored character premises.',
    maxOutputTokens: Math.min(4096, Math.max(1200, premiseCount * 650)),
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['premises'],
      properties: {
        premises: {
          type: 'array',
          minItems: premiseCount,
          maxItems: premiseCount,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['premiseId', 'minimumEvidenceHits', 'propositions'],
            properties: {
              premiseId: { type: 'string' },
              minimumEvidenceHits: { type: 'integer', minimum: 1, maximum: 4 },
              propositions: {
                type: 'array',
                minItems: 1,
                maxItems: 4,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'propositionId', 'sourceSpan', 'proposition', 'semanticCriteria',
                    'verificationAuthority', 'required',
                  ],
                  properties: {
                    propositionId: { type: 'string', maxLength: 8 },
                    sourceSpan: { type: 'string', maxLength: 800 },
                    proposition: { type: 'string', maxLength: 320 },
                    semanticCriteria: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', maxLength: 240 } },
                    verificationAuthority: { type: 'string', enum: ['literal', 'semantic_judge'] },
                    required: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

export class SemanticContractCompilerAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Semantic Contract Compiler', { ...config, temperature: 0.1 });
    this.includeSystemPrompt = false;
  }

  protected getAgentSpecificPrompt(): string {
    return '';
  }

  async execute(scenePlan: SeasonScenePlan): Promise<AgentResponse<AuthoredEventSemanticIR>> {
    const graph = scenePlan.narrativeContractGraph;
    if (!graph) return { success: false, error: 'Season scene plan has no narrative contract graph.' };
    const seeds = semanticContractEventSeeds(graph);
    const premiseSeeds = semanticContractPremiseSeeds(graph);
    if (seeds.length === 0 && premiseSeeds.length === 0) {
      return { success: false, error: 'Narrative contract graph has no depiction events or authored premises.' };
    }
    const knownLocations = [...new Set(scenePlan.scenes.flatMap((scene) => scene.locations ?? []).filter(Boolean))].sort();
    const compiledEvents: AuthoredEventSemanticIR['events'] = [];
    const compiledPremises: NonNullable<AuthoredEventSemanticIR['premises']> = [];

    try {
      for (let offset = 0; offset < seeds.length; offset += 6) {
        const batch = seeds.slice(offset, offset + 6);
        let batchEvents: AuthoredEventSemanticIR['events'] | undefined;
        let correctionIssues: string[] = [];
        for (let structuredAttempt = 1; structuredAttempt <= 2 && !batchEvents; structuredAttempt += 1) {
          const messages = [{ role: 'user' as const, content: this.buildPrompt(batch, knownLocations) }];
          if (correctionIssues.length > 0) {
            messages.push({
              role: 'user',
              content: `Your previous semantic IR was structurally invalid. Correct only these issues and return the complete batch again:\n- ${correctionIssues.join('\n- ')}`,
            });
          }
          const { data } = await this.callLLMForJson<RawSemanticBatch>(messages, {
            jsonSchema: semanticContractSchema(batch.length),
          });
          let normalized: AuthoredEventSemanticIR['events'];
          try {
            normalized = this.normalizeBatch(batch, data);
          } catch (error) {
            correctionIssues = [error instanceof Error ? error.message : String(error)];
            continue;
          }
          const candidate: AuthoredEventSemanticIR = {
            version: 1,
            policyVersion: SEMANTIC_CONTRACT_IR_POLICY_VERSION,
            provider: this.config.provider,
            model: this.config.model,
            sourceHash: semanticContractSourceHash(batch),
            events: normalized,
          };
          const validation = validateAuthoredEventSemanticIR(candidate, batch, knownLocations);
          if (validation.passed) batchEvents = normalized;
          else correctionIssues = validation.issues;
        }
        if (!batchEvents) throw new Error(`Semantic contract batch failed bounded structured correction: ${correctionIssues.join(' | ')}`);
        compiledEvents.push(...batchEvents);
      }

      for (let offset = 0; offset < premiseSeeds.length; offset += 6) {
        const batch = premiseSeeds.slice(offset, offset + 6);
        let batchPremises: NonNullable<AuthoredEventSemanticIR['premises']> | undefined;
        let correctionIssues: string[] = [];
        for (let structuredAttempt = 1; structuredAttempt <= 2 && !batchPremises; structuredAttempt += 1) {
          const messages = [{ role: 'user' as const, content: this.buildPremisePrompt(batch) }];
          if (correctionIssues.length > 0) {
            messages.push({
              role: 'user',
              content: `Your previous premise IR was structurally invalid. Correct only these issues and return the complete batch again:\n- ${correctionIssues.join('\n- ')}`,
            });
          }
          const { data } = await this.callLLMForJson<RawPremiseBatch>(messages, {
            jsonSchema: premiseContractSchema(batch.length),
          });
          try {
            batchPremises = this.normalizePremiseBatch(batch, data);
          } catch (error) {
            correctionIssues = [error instanceof Error ? error.message : String(error)];
            continue;
          }
          const candidate: AuthoredEventSemanticIR = {
            version: 1,
            policyVersion: SEMANTIC_CONTRACT_IR_POLICY_VERSION,
            provider: this.config.provider,
            model: this.config.model,
            sourceHash: semanticContractSourceHash([]),
            events: [],
            premiseSourceHash: semanticContractPremiseSourceHash(batch),
            premises: batchPremises,
          };
          const validation = validateAuthoredEventSemanticIR(candidate, [], [], batch);
          if (!validation.passed) {
            correctionIssues = validation.issues;
            batchPremises = undefined;
          }
        }
        if (!batchPremises) throw new Error(`Premise semantic contract batch failed bounded structured correction: ${correctionIssues.join(' | ')}`);
        compiledPremises.push(...batchPremises);
      }

      const ir: AuthoredEventSemanticIR = {
        version: 1,
        policyVersion: SEMANTIC_CONTRACT_IR_POLICY_VERSION,
        provider: this.config.provider,
        model: this.config.model,
        sourceHash: semanticContractSourceHash(seeds),
        events: compiledEvents,
        premiseSourceHash: semanticContractPremiseSourceHash(premiseSeeds),
        premises: compiledPremises,
      };
      const validation = validateAuthoredEventSemanticIR(ir, seeds, knownLocations, premiseSeeds);
      if (!validation.passed) {
        return { success: false, error: `Semantic contract IR failed validation: ${validation.issues.join(' | ')}` };
      }
      return { success: true, data: ir };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private normalizeBatch(
    seeds: SemanticContractEventSeed[],
    data: RawSemanticBatch,
  ): AuthoredEventSemanticIR['events'] {
    const byEventId = new Map((data.events ?? []).map((event) => [event.eventId, event]));
    return seeds.map((seed) => {
      const raw = byEventId.get(seed.eventId);
      if (!raw) throw new Error(`LLM omitted depiction event ${seed.eventId}.`);
      for (const [index, proposition] of raw.propositions.entries()) {
        if (proposition.propositionId !== `p${index + 1}`) {
          throw new Error(`Event ${seed.eventId} must use ordered proposition ids p1..pN; received ${proposition.propositionId || '<missing>'} at position ${index + 1}.`);
        }
      }
      const localIdMap = new Map(raw.propositions.map((proposition, index) => [
        proposition.propositionId,
        `${seed.eventId}:semantic:${index + 1}`,
      ]));
      return {
        eventId: seed.eventId,
        sourceText: seed.sourceText,
        sources: seed.sources,
        propositions: raw.propositions.map((proposition, index) => ({
          id: `${seed.eventId}:semantic:${index + 1}`,
          sourceId: proposition.sourceId,
          sourceSpan: proposition.sourceSpan,
          proposition: proposition.proposition,
          semanticRole: proposition.semanticRole,
          participantIds: proposition.participantIds ?? [],
          semanticCriteria: proposition.semanticCriteria ?? [],
          prerequisitePropositionIds: (proposition.prerequisitePropositionIds ?? []).map((id) => localIdMap.get(id) ?? id),
          stagedLocation: proposition.stagedLocation || undefined,
          referencedLocations: proposition.referencedLocations ?? [],
          required: proposition.required !== false,
        })),
      };
    });
  }

  private normalizePremiseBatch(
    seeds: SemanticContractPremiseSeed[],
    data: RawPremiseBatch,
  ): NonNullable<AuthoredEventSemanticIR['premises']> {
    const byPremiseId = new Map((data.premises ?? []).map((premise) => [premise.premiseId, premise]));
    return seeds.map((seed) => {
      const raw = byPremiseId.get(seed.premiseId);
      if (!raw) throw new Error(`LLM omitted authored premise ${seed.premiseId}.`);
      for (const [index, proposition] of raw.propositions.entries()) {
        if (proposition.propositionId !== `p${index + 1}`) {
          throw new Error(`Premise ${seed.premiseId} must use ordered proposition ids p1..pN; received ${proposition.propositionId || '<missing>'} at position ${index + 1}.`);
        }
      }
      return {
        premiseId: seed.premiseId,
        sourceText: seed.sourceText,
        minimumEvidenceHits: raw.minimumEvidenceHits,
        propositions: raw.propositions.map((proposition, index) => ({
          id: `${seed.premiseId}:semantic:${index + 1}`,
          sourceSpan: proposition.sourceSpan,
          proposition: proposition.proposition,
          semanticCriteria: proposition.semanticCriteria ?? [],
          verificationAuthority: proposition.verificationAuthority,
          required: proposition.required !== false,
        })),
      };
    });
  }

  private buildPrompt(events: SemanticContractEventSeed[], knownLocations: string[]): string {
    return `You are compiling authored narrative events into a semantic contract IR. You do not write story prose and you do not judge generated prose.

For each event, decompose the supplied source segments into the smallest independently verifiable completed meanings. Preserve distinctions such as mention versus arrival, invitation versus acceptance, attempt versus completion, setup versus aftermath, and actor versus recipient.

Rules:
- Return exactly one event object for every input eventId.
- Use propositionId values p1, p2, ... in causal/temporal order within that event.
- sourceSpan must be copied EXACTLY from one supplied source segment and sourceId must name that segment.
- Do not add facts, people, actions, locations, motives, outcomes, or chronology absent from the sources.
- proposition is a concise factual meaning, not required wording.
- semanticCriteria are concise meaning conditions a semantic judge can evaluate; do not provide keyword lists or stylistic advice.
- participantIds name only participants explicitly present in or unambiguously referred to by the cited span. Pronouns may remain pronouns.
- stagedLocation means the action physically occurs there. A mentioned destination belongs in referencedLocations instead.
- Use only these known location strings for location fields: ${knownLocations.length > 0 ? knownLocations.join(' | ') : '(none)'}.
- prerequisitePropositionIds may reference only earlier propositionIds in the same event.
- Mark every authored proposition required unless the source explicitly describes an optional possibility.

INPUT EVENTS:
${JSON.stringify(events, null, 2)}`;
  }

  private buildPremisePrompt(premises: SemanticContractPremiseSeed[]): string {
    return `You are compiling authored character and premise fields into semantic contract IR. You do not write story prose and you do not judge generated prose.

For each premise, produce the smallest set of independently judgeable, subject-predicate propositions needed to establish the authored field in reader-facing prose.

Rules:
- Return exactly one premise object for every premiseId.
- Use propositionId values p1, p2, ... in source order.
- sourceSpan must be copied EXACTLY from sourceText.
- Every proposition must state a complete meaning with an identifiable subject. Never emit an isolated word, vocabulary token, n-gram, adjective, conjunction, possessive, or grammatical fragment.
- Preserve authored meaning without adding biography, motives, causality, or facts absent from sourceText.
- semanticCriteria are concise meaning conditions, never keyword lists or stylistic directions.
- Use literal only when exact reader-facing identity or terminology is itself required, and then make sourceSpan the minimal exact name or term. Use semantic_judge for paraphrasable facts, behavior, wound, origin, or role meaning.
- minimumEvidenceHits is the number of propositions needed to unmistakably establish this field. Prefer 1; use 2 only when two independently load-bearing meanings are necessary. It may not exceed the proposition count.
- Keep no more than 3 propositions unless the authored source contains four genuinely independent, load-bearing meanings.
- Mark a proposition required only when it contributes to minimumEvidenceHits.

INPUT PREMISES:
${JSON.stringify(premises, null, 2)}`;
  }
}
