import type { ArtifactMemoryService } from './artifactMemoryService';
import type { PipelineFactRecord } from './artifactMemoryTypes';

export interface CorroboratedFact {
  fact: string;
  corroboratedBy: string[];
  confidence: number;
}

export interface CorroborationResult {
  validatedFacts: PipelineFactRecord[];
  candidateFacts: PipelineFactRecord[];
  rejectedFacts: Array<{ fact: PipelineFactRecord; reason: string }>;
  corroboratedSnippets: string[];
  facts: CorroboratedFact[];
  confidence: number;
}

function artifactRefKey(ref: PipelineFactRecord['artifactRefs'][number]): string {
  return `${ref.artifactKind}:${ref.artifactId}:${ref.contentHash}`;
}

export function corroborateFacts(
  recalledSnippets: string[],
  candidateFacts: PipelineFactRecord[],
  artifactMemory: ArtifactMemoryService,
): CorroborationResult {
  const validatedFacts: PipelineFactRecord[] = [];
  const staleFacts: PipelineFactRecord[] = [];
  const rejectedFacts: CorroborationResult['rejectedFacts'] = [];

  for (const fact of candidateFacts) {
    if (fact.status === 'superseded' || fact.status === 'rejected') {
      rejectedFacts.push({ fact, reason: `fact status is ${fact.status}` });
      continue;
    }
    if (!fact.artifactRefs.length) {
      staleFacts.push(fact);
      continue;
    }
    const corroboratedBy: string[] = [];
    let allRefsValid = true;
    let anyLiveArtifact = false;
    for (const ref of fact.artifactRefs) {
      const live = artifactMemory.resolveLiveArtifact({
        artifactId: ref.artifactId,
        artifactKind: ref.artifactKind,
      });
      if (!live) {
        allRefsValid = false;
        continue;
      }
      anyLiveArtifact = true;
      if (live.contentHash === ref.contentHash) {
        corroboratedBy.push(artifactRefKey(ref));
      } else {
        allRefsValid = false;
      }
    }
    if (allRefsValid && corroboratedBy.length > 0) {
      validatedFacts.push(fact);
    } else if (anyLiveArtifact) {
      staleFacts.push(fact);
    } else {
      rejectedFacts.push({ fact, reason: 'no live artifact refs with matching content hash' });
    }
  }

  const facts: CorroboratedFact[] = validatedFacts.map((fact) => ({
    fact: fact.statement,
    corroboratedBy: fact.artifactRefs.map(artifactRefKey),
    confidence: fact.confidence,
  }));

  const corroboratedSnippets = [
    ...validatedFacts.map((fact) => `[validated ${fact.factKind}] ${fact.statement}`),
    ...recalledSnippets,
  ];

  const confidence = validatedFacts.length
    ? validatedFacts.reduce((sum, fact) => sum + fact.confidence, 0) / validatedFacts.length
    : recalledSnippets.length ? 0.35 : 0;

  return {
    validatedFacts,
    candidateFacts: staleFacts,
    rejectedFacts,
    corroboratedSnippets,
    facts,
    confidence,
  };
}
