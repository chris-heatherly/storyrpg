import type {
  AuthoredEventSemanticContract,
  AuthoredEventSemanticIR,
  AuthoredEventSemanticRole,
  AuthoredPremiseSemanticContract,
  NarrativeContractGraph,
  NarrativeEvidenceAtom,
  NarrativeEventContract,
} from '../../types/narrativeContract';
import { stableHash } from './artifacts/store';
import { entityTokens, matchesEntityAuthority } from '../utils/entityIdentity';

export const SEMANTIC_CONTRACT_IR_POLICY_VERSION = 'semantic-contract-ir-v2';

const SEMANTIC_ROLES: ReadonlySet<AuthoredEventSemanticRole> = new Set([
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
]);

export interface SemanticContractEventSeed {
  eventId: string;
  sourceText: string;
  sources: Array<{ id: string; text: string }>;
}

export interface SemanticContractPremiseSeed {
  premiseId: string;
  fieldName: string;
  fieldKind: string;
  sourceText: string;
  narrativeVoice: 'second_person';
}

export interface SemanticContractIrValidation {
  passed: boolean;
  issues: string[];
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

// Shared cross-artifact entity identity (Systemic Guards W2.2): two LLM
// outputs never agree on exact strings — see utils/entityIdentity.ts for the
// standing rule. Re-exported here for existing callers.
export { entityTokens as semanticLocationTokens } from '../utils/entityIdentity';

export function collectKnownSemanticLocations(
  ...locationGroups: Array<ReadonlyArray<string | undefined>>
): string[] {
  const byNormalizedName = new Map<string, string>();
  for (const location of locationGroups.flat()) {
    const name = clean(location);
    if (!name) continue;
    const normalized = name.toLowerCase();
    if (!byNormalizedName.has(normalized)) byNormalizedName.set(normalized, name);
  }
  return [...byNormalizedName.values()].sort((left, right) => left.localeCompare(right));
}

/**
 * Extracts only authored source segments from the bootstrap graph. Existing
 * heuristic atoms may carry supporting-intent provenance, but none of their
 * inferred roles, participants, alternatives, or boundaries are reused.
 */
export function semanticContractEventSeeds(graph: NarrativeContractGraph): SemanticContractEventSeed[] {
  return graph.events
    .filter((event) => event.realizationMode === 'depiction')
    .map((event) => {
      const persistedContract = graph.semanticEventIr?.events.find((contract) => contract.eventId === event.id);
      if (persistedContract) {
        return {
          eventId: event.id,
          sourceText: clean(event.sourceText),
          sources: persistedContract.sources.map((source) => ({ ...source })),
        };
      }
      const sourceTexts = unique([
        clean(event.sourceText),
        ...(event.realizationAtoms ?? []).map((atom) => clean(atom.sourceText)),
      ].filter(Boolean));
      return {
        eventId: event.id,
        sourceText: clean(event.sourceText),
        sources: sourceTexts.map((text, index) => ({
          id: `${event.id}:source:${index + 1}`,
          text,
        })),
      };
    })
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
}

export function semanticContractSourceHash(events: SemanticContractEventSeed[]): string {
  return stableHash(events.map((event) => ({
    eventId: event.eventId,
    sourceText: event.sourceText,
    sources: event.sources,
  })));
}

export function semanticContractPremiseSeeds(graph: NarrativeContractGraph): SemanticContractPremiseSeed[] {
  return (graph.premiseContracts ?? [])
    .map((premise) => ({
      premiseId: premise.id,
      fieldName: premise.fieldName,
      fieldKind: premise.fieldKind,
      sourceText: clean(premise.sourceText),
      narrativeVoice: graph.narrativeVoice ?? 'second_person',
    }))
    .sort((left, right) => left.premiseId.localeCompare(right.premiseId));
}

export function semanticContractPremiseSourceHash(premises: SemanticContractPremiseSeed[]): string {
  return stableHash(premises);
}

export function validateAuthoredEventSemanticIR(
  ir: AuthoredEventSemanticIR,
  expectedEvents: SemanticContractEventSeed[],
  knownLocations: string[],
  expectedPremises?: SemanticContractPremiseSeed[],
): SemanticContractIrValidation {
  const issues: string[] = [];
  if (ir.version !== 1) issues.push(`Unsupported semantic IR version ${String(ir.version)}.`);
  if (ir.policyVersion !== SEMANTIC_CONTRACT_IR_POLICY_VERSION) {
    issues.push(`Semantic IR policy ${ir.policyVersion || '<missing>'} does not match ${SEMANTIC_CONTRACT_IR_POLICY_VERSION}.`);
  }
  const expectedHash = semanticContractSourceHash(expectedEvents);
  if (ir.sourceHash !== expectedHash) issues.push('Semantic IR source hash does not match the depiction-event sources.');

  const expectedById = new Map(expectedEvents.map((event) => [event.eventId, event]));
  const actualIds = new Set<string>();
  const knownLocationTokenSets = knownLocations
    .map((location) => entityTokens(location))
    .filter((tokens) => tokens.size > 0);
  // Tolerant authority matching: the IR compiler and the season planner are
  // separate LLM outputs, so exact string equality between them is a plan
  // lottery — "Kylie's Lipscani apartment" failed against an authority that
  // rolled "Kylie's Apartment" and killed the run at source analysis
  // (worker-1784082660976). A reference is KNOWN when its content tokens are
  // a subset or superset of any authority entry: qualifiers and sublocations
  // of known places pass; genuinely invented places still fail.
  const isKnownLocation = (location: string): boolean =>
    matchesEntityAuthority(location, knownLocationTokenSets);

  for (const event of ir.events ?? []) {
    if (actualIds.has(event.eventId)) {
      issues.push(`Semantic IR duplicates event ${event.eventId}.`);
      continue;
    }
    actualIds.add(event.eventId);
    const expected = expectedById.get(event.eventId);
    if (!expected) {
      issues.push(`Semantic IR contains unknown event ${event.eventId}.`);
      continue;
    }
    if (event.sourceText !== expected.sourceText) issues.push(`Semantic IR changed source text for ${event.eventId}.`);
    if (stableHash(event.sources) !== stableHash(expected.sources)) issues.push(`Semantic IR changed source segments for ${event.eventId}.`);
    if (!Array.isArray(event.propositions) || event.propositions.length < 1 || event.propositions.length > 8) {
      issues.push(`Semantic IR event ${event.eventId} must contain 1-8 propositions.`);
      continue;
    }
    const sources = new Map(expected.sources.map((source) => [source.id, source.text]));
    const citedSourceIds = new Set<string>();
    const propositionIds = new Set<string>();
    const propositionsById = new Map<string, (typeof event.propositions)[number]>();
    for (const [index, proposition] of event.propositions.entries()) {
      const expectedId = `${event.eventId}:semantic:${index + 1}`;
      if (proposition.id !== expectedId) issues.push(`Semantic proposition ${proposition.id || '<missing>'} must have stable id ${expectedId}.`);
      if (propositionIds.has(proposition.id)) issues.push(`Semantic IR duplicates proposition ${proposition.id}.`);
      propositionIds.add(proposition.id);
      propositionsById.set(proposition.id, proposition);
      const source = sources.get(proposition.sourceId);
      if (!source) {
        issues.push(`Semantic proposition ${proposition.id} cites unknown source ${proposition.sourceId}.`);
      } else if (!proposition.sourceSpan || !source.includes(proposition.sourceSpan)) {
        issues.push(`Semantic proposition ${proposition.id} source span is not an exact substring of ${proposition.sourceId}.`);
      } else {
        citedSourceIds.add(proposition.sourceId);
      }
      if (!clean(proposition.proposition)) issues.push(`Semantic proposition ${proposition.id} has no proposition text.`);
      if (!SEMANTIC_ROLES.has(proposition.semanticRole)) issues.push(`Semantic proposition ${proposition.id} has invalid role ${String(proposition.semanticRole)}.`);
      if (!Array.isArray(proposition.semanticCriteria) || proposition.semanticCriteria.length < 1 || proposition.semanticCriteria.length > 6) {
        issues.push(`Semantic proposition ${proposition.id} must contain 1-6 semantic criteria.`);
      } else if (proposition.semanticCriteria.some((criterion) => !clean(criterion) || clean(criterion).length > 240)) {
        issues.push(`Semantic proposition ${proposition.id} contains an empty or oversized criterion.`);
      }
      if (!Array.isArray(proposition.participantIds) || proposition.participantIds.length > 8) {
        issues.push(`Semantic proposition ${proposition.id} has invalid participants.`);
      }
      if (proposition.stagedLocation && !isKnownLocation(proposition.stagedLocation)) {
        issues.push(`Semantic proposition ${proposition.id} stages unknown location ${proposition.stagedLocation}.`);
      }
      for (const location of proposition.referencedLocations ?? []) {
        if (!isKnownLocation(location)) {
          issues.push(`Semantic proposition ${proposition.id} references unknown location ${location}.`);
        }
      }
      for (const prerequisiteId of proposition.prerequisitePropositionIds ?? []) {
        if (!propositionIds.has(prerequisiteId)) {
          issues.push(`Semantic proposition ${proposition.id} prerequisite ${prerequisiteId} must refer to an earlier proposition in the same event.`);
          continue;
        }
        // Source-order sanity: when both propositions cite the same source
        // segment, the prerequisite's span must not START after the dependent's
        // — a dependency pointing backward against the authored chronology
        // ("form the Dusk Club" as prerequisite of "Kylie is tested" when the
        // source reads "After testing Kylie, the three ... form the Dusk
        // Club") compiles an impossible staging order for every downstream
        // owner surface.
        const prerequisite = propositionsById.get(prerequisiteId);
        if (prerequisite && prerequisite.sourceId === proposition.sourceId && source) {
          const prerequisiteStart = source.indexOf(prerequisite.sourceSpan ?? '');
          const dependentStart = source.indexOf(proposition.sourceSpan ?? '');
          if (prerequisiteStart >= 0 && dependentStart >= 0 && prerequisiteStart > dependentStart) {
            issues.push(`Semantic proposition ${proposition.id} depends on ${prerequisiteId}, but the prerequisite's source span appears LATER in the source — the dependency inverts the authored chronology.`);
          }
        }
      }
      const lexicalIds = new Set<string>();
      for (const artifact of proposition.createdLexicalArtifacts ?? []) {
        if (!artifact.id || lexicalIds.has(artifact.id)) {
          issues.push(`Semantic proposition ${proposition.id} has a missing or duplicate lexical artifact id.`);
        }
        lexicalIds.add(artifact.id);
        if (!clean(artifact.canonicalValue) || !proposition.sourceSpan.includes(artifact.canonicalValue)) {
          issues.push(`Lexical artifact ${artifact.id} value must be copied exactly from proposition ${proposition.id}'s source span.`);
        }
        if (artifact.routePolicy === 'source_invariant' && artifact.allowedAlternatives.length > 0) {
          issues.push(`Source-invariant lexical artifact ${artifact.id} cannot declare route alternatives.`);
        }
        if (artifact.routePolicy === 'player_selected' && artifact.allowedAlternatives.length === 0) {
          issues.push(`Player-selected lexical artifact ${artifact.id} must declare at least one authored alternative.`);
        }
        if (artifact.allowedAlternatives.some((alternative) => !proposition.sourceSpan.includes(alternative))) {
          issues.push(`Lexical artifact ${artifact.id} declares an alternative absent from its exact source span.`);
        }
      }
    }
    for (const sourceId of sources.keys()) {
      if (!citedSourceIds.has(sourceId)) issues.push(`Semantic IR event ${event.eventId} does not realize authored source segment ${sourceId}.`);
    }
  }

  for (const expected of expectedEvents) {
    if (!actualIds.has(expected.eventId)) issues.push(`Semantic IR is missing depiction event ${expected.eventId}.`);
  }
  if (expectedPremises) {
    const expectedPremiseHash = semanticContractPremiseSourceHash(expectedPremises);
    if (ir.premiseSourceHash !== expectedPremiseHash) {
      issues.push('Semantic IR premise source hash does not match the authored premise sources.');
    }
    const expectedPremiseById = new Map(expectedPremises.map((premise) => [premise.premiseId, premise]));
    const actualPremiseIds = new Set<string>();
    for (const premise of ir.premises ?? []) {
      if (actualPremiseIds.has(premise.premiseId)) {
        issues.push(`Semantic IR duplicates premise ${premise.premiseId}.`);
        continue;
      }
      actualPremiseIds.add(premise.premiseId);
      const expected = expectedPremiseById.get(premise.premiseId);
      if (!expected) {
        issues.push(`Semantic IR contains unknown premise ${premise.premiseId}.`);
        continue;
      }
      if (premise.sourceText !== expected.sourceText) issues.push(`Semantic IR changed source text for premise ${premise.premiseId}.`);
      if (!Array.isArray(premise.propositions) || premise.propositions.length < 1 || premise.propositions.length > 4) {
        issues.push(`Semantic IR premise ${premise.premiseId} must contain 1-4 propositions.`);
        continue;
      }
      if (!Number.isInteger(premise.minimumEvidenceHits)
        || premise.minimumEvidenceHits < 1
        || premise.minimumEvidenceHits > premise.propositions.length) {
        issues.push(`Semantic IR premise ${premise.premiseId} has an invalid evidence threshold.`);
      }
      for (const [index, proposition] of premise.propositions.entries()) {
        const expectedId = `${premise.premiseId}:semantic:${index + 1}`;
        if (proposition.id !== expectedId) issues.push(`Premise proposition ${proposition.id || '<missing>'} must have stable id ${expectedId}.`);
        if (!proposition.sourceSpan || !expected.sourceText.includes(proposition.sourceSpan)) {
          issues.push(`Premise proposition ${proposition.id} source span is not an exact substring of its authored source.`);
        }
        if (clean(proposition.proposition).split(/\s+/).length < 3) {
          issues.push(`Premise proposition ${proposition.id} is not an independently judgeable subject-predicate claim.`);
        }
        if (!Array.isArray(proposition.semanticCriteria)
          || proposition.semanticCriteria.length < 1
          || proposition.semanticCriteria.length > 5
          || proposition.semanticCriteria.some((criterion) => clean(criterion).split(/\s+/).length < 2)) {
          issues.push(`Premise proposition ${proposition.id} must contain 1-5 meaning-level criteria, not isolated vocabulary.`);
        }
        if (proposition.verificationAuthority !== 'literal' && proposition.verificationAuthority !== 'semantic_judge') {
          issues.push(`Premise proposition ${proposition.id} has invalid verification authority ${String(proposition.verificationAuthority)}.`);
        }
      }
    }
    for (const expected of expectedPremises) {
      if (!actualPremiseIds.has(expected.premiseId)) issues.push(`Semantic IR is missing authored premise ${expected.premiseId}.`);
    }
  }
  return { passed: issues.length === 0, issues };
}

export function semanticAtomsForEvent(
  event: Pick<NarrativeEventContract, 'id' | 'sourceText'>,
  ir: AuthoredEventSemanticIR,
): NarrativeEvidenceAtom[] {
  const contract = ir.events.find((candidate) => candidate.eventId === event.id);
  if (!contract) throw new Error(`[SemanticContractIR] Missing semantic contract for depiction event ${event.id}.`);
  if (contract.sourceText !== clean(event.sourceText)) {
    throw new Error(`[SemanticContractIR] Source text drift for depiction event ${event.id}.`);
  }
  return contract.propositions.map((proposition): NarrativeEvidenceAtom => ({
    id: proposition.id,
    description: proposition.proposition,
    acceptedPatterns: [proposition.sourceSpan],
    sourceText: contract.sources.find((source) => source.id === proposition.sourceId)?.text ?? contract.sourceText,
    kind: 'semantic',
    verificationAuthority: 'semantic_judge',
    // The proposition is the canonical, source-grounded requirement. Compiler
    // criteria are useful drafting notes, but an LLM paraphrase can accidentally
    // strengthen aspect or completion state (for example, "befriends" into
    // "are friends"). Never let that secondary text redefine the gate.
    semanticCriteria: [proposition.proposition],
    semanticRole: proposition.semanticRole,
    participantIds: proposition.participantIds,
    prerequisiteAtomIds: proposition.prerequisitePropositionIds,
    stagedLocation: proposition.stagedLocation,
    referencedLocations: proposition.referencedLocations,
    required: proposition.required,
  }));
}

export function semanticContractForEvent(
  ir: AuthoredEventSemanticIR,
  eventId: string,
): AuthoredEventSemanticContract | undefined {
  return ir.events.find((event) => event.eventId === eventId);
}

export function semanticContractForPremise(
  ir: AuthoredEventSemanticIR,
  premiseId: string,
): AuthoredPremiseSemanticContract | undefined {
  return ir.premises?.find((premise) => premise.premiseId === premiseId);
}
