import type {
  EpisodeOutline,
  SourceMaterialAnalysis,
  StoryCircleBeat,
  StoryCircleRoleAssignment,
  TreatmentSeasonGuidance,
} from '../../types/sourceAnalysis';
import { STORY_CIRCLE_BEATS } from '../../types/sourceAnalysis';
import type {
  CanonConflict,
  CanonFact,
  CanonFactDomain,
  CanonFactSource,
  CanonInputKind,
  CanonLockManifest,
  CanonObligation,
  CanonObligationDomain,
  CanonObligationSurface,
  CanonValidatorRecord,
  LockedStoryCanon,
} from '../../types/storyCanon';
import type { ExtractedTreatment } from './treatmentExtraction';

const CANON_VERSION = 1;

const PLACEHOLDER_RE = /^(?:tbd|to be determined|unknown|n\/a|none yet|placeholder|lorem ipsum|a mysterious threat|the protagonist)$/i;

const POLARITY_PAIRS: Array<{
  kind: string;
  label: string;
  beats: [StoryCircleBeat, StoryCircleBeat];
}> = [
  { kind: 'polarity_you_go', label: 'You vs Go', beats: ['you', 'go'] },
  { kind: 'polarity_need_find', label: 'Need vs Find', beats: ['need', 'find'] },
  { kind: 'polarity_search_take', label: 'Search vs Take', beats: ['search', 'take'] },
  { kind: 'polarity_return_change', label: 'Return vs Change', beats: ['return', 'change'] },
];

type FactDraft = Omit<CanonFact, 'id' | 'status' | 'createdAtStage' | 'derivedFromFactIds'> & {
  id?: string;
  sourceFactIds?: string[];
  status?: CanonFact['status'];
};

export interface SourceCanonBuilderInput {
  analysis: SourceMaterialAnalysis;
  sourceText?: string;
  userPrompt?: string;
  treatment?: ExtractedTreatment;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'fact';
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
}

function present(value: unknown): boolean {
  const rendered = text(value);
  return rendered.length > 0 && !PLACEHOLDER_RE.test(rendered);
}

function firstPresent(...values: unknown[]): string {
  for (const value of values) {
    const rendered = text(value);
    if (present(rendered)) return rendered;
  }
  return '';
}

function compact(value: string, max = 96): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1).trim()}...`;
}

function inputKindFor(input: SourceCanonBuilderInput): CanonInputKind {
  const treatment = input.treatment;
  if (treatment?.metadata.formatVersion === 'story-treatment-lite') return 'story-treatment-lite';
  if (treatment?.isTreatment) return 'story-treatment-full';
  if (input.sourceText?.trim() && input.userPrompt?.trim()) return 'mixed';
  if (input.sourceText?.trim()) return 'source-material';
  return 'freeform-prompt';
}

function sourceFingerprintFor(input: SourceCanonBuilderInput): string {
  const basis = [
    input.analysis.sourceTitle,
    input.analysis.sourceAuthor || '',
    input.treatment?.metadata.formatVersion || input.analysis.sourceFormat || '',
    input.sourceText || '',
    input.userPrompt || '',
  ].join('\n---\n');
  return `canon-${stableHash(basis)}`;
}

function sourceForExplicit(value: unknown, fallback: CanonFactSource = 'source_canon_derivation'): CanonFactSource {
  return present(value) ? 'explicit_input' : fallback;
}

function factId(domain: CanonFactDomain, kind: string, subjectId: string): string {
  return `canon-${domain}-${kind}-${slugify(subjectId)}`;
}

function canonicalFact(input: FactDraft): CanonFact {
  const subjectId = input.subjectId || 'story';
  return {
    id: input.id || factId(input.domain, input.kind, subjectId),
    domain: input.domain,
    kind: input.kind,
    subjectId,
    value: input.value,
    source: input.source,
    sourceText: input.sourceText,
    evidenceText: input.evidenceText,
    confidence: input.confidence,
    derivedFromFactIds: input.sourceFactIds || [],
    supersedesFactIds: input.supersedesFactIds,
    status: input.status || 'canonical',
    createdAtStage: 'source',
    episodeNumber: input.episodeNumber,
    sceneId: input.sceneId,
    beatId: input.beatId,
  };
}

function addFact(facts: CanonFact[], draft: FactDraft): CanonFact {
  const fact = canonicalFact(draft);
  const existing = facts.find((candidate) => candidate.id === fact.id);
  if (existing) return existing;
  facts.push(fact);
  return fact;
}

function storyCircleRolesForEpisode(episode: EpisodeOutline): StoryCircleRoleAssignment[] {
  return episode.storyCircleRole?.length ? episode.storyCircleRole : [];
}

function storyCircleBeatNames(roles: StoryCircleRoleAssignment[]): StoryCircleBeat[] {
  return Array.from(new Set(
    roles
      .map((role) => role.beat)
      .filter((beat): beat is StoryCircleBeat => (STORY_CIRCLE_BEATS as readonly string[]).includes(beat)),
  ));
}

function targetEpisodesForRoles(analysis: SourceMaterialAnalysis, beat: StoryCircleBeat): number[] {
  const matches = analysis.episodeBreakdown
    .filter((episode) => storyCircleBeatNames(storyCircleRolesForEpisode(episode)).includes(beat))
    .map((episode) => episode.episodeNumber);
  return matches.length ? matches : [1];
}

function arcRangeFor(index: number, totalEpisodes: number): { start: number; end: number } {
  if (totalEpisodes <= 1) return { start: 1, end: 1 };
  const arcCount = Math.max(1, Math.min(3, totalEpisodes));
  const start = Math.floor(index * totalEpisodes / arcCount) + 1;
  const end = index === arcCount - 1
    ? totalEpisodes
    : Math.max(start, Math.floor((index + 1) * totalEpisodes / arcCount));
  return { start, end };
}

function arcOwnedBeats(analysis: SourceMaterialAnalysis, range: { start: number; end: number }): StoryCircleBeat[] {
  const beats = analysis.episodeBreakdown
    .filter((episode) => episode.episodeNumber >= range.start && episode.episodeNumber <= range.end)
    .flatMap((episode) => storyCircleBeatNames(storyCircleRolesForEpisode(episode)));
  return Array.from(new Set(beats)).length ? Array.from(new Set(beats)) : [...STORY_CIRCLE_BEATS];
}

function sourceTextFromGuidance(guidance: TreatmentSeasonGuidance | undefined, field: keyof TreatmentSeasonGuidance): string | undefined {
  const value = guidance?.[field];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function factsKey(fact: Pick<CanonFact, 'domain' | 'kind' | 'subjectId'>): string {
  return `${fact.domain}:${fact.kind}:${fact.subjectId}`;
}

function detectConflicts(facts: CanonFact[]): CanonConflict[] {
  const conflicts: CanonConflict[] = [];
  const byKey = new Map<string, CanonFact[]>();
  for (const fact of facts) {
    const key = factsKey(fact);
    byKey.set(key, [...(byKey.get(key) || []), fact]);
  }
  for (const [key, group] of byKey) {
    const renderedValues = Array.from(new Set(group.map((fact) => text(fact.value).toLowerCase()).filter(Boolean)));
    if (renderedValues.length <= 1) continue;
    const [domain, kind, subjectId] = key.split(':');
    conflicts.push({
      id: `canon-conflict-${slugify(key)}`,
      factIds: group.map((fact) => fact.id),
      domain: domain as CanonFactDomain,
      kind,
      subjectId,
      message: `Conflicting canon values for ${key}.`,
    });
  }
  return conflicts;
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
  const value = fact.value as any;
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

function conceptKeysForFacts(facts: CanonFact[]): Set<string> {
  const keys = new Set<string>();
  for (const fact of facts) {
    keys.add(`${fact.domain}:${fact.kind}`);
    keys.add(`${fact.domain}:${fact.kind}:${fact.subjectId}`);
    if (fact.domain === 'story_circle' && fact.kind === 'beat') {
      keys.add(`story_circle:beat:${(fact.value as any)?.beat || fact.subjectId}`);
    }
  }
  return keys;
}

function requiredConcepts(analysis: SourceMaterialAnalysis): string[] {
  return [
    'story:identity',
    'story:promise',
    ...STORY_CIRCLE_BEATS.map((beat) => `story_circle:beat:${beat}`),
    ...POLARITY_PAIRS.map((pair) => `story_circle:${pair.kind}`),
    'arc:arc',
    'character:protagonist_profile',
    'npc:npc_profile',
    'world:world_profile',
    'location:location_profile',
    ...analysis.episodeBreakdown.map((episode) => `episode:episode_profile:episode-${episode.episodeNumber}`),
    'ending:ending_profile',
  ];
}

function missingConcepts(facts: CanonFact[], analysis: SourceMaterialAnalysis): string[] {
  const keys = conceptKeysForFacts(facts);
  return requiredConcepts(analysis).filter((key) => !keys.has(key));
}

function validatorRecord(validator: string, issues: string[]): CanonValidatorRecord {
  return { validator, passed: issues.length === 0, issues };
}

function factHasPlaceholder(fact: CanonFact): boolean {
  return PLACEHOLDER_RE.test(text(fact.value)) || PLACEHOLDER_RE.test(fact.sourceText || '');
}

export function buildLockedStoryCanon(input: SourceCanonBuilderInput): LockedStoryCanon {
  const { analysis, treatment } = input;
  const facts: CanonFact[] = [];
  const guidance = analysis.treatmentSeasonGuidance;
  const totalEpisodes = Math.max(1, analysis.totalEstimatedEpisodes || analysis.episodeBreakdown.length || 1);
  const setting = analysis.setting || {
    timePeriod: 'unspecified story time',
    location: analysis.anchors?.stakes || analysis.sourceTitle || 'the story world',
    worldDetails: analysis.anchors?.incitingIncident || analysis.anchors?.goal || analysis.sourceTitle || 'the source premise',
  };
  const sourceFingerprint = sourceFingerprintFor(input);
  const canonId = `source-canon-${sourceFingerprint.replace(/^canon-/, '')}`;

  addFact(facts, {
    domain: 'story',
    kind: 'identity',
    subjectId: 'story',
    value: {
      title: firstPresent(analysis.sourceTitle, input.treatment?.episodes[1]?.authoredTitle, `${analysis.protagonist.name}'s ${analysis.genre} Season`),
      genre: firstPresent(guidance?.genre, analysis.genre),
      tone: firstPresent(guidance?.tone, analysis.tone),
    },
    source: sourceForExplicit(guidance?.genre || guidance?.tone || input.treatment?.metadata.detected),
    sourceText: compact([analysis.sourceTitle, guidance?.genre, guidance?.tone].filter(Boolean).join(' | ')),
    confidence: treatment?.isTreatment ? 'explicit' : 'high',
  });

  const promiseSource = firstPresent(
    guidance?.highConceptPitch,
    guidance?.logline,
    guidance?.coreFantasy,
    guidance?.audiencePromise,
    `${analysis.protagonist.name} pursues ${analysis.anchors.goal} while ${analysis.anchors.stakes} is at risk.`,
  );
  addFact(facts, {
    domain: 'story',
    kind: 'promise',
    subjectId: 'story',
    value: {
      highConceptPitch: firstPresent(guidance?.highConceptPitch, `${analysis.genre} pressure in ${setting.location}`),
      logline: firstPresent(guidance?.logline, `${analysis.protagonist.name} must ${analysis.anchors.goal} before ${analysis.anchors.stakes} is lost.`),
      coreFantasy: firstPresent(guidance?.coreFantasy, `Navigate ${setting.location} through ${analysis.tone} pressure and identity-defining choices.`),
      themes: analysis.themes,
      audiencePromise: firstPresent(guidance?.audiencePromise, guidance?.emotionalPromise, `A ${analysis.tone} story where ${analysis.themes[0] || 'identity'} is tested on-page.`),
    },
    source: sourceForExplicit(guidance?.highConceptPitch || guidance?.logline || guidance?.coreFantasy || guidance?.audiencePromise),
    sourceText: promiseSource,
    confidence: treatment?.isTreatment ? 'explicit' : 'high',
  });

  for (const beat of STORY_CIRCLE_BEATS) {
    const sourceText = analysis.storyCircle?.[beat];
    addFact(facts, {
      domain: 'story_circle',
      kind: 'beat',
      subjectId: beat,
      value: {
        beat,
        text: firstPresent(sourceText, `${beat}: ${analysis.anchors.goal}`),
        targetEpisodeNumbers: targetEpisodesForRoles(analysis, beat),
      },
      source: sourceForExplicit(guidance?.storyCircleBeatEpisodeAnchors?.[beat] || sourceText, 'source_canon_derivation'),
      sourceText,
      confidence: guidance?.storyCircleBeatEpisodeAnchors?.[beat] ? 'explicit' : 'high',
    });
  }

  for (const pair of POLARITY_PAIRS) {
    const [left, right] = pair.beats;
    addFact(facts, {
      domain: 'story_circle',
      kind: pair.kind,
      subjectId: pair.kind,
      value: {
        label: pair.label,
        beats: pair.beats,
        tension: `${analysis.storyCircle?.[left] || left} <-> ${analysis.storyCircle?.[right] || right}`,
      },
      source: 'source_canon_derivation',
      sourceText: pair.label,
      confidence: 'high',
    });
  }

  const authoredArcs = guidance?.arcGuidance?.arcs || [];
  const sourceArcs = authoredArcs.length > 0
    ? authoredArcs.map((arc, index) => ({
        id: `arc-${slugify(arc.title || `arc-${index + 1}`)}`,
        name: arc.title || `Arc ${index + 1}`,
        description: firstPresent(arc.pressureMovement, arc.arcDramaticQuestion, arc.sourceText),
        episodeRange: arc.episodeRange || arcRangeFor(index, totalEpisodes),
        arcQuestion: firstPresent(arc.arcDramaticQuestion, arc.sourceText),
        pressureMovement: firstPresent(arc.pressureMovement, arc.sourceText),
        protagonistPolarity: firstPresent(arc.protagonistPolarity, arc.lieFacet),
        pressureSource: firstPresent(arc.keyNpcLocationPressure, arc.relationToSeasonQuestion),
        handoff: firstPresent(arc.handoffPressure, arc.finaleAnswer),
        explicit: true,
      }))
    : (analysis.storyArcs.length > 0 ? analysis.storyArcs : [{
        id: 'arc-1',
        name: `${analysis.protagonist.name}'s Pressure Arc`,
        description: analysis.protagonist.arc,
        estimatedEpisodeRange: { start: 1, end: totalEpisodes },
      }]).map((arc, index) => ({
        id: arc.id || `arc-${index + 1}`,
        name: arc.name || `Arc ${index + 1}`,
        description: arc.description || analysis.protagonist.arc,
        episodeRange: arc.estimatedEpisodeRange || arcRangeFor(index, totalEpisodes),
        arcQuestion: `How does ${analysis.protagonist.name} change under the pressure of ${arc.name || 'the season'}?`,
        pressureMovement: arc.description || analysis.protagonist.arc,
        protagonistPolarity: analysis.characterArchitecture?.protagonist.lie || analysis.protagonist.arc,
        pressureSource: analysis.anchors.stakes || setting.location,
        handoff: `The result of ${arc.name || 'the arc'} creates the next pressure state.`,
        explicit: false,
      }));

  for (const arc of sourceArcs) {
    const range = {
      start: Math.max(1, Math.min(totalEpisodes, arc.episodeRange.start)),
      end: Math.max(1, Math.min(totalEpisodes, arc.episodeRange.end)),
    };
    addFact(facts, {
      domain: 'arc',
      kind: 'arc',
      subjectId: arc.id,
      value: {
        name: arc.name,
        description: arc.description,
        episodeRange: range,
        storyCircleSpan: {
          ownedBeats: arcOwnedBeats(analysis, range),
        },
        arcQuestion: arc.arcQuestion,
        pressureMovement: arc.pressureMovement,
        protagonistPolarity: arc.protagonistPolarity,
        pressureSource: arc.pressureSource,
        handoff: arc.handoff,
      },
      source: arc.explicit ? 'explicit_input' : 'source_canon_derivation',
      sourceText: arc.description,
      confidence: arc.explicit ? 'explicit' : 'high',
    });
  }

  const protagonistGuidance = guidance?.protagonistGuidance;
  addFact(facts, {
    domain: 'character',
    kind: 'protagonist_profile',
    subjectId: analysis.protagonist.id,
    value: {
      name: analysis.protagonist.name,
      pronouns: protagonistGuidance?.nameAndPronouns,
      role: firstPresent(protagonistGuidance?.roleInWorld, analysis.protagonist.description),
      want: firstPresent(protagonistGuidance?.want, analysis.characterArchitecture?.protagonist.want, analysis.anchors.goal),
      need: firstPresent(protagonistGuidance?.need, analysis.characterArchitecture?.protagonist.need, analysis.protagonist.arc),
      lieOrSurvivalPosture: firstPresent(protagonistGuidance?.lie, analysis.characterArchitecture?.protagonist.lie, analysis.protagonist.arc),
      originPressure: firstPresent(protagonistGuidance?.wound, analysis.characterArchitecture?.protagonist.originPressure, analysis.anchors.incitingIncident),
      truthOrTransformation: firstPresent(protagonistGuidance?.truth, analysis.characterArchitecture?.protagonist.truth, analysis.protagonist.arc),
      startingIdentity: firstPresent(protagonistGuidance?.startingIdentity, analysis.protagonist.description),
      possibleEndStates: protagonistGuidance?.possibleEndStates?.length
        ? protagonistGuidance.possibleEndStates
        : analysis.resolvedEndings?.map((ending) => ending.name).slice(0, 4),
      visualIdentity: firstPresent(protagonistGuidance?.visualIdentity, analysis.protagonist.fashionStyle?.styleSummary, analysis.protagonist.description),
    },
    source: sourceForExplicit(protagonistGuidance?.rawSection),
    sourceText: protagonistGuidance?.rawSection || analysis.protagonist.description,
    confidence: protagonistGuidance?.rawSection ? 'explicit' : 'high',
  });

  const npcSources = analysis.majorCharacters.length > 0
    ? analysis.majorCharacters
    : [{
        id: 'npc-primary-pressure',
      name: `Pressure from ${compact(analysis.anchors.incitingIncident || setting.worldDetails, 48)}`,
        role: 'antagonist' as const,
      description: firstPresent(analysis.anchors.incitingIncident, setting.worldDetails),
        importance: 'core' as const,
        firstAppearance: 1,
      }];
  for (const npc of npcSources) {
    addFact(facts, {
      domain: 'npc',
      kind: 'npc_profile',
      subjectId: npc.id,
      value: {
        name: npc.name,
        role: npc.role,
        want: `${npc.name} wants pressure in ${analysis.sourceTitle} to resolve in their favor.`,
        leverage: firstPresent(npc.description, analysis.anchors.stakes),
        secretOrContradiction: firstPresent(npc.description, analysis.themes[0]),
        relationshipToProtagonist: npc.description,
        voiceOrVisualNotes: firstPresent((npc as any).fashionStyle?.styleSummary, npc.description),
      },
      source: 'source_canon_derivation',
      sourceText: npc.description,
      confidence: analysis.majorCharacters.length > 0 ? 'high' : 'medium',
    });
  }

  addFact(facts, {
    domain: 'world',
    kind: 'world_profile',
    subjectId: 'world',
    value: {
      premise: firstPresent(guidance?.worldLocationGuidance?.worldPremise, setting.worldDetails),
      timePeriod: firstPresent(guidance?.worldLocationGuidance?.timePeriod, setting.timePeriod),
      dramaRules: [
        ...(guidance?.worldLocationGuidance?.dramaticRules || []),
        ...(guidance?.worldLocationGuidance?.supernaturalRules || []),
        ...(guidance?.worldLocationGuidance?.costsAndTaboos || []),
      ].filter(Boolean),
    },
    source: sourceForExplicit(guidance?.worldLocationGuidance?.rawSection),
    sourceText: guidance?.worldLocationGuidance?.rawSection || setting.worldDetails,
    confidence: guidance?.worldLocationGuidance?.rawSection ? 'explicit' : 'high',
  });

  const locations = analysis.keyLocations.length > 0
    ? analysis.keyLocations
    : [{
        id: `loc-${slugify(setting.location || 'primary-location')}`,
        name: setting.location || 'Primary location',
        description: setting.worldDetails,
        importance: 'major' as const,
        firstAppearance: 1,
      }];
  for (const location of locations) {
    addFact(facts, {
      domain: 'location',
      kind: 'location_profile',
      subjectId: location.id,
      value: {
        name: location.name,
        purpose: location.description,
        mood: analysis.tone,
        choicePressure: analysis.anchors.stakes,
      },
      source: sourceForExplicit(guidance?.worldLocationGuidance?.keyLocations?.find((candidate) => candidate.name === location.name)?.sourceText, 'source_canon_derivation'),
      sourceText: location.description,
      confidence: 'high',
    });
  }

  for (const episode of analysis.episodeBreakdown) {
    const guidanceForEpisode = episode.treatmentGuidance;
    const roles = storyCircleBeatNames(storyCircleRolesForEpisode(episode));
    addFact(facts, {
      domain: 'episode',
      kind: 'episode_profile',
      subjectId: `episode-${episode.episodeNumber}`,
      episodeNumber: episode.episodeNumber,
      value: {
        title: episode.title,
        storyCircleRole: roles,
        highLevelDescription: firstPresent(guidanceForEpisode?.synopsis, episode.synopsis),
        majorPressure: firstPresent(guidanceForEpisode?.encounterCentralConflict, guidanceForEpisode?.dramaticQuestion, episode.narrativeFunction.conflict),
        likelyConsequence: firstPresent(guidanceForEpisode?.endStateChange, guidanceForEpisode?.endingPressure, episode.narrativeFunction.resolution),
      },
      source: sourceForExplicit(guidanceForEpisode?.sourceKind || guidanceForEpisode?.synopsis),
      sourceText: guidanceForEpisode?.synopsis || episode.synopsis,
      confidence: guidanceForEpisode?.sourceKind ? 'explicit' : 'high',
    });
  }

  const endings = (analysis.resolvedEndings || []).slice(0, 3);
  while (endings.length < 3) {
    const index = endings.length + 1;
    endings.push({
      id: `ending-derived-${index}`,
      name: index === 1 ? 'Transformation' : index === 2 ? 'Costly Compromise' : 'Refusal',
      summary: `${analysis.protagonist.name} reaches a distinct ${analysis.tone} outcome shaped by ${analysis.themes[index - 1] || analysis.themes[0] || 'the season pressure'}.`,
      emotionalRegister: index === 1 ? 'transformative' : index === 2 ? 'bittersweet' : 'tragic',
      themePayoff: analysis.themes[index - 1] || analysis.themes[0] || analysis.protagonist.arc,
      stateDrivers: [{ type: 'theme', label: analysis.themes[index - 1] || 'season pattern' }],
      targetConditions: [`Repeated choices align with ending pattern ${index}.`],
      sourceConfidence: 'generated',
    });
  }
  for (const ending of endings) {
    addFact(facts, {
      domain: 'ending',
      kind: 'ending_profile',
      subjectId: ending.id,
      value: {
        name: ending.name,
        emotionalDestination: ending.emotionalRegister,
        thematicMeaning: ending.themePayoff,
        repeatedPatternOrStateDriver: ending.repeatedChoicePattern || ending.stateDrivers.map((driver) => driver.label).join('; '),
        targetConditions: ending.targetConditions,
      },
      source: ending.sourceConfidence === 'explicit' ? 'explicit_input' : 'source_canon_derivation',
      sourceText: ending.sourceText || ending.summary,
      confidence: ending.sourceConfidence === 'explicit' ? 'explicit' : 'high',
    });
  }

  const explicitFactCount = facts.filter((fact) => fact.source === 'explicit_input').length;
  const missingBeforeDerivation = missingConcepts(
    facts.filter((fact) => fact.source === 'explicit_input'),
    analysis,
  );
  const placeholderIssues = facts
    .filter(factHasPlaceholder)
    .map((fact) => `${fact.id} contains placeholder-like canon text.`);
  const conflicts = detectConflicts(facts);
  const missingAfterDerivation = missingConcepts(facts, analysis);
  const lockIssues = [
    ...missingAfterDerivation.map((concept) => `Missing required canon concept: ${concept}`),
    ...placeholderIssues,
    ...conflicts.map((conflict) => conflict.message),
    ...(endings.length !== 3 ? [`Expected exactly 3 endings, found ${endings.length}.`] : []),
  ];
  const validatorResults = [
    validatorRecord('CanonCompletenessValidator', missingAfterDerivation),
    validatorRecord('CanonDuplicateConflictValidator', conflicts.map((conflict) => conflict.message)),
    validatorRecord('CanonDerivationValidator', placeholderIssues),
    validatorRecord('CanonLockValidator', lockIssues),
  ];
  if (lockIssues.length > 0) {
    throw new Error(`Source canon lock failed: ${lockIssues.join('; ')}`);
  }

  const obligations = buildObligations(facts, totalEpisodes);
  const lockManifest: CanonLockManifest = {
    canonId,
    canonVersion: CANON_VERSION,
    sourceFingerprint,
    requiredConceptsSatisfied: true,
    lockedFactIds: facts.map((fact) => fact.id),
    validatorResults,
  };

  return {
    canonId,
    canonVersion: CANON_VERSION,
    sourceFingerprint,
    inputKind: inputKindFor(input),
    lockStatus: 'locked',
    lockedAtStage: 'source',
    lockedAt: new Date().toISOString(),
    facts,
    obligations,
    derivationReport: {
      explicitFactCount,
      derivedFactCount: facts.length - explicitFactCount,
      repairedFactCount: 0,
      missingBeforeDerivation,
      conflictsResolved: [],
      unresolvedConflicts: [],
      confidenceWarnings: facts
        .filter((fact) => fact.confidence === 'low')
        .map((fact) => `${fact.id} has low confidence.`),
    },
    lockManifest,
  };
}
