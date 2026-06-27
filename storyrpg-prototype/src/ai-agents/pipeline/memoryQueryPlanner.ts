import type { AgentMemoryRequest, AgentMemoryRole, ValidatorEvidenceRequest } from './pipelineMemory';
import type { PipelineMemoryFactKind } from './artifactMemoryTypes';

export interface PlannedMemoryQuery {
  query: string;
  factKinds?: PipelineMemoryFactKind[];
  topK?: number;
}

function scopeText(request: Pick<AgentMemoryRequest, 'storyId' | 'episodeNumber' | 'sceneId' | 'characterIds' | 'artifactKinds' | 'artifactIds' | 'factKinds'>): string {
  return [
    request.storyId ? `story ${request.storyId}` : null,
    request.episodeNumber != null ? `episode ${request.episodeNumber}` : null,
    request.sceneId ? `scene ${request.sceneId}` : null,
    request.characterIds?.length ? `characters ${request.characterIds.join(', ')}` : null,
    request.artifactKinds?.length ? `artifact kinds ${request.artifactKinds.join(', ')}` : null,
    request.artifactIds?.length ? `artifact ids ${request.artifactIds.join(', ')}` : null,
    request.factKinds?.length ? `fact kinds ${request.factKinds.join(', ')}` : null,
  ].filter(Boolean).join(', ');
}

function q(request: AgentMemoryRequest, factKinds: PipelineMemoryFactKind[], text: string, topK = 4): PlannedMemoryQuery {
  const scope = scopeText(request);
  return {
    factKinds,
    topK,
    query: `${request.agentRole} ${request.lifecycle}${scope ? ` for ${scope}` : ''}: ${text}`,
  };
}

const rolePlans: Record<AgentMemoryRole, Array<{ factKinds: PipelineMemoryFactKind[]; text: string; topK?: number }>> = {
  SourceMaterialAnalyzer: [
    { factKinds: ['source-obligation', 'source-quote', 'story-anchor'], text: 'validated source obligations, quote recall duties, and treatment fidelity rules', topK: 6 },
    { factKinds: ['validator-failure', 'repair-learning'], text: 'prior source-analysis failures and repairs for quote drift or missed obligations', topK: 3 },
  ],
  WorldBuilder: [
    { factKinds: ['world-rule', 'location-fact', 'source-obligation'], text: 'world rules, location constraints, and source constraints relevant to this world pass', topK: 6 },
    { factKinds: ['validator-failure', 'repair-learning'], text: 'prior location continuity or worldbuilding failures and successful repairs', topK: 3 },
  ],
  CharacterDesigner: [
    { factKinds: ['character-fact', 'relationship-fact', 'voice-fact'], text: 'character identity, motivation, voice, and relationship facts', topK: 6 },
    { factKinds: ['appearance-fact', 'media-style-fact'], text: 'appearance and reference-image continuity facts', topK: 4 },
    { factKinds: ['validator-failure', 'repair-learning'], text: 'prior character depth, relationship pacing, and reference consistency failures', topK: 3 },
  ],
  StoryArchitect: [
    { factKinds: ['story-anchor', 'story-circle-role', 'source-obligation'], text: 'story anchors, structural roles, and treatment obligations for planning', topK: 6 },
    { factKinds: ['branch-topology', 'callback-obligation', 'residue-obligation'], text: 'branch topology, setup/payoff, callback, and residue obligations for architecture', topK: 5 },
    { factKinds: ['validator-failure', 'repair-learning'], text: 'prior plan-time fidelity, branch topology, and structure failures', topK: 4 },
  ],
  BranchManager: [
    { factKinds: ['branch-topology', 'choice-consequence'], text: 'branch fanout, reconvergence, bottleneck, and choice target facts', topK: 6 },
    { factKinds: ['validator-failure', 'repair-learning'], text: 'prior skipped setup, collapsed branch, and reconvergence repair lessons', topK: 4 },
  ],
  SceneWriter: [
    { factKinds: ['scene-canon', 'episode-canon'], text: 'current scene canon and episode-local facts', topK: 6 },
    { factKinds: ['callback-obligation', 'residue-obligation'], text: 'callbacks, residue, setup/payoff obligations, and prior-scene aftermath', topK: 6 },
    { factKinds: ['source-obligation', 'source-quote'], text: 'source obligations and quote recall duties relevant to this scene', topK: 4 },
    { factKinds: ['validator-failure', 'repair-learning'], text: 'prior continuity, prose drift, POV, and pressure-architecture failures for scene writing', topK: 4 },
  ],
  ChoiceAuthor: [
    { factKinds: ['choice-consequence', 'branch-topology'], text: 'choice consequences, branch targets, flags, witness IDs, and reconvergence facts', topK: 6 },
    { factKinds: ['callback-obligation', 'residue-obligation'], text: 'callback debt and residue affected by choices', topK: 4 },
    { factKinds: ['validator-failure', 'repair-learning'], text: 'prior choice-impact, consequence-budget, and branch-target failures', topK: 4 },
  ],
  EncounterArchitect: [
    { factKinds: ['encounter-anchor', 'choice-consequence', 'scene-canon'], text: 'encounter anchors, outcome variants, scene stakes, and consequence facts', topK: 6 },
    { factKinds: ['validator-failure', 'repair-learning'], text: 'prior encounter QA, POV integrity, prose integrity, and outcome desync repairs', topK: 4 },
  ],
  ThreadPlanner: [
    { factKinds: ['callback-obligation', 'residue-obligation', 'story-anchor'], text: 'setup/payoff, callback, and story-anchor facts before thread planning', topK: 6 },
  ],
  TwistArchitect: [
    { factKinds: ['story-anchor', 'story-circle-role', 'callback-obligation'], text: 'foreshadowing, reversal timing, reveal integrity, and setup facts', topK: 6 },
    { factKinds: ['validator-failure', 'repair-learning'], text: 'prior twist quality and foreshadow-before-reveal failures', topK: 3 },
  ],
  CharacterArcTracker: [
    { factKinds: ['character-fact', 'relationship-fact', 'episode-canon'], text: 'identity deltas, relationship milestones, and arc target facts', topK: 6 },
    { factKinds: ['validator-failure', 'repair-learning'], text: 'prior arc delta and relationship pacing failures', topK: 3 },
  ],
  ImageAgentTeam: [
    { factKinds: ['appearance-fact', 'media-style-fact'], text: 'style bible, character appearance, pose diversity, and visual continuity facts', topK: 7 },
    { factKinds: ['provider-failure', 'repair-learning'], text: 'image provider failures and successful visual repair lessons', topK: 3 },
  ],
  AudioGenerationService: [
    { factKinds: ['voice-fact', 'character-fact'], text: 'voice casting, narration style, and character voice facts', topK: 5 },
    { factKinds: ['provider-failure', 'repair-learning'], text: 'audio provider failures and successful narration repair lessons', topK: 3 },
  ],
  VideoDirectorAgent: [
    { factKinds: ['scene-canon', 'appearance-fact', 'media-style-fact'], text: 'visual continuity, camera direction, scene canon, and character appearance facts', topK: 6 },
    { factKinds: ['provider-failure', 'repair-learning'], text: 'video provider failures and successful video repair lessons', topK: 3 },
  ],
  QARunner: [
    { factKinds: ['validator-failure', 'repair-learning'], text: 'validation failures, successful repairs, recurring quality issues, and regression notes', topK: 7 },
  ],
  FinalContract: [
    { factKinds: ['source-obligation', 'story-anchor', 'story-circle-role', 'episode-canon'], text: 'validated final-contract candidate facts and source obligations', topK: 7 },
    { factKinds: ['validator-failure', 'repair-learning'], text: 'final contract failures, repair routes, and regression notes', topK: 5 },
  ],
};

export function planAgentMemoryQueries(request: AgentMemoryRequest): PlannedMemoryQuery[] {
  if (request.queries?.length) {
    return request.queries.map((query) => ({ query, factKinds: request.factKinds, topK: request.topK }));
  }
  const plans = rolePlans[request.agentRole] || [{ factKinds: request.factKinds || [], text: 'relevant StoryRPG generation facts' }];
  return plans.map((plan) => q(request, request.factKinds?.length ? request.factKinds : plan.factKinds, plan.text, plan.topK));
}

export function planValidatorMemoryQueries(request: ValidatorEvidenceRequest): PlannedMemoryQuery[] {
  if (request.queries?.length) {
    return request.queries.map((query) => ({ query, factKinds: request.factKinds, topK: request.topK }));
  }
  const scope = scopeText(request);
  const factKinds: PipelineMemoryFactKind[] = request.factKinds?.length
    ? request.factKinds
    : ['validator-failure', 'repair-learning', 'source-obligation'];
  return [{
    factKinds,
    topK: request.topK || 5,
    query: `${request.validator} ${request.lifecycle}${scope ? ` for ${scope}` : ''}: retrieve validated facts, prior failures, related findings, repair routes, source obligations, and regression notes`,
  }];
}
