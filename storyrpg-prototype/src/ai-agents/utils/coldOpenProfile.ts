import type {
  ArcPressureTreatmentContract,
  AuthoredTreatmentFieldContract,
  ColdOpenConceptRole,
  ColdOpenConceptSource,
  ColdOpenProfile,
  ColdOpenSelectedConcept,
  MechanicPressureContract,
  PlannedScene,
  RequiredBeat,
  RelationshipPacingContract,
  SceneTurnContract,
  SeasonPromiseRealizationContract,
  StoryCircleBeatRealizationContract,
} from '../../types/scenePlan';
import type {
  StoryCircleBeat,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
} from '../../types/sourceAnalysis';

const STORY_CIRCLE_BEATS: StoryCircleBeat[] = [
  'you',
  'need',
  'go',
  'search',
  'find',
  'take',
  'return',
  'change',
];

export interface ColdOpenSceneLike {
  id?: string;
  episodeNumber?: number;
  order?: number;
  title?: string;
  name?: string;
  description?: string;
  dramaticPurpose?: string;
  narrativeFunction?: string;
  narrativeRole?: string;
  location?: string;
  locations?: string[];
  stakes?: string;
  dramaticQuestion?: string;
  wantVsNeed?: string;
  conflictEngine?: string;
  personalStake?: string;
  themePressure?: string;
  requiredBeats?: RequiredBeat[];
  signatureMoment?: string;
  turnContract?: SceneTurnContract;
  storyCircleBeatContracts?: StoryCircleBeatRealizationContract[];
  seasonPromiseContracts?: SeasonPromiseRealizationContract[];
  arcPressureContracts?: ArcPressureTreatmentContract[];
  mechanicPressure?: MechanicPressureContract[];
  relationshipPacing?: RelationshipPacingContract[];
  authoredTreatmentFields?: AuthoredTreatmentFieldContract[];
  setsUp?: string[];
  paysOff?: string[];
  choicePoint?: {
    description?: string;
    stakes?: {
      want?: string;
      cost?: string;
      identity?: string;
    };
  };
  hasChoice?: boolean;
  recommendedBeatCount?: number;
  coldOpenProfile?: ColdOpenProfile;
}

export interface ColdOpenProfileOptions {
  episodeNumber?: number;
  storyCircleRole?: StoryCircleRoleAssignment[];
  episodeCircle?: Partial<StoryCircleStructure>;
}

export interface ColdOpenProfileDiagnostic {
  sceneId?: string;
  episodeNumber?: number;
  severity: 'error' | 'warning';
  message: string;
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clip(value: string, max = 240): string {
  const text = cleanText(value);
  if (text.length <= max) return text;
  const soft = text.slice(0, max).replace(/\s+\S*$/, '');
  return `${soft || text.slice(0, max)}...`;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function isStoryCircleBeat(value: unknown): value is StoryCircleBeat {
  return STORY_CIRCLE_BEATS.includes(value as StoryCircleBeat);
}

function roleBeats(options: ColdOpenProfileOptions, scene: ColdOpenSceneLike): StoryCircleBeat[] {
  const sceneAssignedBeats = (scene.storyCircleBeatContracts ?? [])
    .map((contract) => contract.beat)
    .filter(isStoryCircleBeat);
  if (sceneAssignedBeats.length > 0) return unique(sceneAssignedBeats);
  return unique((options.storyCircleRole ?? []).map((role) => role.beat).filter(isStoryCircleBeat));
}

function sourceTextForBeat(
  beat: StoryCircleBeat,
  scene: ColdOpenSceneLike,
  options: ColdOpenProfileOptions,
): string {
  return cleanText((scene.storyCircleBeatContracts ?? []).find((contract) => contract.beat === beat)?.sourceText)
    || cleanText(options.episodeCircle?.[beat]);
}

function requiredBeatText(beat: RequiredBeat | undefined): string {
  if (!beat) return '';
  return cleanText(beat.mustDepict || beat.sourceTurn);
}

function firstHardRequiredBeat(scene: ColdOpenSceneLike): RequiredBeat | undefined {
  return (scene.requiredBeats ?? []).find((beat) =>
    beat.tier === 'coldopen' || beat.tier === 'authored' || beat.tier === 'signature'
  );
}

function sceneFallbackText(scene: ColdOpenSceneLike): string {
  return cleanText(
    scene.turnContract?.turnEvent
    || scene.turnContract?.centralTurn
    || requiredBeatText(firstHardRequiredBeat(scene))
    || scene.dramaticQuestion
    || scene.dramaticPurpose
    || scene.description
    || scene.narrativeFunction
    || scene.name
    || scene.title
  );
}

function centralTurnFor(scene: ColdOpenSceneLike, storyCircleTexts: string[]): string {
  return clip(
    cleanText(scene.turnContract?.turnEvent)
    || cleanText(scene.turnContract?.centralTurn)
    || requiredBeatText(firstHardRequiredBeat(scene))
    || storyCircleTexts.find(Boolean)
    || sceneFallbackText(scene)
    || 'The protagonist meets the episode pressure.',
  );
}

function modeFor(text: string): ColdOpenProfile['mode'] {
  return /\b(?:attack|ambush|arrest|explosion|body|blood|scream|threat|chase|breaks?|rupture|betray|vanish|death|dead|danger)\b/i.test(text)
    ? 'sharp_disruption'
    : 'new_normal';
}

function archetypeFor(text: string, mode: ColdOpenProfile['mode']): ColdOpenProfile['archetype'] {
  if (/\b(?:flashback|years? earlier|before|memory|remember)\b/i.test(text)) return 'cryptic_flashback';
  if (/\b(?:secret|reveal|discovers?|finds?|truth|hidden|unmasks?)\b/i.test(text)) return 'status_quo_shift';
  if (/\b(?:dread|silence|fog|storm|empty|haunting|atmosphere|ominous)\b/i.test(text)) return 'atmospheric_teaser';
  return mode === 'sharp_disruption' ? 'in_media_res' : 'status_quo_shift';
}

function makeConcept(
  source: ColdOpenConceptSource,
  id: string | undefined,
  role: ColdOpenConceptRole,
  text: unknown,
): ColdOpenSelectedConcept | undefined {
  const clean = cleanText(text);
  if (!clean) return undefined;
  return {
    source,
    id: id || `${source}-${clean.slice(0, 32).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'concept'}`,
    role,
    text: clean,
  };
}

function pushConcept(
  concepts: ColdOpenSelectedConcept[],
  source: ColdOpenConceptSource,
  id: string | undefined,
  role: ColdOpenConceptRole,
  text: unknown,
): void {
  const concept = makeConcept(source, id, role, text);
  if (concept) concepts.push(concept);
}

function collectConcepts(
  scene: ColdOpenSceneLike,
  storyCircleBeats: StoryCircleBeat[],
  centralTurn: string,
  storyCircleTexts: Array<{ beat: StoryCircleBeat; text: string }>,
): ColdOpenSelectedConcept[] {
  const concepts: ColdOpenSelectedConcept[] = [];

  for (const item of storyCircleTexts) {
    const contract = (scene.storyCircleBeatContracts ?? []).find((candidate) => candidate.beat === item.beat);
    pushConcept(concepts, 'storyCircle', contract?.id ?? `episode-circle:${item.beat}`, 'story_circle', item.text);
  }

  const centralRequiredBeat = firstHardRequiredBeat(scene);
  if (centralRequiredBeat) {
    pushConcept(concepts, 'requiredBeat', centralRequiredBeat.id, 'central_turn', requiredBeatText(centralRequiredBeat));
  }
  if (scene.turnContract) {
    pushConcept(concepts, 'sceneTurn', scene.turnContract.turnId, 'central_turn', centralTurn);
  }

  for (const beat of scene.requiredBeats ?? []) {
    if (beat.id === centralRequiredBeat?.id) continue;
    pushConcept(concepts, 'requiredBeat', beat.id, beat.tier === 'connective' ? 'texture' : 'pressure', requiredBeatText(beat));
  }
  if (scene.signatureMoment) pushConcept(concepts, 'requiredBeat', 'signatureMoment', 'pressure', scene.signatureMoment);
  for (const contract of scene.seasonPromiseContracts ?? []) {
    pushConcept(concepts, 'seasonPromise', contract.id, 'pressure', contract.sourceText);
  }
  for (const contract of scene.arcPressureContracts ?? []) {
    pushConcept(concepts, 'arcPressure', contract.id, 'pressure', contract.sourceText);
  }
  for (const pressure of scene.mechanicPressure ?? []) {
    pushConcept(concepts, 'mechanicPressure', pressure.id, 'pressure', pressure.storyPressure);
  }
  for (const pacing of scene.relationshipPacing ?? []) {
    pushConcept(concepts, 'relationshipPacing', pacing.id, 'pressure', pacing.requiredEvidence.join(' | '));
  }
  for (const field of scene.authoredTreatmentFields ?? []) {
    pushConcept(concepts, 'treatmentField', field.id, 'pressure', field.sourceText);
  }
  if (scene.themePressure) pushConcept(concepts, 'themePressure', 'themePressure', 'pressure', scene.themePressure);
  for (const setup of scene.setsUp ?? []) pushConcept(concepts, 'setupPayoff', `setsUp:${setup}`, 'texture', setup);
  for (const payoff of scene.paysOff ?? []) pushConcept(concepts, 'setupPayoff', `paysOff:${payoff}`, 'pressure', payoff);
  if (scene.choicePoint?.description) {
    pushConcept(concepts, 'choicePressure', 'choicePoint', 'open_question', scene.choicePoint.description);
  }

  const selectedBeatSet = new Set(storyCircleBeats);
  const deduped = new Map<string, ColdOpenSelectedConcept>();
  for (const concept of concepts) {
    const key = `${concept.source}:${concept.id}:${concept.role}`;
    if (!deduped.has(key)) deduped.set(key, concept);
  }
  return Array.from(deduped.values()).filter((concept) =>
    concept.role !== 'story_circle'
    || selectedBeatSet.size === 0
    || storyCircleBeats.some((beat) => concept.id.includes(beat) || concept.text === sourceTextForBeat(beat, scene, { storyCircleRole: [], episodeCircle: undefined }))
  );
}

function compileStoryCircleFulfillment(
  scene: ColdOpenSceneLike,
  options: ColdOpenProfileOptions,
  beats: StoryCircleBeat[],
  centralTurn: string,
): ColdOpenProfile['storyCircleFulfillment'] {
  const youText = sourceTextForBeat('you', scene, options);
  const needText = sourceTextForBeat('need', scene, options);
  const firstRoleText = beats.map((beat) => sourceTextForBeat(beat, scene, options)).find(Boolean);
  const baseline = clip(youText || firstRoleText || sceneFallbackText(scene) || centralTurn);
  const need = beats.includes('need') ? clip(needText || scene.wantVsNeed || scene.personalStake || scene.stakes || '') : undefined;
  const collision = beats.includes('you') && beats.includes('need')
    ? clip(`${baseline} is immediately pressured by ${need || 'the unmet need'} through ${centralTurn}.`, 320)
    : clip(centralTurn || baseline, 320);
  const sourceContractIds = (scene.storyCircleBeatContracts ?? [])
    .filter((contract) => beats.includes(contract.beat))
    .map((contract) => contract.id);

  return {
    beats,
    combinedBeats: beats.includes('you') && beats.includes('need') ? ['you', 'need'] : undefined,
    baseline,
    ...(need ? { need } : {}),
    collision,
    sourceContractIds,
  };
}

function sourceContractIds(concepts: ColdOpenSelectedConcept[]): string[] {
  return unique(concepts.map((concept) => concept.id).filter(Boolean));
}

function conflictResolutionsFor(scene: ColdOpenSceneLike, beats: StoryCircleBeat[], concepts: ColdOpenSelectedConcept[]): string[] {
  const resolutions: string[] = [];
  if (beats.includes('you') && beats.includes('need')) {
    resolutions.push('Combined Story Circle you + need into one immediate cold-open collision instead of separate checklist beats.');
  }
  const hardBeats = (scene.requiredBeats ?? []).filter((beat) =>
    beat.tier === 'coldopen' || beat.tier === 'authored' || beat.tier === 'signature'
  );
  if (hardBeats.length > 1) {
    resolutions.push('Kept scene-local hard beats binding while requiring them to serve one central cold-open turn.');
  }
  if (concepts.length > 8) {
    resolutions.push('Supporting story concepts sharpen pressure, texture, and handoff only; they are not independent cold-open turns.');
  }
  return resolutions;
}

function beatBudgetFor(scene: ColdOpenSceneLike): ColdOpenProfile['beatBudget'] {
  const recommended = Math.max(6, Math.min(12, scene.recommendedBeatCount ?? 8));
  return {
    min: 6,
    recommended,
    max: Math.max(10, recommended),
  };
}

export function compileColdOpenProfile(
  scene: ColdOpenSceneLike,
  options: ColdOpenProfileOptions = {},
): ColdOpenProfile | undefined {
  const beats = roleBeats(options, scene);
  if (beats.length === 0) return undefined;

  const storyCircleTexts = beats
    .map((beat) => ({ beat, text: sourceTextForBeat(beat, scene, options) }))
    .filter((item) => item.text);
  const centralTurn = centralTurnFor(scene, storyCircleTexts.map((item) => item.text));
  const mode = modeFor([centralTurn, scene.description, scene.dramaticPurpose, scene.narrativeFunction].join(' '));
  const archetype = archetypeFor([centralTurn, scene.description, scene.dramaticPurpose, scene.narrativeFunction].join(' '), mode);
  const concepts = collectConcepts(scene, beats, centralTurn, storyCircleTexts);
  const storyCircleFulfillment = compileStoryCircleFulfillment(scene, options, beats, centralTurn);
  const microConflict = clip(scene.conflictEngine || scene.choicePoint?.description || storyCircleFulfillment.collision || centralTurn, 280);
  const openQuestion = clip(
    scene.dramaticQuestion
    || scene.choicePoint?.description
    || (beats.includes('need')
      ? `How will the protagonist respond when the unmet need is forced into the open?`
      : `What changes once this opening pressure lands?`),
    240,
  );

  return {
    id: `cold-open:${options.episodeNumber ?? scene.episodeNumber ?? 'episode'}:${scene.id ?? 'opening'}`,
    episodeNumber: options.episodeNumber ?? scene.episodeNumber,
    sceneId: scene.id ?? 'opening',
    mode,
    archetype,
    storyCircleBeats: beats,
    storyCircleFulfillment,
    centralTurn,
    microConflict,
    openQuestion,
    activeCastLimit: 2,
    beatBudget: beatBudgetFor(scene),
    exitHook: 'End on a reveal, reversal, charged line, or profound silence that keeps the open question alive.',
    sourceContractIds: sourceContractIds(concepts),
    selectedConcepts: concepts,
    conflictResolutions: conflictResolutionsFor(scene, beats, concepts),
  };
}

function sceneEpisode(scene: ColdOpenSceneLike, fallback?: number): number | undefined {
  return scene.episodeNumber ?? fallback;
}

function openingScenesByEpisode<T extends ColdOpenSceneLike>(
  scenes: T[],
  options: ColdOpenProfileOptions,
): Array<{ episodeNumber?: number; scene: T }> {
  const grouped = new Map<number | string, Array<{ scene: T; index: number }>>();
  scenes.forEach((scene, index) => {
    const episodeNumber = sceneEpisode(scene, options.episodeNumber);
    const key = episodeNumber ?? 'unknown';
    grouped.set(key, [...(grouped.get(key) ?? []), { scene, index }]);
  });

  return Array.from(grouped.entries()).map(([key, entries]) => {
    const first = entries
      .slice()
      .sort((a, b) => {
        const ao = typeof a.scene.order === 'number' ? a.scene.order : a.index;
        const bo = typeof b.scene.order === 'number' ? b.scene.order : b.index;
        return ao - bo || a.index - b.index;
      })[0];
    const episodeNumber = typeof key === 'number' ? key : options.episodeNumber;
    return { episodeNumber, scene: first.scene };
  });
}

export function attachColdOpenProfiles<T extends ColdOpenSceneLike>(
  scenes: T[],
  options: ColdOpenProfileOptions = {},
): ColdOpenProfileDiagnostic[] {
  const diagnostics: ColdOpenProfileDiagnostic[] = [];
  for (const opening of openingScenesByEpisode(scenes, options)) {
    const profile = compileColdOpenProfile(opening.scene, {
      ...options,
      episodeNumber: opening.episodeNumber ?? options.episodeNumber,
    });
    if (profile) {
      opening.scene.coldOpenProfile = profile;
    } else {
      diagnostics.push({
        sceneId: opening.scene.id,
        episodeNumber: opening.episodeNumber,
        severity: 'error',
        message: `Cold open scene "${opening.scene.id ?? 'opening'}" has no Story Circle role or beat contract to fulfill.`,
      });
    }
  }
  return diagnostics;
}

export function collectColdOpenProfileIssues<T extends ColdOpenSceneLike>(
  scenes: T[],
  options: ColdOpenProfileOptions = {},
): string[] {
  const diagnostics = attachColdOpenProfiles(scenes, options);
  const issues = diagnostics.filter((item) => item.severity === 'error').map((item) => item.message);
  for (const opening of openingScenesByEpisode(scenes, options)) {
    const profile = opening.scene.coldOpenProfile;
    if (!profile) continue;
    if (profile.storyCircleBeats.length === 0) {
      issues.push(`Cold open scene "${opening.scene.id ?? 'opening'}" has no Story Circle beat in its coldOpenProfile.`);
    }
    if (!profile.storyCircleFulfillment.collision.trim()) {
      issues.push(`Cold open scene "${opening.scene.id ?? 'opening'}" does not define a Story Circle collision.`);
    }
    const roleSet = new Set(roleBeats(options, opening.scene));
    if (roleSet.has('you') && roleSet.has('need') && !profile.storyCircleFulfillment.combinedBeats?.includes('need')) {
      issues.push(`Cold open scene "${opening.scene.id ?? 'opening'}" must combine Story Circle you + need into one immediate collision.`);
    }
  }
  return unique(issues);
}

export type ColdOpenPlannedScene = PlannedScene & ColdOpenSceneLike;
