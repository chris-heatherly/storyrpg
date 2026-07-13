import { describe, expect, it } from 'vitest';
import type { AuthoredEventSemanticIR, NarrativeContractGraph } from '../../types/narrativeContract';
import {
  SEMANTIC_CONTRACT_IR_POLICY_VERSION,
  semanticAtomsForEvent,
  semanticContractEventSeeds,
  semanticContractSourceHash,
  validateAuthoredEventSemanticIR,
} from './semanticContractIr';

const eventId = 'event:ep1:stela-introduces-kylie';
const sourceText = 'Stela introduces Kylie to Valescu Club and her other friend Iulia.';

function graph(): NarrativeContractGraph {
  return {
    version: 1,
    compilerVersion: 'bootstrap',
    storyId: 'bite-me',
    sourceHash: 'bootstrap',
    events: [{
      id: eventId,
      episodeNumber: 1,
      sourceOrder: 1,
      sourceContractIds: ['bite-me:ep1:introduction'],
      sourceText,
      realizationMode: 'depiction',
      ownershipPolicy: 'exactly_one_scene',
      prerequisiteEventIds: [],
      targetSceneIds: ['scene-1'],
      targetSpineUnitIds: [],
      ownerSceneId: 'scene-1',
      realizationAtoms: [{
        id: `${eventId}:atom:1`,
        description: 'legacy bootstrap atom',
        acceptedPatterns: ['malformed heuristic alternative'],
        sourceText,
        kind: 'semantic',
        semanticRole: 'introduction',
        participantIds: ['Stela', 'Kylie', 'Valescu', 'Iulia'],
        prerequisiteAtomIds: [],
        required: true,
      }],
      provenance: { source: 'treatment_contract', confidence: 'authoritative' },
    }],
    characterPresenceContracts: [],
    dependencies: [],
    validation: { passed: true, issues: [] },
  };
}

function ir(): AuthoredEventSemanticIR {
  const seeds = semanticContractEventSeeds(graph());
  return {
    version: 1,
    policyVersion: SEMANTIC_CONTRACT_IR_POLICY_VERSION,
    provider: 'gemini',
    model: 'gemini-test',
    sourceHash: semanticContractSourceHash(seeds),
    events: [{
      ...seeds[0],
      propositions: [
        {
          id: `${eventId}:semantic:1`,
          sourceId: `${eventId}:source:1`,
          sourceSpan: 'Stela introduces Kylie to Valescu Club',
          proposition: 'Stela personally introduces Kylie to the Valescu Club.',
          semanticRole: 'introduction',
          participantIds: ['Stela', 'Kylie'],
          semanticCriteria: ['Stela performs the introduction', 'Kylie is the person being introduced', 'Valescu Club is the introduced social destination'],
          prerequisitePropositionIds: [],
          referencedLocations: [],
          required: true,
        },
        {
          id: `${eventId}:semantic:2`,
          sourceId: `${eventId}:source:1`,
          sourceSpan: 'her other friend Iulia',
          proposition: 'Stela also introduces Kylie to Iulia.',
          semanticRole: 'introduction',
          participantIds: ['Stela', 'Kylie', 'Iulia'],
          semanticCriteria: ['Iulia is presented as Stela\'s friend', 'Kylie and Iulia are introduced'],
          prerequisitePropositionIds: [`${eventId}:semantic:1`],
          referencedLocations: [],
          required: true,
        },
      ],
    }],
  };
}

describe('semantic contract IR', () => {
  it('projects only LLM-authored semantic propositions into canonical atoms', () => {
    const contract = ir();
    const validation = validateAuthoredEventSemanticIR(contract, semanticContractEventSeeds(graph()), []);
    expect(validation).toEqual({ passed: true, issues: [] });

    const atoms = semanticAtomsForEvent({ id: eventId, sourceText }, contract);
    expect(atoms).toHaveLength(2);
    expect(atoms[0]).toMatchObject({
      id: `${eventId}:semantic:1`,
      verificationAuthority: 'semantic_judge',
      description: 'Stela personally introduces Kylie to the Valescu Club.',
    });
    expect(atoms.flatMap((atom) => atom.acceptedPatterns)).not.toContain('malformed heuristic alternative');
  });

  it('rejects stale provenance, invented locations, and non-monotonic prerequisites', () => {
    const contract = ir();
    contract.sourceHash = 'stale';
    contract.events[0].propositions[0].stagedLocation = 'Invented Ballroom';
    contract.events[0].propositions[0].prerequisitePropositionIds = [`${eventId}:semantic:2`];

    const result = validateAuthoredEventSemanticIR(contract, semanticContractEventSeeds(graph()), ['Valescu Club']);
    expect(result.passed).toBe(false);
    expect(result.issues.join(' | ')).toMatch(/source hash/);
    expect(result.issues.join(' | ')).toMatch(/unknown location/);
    expect(result.issues.join(' | ')).toMatch(/earlier proposition/);
  });

  it('rejects source spans that are not exact authored substrings', () => {
    const contract = ir();
    contract.events[0].propositions[0].sourceSpan = 'Kylie meets everyone at the club';
    const result = validateAuthoredEventSemanticIR(contract, semanticContractEventSeeds(graph()), []);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain(
      `Semantic proposition ${eventId}:semantic:1 source span is not an exact substring of ${eventId}:source:1.`,
    );
  });
});
