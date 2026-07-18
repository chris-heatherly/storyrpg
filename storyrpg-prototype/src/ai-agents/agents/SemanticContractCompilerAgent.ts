import type { AgentConfig } from '../config';
import type {
  AuthoredEventSemanticIR,
  AuthoredEventSemanticRole,
  NarrativeContractGraph,
} from '../../types/narrativeContract';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { AgentResponse, BaseAgent, TruncatedLLMResponseError } from './BaseAgent';
import {
  SEMANTIC_CONTRACT_IR_POLICY_VERSION,
  collectKnownSemanticLocations,
  semanticContractEventSeeds,
  semanticContractPremiseSeeds,
  semanticContractPremiseSourceHash,
  semanticContractSourceHash,
  validateAuthoredEventSemanticIR,
  type SemanticContractEventSeed,
  type SemanticContractPremiseSeed,
} from '../pipeline/semanticContractIr';
import { entityTokensMatch } from '../utils/entityIdentity';

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
  createdLexicalArtifacts: Array<{
    artifactId: string;
    kind: 'coined_term' | 'group_name' | 'title' | 'handle' | 'codeword';
    canonicalValue: string;
    creatorParticipantId?: string;
    routePolicy: 'source_invariant' | 'player_selected';
    allowedAlternatives: string[];
  }>;
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
  const visibleTokens = Math.min(12288, Math.max(3072, eventCount * 1500));
  return {
    name: 'authored_event_semantic_contracts',
    description: 'Source-grounded semantic propositions for authored narrative events.',
    maxOutputTokens: visibleTokens,
    // Gemini 3 counts hidden thinking inside maxOutputTokens. Reserving it here
    // keeps the JSON payload from being starved on dense source batches.
    outputBudget: {
      visibleTokens,
      reasoningProfile: 'minimal' as const,
      safetyTokens: 512,
    },
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
                    'referencedLocations', 'required', 'createdLexicalArtifacts',
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
                    createdLexicalArtifacts: {
                      type: 'array',
                      maxItems: 3,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['artifactId', 'kind', 'canonicalValue', 'routePolicy', 'allowedAlternatives'],
                        properties: {
                          artifactId: { type: 'string', maxLength: 8 },
                          kind: { type: 'string', enum: ['coined_term', 'group_name', 'title', 'handle', 'codeword'] },
                          canonicalValue: { type: 'string', maxLength: 120 },
                          creatorParticipantId: { type: 'string', maxLength: 120 },
                          routePolicy: { type: 'string', enum: ['source_invariant', 'player_selected'] },
                          allowedAlternatives: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 120 } },
                        },
                      },
                    },
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
  const visibleTokens = Math.min(9216, Math.max(3072, premiseCount * 1200));
  return {
    name: 'authored_premise_semantic_contracts',
    description: 'Source-grounded, independently judgeable propositions for authored character premises.',
    maxOutputTokens: visibleTokens,
    // Premise IR carries source spans and judge criteria, so it needs explicit
    // visible headroom rather than inheriting Gemini's thinking-only default.
    outputBudget: {
      visibleTokens,
      reasoningProfile: 'minimal' as const,
      safetyTokens: 512,
    },
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

function revealContractSchema(maxEpisode: number) {
  return {
    name: 'season_reveal_contracts',
    description: 'Season secrets that must stay unrevealed until their reveal episode.',
    maxOutputTokens: 3072,
    outputBudget: { visibleTokens: 3072, reasoningProfile: 'minimal' as const, safetyTokens: 512 },
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['revealContracts'],
      properties: {
        revealContracts: {
          type: 'array',
          minItems: 0,
          maxItems: 12,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['secretDescription', 'forbiddenMeanings', 'revealEpisode', 'sourceRef'],
            properties: {
              secretDescription: { type: 'string', maxLength: 240 },
              forbiddenMeanings: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', maxLength: 240 } },
              revealEpisode: { type: 'integer', minimum: 2, maximum: maxEpisode },
              sourceRef: { type: 'string', maxLength: 200 },
            },
          },
        },
      },
    },
  };
}

/**
 * r115 owner-plan feasibility: does a compiled anchor's declared staging
 * location actually belong to its owning scene? Compares STRUCTURED,
 * enum-constrained fields only (never tokenizes onPageAction's semantic-judge
 * prose — the standing guard rule from the v27 feasibility incident). A
 * missing/"unspecified" stagedLocation, or a scene with no location data,
 * always passes (nothing to contradict).
 */
export function anchorLocationIsFeasible(
  stagedLocation: string | undefined,
  owningSceneLocations: readonly string[],
): boolean {
  const staged = stagedLocation?.trim();
  if (!staged || staged === 'unspecified') return true;
  if (owningSceneLocations.length === 0) return true;
  return owningSceneLocations.some((location) => entityTokensMatch(staged, location));
}

function anchorContractSchema(sceneIds: string[], castNames: string[], knownLocations: string[]) {
  // r115: stagedLocation is a STRUCTURED field (enum-constrained to the
  // episode's known locations, exactly like ordinary depiction events'
  // referencedLocations), not free text — it lets the compiler deterministically
  // cross-check the LLM's chosen location against the owning scene's actual
  // locations WITHOUT tokenizing onPageAction's semantic-judge prose (the
  // standing guard rule from the v27 feasibility incident: no deterministic
  // check may consume semantic_judge text as wording).
  const locationEnum = [...knownLocations, 'unspecified'];
  return {
    name: 'season_anchor_contracts',
    description: 'Live season anchors bound to their owning scene and an on-page planting action.',
    maxOutputTokens: 3072,
    outputBudget: { visibleTokens: 3072, reasoningProfile: 'minimal' as const, safetyTokens: 512 },
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['anchorContracts'],
      properties: {
        anchorContracts: {
          type: 'array',
          minItems: 0,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['anchorName', 'owningSceneId', 'onPageAction', 'appearanceMode', 'stagedLocation'],
            properties: {
              anchorName: { type: 'string', maxLength: 120 },
              owningSceneId: { type: 'string', enum: sceneIds },
              onPageAction: { type: 'string', maxLength: 240 },
              stagedLocation: locationEnum.length > 1 ? { type: 'string', enum: locationEnum } : { type: 'string', maxLength: 80 },
              npcName: castNames.length > 0 ? { type: 'string', enum: castNames } : { type: 'string', maxLength: 80 },
              firstSighting: { type: 'boolean' },
              appearanceMode: { type: 'string', enum: ['named_on_page', 'anonymous_plant', 'not_applicable'] },
              sourceRef: { type: 'string', maxLength: 200 },
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
    const knownLocations = collectKnownSemanticLocations(
      graph.knownLocationNames ?? [],
      scenePlan.scenes.flatMap((scene) => scene.locations ?? []),
    );
    const compiledEvents: AuthoredEventSemanticIR['events'] = [];
    const compiledPremises: NonNullable<AuthoredEventSemanticIR['premises']> = [];

    try {
      for (let offset = 0; offset < seeds.length; offset += 6) {
        compiledEvents.push(...await this.compileEventBatch(seeds.slice(offset, offset + 6), knownLocations));
      }

      for (let offset = 0; offset < premiseSeeds.length; offset += 6) {
        compiledPremises.push(...await this.compilePremiseBatch(premiseSeeds.slice(offset, offset + 6)));
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

  /**
   * F1.1 (Treatment Fidelity Plan): extract season secrets + reveal episodes
   * from the episode outlines and NPC secret notes. Deterministic validation
   * bounds episodes and requires grounded meanings; downstream these become
   * forbidden semantic atoms on every episode BEFORE the reveal. Best-effort:
   * failure returns [] with a warning — reveal enforcement is protection, not
   * a new way for analysis to die.
   */
  async compileRevealContracts(input: {
    episodes: Array<{ number: number; title?: string; summary: string }>;
    npcSecretNotes: string[];
    audiencePromise?: string;
  }): Promise<import('../../types/narrativeContract').NarrativeRevealContract[]> {
    const maxEpisode = Math.max(2, ...input.episodes.map((episode) => episode.number));
    if (input.episodes.length < 2) return [];
    const prompt = `You are compiling REVEAL-TIMING contracts for a serialized interactive story. You do not write prose.

A reveal contract names one season-level secret, the FIRST episode where the story may confirm it on reader-facing surfaces, and 1-4 forbidden meanings: statements whose on-page presence in ANY EARLIER episode would spoil the secret. A forbidden meaning is a complete factual claim a judge can test prose against (e.g. "The rescue was staged as bait"), never a keyword list.

Rules:
- Only secrets the source material itself schedules for a later episode (twists, hidden natures, hidden allegiances, staged events, hidden pasts).
- revealEpisode = the episode whose outline actually reveals it. Foreshadowing in earlier episodes is allowed and is NOT a forbidden meaning — forbid CONFIRMATION, not atmosphere.
- sourceRef quotes or names the outline/NPC line grounding the secret.
- Do not invent secrets absent from the material.
- Secrets are not only identities. Also extract:
  * KNOWLEDGE BOUNDARIES: when a watcher/antagonist secretly monitors or steers the protagonist, anyone outside the circle DEMONSTRATING knowledge of the circle's private names, pacts, or plans before the episode that reveals the surveillance is a leak (e.g. "An outsider shows they know the friends' private pact or its name").
  * HIDDEN ROLES: an ally's secret protective or assigned function (warder, planted friend, anonymous guardian) — publicly performing or announcing that role before its reveal episode is a leak, INCLUDING through a screen name, handle, or alias attributable to that character.
  * CODENAME COINAGE: a codename is a coined artifact. When an outline coins a codename in episode N, emit a contract with revealEpisode N whose forbidden meaning is that the codename appears or is used in any reader-facing text (e.g. "The codename 'The Mountain' is used") — before its coining, the name does not exist.

${input.audiencePromise ? `AUDIENCE PROMISE (pacing contract):\n${input.audiencePromise}\n` : ''}
EPISODE OUTLINES:
${input.episodes.map((episode) => `Episode ${episode.number}${episode.title ? ` (${episode.title})` : ''}: ${episode.summary}`).join('\n\n')}

NPC SECRETS:
${input.npcSecretNotes.map((note) => `- ${note}`).join('\n') || '(none)'}`;
    try {
      const { data } = await this.callLLMForJson<{ revealContracts: Array<{
        secretDescription: string; forbiddenMeanings: string[]; revealEpisode: number; sourceRef: string;
      }> }>([{ role: 'user', content: prompt }], { jsonSchema: revealContractSchema(maxEpisode) });
      const contracts = (data?.revealContracts ?? [])
        .filter((contract) => contract
          && typeof contract.secretDescription === 'string' && contract.secretDescription.trim()
          && Array.isArray(contract.forbiddenMeanings) && contract.forbiddenMeanings.some((meaning) => meaning?.trim())
          && Number.isInteger(contract.revealEpisode)
          && contract.revealEpisode >= 2 && contract.revealEpisode <= maxEpisode)
        .map((contract, index) => ({
          id: `reveal:${index + 1}:${contract.secretDescription.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)}`,
          secretDescription: contract.secretDescription.trim(),
          forbiddenMeanings: contract.forbiddenMeanings.map((meaning) => String(meaning ?? '').trim()).filter(Boolean).slice(0, 4),
          revealEpisode: contract.revealEpisode,
          sourceRef: contract.sourceRef?.trim() || undefined,
        }));
      return contracts;
    } catch (error) {
      console.warn(`[Semantic Contract Compiler] reveal-contract compilation failed (continuing without): ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * G5 (treatment-gap analysis 2026-07-15): bind each "live season anchor"
   * from an episode outline's likely-consequence line to the SCENE that owns
   * planting it and a concrete reader-visible action. This must be semantic —
   * the treatment stages Radu's first sighting anonymously ("a rougher man
   * near the kitchen"), so no name match can find the owning scene. Best-
   * effort: failure returns [] with a warning; anchors are protection, not a
   * new way for analysis to die.
   */
  async compileAnchorContracts(input: {
    episodeNumber: number;
    episodeOutline: string;
    likelyConsequence: string;
    scenes: Array<{ id: string; order: number; summary: string; locations?: string[] }>;
    castNames: string[];
  }): Promise<import('../../types/narrativeContract').NarrativeAnchorContract[]> {
    if (!input.likelyConsequence?.trim() || input.scenes.length === 0) return [];
    const orderedScenes = [...input.scenes].sort((left, right) => left.order - right.order);
    // r115: the compiler previously had NO location data for any scene — it
    // could only guess a scene's physical location from the free-text
    // `summary` label, so nothing stopped it from inventing an action set at
    // a location the owning scene never visits (a bare anchor phrase like
    // "Stela's protection" became "guides Kylie past the Valescu Club
    // threshold" — assigned to the bookshop scene). Ground every scene in
    // its actual locations.
    const knownLocations = collectKnownSemanticLocations(orderedScenes.flatMap((scene) => scene.locations ?? []));
    const prompt = `You are binding SEASON ANCHORS for a serialized interactive story. You do not write prose.

The episode outline ends with a likely-consequence line naming things that "become live season anchors" — promises the season builds on. For each anchor, name the ONE scene in this episode that owns planting it, and the concrete READER-VISIBLE ACTION that plants it: something a judge can test the prose against (an object accepted, a threshold crossed, a person first seen, a pact spoken), never a mood or a metadata fact.

Rules:
- Only anchors the likely-consequence line actually names. Do not invent anchors.
- owningSceneId must be the scene whose summary stages the anchor's planting moment — match by MEANING (the outline may describe a character anonymously, e.g. "a rougher man near the kitchen" can be a named cast member's first sighting).
- When the anchor is about a cast member, set npcName to their canonical name, and firstSighting: true when the owning scene is the reader's FIRST on-page look at them.
- Whenever firstSighting is true, set appearanceMode to named_on_page only when the source permits the reader to learn the canonical name in that scene; otherwise use anonymous_plant. An anonymous description that corresponds semantically to a cast member remains anonymous even though npcName identifies the contract owner.
- For anchors that are not character first sightings, set appearanceMode to not_applicable.
- onPageAction states what the reader must SEE in the owning scene ("Kylie accepts a protective object from Stela"), not what it means for the season. The action MUST take place at the owning scene's own listed location(s) — never send the reader somewhere the scene doesn't go. If the anchor phrase gives no location detail at all, keep the action location-neutral (a gesture, an object, a spoken line) rather than inventing a place.
- stagedLocation names the ONE location (from the SCENES list below) where onPageAction physically happens — it must be one of the owning scene's own locations, or "unspecified" if the action has no particular place (a spoken line, a handed-over object, a look).
- When the anchor is a relationship or bond ("after testing her", "a new alliance"), onPageAction must name the dramatized EXCHANGE that earns it — a test passed, a cost paid, a vulnerability shown — never a declaration that the bond exists.
- Match the action to the anchor's FUNCTION, not merely to the same character. A protection/safety/sanctuary anchor requires an actual protective intervention, ward, boundary, warning, resource, or accepted safeguard; friendliness, an invitation, or appearing in the scene is not protection. Apply the same discipline to leverage, betrayal, placement, debt, authorship, and other functional anchors.
- sourceRef quotes the anchor phrase from the likely-consequence line.

CAST: ${input.castNames.join(', ') || '(unknown)'}

EPISODE ${input.episodeNumber} OUTLINE:
${input.episodeOutline}

LIKELY CONSEQUENCE (the anchor list):
${input.likelyConsequence}

SCENES (in order, with their actual location(s)):
${orderedScenes.map((scene) => `- ${scene.id} [${(scene.locations ?? []).join(', ') || 'unspecified'}]: ${scene.summary}`).join('\n')}`;
    try {
      const { data } = await this.callLLMForJson<{ anchorContracts: Array<{
        anchorName: string; owningSceneId: string; onPageAction: string; stagedLocation?: string;
        npcName?: string; firstSighting?: boolean; appearanceMode: 'named_on_page' | 'anonymous_plant' | 'not_applicable'; sourceRef?: string;
      }> }>([{ role: 'user', content: prompt }], {
        jsonSchema: anchorContractSchema(orderedScenes.map((scene) => scene.id), input.castNames, knownLocations),
      });
      const sceneById = new Map(orderedScenes.map((scene) => [scene.id, scene]));
      const dropped: string[] = [];
      const contracts = (data?.anchorContracts ?? [])
        .filter((anchor) => anchor
          && typeof anchor.anchorName === 'string' && anchor.anchorName.trim()
          && typeof anchor.onPageAction === 'string' && anchor.onPageAction.trim()
          && typeof anchor.owningSceneId === 'string' && sceneById.has(anchor.owningSceneId))
        .filter((anchor) => {
          // A mismatch means the compiler invented a location the owning
          // scene cannot host; drop the anchor rather than ship an
          // unsatisfiable task (fail-open, per the standing "no valid
          // content can satisfy it" family of fixes).
          const owningLocations = sceneById.get(anchor.owningSceneId)?.locations ?? [];
          const feasible = anchorLocationIsFeasible(anchor.stagedLocation, owningLocations);
          if (!feasible) {
            dropped.push(`${anchor.anchorName} (stagedLocation "${anchor.stagedLocation}" not among ${anchor.owningSceneId}'s locations [${owningLocations.join(', ')}])`);
          }
          return feasible;
        })
        .slice(0, 10)
        .map((anchor, index) => ({
          id: `anchor:${input.episodeNumber}:${index + 1}:${anchor.anchorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)}`,
          anchorName: anchor.anchorName.trim(),
          episodeNumber: input.episodeNumber,
          owningSceneId: anchor.owningSceneId,
          onPageAction: anchor.onPageAction.trim(),
          npcName: anchor.npcName?.trim() || undefined,
          firstSighting: anchor.firstSighting === true || undefined,
          appearanceMode: anchor.appearanceMode,
          sourceRef: anchor.sourceRef?.trim() || undefined,
        }));
      if (dropped.length > 0) {
        console.warn(`[Semantic Contract Compiler] dropped ${dropped.length} anchor(s) with an owner-scene location mismatch: ${dropped.join('; ')}`);
      }
      return contracts;
    } catch (error) {
      console.warn(`[Semantic Contract Compiler] anchor-contract compilation failed (continuing without): ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async compileEventBatch(
    batch: SemanticContractEventSeed[],
    knownLocations: string[],
  ): Promise<AuthoredEventSemanticIR['events']> {
    let batchEvents: AuthoredEventSemanticIR['events'] | undefined;
    let previousRawBatch: RawSemanticBatch | undefined;
    let correctionIssues: string[] = [];
    try {
      for (let structuredAttempt = 1; structuredAttempt <= 2 && !batchEvents; structuredAttempt += 1) {
        const messages = [{ role: 'user' as const, content: this.buildPrompt(batch, knownLocations) }];
        if (correctionIssues.length > 0) {
          messages.push({
            role: 'user',
            content: `Your previous semantic IR was structurally invalid. Correct only these issues and return the complete batch again:\n- ${correctionIssues.join('\n- ')}\n\nPrevious invalid batch:\n${JSON.stringify(previousRawBatch, null, 2)}`,
          });
        }
        const { data } = await this.callLLMForJson<RawSemanticBatch>(messages, {
          jsonSchema: semanticContractSchema(batch.length),
        });
        previousRawBatch = data;
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
    } catch (error) {
      if (error instanceof TruncatedLLMResponseError && batch.length > 1) {
        const midpoint = Math.ceil(batch.length / 2);
        console.warn(`[Semantic Contract Compiler] Batch of ${batch.length} events truncated; recompiling two complete sub-batches.`);
        return [
          ...await this.compileEventBatch(batch.slice(0, midpoint), knownLocations),
          ...await this.compileEventBatch(batch.slice(midpoint), knownLocations),
        ];
      }
      throw error;
    }
    if (!batchEvents && batch.length > 1) {
      const midpoint = Math.ceil(batch.length / 2);
      console.warn(`[Semantic Contract Compiler] Batch of ${batch.length} events remained semantically invalid; recompiling focused sub-batches.`);
      return [
        ...await this.compileEventBatch(batch.slice(0, midpoint), knownLocations),
        ...await this.compileEventBatch(batch.slice(midpoint), knownLocations),
      ];
    }
    if (!batchEvents) throw new Error(`Semantic contract batch failed bounded structured correction: ${correctionIssues.join(' | ')}`);
    return batchEvents;
  }

  private async compilePremiseBatch(
    batch: SemanticContractPremiseSeed[],
  ): Promise<NonNullable<AuthoredEventSemanticIR['premises']>> {
    let batchPremises: NonNullable<AuthoredEventSemanticIR['premises']> | undefined;
    let correctionIssues: string[] = [];
    try {
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
    } catch (error) {
      if (error instanceof TruncatedLLMResponseError && batch.length > 1) {
        const midpoint = Math.ceil(batch.length / 2);
        console.warn(`[Semantic Contract Compiler] Batch of ${batch.length} premises truncated; recompiling two complete sub-batches.`);
        return [
          ...await this.compilePremiseBatch(batch.slice(0, midpoint)),
          ...await this.compilePremiseBatch(batch.slice(midpoint)),
        ];
      }
      throw error;
    }
    if (!batchPremises) throw new Error(`Premise semantic contract batch failed bounded structured correction: ${correctionIssues.join(' | ')}`);
    return batchPremises;
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
        for (const [artifactIndex, artifact] of (proposition.createdLexicalArtifacts ?? []).entries()) {
          if (artifact.artifactId !== `a${artifactIndex + 1}`) {
            throw new Error(`Event ${seed.eventId} proposition ${proposition.propositionId} must use lexical artifact ids a1..aN; received ${artifact.artifactId || '<missing>'}.`);
          }
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
          createdLexicalArtifacts: (proposition.createdLexicalArtifacts ?? []).map((artifact, artifactIndex) => ({
            id: `${seed.eventId}:semantic:${index + 1}:lexical:${artifactIndex + 1}`,
            kind: artifact.kind,
            canonicalValue: artifact.canonicalValue.trim(),
            creatorParticipantId: artifact.creatorParticipantId?.trim() || undefined,
            routePolicy: artifact.routePolicy,
            allowedAlternatives: (artifact.allowedAlternatives ?? []).map((value) => value.trim()).filter(Boolean),
          })),
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
- semanticCriteria are concise evidence guidance for the proposition; they must be entailed by the proposition and may never strengthen its completion state, relationship stage, causality, certainty, or outcome. For example, "befriends" must not become "are friends," an invitation must not become acceptance, and an attempt must not become success.
- The proposition is the canonical requirement. Criteria may clarify who acts or what must be understood, but they may not replace the source predicate with a stronger result state.
- ONE completed meaning per proposition. If a source clause chains several actions with "and" / "then" / "after" (e.g. "After testing her, the three become friends and form the club"), emit one proposition per action — a judge must be able to pass or fail each independently. Never bundle an introduction, a relationship change, and a location reference into one proposition.
- Propositions follow the source's causal/temporal order. An action the source describes as happening FIRST ("after testing Kylie...") must be an earlier proposition, and a later action may list it in prerequisitePropositionIds — never the reverse.
- participantIds name only participants explicitly present in or unambiguously referred to by the cited span. Pronouns may remain pronouns.
- stagedLocation means the action physically occurs there. A mentioned destination belongs in referencedLocations instead.
- Use only these known location strings for location fields: ${knownLocations.length > 0 ? knownLocations.join(' | ') : '(none)'}.
- prerequisitePropositionIds may reference only earlier propositionIds in the same event.
- createdLexicalArtifacts lists exact names, titles, handles, codewords, or group names that THIS proposition creates on-page. Use [] when it creates none. Do not mark an ordinary mention as creation.
- canonicalValue must be copied exactly from sourceSpan. routePolicy is source_invariant when the source mandates that value; use player_selected only when the source explicitly allows the player/protagonist to choose among alternatives. Do not infer optionality merely because the eventual scene may contain a choice.
- artifactId values are a1, a2, ... within the proposition. allowedAlternatives contains only alternatives explicitly authored by the source; otherwise return [].
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
- In second_person narration, the protagonist is represented by you/your. Never create a proposition requiring the protagonist's name or third-person pronouns merely to prove subject identity.
- minimumEvidenceHits is the number of propositions needed to unmistakably establish this field. Prefer 1; use 2 only when two independently load-bearing meanings are necessary. It may not exceed the proposition count.
- Keep no more than 3 propositions unless the authored source contains four genuinely independent, load-bearing meanings.
- Mark a proposition required only when it contributes to minimumEvidenceHits.

INPUT PREMISES:
${JSON.stringify(premises, null, 2)}`;
  }
}
