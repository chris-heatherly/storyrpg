import { sha256Hex } from '../utils/atomicIo';
import { PipelineMemory, slugifyMemoryKey } from './pipelineMemory';
import type {
  PipelineArtifactEnvelope,
  PipelineFactRecord,
  PipelineMemoryFactKind,
} from './artifactMemoryTypes';

const MAX_FACTS_PER_ARTIFACT = 80;

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 0 ? clean : undefined;
}

function arrayOfObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((item): item is string => Boolean(item)) : [];
}

function subjectId(record: Record<string, unknown>, fallback: string): string {
  return text(record.id) || text(record.sceneId) || text(record.beatId) || text(record.characterId) || text(record.name) || fallback;
}

function factId(input: {
  storyId: string;
  runId: string;
  factKind: PipelineMemoryFactKind;
  subjectId?: string;
  predicate?: string;
  statement: string;
  artifactId: string;
}): string {
  const stable = [
    input.storyId,
    input.runId,
    input.factKind,
    input.subjectId || '',
    input.predicate || '',
    input.statement,
    input.artifactId,
  ].join('|');
  return `${input.factKind}:${slugifyMemoryKey(input.subjectId || 'global')}:${sha256Hex(stable).slice(0, 16)}`;
}

function makeFact(
  envelope: PipelineArtifactEnvelope,
  factKind: PipelineMemoryFactKind,
  statement: string | undefined,
  options: Partial<Pick<PipelineFactRecord, 'subjectId' | 'predicate' | 'value' | 'characterIds' | 'locationIds' | 'status' | 'confidence' | 'validatorRefs'>> = {},
): PipelineFactRecord | null {
  const cleanStatement = text(statement);
  if (!cleanStatement) return null;
  const id = factId({
    storyId: envelope.storyId,
    runId: envelope.runId,
    factKind,
    subjectId: options.subjectId,
    predicate: options.predicate,
    statement: cleanStatement,
    artifactId: envelope.artifactId,
  });
  return {
    factId: id,
    factKind,
    statement: cleanStatement,
    subjectId: options.subjectId,
    predicate: options.predicate,
    value: options.value,
    storyId: envelope.storyId,
    runId: envelope.runId,
    episodeNumber: envelope.episodeNumber,
    sceneId: envelope.sceneId,
    characterIds: options.characterIds || envelope.characterIds,
    locationIds: options.locationIds,
    sourceFingerprint: envelope.sourceFingerprint,
    status: options.status || (envelope.provenance.validator ? 'validated' : 'adopted'),
    confidence: options.confidence ?? (envelope.provenance.validator ? 0.9 : 0.75),
    artifactRefs: [{
      artifactKind: envelope.artifactKind,
      artifactId: envelope.artifactId,
      contentHash: envelope.contentHash,
    }],
    validatorRefs: options.validatorRefs || (envelope.provenance.validator ? [{
      validator: envelope.provenance.validator,
      lifecycle: envelope.lifecycle,
      outcome: 'passed',
    }] : undefined),
    createdAt: envelope.createdAt,
  };
}

function pushFact(facts: PipelineFactRecord[], fact: PipelineFactRecord | null): void {
  if (!fact) return;
  if (facts.some((existing) => existing.factId === fact.factId)) return;
  if (facts.length >= MAX_FACTS_PER_ARTIFACT) return;
  facts.push(fact);
}

function collectSourceFacts(envelope: PipelineArtifactEnvelope, record: Record<string, unknown>, facts: PipelineFactRecord[]): void {
  for (const [key, value] of Object.entries(record.anchors || {})) {
    pushFact(facts, makeFact(envelope, 'story-anchor', `${key}: ${text(value)}`, {
      subjectId: key,
      predicate: 'source-anchor',
      value: text(value),
      confidence: 0.85,
    }));
  }
  for (const [key, value] of Object.entries(record.storyCircle || record.sevenPoint || {})) {
    pushFact(facts, makeFact(envelope, 'story-circle-role', `${key}: ${text(value)}`, {
      subjectId: key,
      predicate: 'structural-role',
      value: text(value),
      confidence: 0.82,
    }));
  }
  for (const obligation of arrayOfStrings(record.treatmentObligations || record.sourceObligations || record.keyObligations)) {
    pushFact(facts, makeFact(envelope, 'source-obligation', obligation, {
      subjectId: slugifyMemoryKey(obligation).slice(0, 48),
      predicate: 'requires',
      confidence: 0.84,
    }));
  }
  for (const quote of arrayOfStrings(record.quotes || record.requiredQuotes || record.quoteObligations)) {
    pushFact(facts, makeFact(envelope, 'source-quote', quote, {
      subjectId: slugifyMemoryKey(quote).slice(0, 48),
      predicate: 'quote',
      confidence: 0.84,
    }));
  }
  for (const episode of arrayOfObjects(record.episodeBreakdown)) {
    const number = episode.episodeNumber ?? episode.number;
    const role = text(episode.storyCircleRole) || text(episode.structuralRole);
    pushFact(facts, makeFact(envelope, 'episode-canon', `Episode ${number}: ${text(episode.title) || text(episode.summary) || role}`, {
      subjectId: number != null ? `episode-${number}` : subjectId(episode, 'episode'),
      predicate: 'episode-outline',
      confidence: 0.78,
    }));
    if (role) {
      pushFact(facts, makeFact(envelope, 'story-circle-role', `Episode ${number} carries ${role}`, {
        subjectId: number != null ? `episode-${number}` : subjectId(episode, 'episode'),
        predicate: 'episode-structural-role',
        value: role,
        confidence: 0.82,
      }));
    }
  }
}

function collectWorldFacts(envelope: PipelineArtifactEnvelope, record: Record<string, unknown>, facts: PipelineFactRecord[]): void {
  for (const rule of arrayOfStrings(record.worldRules)) {
    pushFact(facts, makeFact(envelope, 'world-rule', rule, { subjectId: slugifyMemoryKey(rule).slice(0, 48), predicate: 'world-rule' }));
  }
  for (const tension of arrayOfStrings(record.tensions)) {
    pushFact(facts, makeFact(envelope, 'world-rule', tension, { subjectId: slugifyMemoryKey(tension).slice(0, 48), predicate: 'world-tension' }));
  }
  for (const location of arrayOfObjects(record.locations)) {
    const id = subjectId(location, 'location');
    pushFact(facts, makeFact(envelope, 'location-fact', `${text(location.name) || id}: ${text(location.description) || text(location.atmosphere)}`, {
      subjectId: id,
      predicate: 'location',
      locationIds: [id],
    }));
  }
}

function collectCharacterFacts(envelope: PipelineArtifactEnvelope, record: Record<string, unknown>, facts: PipelineFactRecord[]): void {
  for (const character of arrayOfObjects(record.characters)) {
    const id = subjectId(character, 'character');
    const name = text(character.name) || id;
    pushFact(facts, makeFact(envelope, 'character-fact', `${name}: ${text(character.overview) || text(character.description) || text(character.role)}`, {
      subjectId: id,
      predicate: 'identity',
      characterIds: [id],
    }));
    for (const key of ['motivation', 'voice', 'speakingStyle', 'personality', 'arc']) {
      const value = text(character[key]);
      if (!value) continue;
      pushFact(facts, makeFact(envelope, key === 'voice' || key === 'speakingStyle' ? 'voice-fact' : 'character-fact', `${name} ${key}: ${value}`, {
        subjectId: id,
        predicate: key,
        value,
        characterIds: [id],
      }));
    }
    for (const appearance of arrayOfStrings([character.appearance, character.visualDescription, character.canonicalAppearance])) {
      pushFact(facts, makeFact(envelope, 'appearance-fact', `${name} appearance: ${appearance}`, {
        subjectId: id,
        predicate: 'appearance',
        value: appearance,
        characterIds: [id],
      }));
    }
    for (const relation of arrayOfObjects(character.relationships)) {
      pushFact(facts, makeFact(envelope, 'relationship-fact', `${name} relationship: ${text(relation.currentDynamic) || text(relation.description) || text(relation.targetId)}`, {
        subjectId: id,
        predicate: 'relationship',
        characterIds: [id, text(relation.targetId)].filter((value): value is string => Boolean(value)),
      }));
    }
  }
}

function collectBlueprintFacts(envelope: PipelineArtifactEnvelope, record: Record<string, unknown>, facts: PipelineFactRecord[]): void {
  for (const scene of arrayOfObjects(record.scenes)) {
    const id = subjectId(scene, 'scene');
    pushFact(facts, makeFact(envelope, 'scene-canon', `${text(scene.name) || id}: ${text(scene.description) || text(scene.purpose) || text(scene.summary)}`, {
      subjectId: id,
      predicate: 'planned-scene',
    }));
    if (scene.choicePoint) {
      pushFact(facts, makeFact(envelope, 'choice-consequence', `${id} has planned choice point: ${text(scene.choicePoint) || 'choice point'}`, {
        subjectId: id,
        predicate: 'planned-choice',
      }));
    }
    if (scene.isEncounter) {
      pushFact(facts, makeFact(envelope, 'encounter-anchor', `${id} has planned encounter anchor: ${text(scene.encounterType) || text(scene.purpose) || 'encounter'}`, {
        subjectId: id,
        predicate: 'planned-encounter',
      }));
    }
  }
  for (const promise of arrayOfStrings(record.narrativePromises)) {
    pushFact(facts, makeFact(envelope, 'callback-obligation', promise, {
      subjectId: slugifyMemoryKey(promise).slice(0, 48),
      predicate: 'narrative-promise',
    }));
  }
}

function collectSceneFacts(envelope: PipelineArtifactEnvelope, record: Record<string, unknown>, facts: PipelineFactRecord[]): void {
  const sceneId = text(record.sceneId) || envelope.sceneId || 'scene';
  pushFact(facts, makeFact(envelope, 'scene-canon', `${text(record.sceneName) || sceneId}: ${text(record.summary) || text(record.scenePurpose) || `${arrayOfObjects(record.beats).length} authored beat(s)`}`, {
    subjectId: sceneId,
    predicate: 'authored-scene',
  }));
  for (const beat of arrayOfObjects(record.beats)) {
    const id = subjectId(beat, 'beat');
    const beatText = text(beat.text) || text(beat.summary);
    pushFact(facts, makeFact(envelope, 'scene-canon', beatText ? `${id}: ${beatText}` : undefined, {
      subjectId: id,
      predicate: 'beat',
    }));
    const residue = text(beat.residue) || text(beat.stateChange) || text(beat.consequence);
    pushFact(facts, makeFact(envelope, 'residue-obligation', residue ? `${id} residue: ${residue}` : undefined, {
      subjectId: id,
      predicate: 'residue',
    }));
    const callback = text(beat.callback) || text(beat.setup) || text(beat.payoff);
    pushFact(facts, makeFact(envelope, 'callback-obligation', callback ? `${id} callback/setup/payoff: ${callback}` : undefined, {
      subjectId: id,
      predicate: 'callback',
    }));
  }
}

function collectChoiceFacts(envelope: PipelineArtifactEnvelope, record: Record<string, unknown>, facts: PipelineFactRecord[]): void {
  const beatId = text(record.beatId) || 'choice-set';
  for (const choice of arrayOfObjects(record.choices)) {
    const id = subjectId(choice, beatId);
    const label = text(choice.text) || text(choice.label) || id;
    const target = text(choice.nextSceneId) || text(choice.targetSceneId);
    pushFact(facts, makeFact(envelope, 'choice-consequence', `${label}${target ? ` -> ${target}` : ''}`, {
      subjectId: id,
      predicate: 'choice-target',
      value: target,
    }));
    for (const consequence of arrayOfObjects(choice.consequences)) {
      pushFact(facts, makeFact(envelope, 'choice-consequence', `${label} consequence: ${text(consequence.description) || text(consequence.flag) || text(consequence.type)}`, {
        subjectId: id,
        predicate: 'consequence',
      }));
    }
  }
}

function collectValidatorFacts(envelope: PipelineArtifactEnvelope, record: Record<string, unknown>, facts: PipelineFactRecord[]): void {
  const validator = envelope.provenance.validator || text(record.validator) || 'validator';
  const passed = record.passed === true || record.canProceed === true || record.overallPassed === true;
  const failed = record.passed === false || record.canProceed === false || record.overallPassed === false;
  for (const issue of [
    ...arrayOfObjects(record.blockingIssues),
    ...arrayOfObjects(record.warnings),
    ...arrayOfObjects(record.suggestions),
    ...arrayOfObjects(record.findings),
  ]) {
    const message = text(issue.message) || text(issue.summary) || text(issue.description);
    pushFact(facts, makeFact(envelope, 'validator-failure', message ? `${validator}: ${message}` : undefined, {
      subjectId: validator,
      predicate: 'finding',
      status: envelope.provenance.validator || passed || failed ? 'validated' : 'adopted',
      validatorRefs: [{ validator, lifecycle: envelope.lifecycle, outcome: failed ? 'failed' : passed ? 'passed' : 'warning' }],
    }));
  }
}

export class FactMemoryService {
  constructor(private readonly memory: PipelineMemory) {}

  extractFacts(envelope: PipelineArtifactEnvelope): PipelineFactRecord[] {
    const payload = envelope.payload && typeof envelope.payload === 'object'
      ? envelope.payload as Record<string, unknown>
      : {};
    const facts: PipelineFactRecord[] = [];
    switch (envelope.artifactKind) {
      case 'source-analysis':
      case 'season-plan':
        collectSourceFacts(envelope, payload, facts);
        break;
      case 'world-bible':
        collectWorldFacts(envelope, payload, facts);
        break;
      case 'character-bible':
        collectCharacterFacts(envelope, payload, facts);
        break;
      case 'episode-blueprint':
      case 'thread-ledger':
      case 'twist-plan':
      case 'arc-targets':
        collectBlueprintFacts(envelope, payload, facts);
        break;
      case 'scene-content':
        collectSceneFacts(envelope, payload, facts);
        break;
      case 'choice-set':
        collectChoiceFacts(envelope, payload, facts);
        break;
      case 'encounter-structure':
        pushFact(facts, makeFact(envelope, 'encounter-anchor', `${text(payload.name) || envelope.sceneId || 'encounter'}: ${text(payload.summary) || text(payload.stakes) || text(payload.type) || 'encounter structure adopted'}`, {
          subjectId: envelope.sceneId || text(payload.id) || 'encounter',
          predicate: 'encounter-anchor',
        }));
        break;
      case 'quick-validation-report':
      case 'qa-report':
      case 'validator-report':
      case 'final-contract':
        collectValidatorFacts(envelope, payload, facts);
        break;
      case 'image-diagnostics':
      case 'audio-diagnostics':
      case 'video-diagnostics':
        pushFact(facts, makeFact(envelope, 'provider-failure', `${envelope.artifactKind}: ${text(payload.summary) || 'diagnostic artifact adopted'}`, {
          subjectId: envelope.artifactKind,
          predicate: 'media-diagnostic',
        }));
        break;
      case 'story-json':
      case 'branch-analysis':
        pushFact(facts, makeFact(envelope, envelope.artifactKind === 'branch-analysis' ? 'branch-topology' : 'episode-canon', envelope.projection.summary, {
          subjectId: envelope.artifactKind,
          predicate: 'artifact-summary',
        }));
        break;
      default:
        break;
    }
    return facts.slice(0, MAX_FACTS_PER_ARTIFACT);
  }

  async writeFactsForArtifact(envelope: PipelineArtifactEnvelope): Promise<PipelineFactRecord[]> {
    const facts = this.extractFacts(envelope);
    await Promise.all(facts.map((fact) => this.memory.writeFactSnapshot(fact)));
    if (facts.length > 0) {
      await this.memory.cognifyDatasets([`storyrpg-run-${slugifyMemoryKey(envelope.storyId)}`], { background: true });
    }
    return facts;
  }
}
