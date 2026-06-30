import type { SeasonPlan, SeasonArc, SeasonEpisode } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis, StoryCircleBeat, StoryEndingTarget } from '../../types/sourceAnalysis';
import { STORY_CIRCLE_BEATS } from '../../types/sourceAnalysis';
import type {
  CanonEditConflict,
  CanonEditProposal,
  CanonEditRepairSuggestion,
  CanonEditValidationResult,
  CanonFact,
  CanonLockManifest,
  CanonObligation,
  CanonObligationDomain,
  CanonObligationSurface,
  CanonValidatorRecord,
  CanonWizardState,
  CanonWizardStep,
  LockedStoryCanon,
} from '../../types/storyCanon';

const PLACEHOLDER_RE = /^(?:tbd|to be determined|unknown|n\/a|none yet|placeholder|lorem ipsum|a mysterious threat|the protagonist)$/i;

const STEP_ORDER: CanonWizardStep[] = ['story', 'peopleWorld', 'episodesEndings'];

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'fact';
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function factKey(fact: Pick<CanonFact, 'domain' | 'kind' | 'subjectId'>): string {
  return `${fact.domain}:${fact.kind}:${fact.subjectId}`;
}

function getValueAtPath(root: unknown, fieldPath: string): unknown {
  if (!fieldPath) return root;
  return fieldPath.split('.').reduce<unknown>((current, part) => {
    if (current == null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, root);
}

function setValueAtPath(root: unknown, fieldPath: string, nextValue: unknown): unknown {
  if (!fieldPath) return nextValue;
  const next = root && typeof root === 'object' ? clone(root) : {};
  let cursor = next as Record<string, unknown>;
  const parts = fieldPath.split('.');
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const existing = cursor[key];
    cursor[key] = existing && typeof existing === 'object' ? clone(existing) : {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = nextValue;
  return next;
}

export function canonStepForFact(fact: Pick<CanonFact, 'domain' | 'kind'>): CanonWizardStep {
  if (fact.domain === 'story' || fact.domain === 'story_circle' || fact.domain === 'arc') return 'story';
  if (fact.domain === 'character' || fact.domain === 'npc' || fact.domain === 'world' || fact.domain === 'location') {
    return 'peopleWorld';
  }
  return 'episodesEndings';
}

export function createCanonWizardState(canon: LockedStoryCanon, selectedEpisodes: number[] = []): CanonWizardState {
  return {
    canonId: canon.canonId,
    canonVersion: canon.canonVersion,
    activeStep: 'story',
    stepStatus: {
      story: 'draft',
      peopleWorld: 'draft',
      episodesEndings: 'draft',
    },
    selectedEpisodes,
    validationIssues: [],
    repairSuggestions: [],
  };
}

export function invalidatedStepsForEdit(step: CanonWizardStep): CanonWizardStep[] {
  const index = STEP_ORDER.indexOf(step);
  return index < 0 ? [] : STEP_ORDER.slice(index + 1);
}

export function applyCanonEditProposal(canon: LockedStoryCanon, proposal: CanonEditProposal): LockedStoryCanon {
  return {
    ...canon,
    lockStatus: 'draft',
    facts: canon.facts.map((fact) => {
      if (fact.id !== proposal.factId) return fact;
      return {
        ...fact,
        value: setValueAtPath(fact.value, proposal.fieldPath, proposal.nextValue),
        source: 'validator_repair',
      };
    }),
  };
}

export function buildCanonEditProposal(
  canon: LockedStoryCanon,
  factId: string,
  fieldPath: string,
  nextValue: unknown,
): CanonEditProposal | null {
  const fact = canon.facts.find((candidate) => candidate.id === factId);
  if (!fact) return null;
  const step = canonStepForFact(fact);
  return {
    factId,
    fieldPath,
    previousValue: getValueAtPath(fact.value, fieldPath),
    nextValue,
    editedBy: 'user',
    editedAt: new Date().toISOString(),
    invalidatesSteps: invalidatedStepsForEdit(step),
  };
}

function obligationDomainForFact(fact: CanonFact): CanonObligationDomain | undefined {
  if (fact.domain === 'story' && fact.kind === 'identity') return 'story_identity';
  if (fact.domain === 'story' && fact.kind === 'promise') return 'story_promise';
  if (fact.domain === 'story_circle') return 'story_circle';
  if (fact.domain === 'arc') return 'arc';
  if (fact.domain === 'character') return 'protagonist';
  if (fact.domain === 'npc') return 'npc';
  if (fact.domain === 'world' || fact.domain === 'location') return 'world';
  if (fact.domain === 'episode') return 'episode';
  if (fact.domain === 'ending') return 'ending';
  return undefined;
}

function obligationSurfacesForFact(fact: CanonFact): CanonObligationSurface[] {
  if (fact.domain === 'ending') return ['season_plan', 'ending_target', 'final_prose'];
  if (fact.domain === 'episode') return ['episode_plan', 'scene_turn', 'final_prose'];
  if (fact.domain === 'story_circle') return ['season_plan', 'episode_plan', 'scene_turn', 'final_prose'];
  if (fact.domain === 'arc') return ['season_plan', 'episode_plan', 'scene_turn', 'final_prose'];
  if (fact.domain === 'character' || fact.domain === 'npc') return ['season_plan', 'scene_turn', 'beat_text', 'final_prose'];
  if (fact.domain === 'world' || fact.domain === 'location') return ['season_plan', 'scene_turn', 'beat_text', 'final_prose'];
  return ['season_plan', 'episode_plan', 'final_prose'];
}

function targetEpisodesForFact(fact: CanonFact, totalEpisodes: number): number[] {
  if (fact.episodeNumber) return [fact.episodeNumber];
  const value = fact.value as { episodeRange?: { start?: number; end?: number } } | undefined;
  if (value?.episodeRange?.start && value?.episodeRange?.end) {
    const start = Math.max(1, Number(value.episodeRange.start));
    const end = Math.max(start, Math.min(totalEpisodes, Number(value.episodeRange.end)));
    return Array.from({ length: end - start + 1 }, (_unused, index) => start + index);
  }
  return Array.from({ length: Math.max(1, totalEpisodes) }, (_unused, index) => index + 1);
}

function buildObligations(facts: CanonFact[], totalEpisodes: number): CanonObligation[] {
  return facts.flatMap((fact) => {
    const domain = obligationDomainForFact(fact);
    if (!domain) return [];
    return [{
      id: `canon-obligation-${slugify(fact.id)}`,
      canonSourceId: fact.id,
      domain,
      kind: fact.kind,
      sourceText: fact.sourceText || text(fact.value),
      requiredRealization: obligationSurfacesForFact(fact),
      targetEpisodeNumbers: targetEpisodesForFact(fact, totalEpisodes),
      targetSceneIds: [],
      blockingLevel: fact.confidence === 'low' ? 'advisory' : 'blocking',
    }];
  });
}

function validatorRecord(validator: string, issues: string[]): CanonValidatorRecord {
  return { validator, passed: issues.length === 0, issues };
}

function factHasPlaceholder(fact: CanonFact): boolean {
  return PLACEHOLDER_RE.test(text(fact.value)) || PLACEHOLDER_RE.test(fact.sourceText || '');
}

function requiredKeysForCanon(canon: LockedStoryCanon, step?: CanonWizardStep): string[] {
  const episodeFactSubjects = canon.facts
    .filter((fact) => fact.domain === 'episode' && fact.kind === 'episode_profile')
    .map((fact) => `episode:episode_profile:${fact.subjectId}`);
  const keys = [
    'story:identity',
    'story:promise',
    ...STORY_CIRCLE_BEATS.map((beat) => `story_circle:beat:${beat}`),
    'story_circle:polarity_you_go',
    'story_circle:polarity_need_find',
    'story_circle:polarity_search_take',
    'story_circle:polarity_return_change',
    'arc:arc',
    'character:protagonist_profile',
    'npc:npc_profile',
    'world:world_profile',
    'location:location_profile',
    ...episodeFactSubjects,
    'ending:ending_profile',
  ];
  if (!step) return keys;
  return keys.filter((key) => {
    const [domain, kind] = key.split(':');
    return canonStepForFact({ domain: domain as CanonFact['domain'], kind }) === step;
  });
}

function conceptKeysForFacts(facts: CanonFact[]): Set<string> {
  const keys = new Set<string>();
  for (const fact of facts) {
    keys.add(`${fact.domain}:${fact.kind}`);
    keys.add(`${fact.domain}:${fact.kind}:${fact.subjectId}`);
    if (fact.domain === 'story_circle' && fact.kind === 'beat') {
      keys.add(`story_circle:beat:${(fact.value as { beat?: string })?.beat || fact.subjectId}`);
    }
  }
  return keys;
}

export function deterministicCanonRepairSuggestion(conflicts: CanonEditConflict[]): CanonEditRepairSuggestion {
  const first = conflicts[0];
  return {
    source: 'deterministic',
    summary: first
      ? `Keep the earlier canon value for ${first.factId}.${first.fieldPath}, or revise the new value so it extends that fact instead of replacing it.`
      : 'Review the highlighted canon fields and remove placeholder or contradictory values.',
    proposedPatches: first
      ? [{
          factId: first.factId,
          fieldPath: first.fieldPath,
          nextValue: first.previousValue ?? '',
          reason: 'Restores the prior locked value.',
        }]
      : [],
  };
}

export function validateCanonEdit(
  previousCanon: LockedStoryCanon | undefined,
  proposedCanon: LockedStoryCanon,
  step?: CanonWizardStep,
): CanonEditValidationResult {
  const scopedFacts = step
    ? proposedCanon.facts.filter((fact) => canonStepForFact(fact) === step)
    : proposedCanon.facts;
  const keys = conceptKeysForFacts(proposedCanon.facts);
  const missing = requiredKeysForCanon(proposedCanon, step).filter((key) => !keys.has(key));
  const conflicts: CanonEditConflict[] = [];

  for (const concept of missing) {
    conflicts.push({
      id: `missing-${slugify(concept)}`,
      factId: concept,
      fieldPath: '',
      message: `Missing required canon concept: ${concept}`,
      priorFactIds: [],
    });
  }

  for (const fact of scopedFacts) {
    if (factHasPlaceholder(fact)) {
      conflicts.push({
        id: `placeholder-${fact.id}`,
        factId: fact.id,
        fieldPath: '',
        message: `${fact.id} contains placeholder-like canon text.`,
        nextValue: fact.value,
        priorFactIds: [],
      });
    }
    if (!text(fact.value)) {
      conflicts.push({
        id: `empty-${fact.id}`,
        factId: fact.id,
        fieldPath: '',
        message: `${fact.id} cannot be empty.`,
        nextValue: fact.value,
        priorFactIds: [],
      });
    }
  }

  const byKey = new Map<string, CanonFact[]>();
  for (const fact of proposedCanon.facts) {
    const key = factKey(fact);
    byKey.set(key, [...(byKey.get(key) || []), fact]);
  }
  for (const [key, group] of byKey) {
    const renderedValues = Array.from(new Set(group.map((fact) => text(fact.value).toLowerCase()).filter(Boolean)));
    if (renderedValues.length <= 1) continue;
    const scoped = group.some((fact) => !step || canonStepForFact(fact) === step);
    if (!scoped) continue;
    conflicts.push({
      id: `duplicate-${slugify(key)}`,
      factId: group[0].id,
      fieldPath: '',
      message: `Conflicting canon values for ${key}.`,
      priorFactIds: group.map((fact) => fact.id),
    });
  }

  if (!step || step === 'episodesEndings') {
    const endings = proposedCanon.facts.filter((fact) => fact.domain === 'ending' && fact.kind === 'ending_profile');
    if (endings.length !== 3) {
      conflicts.push({
        id: 'ending-count',
        factId: 'ending:ending_profile',
        fieldPath: '',
        message: `Expected exactly 3 ending targets, found ${endings.length}.`,
        priorFactIds: endings.map((fact) => fact.id),
      });
    }
  }

  if (previousCanon) {
    const previousIds = new Set(previousCanon.facts.map((fact) => fact.id));
    for (const fact of proposedCanon.facts) {
      if (!previousIds.has(fact.id)) {
        conflicts.push({
          id: `new-fact-${fact.id}`,
          factId: fact.id,
          fieldPath: '',
          message: `Manual canon editing cannot create a new canonical fact id (${fact.id}) in this flow.`,
          nextValue: fact.value,
          priorFactIds: [],
        });
      }
    }
  }

  const warnings: string[] = [];
  if (scopedFacts.some((fact) => fact.confidence === 'low')) {
    warnings.push('One or more facts in this step are low confidence and should be reviewed before generation.');
  }

  return {
    passed: conflicts.length === 0,
    blockingConflicts: conflicts,
    warnings,
    suggestion: conflicts.length > 0 ? deterministicCanonRepairSuggestion(conflicts) : undefined,
  };
}

export function commitCanonStep(
  canon: LockedStoryCanon,
  step: CanonWizardStep,
  totalEpisodes: number,
): { canon: LockedStoryCanon; validation: CanonEditValidationResult } {
  const validation = validateCanonEdit(canon, canon, step);
  if (!validation.passed) return { canon, validation };
  const fullValidation = validateCanonEdit(canon, canon);
  const validatorResults = [
    validatorRecord('CanonWizardStepValidator', validation.blockingConflicts.map((issue) => issue.message)),
    validatorRecord('CanonCompletenessValidator', fullValidation.blockingConflicts
      .filter((issue) => issue.id.startsWith('missing-'))
      .map((issue) => issue.message)),
    validatorRecord('CanonDuplicateConflictValidator', fullValidation.blockingConflicts
      .filter((issue) => issue.id.startsWith('duplicate-'))
      .map((issue) => issue.message)),
    validatorRecord('CanonDerivationValidator', fullValidation.blockingConflicts
      .filter((issue) => issue.id.startsWith('placeholder-') || issue.id.startsWith('empty-'))
      .map((issue) => issue.message)),
  ];
  const lockManifest: CanonLockManifest = {
    canonId: canon.canonId,
    canonVersion: canon.canonVersion + 1,
    sourceFingerprint: canon.sourceFingerprint,
    requiredConceptsSatisfied: fullValidation.passed,
    lockedFactIds: canon.facts.map((fact) => fact.id),
    validatorResults,
  };
  const locked: LockedStoryCanon = {
    ...canon,
    canonVersion: canon.canonVersion + 1,
    lockStatus: 'locked',
    lockedAtStage: 'source',
    lockedAt: new Date().toISOString(),
    facts: canon.facts.map((fact) => ({
      ...fact,
      status: 'canonical',
      createdAtStage: 'source',
    })),
    obligations: buildObligations(canon.facts, totalEpisodes),
    lockManifest,
    derivationReport: {
      ...canon.derivationReport,
      repairedFactCount: canon.derivationReport.repairedFactCount + 1,
      unresolvedConflicts: fullValidation.blockingConflicts.map((issue) => issue.message),
    },
  };
  return { canon: locked, validation };
}

export function updateWizardStateAfterEdit(
  state: CanonWizardState | null | undefined,
  canon: LockedStoryCanon,
  editedStep: CanonWizardStep,
): CanonWizardState {
  const base = state ?? createCanonWizardState(canon);
  const invalidated = invalidatedStepsForEdit(editedStep);
  return {
    ...base,
    canonId: canon.canonId,
    canonVersion: canon.canonVersion,
    lastEditedAt: new Date().toISOString(),
    stepStatus: {
      ...base.stepStatus,
      [editedStep]: 'draft',
      ...Object.fromEntries(invalidated.map((step) => [step, 'invalidated'])),
    } as CanonWizardState['stepStatus'],
  };
}

export function updateWizardStateAfterApproval(
  state: CanonWizardState | null | undefined,
  canon: LockedStoryCanon,
  step: CanonWizardStep,
  validation: CanonEditValidationResult,
): CanonWizardState {
  const base = state ?? createCanonWizardState(canon);
  const nextStep = STEP_ORDER[Math.min(STEP_ORDER.indexOf(step) + 1, STEP_ORDER.length - 1)];
  return {
    ...base,
    canonId: canon.canonId,
    canonVersion: canon.canonVersion,
    activeStep: nextStep,
    stepStatus: {
      ...base.stepStatus,
      [step]: validation.passed ? 'approved' : 'draft',
    },
    validationIssues: validation.blockingConflicts,
    repairSuggestions: validation.suggestion ? [validation.suggestion, ...base.repairSuggestions].slice(0, 5) : base.repairSuggestions,
    lastValidatedAt: new Date().toISOString(),
  };
}

function findFact<T = Record<string, unknown>>(
  canon: LockedStoryCanon,
  domain: CanonFact['domain'],
  kind: string,
  subjectId?: string,
): (CanonFact & { value: T }) | undefined {
  return canon.facts.find((fact) =>
    fact.domain === domain
    && fact.kind === kind
    && (!subjectId || fact.subjectId === subjectId)
  ) as (CanonFact & { value: T }) | undefined;
}

export function applyCanonToSourceAnalysis(
  analysis: SourceMaterialAnalysis,
  canon: LockedStoryCanon,
): SourceMaterialAnalysis {
  const next = clone(analysis);
  const identity = findFact<{ title?: string; genre?: string; tone?: string }>(canon, 'story', 'identity')?.value;
  if (identity) {
    next.sourceTitle = String(identity.title || next.sourceTitle || '');
    next.genre = String(identity.genre || next.genre || '');
    next.tone = String(identity.tone || next.tone || '');
  }

  const promise = findFact<{ themes?: unknown }>(canon, 'story', 'promise')?.value;
  if (Array.isArray(promise?.themes)) {
    next.themes = promise.themes.map(String).filter(Boolean);
  } else if (typeof promise?.themes === 'string') {
    next.themes = promise.themes.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  }

  const storyCircle = { ...(next.storyCircle || {}) } as Record<StoryCircleBeat, string>;
  for (const beat of STORY_CIRCLE_BEATS) {
    const fact = findFact<{ text?: string }>(canon, 'story_circle', 'beat', beat);
    if (fact?.value?.text) storyCircle[beat] = String(fact.value.text);
  }
  next.storyCircle = storyCircle;

  const arcFacts = canon.facts.filter((fact) => fact.domain === 'arc' && fact.kind === 'arc');
  if (arcFacts.length > 0) {
    next.storyArcs = arcFacts.map((fact, index) => {
      const value = fact.value as {
        name?: string;
        description?: string;
        episodeRange?: { start?: number; end?: number };
      };
      return {
        id: fact.subjectId || `arc-${index + 1}`,
        name: String(value.name || `Arc ${index + 1}`),
        description: String(value.description || ''),
        estimatedEpisodeRange: {
          start: Number(value.episodeRange?.start || 1),
          end: Number(value.episodeRange?.end || next.totalEstimatedEpisodes || 1),
        },
      };
    });
  }

  const protagonist = canon.facts.find((fact) => fact.domain === 'character' && fact.kind === 'protagonist_profile');
  if (protagonist) {
    const value = protagonist.value as {
      name?: string;
      role?: string;
      startingIdentity?: string;
      truthOrTransformation?: string;
      visualIdentity?: string;
      want?: string;
      need?: string;
      lieOrSurvivalPosture?: string;
      originPressure?: string;
    };
    next.protagonist = {
      ...next.protagonist,
      id: protagonist.subjectId || next.protagonist.id,
      name: String(value.name || next.protagonist.name),
      description: String(value.role || value.startingIdentity || next.protagonist.description),
      arc: String(value.truthOrTransformation || next.protagonist.arc),
    };
    next.characterArchitecture = {
      ...(next.characterArchitecture || {}),
      supportingCharacters: next.characterArchitecture?.supportingCharacters || [],
      protagonist: {
        ...(next.characterArchitecture?.protagonist || {}),
        want: String(value.want || next.characterArchitecture?.protagonist?.want || ''),
        need: String(value.need || next.characterArchitecture?.protagonist?.need || ''),
        lie: String(value.lieOrSurvivalPosture || next.characterArchitecture?.protagonist?.lie || ''),
        originPressure: String(value.originPressure || next.characterArchitecture?.protagonist?.originPressure || ''),
        truth: String(value.truthOrTransformation || next.characterArchitecture?.protagonist?.truth || ''),
      },
    } as SourceMaterialAnalysis['characterArchitecture'];
  }

  const npcFacts = canon.facts.filter((fact) => fact.domain === 'npc' && fact.kind === 'npc_profile');
  if (npcFacts.length > 0) {
    next.majorCharacters = npcFacts.map((fact, index) => {
      const value = fact.value as { name?: string; role?: string; relationshipToProtagonist?: string; voiceOrVisualNotes?: string };
      return {
        id: fact.subjectId || `npc-${index + 1}`,
        name: String(value.name || `NPC ${index + 1}`),
        role: (value.role || 'neutral') as SourceMaterialAnalysis['majorCharacters'][number]['role'],
        description: String(value.relationshipToProtagonist || value.voiceOrVisualNotes || ''),
        importance: 'core',
        firstAppearance: 1,
      };
    });
  }

  const world = findFact<{ premise?: string; timePeriod?: string; dramaRules?: string[] }>(canon, 'world', 'world_profile')?.value;
  if (world) {
    next.setting = {
      ...(next.setting || {}),
      worldDetails: String(world.premise || next.setting?.worldDetails || ''),
      timePeriod: String(world.timePeriod || next.setting?.timePeriod || ''),
      location: next.setting?.location || '',
    };
  }

  const locationFacts = canon.facts.filter((fact) => fact.domain === 'location' && fact.kind === 'location_profile');
  if (locationFacts.length > 0) {
    next.keyLocations = locationFacts.map((fact, index) => {
      const value = fact.value as { name?: string; purpose?: string };
      return {
        id: fact.subjectId || `location-${index + 1}`,
        name: String(value.name || `Location ${index + 1}`),
        description: String(value.purpose || ''),
        importance: index === 0 ? 'major' : 'minor',
        firstAppearance: 1,
      };
    });
    if (next.setting && !next.setting.location) next.setting.location = next.keyLocations[0]?.name || '';
  }

  const episodeFacts = canon.facts.filter((fact) => fact.domain === 'episode' && fact.kind === 'episode_profile');
  next.episodeBreakdown = next.episodeBreakdown.map((episode) => {
    const fact = episodeFacts.find((candidate) => candidate.subjectId === `episode-${episode.episodeNumber}`);
    if (!fact) return episode;
    const value = fact.value as {
      title?: string;
      storyCircleRole?: StoryCircleBeat[];
      highLevelDescription?: string;
      majorPressure?: string;
      likelyConsequence?: string;
    };
    return {
      ...episode,
      title: String(value.title || episode.title),
      synopsis: String(value.highLevelDescription || episode.synopsis),
      storyCircleRole: Array.isArray(value.storyCircleRole)
        ? value.storyCircleRole.map((beat) => ({ beat, roleKind: 'primary' as const, source: 'treatment' as const }))
        : episode.storyCircleRole,
      narrativeFunction: {
        ...episode.narrativeFunction,
        conflict: String(value.majorPressure || episode.narrativeFunction.conflict),
        resolution: String(value.likelyConsequence || episode.narrativeFunction.resolution),
      },
    };
  });

  const endingFacts = canon.facts.filter((fact) => fact.domain === 'ending' && fact.kind === 'ending_profile');
  if (endingFacts.length > 0) {
    next.resolvedEndings = endingFacts.map((fact, index) => {
      const value = fact.value as {
        name?: string;
        emotionalDestination?: string;
        thematicMeaning?: string;
        repeatedPatternOrStateDriver?: string;
        targetConditions?: string[];
      };
      return {
        id: fact.subjectId || `ending-${index + 1}`,
        name: String(value.name || `Ending ${index + 1}`),
        summary: String(value.thematicMeaning || value.emotionalDestination || ''),
        emotionalRegister: String(value.emotionalDestination || ''),
        themePayoff: String(value.thematicMeaning || ''),
        repeatedChoicePattern: String(value.repeatedPatternOrStateDriver || ''),
        stateDrivers: value.repeatedPatternOrStateDriver
          ? [{ type: 'theme', label: String(value.repeatedPatternOrStateDriver) }]
          : [],
        targetConditions: Array.isArray(value.targetConditions) ? value.targetConditions.map(String) : [],
        sourceConfidence: 'explicit',
      } as StoryEndingTarget;
    });
    next.resolvedEndingMode = 'multiple';
    next.detectedEndingMode = 'multiple';
  }

  next.sourceCanon = canon;
  next.canonLockManifest = canon.lockManifest;
  return next;
}

export function applyCanonToSeasonPlan(plan: SeasonPlan, canon: LockedStoryCanon): SeasonPlan {
  const next = clone(plan);
  const identity = findFact<{ title?: string; genre?: string; tone?: string }>(canon, 'story', 'identity')?.value;
  if (identity?.title) {
    next.sourceTitle = String(identity.title);
    next.seasonTitle = String(identity.title);
  }
  const promise = findFact<{ logline?: string; highConceptPitch?: string }>(canon, 'story', 'promise')?.value;
  if (promise?.logline || promise?.highConceptPitch) {
    next.seasonSynopsis = String(promise.logline || promise.highConceptPitch);
  }

  const episodeFacts = canon.facts.filter((fact) => fact.domain === 'episode' && fact.kind === 'episode_profile');
  next.episodes = next.episodes.map((episode: SeasonEpisode) => {
    const fact = episodeFacts.find((candidate) => candidate.subjectId === `episode-${episode.episodeNumber}`);
    if (!fact) return episode;
    const value = fact.value as {
      title?: string;
      storyCircleRole?: StoryCircleBeat[];
      highLevelDescription?: string;
      majorPressure?: string;
      likelyConsequence?: string;
    };
    return {
      ...episode,
      title: String(value.title || episode.title),
      synopsis: String(value.highLevelDescription || episode.synopsis),
      storyCircleRole: Array.isArray(value.storyCircleRole)
        ? value.storyCircleRole.map((beat) => ({ beat, roleKind: 'primary' as const, source: 'treatment' as const }))
        : episode.storyCircleRole,
      narrativeFunction: {
        ...episode.narrativeFunction,
        conflict: String(value.majorPressure || episode.narrativeFunction?.conflict || ''),
        resolution: String(value.likelyConsequence || episode.narrativeFunction?.resolution || ''),
      },
      canonEpisodeId: fact.id,
      derivedFromFactIds: [fact.id],
    };
  });

  const arcFacts = canon.facts.filter((fact) => fact.domain === 'arc' && fact.kind === 'arc');
  if (arcFacts.length > 0) {
    next.arcs = arcFacts.map((fact, index) => {
      const value = fact.value as {
        name?: string;
        description?: string;
        episodeRange?: { start?: number; end?: number };
        arcQuestion?: string;
        pressureMovement?: string;
      };
      const existing = next.arcs[index] || {};
      return {
        ...existing,
        id: existing.id || fact.subjectId || `arc-${index + 1}`,
        name: String(value.name || existing.name || `Arc ${index + 1}`),
        description: String(value.description || value.pressureMovement || existing.description || ''),
        episodeRange: {
          start: Number(value.episodeRange?.start || existing.episodeRange?.start || 1),
          end: Number(value.episodeRange?.end || existing.episodeRange?.end || next.totalEpisodes),
        },
        keyMoments: existing.keyMoments || [],
        status: existing.status || 'not_started',
        completionPercentage: existing.completionPercentage || 0,
        canonArcId: fact.id,
        derivedFromFactIds: [fact.id],
        arcQuestion: value.arcQuestion || existing.arcQuestion,
      } as SeasonArc;
    });
  }

  next.sourceCanon = canon;
  next.canonLockManifest = canon.lockManifest;
  next.updatedAt = new Date();
  return next;
}
