import type { SeasonPlan, SeasonResidueObligation } from '../../types/seasonPlan';
import type {
  AuthoredEventSemanticIR,
  EpisodeEventPlan,
  NarrativeContractGraph,
  NarrativeCharacterPresenceContract,
  NarrativeCharacterRoleConstraint,
  NarrativeContractIssue,
  NarrativeDependencyContract,
  NarrativeEpisodeTopologyContract,
  NarrativeEventContract,
  NarrativeEvidenceRequirement,
  NarrativeIdentityScheduleContract,
  NarrativeEventCue,
  NarrativeChoiceResidueContract,
  NarrativePremiseContract,
  NarrativePremiseEvidenceAtom,
  NarrativeSeedContract,
  NarrativeStateContract,
  NarrativeTransitionContract,
  NarrativeTransitionStateContract,
  NarrativeTwistContract,
} from '../../types/narrativeContract';
import {
  EPISODE_EVENT_PLAN_VERSION,
  NARRATIVE_CONTRACT_GRAPH_VERSION,
} from '../../types/narrativeContract';
import type { PlannedScene, SceneOwnedEvent, SeasonScenePlan, SetupPayoffEdge } from '../../types/scenePlan';
import type { EpisodeSpineContract, EpisodeSpineUnit, SpineRealizationIntent } from '../../types/episodeSpine';
import { stableHash } from './artifacts/store';
import { detectPrimaryStoryEventCues, isQuestionShapedAnchor, type StoryEventCue } from '../remediation/storyEventCues';
import { isGenericScenePlannerText, isQuestionShapedTurnText } from '../utils/sceneContractBuilders';
import { PipelineError } from './errors';
import { resolveCharacterIntroMode, resolveRosterCharacter } from '../utils/npcIntroductionLedger';
import { buildCharacterTreatmentContractsForPlan } from '../utils/characterTreatmentContracts';
import { compileNarrativeRealizationTasks } from './realizationTaskCompiler';
import { plannedGroupFormation } from '../utils/relationshipPacingStagePolicy';
import { compileEventRealizationAtoms, stagedLocationsForAtoms } from './eventAtomCompiler';
import { CANONICAL_ROUTE_TIERS } from '../validators/encounterTextSurfaces';
import { atomizeTreatmentText } from '../utils/treatmentEventAtomizer';
import {
  semanticAtomsForEvent,
  semanticContractEventSeeds,
  semanticContractForPremise,
  semanticContractPremiseSeeds,
  validateAuthoredEventSemanticIR,
  type SemanticContractEventSeed,
} from './semanticContractIr';

export const NARRATIVE_CONTRACT_COMPILER_VERSION = 'narrative-contract-compiler-v26';

const MAX_BLOCKING_PREMISE_PROPOSITIONS_PER_SCENE = 12;

const DUPLICATE_SENSITIVE_CUES = new Set<NarrativeEventCue>([
  'arrival',
  'venueDoor',
  'objectHandoff',
  'threatEncounter',
  'roadBreakdown',
  'lateNightWriting',
  'antagonistContact',
  'blogAftermath',
  'endingAftermath',
  'walkHome',
]);

const SPINE_CUE: Partial<Record<EpisodeSpineUnit['kind'], NarrativeEventCue>> = {
  arrival: 'arrival',
  late_night_writing: 'lateNightWriting',
  aftermath: 'blogAftermath',
};

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sceneSourceText(scene: PlannedScene, spineUnit?: EpisodeSpineUnit): string {
  return clean(
    spineUnit?.text
    || scene.turnContract?.turnEvent
    || scene.turnContract?.centralTurn
    || scene.sceneConstructionProfile?.primaryTurn.text
    || scene.requiredBeats?.find((beat) => beat.contractKind !== 'identity_constraint')?.mustDepict
    || scene.dramaticPurpose
    || scene.title,
  );
}

function eventRealizationAtoms(
  eventId: string,
  sourceText: string,
  knownLocations: string[],
  semanticEventIr?: AuthoredEventSemanticIR,
) {
  if (semanticEventIr) {
    return semanticAtomsForEvent({ id: eventId, sourceText }, semanticEventIr);
  }
  // Bootstrap/migration only. Production plans are recompiled from the
  // persisted semantic IR before they leave story analysis.
  const atoms = compileEventRealizationAtoms({
    eventId,
    sourceText,
    knownLocations,
  });
  const seen = new Set<string>();
  return atoms
    .filter((atom) => {
      const key = clean(atom.acceptedPatterns[0]).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((atom, index) => ({
      ...atom,
      id: `${eventId}:atom:${index + 1}`,
      prerequisiteAtomIds: index > 0 ? [`${eventId}:atom:${index}`] : [],
    }));
}

function behavioralIntentAtoms(
  eventId: string,
  intents: SpineRealizationIntent[] | undefined,
  scene: PlannedScene,
) {
  return (intents ?? []).flatMap((intent, intentIndex) => {
    if (intent.kind !== 'behavioral_intent') return [];
    const names = Array.from(new Set(intent.intentText.match(/\b[A-Z][A-Za-z'’-]+\b/g) ?? []))
      .filter((name) => !['After', 'Testing', 'Test'].includes(name));
    const target = names.at(-1) || 'the protagonist';
    const actorCandidates = (scene.npcsInvolved ?? [])
      .map((name) => clean(name).split(/\s+/)[0])
      .filter((name) => name && name.toLowerCase() !== target.toLowerCase());
    const patterns = intent.intentKind === 'social_test'
      ? Array.from(new Set([
          ...actorCandidates.flatMap((actor) => [
            `${actor} tests ${target}`,
            `${actor} tests you`,
            `${actor} challenges ${target}`,
            `${actor} challenges you`,
            `${actor} questions ${target}`,
            `${actor} questions you`,
            `${actor} probes ${target}`,
            `${actor} probes you`,
            `${actor} asks ${target} to choose`,
            `${actor} asks you`,
          ]),
          `${target} faces a test`,
          `${target} is challenged`,
          `puts ${target} to the test`,
        ]))
      : [intent.intentText];
    return [{
      id: `${eventId}:behavior:${intentIndex + 1}`,
      description: `Show the authored ${intent.intentKind.replace(/_/g, ' ')} as observable behavior before the primary event`,
      acceptedPatterns: patterns,
      sourceText: intent.intentText,
      kind: 'semantic' as const,
      semanticRole: 'action' as const,
      participantIds: [...actorCandidates, target],
      prerequisiteAtomIds: [],
      required: true,
    }];
  });
}

function eventAndSupportingRealizationAtoms(
  eventId: string,
  sourceText: string,
  knownLocations: string[],
  intents: SpineRealizationIntent[] | undefined,
  scene: PlannedScene,
  semanticEventIr?: AuthoredEventSemanticIR,
) {
  if (semanticEventIr) return eventRealizationAtoms(eventId, sourceText, knownLocations, semanticEventIr);
  const atoms = [
    ...behavioralIntentAtoms(eventId, intents, scene),
    ...eventRealizationAtoms(eventId, sourceText, knownLocations),
  ];
  return atoms.map((atom, index) => ({
    ...atom,
    id: `${eventId}:atom:${index + 1}`,
    prerequisiteAtomIds: index > 0 ? [`${eventId}:atom:${index}`] : [],
  }));
}

function sceneCharacterPresenceText(scene: PlannedScene, spineUnit?: EpisodeSpineUnit): string {
  return clean([
    scene.title,
    scene.dramaticPurpose,
    scene.turnContract?.turnEvent,
    scene.turnContract?.centralTurn,
    scene.signatureMoment,
    spineUnit?.text,
    scene.encounter?.description,
    scene.encounter?.authoredAnchor,
    scene.encounter?.centralConflict,
    ...(scene.requiredBeats ?? []).map((beat) => beat.mustDepict || beat.sourceTurn),
    ...(scene.authoredTreatmentFields ?? []).map((field) => field.sourceText),
  ].filter(Boolean).join(' '));
}

function canonicalCharacterPresenceText(scene: PlannedScene, spineUnit?: EpisodeSpineUnit): string {
  return clean([
    scene.title,
    scene.dramaticPurpose,
    scene.turnContract?.turnEvent,
    scene.turnContract?.centralTurn,
    scene.signatureMoment,
    spineUnit?.text,
    scene.encounter?.authoredAnchor,
    scene.encounter?.centralConflict,
  ].filter(Boolean).join(' '));
}

function textNamesCharacter(text: string, character: { id: string; name: string }): boolean {
  const normalized = slug(text).replace(/-/g, ' ');
  const aliases = [
    character.id,
    character.name,
    character.name.split(/\s+/)[0],
  ].map((value) => slug(value).replace(/^char-/, '').replace(/-/g, ' ')).filter((value) => value.length >= 3);
  return aliases.some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalized));
}

function compileCharacterPresenceContracts(
  plan: SeasonPlan,
  scenePlan: Pick<SeasonScenePlan, 'scenes' | 'episodeSpines'>,
): NarrativeCharacterPresenceContract[] {
  const roster = [
    ...(plan.protagonist?.id && plan.protagonist?.name
      ? [{ id: plan.protagonist.id, name: plan.protagonist.name }]
      : []),
    ...(plan.characterIntroductions ?? []).map((entry) => ({ id: entry.characterId, name: entry.characterName })),
  ].filter((entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index);
  const firstSeen = new Set<string>();
  const contracts: NarrativeCharacterPresenceContract[] = [];
  const scenes = [...scenePlan.scenes].sort((a, b) => a.episodeNumber - b.episodeNumber || a.order - b.order || a.id.localeCompare(b.id));
  const preferredIntroductionScene = new Map<string, string>();

  // Character-introduction ownership closes over the final ESC turn, not the
  // planner's provisional cast list. A later architecture projection may move
  // an introduction while leaving the old `npcsInvolved` hint behind; derived
  // presence contracts must follow the canonical event text.
  for (const character of roster) {
    const introduction = (plan.characterIntroductions ?? []).find((entry) =>
      resolveRosterCharacter(entry.characterId || entry.characterName, roster)?.id === character.id,
    );
    const episodeNumber = introduction?.introducedInEpisode ?? (character.id === plan.protagonist?.id ? 1 : undefined);
    const episodeScenes = scenes.filter((scene) => episodeNumber == null || scene.episodeNumber === episodeNumber);
    const explicitOwner = episodeScenes.find((scene) => {
      const spine = scenePlan.episodeSpines?.[scene.episodeNumber];
      const spineUnit = scene.spineUnitId ? spine?.units.find((unit) => unit.id === scene.spineUnitId) : undefined;
      return textNamesCharacter(canonicalCharacterPresenceText(scene, spineUnit), character);
    });
    const castFallback = episodeScenes.find((scene) =>
      (scene.npcsInvolved ?? []).some((ref) => resolveRosterCharacter(ref, roster)?.id === character.id),
    );
    const owner = explicitOwner ?? castFallback;
    if (owner) preferredIntroductionScene.set(character.id, owner.id);
  }

  for (const scene of scenes) {
    const spine = scenePlan.episodeSpines?.[scene.episodeNumber];
    const spineUnit = scene.spineUnitId ? spine?.units.find((unit) => unit.id === scene.spineUnitId) : undefined;
    const refs = Array.from(new Set([...(scene.npcsInvolved ?? [])].filter(Boolean)));
    for (const ref of refs) {
      const resolved = resolveRosterCharacter(ref, roster);
      if (!resolved || firstSeen.has(resolved.id)) continue;
      const preferredSceneId = preferredIntroductionScene.get(resolved.id);
      if (preferredSceneId && preferredSceneId !== scene.id) continue;
      firstSeen.add(resolved.id);
      const intro = (plan.characterIntroductions ?? []).find((entry) =>
        resolveRosterCharacter(entry.characterId || entry.characterName, roster)?.id === resolved.id,
      );
      const stagingText = sceneCharacterPresenceText(scene, spineUnit);
      const anonymous = resolveCharacterIntroMode({
        characterName: resolved.name,
        stagingText,
      }) === 'anonymous_plant';
      const mode = anonymous ? 'anonymous_plant' : 'named_on_page';
      contracts.push({
        id: `presence:ep${scene.episodeNumber}:${slug(scene.id)}:${slug(resolved.id)}`,
        characterId: resolved.id,
        characterName: resolved.name,
        episodeNumber: scene.episodeNumber,
        sceneId: scene.id,
        mode,
        readerNameAllowed: mode === 'named_on_page',
        requiredEvidence: mode === 'anonymous_plant'
          ? ['distinctive first-contact visual or behavioral staging']
          : [resolved.name],
        forbiddenEvidence: mode === 'anonymous_plant'
          ? [resolved.name, resolved.name.split(/\s+/)[0]]
          : [],
        sourceContractIds: [
          ...(intro ? [`character-introduction:${intro.characterId}`] : []),
          `scene-cast:${scene.id}:${resolved.id}`,
        ],
        provenance: {
          source: intro ? 'season_plan' : 'character_bible',
          confidence: intro ? 'authoritative' : 'deterministic',
        },
      });
    }
  }
  return contracts;
}

function episodeTreatmentText(plan: SeasonPlan, episodeNumber: number): string {
  const episode = plan.episodes?.find((candidate) => candidate.episodeNumber === episodeNumber);
  const guidance = episode?.treatmentGuidance as Record<string, unknown> | undefined;
  const guidanceText = guidance
    ? Object.values(guidance).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === 'string')
    : [];
  return clean([
    ...(episode?.treatmentGuidance?.episodeTurns ?? []),
    episode?.treatmentGuidance?.synopsis,
    episode?.synopsis,
    ...guidanceText,
  ].filter(Boolean).join(' '));
}

function compileIdentityScheduleContracts(
  plan: SeasonPlan,
  presence: NarrativeCharacterPresenceContract[],
): NarrativeIdentityScheduleContract[] {
  const episodeNumbers = (plan.episodes ?? []).map((episode) => episode.episodeNumber).sort((a, b) => a - b);
  const byCharacter = new Map<string, NarrativeCharacterPresenceContract[]>();
  for (const contract of presence) {
    byCharacter.set(contract.characterId, [...(byCharacter.get(contract.characterId) ?? []), contract]);
  }
  const output: NarrativeIdentityScheduleContract[] = [];
  for (const entry of plan.characterIntroductions ?? []) {
    const characterId = entry.characterId;
    if (!characterId) continue;
    const contracts = byCharacter.get(characterId) ?? [];
    const canonicalFirstName = entry.characterName.split(/\s+/)[0];
    const treatmentMentionEpisodes = episodeNumbers.filter((episodeNumber) => {
      const source = episodeTreatmentText(plan, episodeNumber);
      return new RegExp(`\\b${canonicalFirstName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i').test(source)
        || (entry.characterId.toLowerCase().includes('victor') && /mr\.?\s*midnight/i.test(source))
        || (entry.characterId.toLowerCase().includes('radu') && /the\s+mountain|rougher\s+man|first\s+sighting/i.test(source));
    });
    const firstVisualEpisode = Math.min(
      ...(contracts.length > 0 ? contracts.map((contract) => contract.episodeNumber) : []),
      ...(treatmentMentionEpisodes.length > 0 ? [Math.min(...treatmentMentionEpisodes)] : []),
      entry.introducedInEpisode,
    );
    const namedPresenceEpisodes = contracts
      .filter((contract) => contract.mode === 'named_on_page')
      .map((contract) => contract.episodeNumber);
    const namedTreatmentEpisodes = episodeNumbers.filter((episodeNumber) => {
      const source = episodeTreatmentText(plan, episodeNumber);
      const escaped = canonicalFirstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b\\s+(?:fixes|gives|meets|invites|introduces|says|asks|calls|walks|offers|arrives|appears)\\b`, 'i').test(source);
    });
    const namedCandidates = [...namedPresenceEpisodes, ...namedTreatmentEpisodes];
    const namedEpisode = namedCandidates.length > 0
      ? Math.min(...namedCandidates)
      : entry.introducedInEpisode;
    const aliases: string[] = [];
    const seasonText = (plan.episodes ?? []).map((episode) => episodeTreatmentText(plan, episode.episodeNumber)).join(' ');
    if (/mr\.??\s*midnight/i.test(seasonText) && /victor/i.test(entry.characterName)) aliases.push('Mr. Midnight');
    if (/the mountain/i.test(seasonText) && /radu/i.test(entry.characterName)) aliases.push('The Mountain');
    output.push({
      id: `identity:${slug(characterId)}`,
      characterId,
      canonicalName: entry.characterName,
      allowedAliases: Array.from(new Set(aliases)),
      forbiddenBeforeNamedEpisode: [entry.characterName, entry.characterName.split(/\s+/)[0]],
      firstVisualEpisode,
      firstNamedEpisode: Math.max(firstVisualEpisode, namedEpisode),
      firstNamedSceneId: contracts.find((contract) => contract.episodeNumber === namedEpisode && contract.mode === 'named_on_page')?.sceneId,
      sourceContractIds: [`character-introduction:${entry.characterId}`],
    });
  }
  return output;
}

function compileCharacterRoleConstraints(
  plan: SeasonPlan,
  identity: NarrativeIdentityScheduleContract[],
): NarrativeCharacterRoleConstraint[] {
  const output: NarrativeCharacterRoleConstraint[] = [];
  for (const entry of plan.characterIntroductions ?? []) {
    const schedule = identity.find((candidate) => candidate.characterId === entry.characterId);
    if (!schedule) continue;
    for (const episode of plan.episodes ?? []) {
      if (episode.episodeNumber >= schedule.firstNamedEpisode) continue;
      const futureLoveInterest = /love_interest|romantic|second lead/i.test(entry.role);
      output.push({
        id: `role:${slug(entry.characterId)}:ep${episode.episodeNumber}`,
        characterId: entry.characterId,
        characterName: entry.characterName,
        episodeNumber: episode.episodeNumber,
        allowedFunctions: futureLoveInterest ? ['visual_plant', 'witness', 'romantic_pressure'] : ['visual_plant', 'witness', 'staged_rescuer', 'romantic_pressure'],
        forbiddenFunctions: futureLoveInterest ? ['attacker', 'antagonist', 'canonical_identity_reveal'] : ['canonical_identity_reveal'],
        sourceContractIds: [`character-introduction:${entry.characterId}`],
      });
    }
  }
  return output;
}

function compileEpisodeTopologyContracts(plan: SeasonPlan): NarrativeEpisodeTopologyContract[] {
  return (plan.episodes ?? []).map((episode) => {
    const authoredUnitTexts = [...(episode.treatmentGuidance?.episodeTurns ?? [])].filter((text) => clean(text));
    const authoredLite = episode.treatmentGuidance?.sourceKind === 'authored_lite';
    return {
      episodeNumber: episode.episodeNumber,
      expectedSceneCount: authoredUnitTexts.length > 0 ? authoredUnitTexts.length : undefined,
      authoredUnitIds: authoredUnitTexts.map((_, index) => `ep${episode.episodeNumber}-unit-${index + 1}`),
      authoredUnitTexts,
      tolerance: authoredLite ? 0 : 1,
    };
  });
}

function sourceContractIds(scene: PlannedScene, spineUnit?: EpisodeSpineUnit): string[] {
  return Array.from(new Set([
    ...(spineUnit ? [spineUnit.id] : []),
    ...(scene.turnContract?.turnId ? [scene.turnContract.turnId] : []),
    ...(scene.treatmentAtomIds ?? []),
  ].filter(Boolean)));
}

function explicitCue(scene: PlannedScene, spineUnit: EpisodeSpineUnit | undefined, hasWritingHelper: boolean): NarrativeEventCue | undefined {
  if (scene.planningOrigin?.splitKind === 'late_night_writing') return 'lateNightWriting';
  if (scene.planningOrigin?.splitKind === 'viral_aftermath' || scene.planningOrigin?.splitKind === 'public_blog_aftermath') {
    return 'blogAftermath';
  }
  if (spineUnit?.encounterProfile === 'staged_rescue') return 'threatEncounter';
  if (spineUnit?.kind === 'set_piece' && /\b(?:attack|attacked|ambush|rescu(?:e|ed|es))\b/i.test(spineUnit.text)) {
    return 'threatEncounter';
  }
  if (spineUnit?.kind === 'late_night_writing' && hasWritingHelper && /\b(?:viral|readership|reads?|views?|comments?|audience)\b/i.test(spineUnit.text)) {
    return 'blogAftermath';
  }
  const spineCue = spineUnit ? SPINE_CUE[spineUnit.kind] : undefined;
  if (spineCue) return spineCue;
  const chronologyCue = (scene.ownedChronologyKeys ?? []).find((key): key is NarrativeEventCue =>
    DUPLICATE_SENSITIVE_CUES.has(key as NarrativeEventCue),
  );
  if (chronologyCue) return chronologyCue;
  return undefined;
}

function diagnosticCue(text: string): NarrativeEventCue | undefined {
  return [...detectPrimaryStoryEventCues(text)][0] as NarrativeEventCue | undefined;
}

function aftermathOnlyText(text: string): string {
  const match = text.match(/\b(?:and\s+)?(by\s+(?:evening|morning|dawn|night)\b[^.?!]*(?:[.?!]|$))/i);
  if (!match) return text;
  const value = match[1].trim();
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function writingOnlyText(text: string): string {
  const value = clean(text);
  const split = value.search(/\s+and\s+by\s+(?:evening|morning|dawn|night)\b/i);
  if (split < 0) return value;
  return value.slice(0, split).replace(/[,;:]\s*$/, '').trim();
}

function isIndependentSupplementalDepiction(
  episodeNumber: number,
  sourceText: string,
  sourceContractId: string,
): boolean {
  return atomizeTreatmentText({
    episodeNumber,
    text: sourceText,
    idPrefix: sourceContractId,
  }).some((atom) => atom.isPlayableEvent && atom.ownershipIntent === 'must_stage');
}

function interpretiveContractOverlapsEvent(sourceText: string, event: NarrativeEventContract): boolean {
  const stopwords = new Set(['after', 'before', 'first', 'that', 'this', 'with', 'from', 'into', 'proof', 'life']);
  const tokens = (value: string) => new Set(
    slug(value).split('-').filter((token) => token.length >= 4 && !stopwords.has(token)),
  );
  const sourceTokens = tokens(sourceText);
  const eventTokens = tokens(event.sourceText);
  let overlap = 0;
  sourceTokens.forEach((token) => {
    if (eventTokens.has(token)) overlap += 1;
  });
  return overlap >= 2;
}

/**
 * Story Circle prose can summarize several already-canonical events and add an
 * interpretation such as "as proof that ...". That summary is provenance and
 * pressure, not a second depiction event owned by whichever scene happened to
 * receive the derived contract. Fold it into the canonical events it describes
 * so every concrete action remains mandatory at its own owner surface.
 */
function foldInterpretiveStoryCircleContracts(
  scenePlan: Pick<SeasonScenePlan, 'scenes'>,
  events: NarrativeEventContract[],
): NarrativeContractIssue[] {
  const issues: NarrativeContractIssue[] = [];
  for (const scene of scenePlan.scenes) {
    const retained: NonNullable<PlannedScene['storyCircleBeatContracts']> = [];
    for (const contract of scene.storyCircleBeatContracts ?? []) {
      const sourceText = clean(contract.sourceText || contract.stateChange);
      if (!sourceText || isIndependentSupplementalDepiction(scene.episodeNumber, sourceText, contract.id)) {
        retained.push(contract);
        continue;
      }
      const cues = detectPrimaryStoryEventCues(sourceText);
      const candidates = events.filter((event) =>
        event.episodeNumber === scene.episodeNumber
        && event.realizationMode === 'depiction'
        && (Boolean(event.cue && cues.has(event.cue as StoryEventCue)) || interpretiveContractOverlapsEvent(sourceText, event)),
      );
      if (candidates.length === 0) {
        retained.push(contract);
        continue;
      }
      const representative = candidates
        .map((event) => ({ event, cueMatch: Boolean(event.cue && cues.has(event.cue as StoryEventCue)) }))
        .sort((left, right) => Number(right.cueMatch) - Number(left.cueMatch)
          || right.event.sourceOrder - left.event.sourceOrder
          || left.event.id.localeCompare(right.event.id))[0].event;
      representative.sourceContractIds = Array.from(new Set([...representative.sourceContractIds, contract.id]));
      scene.requiredBeats = (scene.requiredBeats ?? []).filter((beat) =>
        clean(beat.mustDepict || beat.sourceTurn).toLowerCase() !== sourceText.toLowerCase(),
      );
      issues.push({
        code: 'interpretive_story_circle_contract_folded',
        severity: 'warning',
        message: `Interpretive Story Circle contract "${contract.id}" was folded into representative canonical event "${representative.id}" instead of creating duplicate scene ownership.`,
        episodeNumber: scene.episodeNumber,
        sceneId: scene.id,
      });
    }
    scene.storyCircleBeatContracts = retained.length > 0 ? retained : undefined;
  }
  return issues;
}

function splitCompoundWritingAftermathScenes(
  scenePlan: Pick<SeasonScenePlan, 'scenes' | 'episodeSpines'>,
): NarrativeContractIssue[] {
  const issues: NarrativeContractIssue[] = [];
  for (const scene of [...scenePlan.scenes]) {
    const spine = scenePlan.episodeSpines?.[scene.episodeNumber];
    const unit = scene.spineUnitId ? spine?.units.find((candidate) => candidate.id === scene.spineUnitId) : undefined;
    if (unit?.kind !== 'late_night_writing') continue;
    if (!/\s+and\s+by\s+(?:evening|morning|dawn|night)\b/i.test(unit.text)) continue;

    const existingAftermath = scenePlan.scenes.find((candidate) =>
      candidate.episodeNumber === scene.episodeNumber
      && candidate.planningOrigin?.kind === 'binder_split'
      && (candidate.planningOrigin.splitKind === 'viral_aftermath'
        || candidate.planningOrigin.splitKind === 'public_blog_aftermath'),
    );
    if (existingAftermath) continue;

    const writingText = writingOnlyText(unit.text);
    const aftermathText = aftermathOnlyText(unit.text);
    const oldOrder = scene.order;
    const aftermathRequiredBeats = (scene.requiredBeats ?? []).filter((beat) => {
      const text = clean(beat.mustDepict || beat.sourceTurn);
      return diagnosticCue(text) === 'blogAftermath' && diagnosticCue(text) !== 'lateNightWriting';
    });
    const aftermathRequiredBeatIds = new Set(aftermathRequiredBeats.map((beat) => beat.id));
    const aftermathStoryCircleContracts = (scene.storyCircleBeatContracts ?? []).filter((contract) =>
      diagnosticCue(contract.sourceText || contract.stateChange || '') === 'blogAftermath',
    );
    const aftermathStoryCircleIds = new Set(aftermathStoryCircleContracts.map((contract) => contract.id));
    const apartmentLocation = scenePlan.scenes
      .filter((candidate) => candidate.episodeNumber === scene.episodeNumber)
      .flatMap((candidate) => candidate.locations ?? [])
      .find((location) => /\b(?:apartment|home|flat)\b/i.test(location));

    scene.dramaticPurpose = writingText;
    scene.locations = [apartmentLocation || 'Apartment'];
    scene.ownedChronologyKeys = Array.from(new Set([
      ...(scene.ownedChronologyKeys ?? []).filter((key) => key !== 'blogAftermath'),
      'lateNightWriting',
    ]));
    scene.requiredBeats = (scene.requiredBeats ?? []).filter((beat) => !aftermathRequiredBeatIds.has(beat.id)).map((beat) => {
      const text = clean(beat.mustDepict || beat.sourceTurn);
      if (!/\s+and\s+by\s+(?:evening|morning|dawn|night)\b/i.test(text)) return beat;
      return { ...beat, sourceTurn: writingText, mustDepict: writingText };
    });
    scene.storyCircleBeatContracts = (scene.storyCircleBeatContracts ?? [])
      .filter((contract) => !aftermathStoryCircleIds.has(contract.id));
    scene.turnContract = {
      ...(scene.turnContract ?? {
        turnId: `${scene.id}-turn`,
        source: 'treatment' as const,
        beforeState: 'The night is still private.',
        afterState: 'Private experience has become public testimony.',
      }),
      centralTurn: writingText,
      turnEvent: writingText,
      handoff: 'Hand the published post forward to its later public consequence without restaging the writing moment.',
    };

    const helperIdBase = `s${scene.episodeNumber}-blog-aftermath`;
    let helperId = helperIdBase;
    let suffix = 2;
    while (scenePlan.scenes.some((candidate) => candidate.id === helperId)) {
      helperId = `${helperIdBase}-${suffix}`;
      suffix += 1;
    }
    scenePlan.scenes.push({
      id: helperId,
      episodeNumber: scene.episodeNumber,
      order: oldOrder + 0.1,
      kind: 'standard',
      title: 'The post becomes public pressure',
      dramaticPurpose: aftermathText,
      narrativeRole: 'payoff',
      locations: [apartmentLocation || 'Online'],
      npcsInvolved: [],
      setsUp: [],
      paysOff: [],
      hasChoice: false,
      planningOrigin: {
        kind: 'binder_split',
        splitKind: 'viral_aftermath',
        parentSceneId: scene.id,
        reason: 'Canonical compiler split private writing from its later public consequence.',
      },
      ownedChronologyKeys: ['blogAftermath'],
      requiredBeats: aftermathRequiredBeats,
      storyCircleBeatContracts: aftermathStoryCircleContracts.map((contract) => ({
        ...contract,
        targetSceneIds: [helperId],
      })),
      turnContract: {
        turnId: `${unit.id}:aftermath`,
        source: 'treatment',
        centralTurn: aftermathText,
        beforeState: 'The post is published but its reach is not yet known.',
        turnEvent: aftermathText,
        afterState: 'Public attention gives the story leverage and danger.',
        handoff: 'Carry the public pressure forward without restaging the writing moment.',
      },
    });

    const episodeScenes = scenePlan.scenes
      .filter((candidate) => candidate.episodeNumber === scene.episodeNumber)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    episodeScenes.forEach((candidate, order) => { candidate.order = order; });
    issues.push({
      code: 'compound_writing_aftermath_scene_split',
      severity: 'warning',
      message: `Scene "${scene.id}" was split into private writing and public aftermath owners before graph commitment.`,
      episodeNumber: scene.episodeNumber,
      sceneId: scene.id,
    });
  }
  return issues;
}

function foldLegacyAbstractTestUnits(
  scenePlan: Pick<SeasonScenePlan, 'scenes' | 'setupPayoffEdges' | 'episodeSpines'>,
): NarrativeContractIssue[] {
  const issues: NarrativeContractIssue[] = [];
  for (const spine of Object.values(scenePlan.episodeSpines ?? {})) {
    for (let index = 0; index < spine.units.length; index += 1) {
      const unit = spine.units[index];
      const abstractTest = unit.kind === 'test'
        && unit.realizationIntent == null
        && /^(?:testing|test)\s+[A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*)?[.!?]?$/i.test(clean(unit.text));
      if (!abstractTest) continue;
      const dependent = spine.units.slice(index + 1).find((candidate) => candidate.kind === 'bond');
      if (!dependent) continue;

      dependent.supportingIntents = [
        ...(dependent.supportingIntents ?? []),
        {
          kind: 'behavioral_intent',
          intentKind: 'social_test',
          intentText: clean(unit.text),
          relation: 'prerequisite',
          requiredSlots: ['actor', 'target', 'mechanism', 'observable_response', 'state_change'],
        },
      ];
      dependent.prerequisites = Array.from(new Set([
        ...dependent.prerequisites.filter((id) => id !== unit.id),
        ...unit.prerequisites,
      ]));

      const sourceScene = scenePlan.scenes.find((scene) => scene.spineUnitId === unit.id);
      const targetScene = scenePlan.scenes.find((scene) => scene.spineUnitId === dependent.id);
      if (targetScene) {
        targetScene.behavioralIntents = [...(dependent.supportingIntents ?? [])];
        targetScene.hasChoice = true;
        targetScene.encounterProfile = targetScene.encounterProfile || 'social_test';
        if (sourceScene && sourceScene.id !== targetScene.id) {
          targetScene.mechanicPressure = [
            ...(targetScene.mechanicPressure ?? []),
            ...(sourceScene.mechanicPressure ?? []),
          ];
          for (const edge of scenePlan.setupPayoffEdges) {
            if (edge.from === sourceScene.id) edge.from = targetScene.id;
            if (edge.to === sourceScene.id) edge.to = targetScene.id;
          }
          scenePlan.scenes.splice(scenePlan.scenes.indexOf(sourceScene), 1);
        }
      }

      spine.units.splice(index, 1);
      spine.units.forEach((candidate, order) => { candidate.order = order; });
      const episodeScenes = scenePlan.scenes
        .filter((scene) => scene.episodeNumber === spine.episodeNumber)
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
      episodeScenes.forEach((scene, order) => { scene.order = order; });
      issues.push({
        code: 'legacy_abstract_test_folded_into_dependent_event',
        severity: 'warning',
        message: `Legacy abstract unit "${unit.text}" was folded into dependent event "${dependent.text}" as behavioral intent.`,
        episodeNumber: spine.episodeNumber,
        sceneId: targetScene?.id,
      });
      index -= 1;
    }
  }
  return issues;
}

function eventEvidenceRequirements(eventId: string, cue: NarrativeEventCue | undefined, sourceText: string): NarrativeEvidenceRequirement[] {
  const requirements: NarrativeEvidenceRequirement[] = [];
  if (cue === 'lateNightWriting' && /Mr\.??\s*Midnight/i.test(sourceText)) {
    requirements.push({
      id: `${eventId}:exact-alias`,
      eventId,
      kind: 'exact_alias',
      acceptedPatterns: ['Mr. Midnight'],
      requiredExactText: true,
      requiredSurface: 'owner_scene',
      blocking: true,
    });
  }
  if (cue === 'blogAftermath' && /viral|readership|audience|followers?|shares?|views?/i.test(sourceText)) {
    requirements.push({
      id: `${eventId}:audience-consequence`,
      eventId,
      kind: 'audience_consequence',
      acceptedPatterns: ['viral', 'shares', 'readers', 'followers', 'views', 'notifications', 'thousands'],
      requiredSurface: 'owner_scene',
      blocking: true,
    });
  }
  if (cue === 'threatEncounter' && /\b(?:attack|attacked|ambush)\b/i.test(sourceText)) {
    requirements.push({
      id: `${eventId}:rescue`,
      eventId,
      kind: 'action',
      acceptedPatterns: ['rescue', 'rescued', 'intervenes', 'saved', 'pulled you clear', 'shielded you'],
      requiredSurface: 'all_routes',
      routeEvidencePosition: 'path',
      blocking: true,
    });
    requirements.push({
      id: `${eventId}:threshold-disappearance`,
      eventId,
      kind: 'action',
      acceptedPatterns: ['threshold', 'door', 'apartment', 'vanishes', 'disappears', 'gone'],
      requiredSurface: 'all_routes',
      routeEvidencePosition: 'terminal',
      blocking: true,
    });
  }
  return requirements;
}

function routeRealizationPolicy(cue: NarrativeEventCue | undefined, sourceText: string): NarrativeEventContract['routeRealizationPolicy'] {
  if (cue === 'threatEncounter' && /\b(?:attack|attacked|ambush|rescu(?:e|ed|es)|threshold|vanish|disappear)/i.test(sourceText)) {
    return 'all_routes';
  }
  return undefined;
}

function sceneMatchTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((token) => token.length >= 4));
}

function isPressureOnlyScene(scene: PlannedScene): boolean {
  const text = clean([
    scene.title,
    scene.dramaticPurpose,
    scene.turnContract?.turnEvent,
    scene.turnContract?.centralTurn,
  ].filter(Boolean).join(' '));
  const result = !(scene.requiredBeats ?? []).some((beat) => beat.contractKind !== 'identity_constraint' && clean(beat.mustDepict || beat.sourceTurn))
    && /player-facing choice|dramatic question|pressure|what if|\bcan\s+[^?]{3,}\?/i.test(text);
  return result;
}

function spineUnitOwnerScene(
  unit: EpisodeSpineUnit,
  scenes: PlannedScene[],
  sourceScene: PlannedScene,
): PlannedScene {
  const normalized = (value: string | undefined): string => clean(value).toLowerCase().replace(/\s+/g, ' ');
  const carriesUnitText = (scene: PlannedScene): boolean => {
    const unitText = normalized(unit.text);
    return [
      scene.turnContract?.turnEvent,
      scene.turnContract?.centralTurn,
      ...(scene.requiredBeats ?? []).map((beat) => beat.mustDepict || beat.sourceTurn),
    ].some((value) => normalized(value) === unitText);
  };

  // Explicit ESC projection is authoritative. The scene plan owns chronology
  // and event identity; prose text is elaboration and may be stale, shifted, or
  // intentionally folded into a neighboring cold-open scene. Never let an
  // exact or lexical prose match move a valid spine binding to another scene.
  if (sourceScene.spineUnitId === unit.id) return sourceScene;
  const exactMatches = scenes.filter((scene) =>
    scene.episodeNumber === sourceScene.episodeNumber
    && scene.kind !== 'encounter' === (unit.sceneKind !== 'encounter')
    && carriesUnitText(scene),
  );
  if (exactMatches.length === 1) return exactMatches[0];
  if (sourceScene.spineUnitId === unit.id) return sourceScene;
  const unitTokens = sceneMatchTokens(unit.text);
  if (unitTokens.size === 0) return sourceScene;
  return scenes
    .filter((scene) => scene.episodeNumber === sourceScene.episodeNumber && scene.kind !== 'encounter' === (unit.sceneKind !== 'encounter'))
    .filter((scene) => !isPressureOnlyScene(scene) || scene.id === sourceScene.id && !(sourceScene.spineUnitId === unit.id))
    .map((scene) => {
      const text = clean([
        scene.title,
        scene.turnContract?.turnEvent,
        scene.turnContract?.centralTurn,
        ...(scene.requiredBeats ?? []).map((beat) => beat.mustDepict || beat.sourceTurn),
        scene.encounter?.description,
        scene.encounter?.centralConflict,
      ].filter(Boolean).join(' '));
      const tokens = sceneMatchTokens(text);
      const overlap = [...unitTokens].filter((token) => tokens.has(token)).length;
      const exactTurn = [scene.turnContract?.turnEvent, scene.turnContract?.centralTurn, ...(scene.requiredBeats ?? []).map((beat) => beat.mustDepict)]
        .some((value) => clean(value).toLowerCase() === clean(unit.text).toLowerCase());
      return { scene, score: overlap + (exactTurn ? 100 : 0) + (scene.id === sourceScene.id ? 0.5 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order || a.scene.id.localeCompare(b.scene.id))[0]?.scene ?? sourceScene;
}

function eventIdFor(
  scene: PlannedScene,
  spineUnit: EpisodeSpineUnit | undefined,
  cue: NarrativeEventCue | undefined,
  sourceText: string,
  sourceIds: string[] = [],
): string {
  if (spineUnit) return `event:${spineUnit.id}${cue === 'blogAftermath' && spineUnit.kind === 'late_night_writing' ? ':aftermath' : ''}`;
  const sourceIdentity = stableHash({
    episodeNumber: scene.episodeNumber,
    sourceIds: [...sourceIds].sort(),
    sourceText: clean(sourceText).toLowerCase(),
    cue: cue ?? null,
  }).slice(0, 16);
  return `event:ep${scene.episodeNumber}:source:${sourceIdentity}`;
}

function isDepictionScene(scene: PlannedScene, spineUnit: EpisodeSpineUnit | undefined, episodeHasSpine: boolean): boolean {
  const turn = clean(scene.turnContract?.turnEvent || scene.turnContract?.centralTurn);
  const hasAuthoredDepiction = (scene.requiredBeats ?? []).some((beat) =>
    beat.contractKind !== 'identity_constraint' && Boolean(clean(beat.mustDepict)),
  );
  if (spineUnit || scene.kind === 'encounter' || scene.planningOrigin || hasAuthoredDepiction || (scene.treatmentAtomIds?.length ?? 0) > 0) {
    return true;
  }
  if (episodeHasSpine) return false;
  return Boolean(turn)
    && !isGenericScenePlannerText(turn)
    && !isQuestionShapedTurnText(turn)
    && !isQuestionShapedAnchor(turn);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

const PREMISE_STOPWORDS = new Set([
  'about', 'after', 'again', 'because', 'before', 'being', 'could', 'from', 'have', 'into',
  'must', 'only', 'over', 'that', 'their', 'there', 'these', 'this', 'through', 'what',
  'when', 'where', 'which', 'while', 'with', 'would', 'your', 'the', 'and', 'for', 'was',
  'were', 'is', 'are', 'has', 'had', 'her', 'his', 'its', 'not', 'but', 'than', 'then',
  // Causal bridge words create brittle n-grams ("engagement made", "made
  // feel") that are not independently meaningful evidence. Keep the adjacent
  // authored nouns/adjectives so paraphrased prose can satisfy the premise.
  'made', 'make', 'makes', 'feel', 'feels', 'felt',
]);

function premiseEvidencePatterns(sourceText: string): string[] {
  const words = sourceText
    .replace(/[^A-Za-z0-9' -]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, '').toLowerCase())
    .filter((word) => word.length >= 4 && !PREMISE_STOPWORDS.has(word));
  const phrases: string[] = [];
  for (let index = 0; index < words.length - 1; index += 1) {
    if (words[index].length >= 4 && words[index + 1].length >= 4) {
      phrases.push(`${words[index]} ${words[index + 1]}`);
    }
  }
  const distinctiveWords = words.filter((word) => word.length >= 6);
  // Prefer independently meaningful authored terms before adjacent n-grams.
  // Adjacent n-grams describe source syntax rather than stable reader-facing facts.
  return Array.from(new Set([...distinctiveWords, ...phrases])).slice(0, 8);
}

function premiseEvidenceAtoms(
  contractId: string,
  fieldKind: NarrativePremiseContract['fieldKind'],
  sourceText: string,
): NarrativePremiseEvidenceAtom[] {
  const sourcePatterns = premiseEvidencePatterns(sourceText);
  const aliases: Record<string, string[]> = {
    observe: ['watch', 'watching', 'spectator', 'notice', 'study'],
    observer: ['observe', 'watch', 'watching', 'spectator', 'notice', 'study'],
    watch: ['observe', 'observes', 'watching', 'spectator', 'notice', 'study'],
    write: ['writer', 'writing', 'article', 'piece', 'paragraph', 'prose', 'byline', 'compose'],
    writer: ['write', 'writing', 'article', 'piece', 'paragraph', 'prose', 'byline', 'compose'],
    hesitate: ['hesitating', 'pause', 'wait', 'delay', 'indecision', 'second guess'],
    second: ['hesitate', 'pause', 'wait', 'delay', 'indecision', 'second guess'],
    cancel: ['cancelled', 'canceled', 'ended', 'called off', 'imploded', 'broken'],
    cancelled: ['cancel', 'canceled', 'ended', 'called off', 'imploded', 'broken'],
    humiliate: ['humiliated', 'shame', 'shamed', 'embarrassed', 'exposed'],
    humiliated: ['humiliate', 'shame', 'shamed', 'embarrassed', 'exposed'],
    grandmother: ['grandma', 'ancestor', 'maternal elder', 'paternal elder'],
    escape: ['flee', 'fled', 'run', 'ran', 'left', 'disappeared'],
    fled: ['escape', 'flee', 'run', 'ran', 'left', 'disappeared'],
  };
  const kind: NarrativePremiseEvidenceAtom['kind'] = fieldKind === 'role_fact'
    ? 'role'
    : fieldKind === 'origin_pressure'
      ? 'origin'
      : fieldKind === 'wound_pressure'
        ? 'wound'
        : fieldKind === 'starting_identity'
          ? 'behavior'
          : 'fact';
  return sourcePatterns.map((pattern, index) => {
    const words = pattern.toLowerCase().split(/\s+/);
    const acceptedPatterns = new Set([pattern]);
    for (const word of words) {
      for (const alias of aliases[word.replace(/(?:ing|ed|es|s)$/i, '')] ?? []) acceptedPatterns.add(alias);
    }
    return {
      id: `${contractId}:atom:${index + 1}`,
      kind,
      canonicalFact: pattern,
      acceptedPatterns: [...acceptedPatterns],
      required: true,
      sourceText,
    };
  });
}

function compilePremiseContracts(
  plan: SeasonPlan,
  scenes: PlannedScene[],
  semanticIr?: AuthoredEventSemanticIR,
): NarrativePremiseContract[] {
  const sourceContracts = buildCharacterTreatmentContractsForPlan(plan);
  // Canonical name/pronouns are artifact invariants, not positive prose
  // obligations. Character-treatment validation owns metadata presence while
  // protagonist/NPC pronoun validation owns contradictions when references occur.
  const premiseKinds = new Set(['role_fact', 'origin_pressure', 'wound_pressure', 'starting_identity']);
  const openingScenes = scenes
    .filter((scene) => scene.episodeNumber === 1)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .slice(0, 2);
  const openingOrder = new Map(openingScenes.map((scene, index) => [scene.id, index]));
  const sceneLoad = new Map(openingScenes.map((scene) => [scene.id, 0]));
  const contracts: NarrativePremiseContract[] = [];
  for (const contract of sourceContracts
    .filter((candidate) => premiseKinds.has(candidate.contractKind) && candidate.targetEpisodeNumbers.includes(1))) {
      const premiseId = `premise:${contract.id}`;
      const compiled = semanticIr ? semanticContractForPremise(semanticIr, premiseId) : undefined;
      const evidencePatterns = premiseEvidencePatterns(contract.sourceText);
      const evidenceAtoms = compiled
        ? compiled.propositions.map((proposition, index): NarrativePremiseEvidenceAtom => ({
            id: proposition.id || `${premiseId}:semantic:${index + 1}`,
            kind: contract.contractKind === 'role_fact'
              ? 'role'
              : contract.contractKind === 'origin_pressure'
                ? 'origin'
                : contract.contractKind === 'wound_pressure'
                  ? 'wound'
                  : contract.contractKind === 'starting_identity'
                    ? 'behavior'
                    : 'fact',
            canonicalFact: proposition.proposition,
            acceptedPatterns: [proposition.sourceSpan],
            required: proposition.required,
            sourceText: contract.sourceText,
            sourceSpan: proposition.sourceSpan,
            semanticCriteria: proposition.semanticCriteria,
            verificationAuthority: proposition.verificationAuthority,
          }))
        : premiseEvidenceAtoms(
            premiseId,
            contract.contractKind as NarrativePremiseContract['fieldKind'],
            contract.sourceText,
          );
      const threshold = compiled?.minimumEvidenceHits ?? Math.min(2, Math.max(1, evidenceAtoms.length));
      const requiredAtoms = evidenceAtoms.filter((atom) => atom.required);
      const assignmentCount = compiled && threshold > 1 && requiredAtoms.length === threshold && requiredAtoms.length <= openingScenes.length
        ? requiredAtoms.length
        : 1;
      const targetSceneIds: string[] = [];
      for (let assignment = 0; assignment < assignmentCount; assignment += 1) {
        const preferred = contract.targetSceneIds.filter((sceneId) => openingOrder.has(sceneId));
        const candidates = uniqueStrings([...preferred, ...openingScenes.map((scene) => scene.id)]);
        const targetSceneId = candidates.sort((left, right) =>
          (sceneLoad.get(left) ?? Number.MAX_SAFE_INTEGER) - (sceneLoad.get(right) ?? Number.MAX_SAFE_INTEGER)
          || Number(preferred.includes(right)) - Number(preferred.includes(left))
          || (openingOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (openingOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
          || left.localeCompare(right))[0];
        if (targetSceneId) {
          targetSceneIds.push(targetSceneId);
          sceneLoad.set(targetSceneId, (sceneLoad.get(targetSceneId) ?? 0) + 1);
        }
      }
      contracts.push({
        id: premiseId,
        episodeNumber: 1,
        fieldName: contract.fieldName,
        fieldKind: contract.contractKind as NarrativePremiseContract['fieldKind'],
        sourceText: contract.sourceText,
        evidencePatterns,
        evidenceAtoms,
        enforcementMode: 'positive_realization',
        minimumEvidenceHits: threshold,
        targetSceneIds,
        requiredSurface: ['beat_text', 'dialogue', 'choice_text'],
        sourceContractIds: [contract.id],
        blocking: contract.blockingLevel !== 'warning',
        provenance: {
          source: contract.source === 'treatment' ? 'treatment' : 'season_plan',
          confidence: contract.blockingLevel === 'treatment' ? 'authoritative' : 'deterministic',
        },
      });
  }
  return contracts;
}

function compileStateContracts(plan: SeasonPlan): NarrativeStateContract[] {
  const records = new Map<string, NarrativeStateContract>();
  const add = (stateId: string | undefined, sourceEpisodeNumber: number, targetEpisodeNumbers: number[], sourceContractIds: string[], source: NarrativeStateContract['provenance']['source'], domain?: NarrativeStateContract['domain']): void => {
    const canonicalStateId = clean(stateId);
    if (!canonicalStateId) return;
    const existing = records.get(canonicalStateId);
    if (existing) {
      existing.targetEpisodeNumbers = Array.from(new Set([...existing.targetEpisodeNumbers, ...targetEpisodeNumbers])).sort((a, b) => a - b);
      existing.sourceContractIds = Array.from(new Set([...existing.sourceContractIds, ...sourceContractIds]));
      return;
    }
    records.set(canonicalStateId, {
      id: `state:${slug(canonicalStateId)}`,
      canonicalStateId,
      aliases: [],
      domain,
      sourceEpisodeNumber,
      targetEpisodeNumbers: Array.from(new Set(targetEpisodeNumbers)).sort((a, b) => a - b),
      sourceContractIds: [...sourceContractIds],
      requiredSetterSurface: 'choice_consequence',
      blocking: true,
      provenance: { source, confidence: source === 'season_flag' || source === 'residue_plan' ? 'authoritative' : 'deterministic' },
    });
  };
  for (const flag of plan.seasonFlags ?? []) {
    add(flag.flag, flag.setInEpisode, [flag.setInEpisode, ...(flag.checkedInEpisodes ?? [])], [`season-flag:${flag.flag}`], 'season_flag');
  }
  for (const residue of plan.residuePlan ?? []) {
    add(residue.flag, residue.sourceEpisodeNumber, [residue.sourceEpisodeNumber, ...(residue.targetEpisodeNumbers ?? [])], [residue.id, ...(residue.treatmentContractIds ?? [])], 'residue_plan', residue.consequenceDomain);
  }
  for (const moment of plan.choiceMoments ?? []) {
    if (moment.flag) add(moment.flag, moment.episode, [moment.episode, ...(moment.paysOffEpisode ? [moment.paysOffEpisode] : [])], [moment.id], 'choice_moment');
  }
  for (const episode of plan.episodes ?? []) {
    for (const flag of episode.setsFlags ?? []) add(flag.flag, episode.episodeNumber, [episode.episodeNumber], [`episode:${episode.episodeNumber}:flag:${flag.flag}`], 'episode_outline');
  }
  return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function compileSeedContracts(plan: SeasonPlan, states: NarrativeStateContract[]): NarrativeSeedContract[] {
  const stateById = new Map(states.map((state) => [state.canonicalStateId, state]));
  const seeds: NarrativeSeedContract[] = [];
  for (const residue of plan.residuePlan ?? []) {
    const targets = (residue.targetEpisodeNumbers ?? []).filter((episode) => episode > residue.sourceEpisodeNumber);
    if (targets.length === 0) continue;
    const sourceText = clean([
      residue.choiceAnchor,
      residue.authoringGuidance,
      residue.sourceMaterial.choiceText,
      residue.sourceMaterial.reminderLater,
      ...(residue.sourceMaterial.residueHints ?? []),
    ].filter(Boolean).join(' '));
    const state = stateById.get(residue.flag);
    seeds.push({
      id: `seed:${residue.id}`,
      sourceEpisodeNumber: residue.sourceEpisodeNumber,
      targetEpisodeNumbers: [...targets].sort((a, b) => a - b),
      targetSceneIds: [...(residue.targetSceneIds ?? [])],
      sourceText,
      requiredEvidence: premiseEvidencePatterns(sourceText).slice(0, 6),
      stateContractIds: state ? [state.id] : [],
      realizationMode: 'future_obligation',
      payoffWindow: { minEpisode: Math.min(...targets), maxEpisode: Math.max(...targets) },
      requiredSurface: residue.requiredSurface,
      sourceContractIds: [residue.id, ...(residue.treatmentContractIds ?? [])],
      blocking: residue.priority === 'major',
      provenance: { source: 'residue_plan', confidence: 'authoritative' },
    });
  }
  for (const moment of plan.choiceMoments ?? []) {
    if (!moment.flag || !moment.paysOffEpisode || moment.paysOffEpisode <= moment.episode) continue;
    if (seeds.some((seed) => seed.sourceContractIds.includes(moment.id))) continue;
    seeds.push({
      id: `seed:choice:${moment.id}`,
      sourceEpisodeNumber: moment.episode,
      targetEpisodeNumbers: [moment.paysOffEpisode],
      targetSceneIds: [],
      sourceText: moment.anchor,
      requiredEvidence: premiseEvidencePatterns(moment.anchor).slice(0, 6),
      stateContractIds: stateById.has(moment.flag) ? [stateById.get(moment.flag)!.id] : [],
      realizationMode: 'future_obligation',
      payoffWindow: { minEpisode: moment.paysOffEpisode, maxEpisode: moment.paysOffEpisode },
      requiredSurface: ['beat_text', 'text_variant', 'choice_text'],
      sourceContractIds: [moment.id],
      blocking: false,
      provenance: { source: 'choice_moment', confidence: 'authoritative' },
    });
  }
  return seeds.sort((a, b) => a.id.localeCompare(b.id));
}

function compileTransitionContracts(scenes: PlannedScene[]): NarrativeTransitionContract[] {
  const output: NarrativeTransitionContract[] = [];
  const byEpisode = new Map<number, PlannedScene[]>();
  for (const scene of scenes) byEpisode.set(scene.episodeNumber, [...(byEpisode.get(scene.episodeNumber) ?? []), scene]);
  for (const [episodeNumber, episodeScenes] of byEpisode) {
    const ordered = [...episodeScenes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    for (let index = 1; index < ordered.length; index += 1) {
      const from = ordered[index - 1];
      const to = ordered[index];
      const locationChanged = clean(from.locations?.[0]) !== clean(to.locations?.[0]);
      const timeChanged = clean(from.timeOfDay) !== clean(to.timeOfDay) && Boolean(from.timeOfDay && to.timeOfDay);
      const fromStates = new Map((from.continuityStates ?? []).map((state) => [state.subject, state]));
      const stateContracts: NarrativeTransitionStateContract[] = (to.continuityStates ?? [])
        .flatMap((state) => {
          const previous = fromStates.get(state.subject);
          if (previous?.disposition === state.disposition) return [];
          return [{
            id: `continuity:${slug(from.id)}:to:${slug(to.id)}:${slug(state.subject)}`,
            subject: state.subject,
            fromDisposition: previous?.disposition,
            toDisposition: state.disposition,
            requiredEvidence: uniqueStrings([
              ...(state.requiredEvidence ?? []),
              state.disposition,
            ]),
            blocking: state.blocking !== false,
            sourceContractIds: [
              `scene:${from.id}`,
              `scene:${to.id}`,
              ...(previous ? [previous.id] : []),
              state.id,
            ],
          } satisfies NarrativeTransitionStateContract];
        });
      if (!locationChanged && !timeChanged && !clean(to.timeJump) && stateContracts.length === 0) continue;
      const normalizedTimeJump = clean(to.timeJump).toLowerCase();
      const hasBlockingStateHandoff = stateContracts.some((state) => state.blocking);
      const bridgePolicy: NarrativeTransitionContract['bridgePolicy'] = hasBlockingStateHandoff
        ? 'state_handoff'
        : locationChanged && /\b(?:continuous|immediate|immediately|moments? later|straight away|without pause)\b/.test(normalizedTimeJump)
          ? 'continuous_action'
          : 'orientation_only';
      const timeValue = clean(to.timeOfDay) || clean(to.timeJump);
      output.push({
        id: `transition:ep${episodeNumber}:${slug(from.id)}:to:${slug(to.id)}`,
        episodeNumber,
        fromSceneId: from.id,
        toSceneId: to.id,
        fromLocation: from.locations?.[0],
        toLocation: to.locations?.[0],
        fromTimeOfDay: from.timeOfDay,
        toTimeOfDay: to.timeOfDay,
        bridgePolicy,
        locationRequirement: locationChanged && clean(to.locations?.[0])
          ? { canonicalValue: clean(to.locations?.[0]), acceptedAliases: [], required: true }
          : undefined,
        timeRequirement: (timeChanged || Boolean(clean(to.timeJump))) && timeValue
          ? { canonicalValue: timeValue, acceptedAliases: [], required: true }
          : undefined,
        requiredBridgeEvidence: uniqueStrings([to.timeJump, to.locations?.[0], to.timeOfDay]),
        stateContracts,
        blocking: locationChanged || timeChanged || stateContracts.some((state) => state.blocking),
        sourceContractIds: [`scene:${from.id}`, `scene:${to.id}`],
      });
    }
  }
  return output;
}

function compileChoiceResidueContracts(plan: SeasonPlan): NarrativeChoiceResidueContract[] {
  return (plan.residuePlan ?? []).map((residue) => ({
    id: `choice-residue:${residue.id}`,
    sourceEpisodeNumber: residue.sourceEpisodeNumber,
    sourceSceneId: residue.sourceSceneId,
    sourceChoiceMomentId: residue.sourceChoiceMomentId,
    canonicalStateIds: residue.flag ? [`state:${slug(residue.flag)}`] : [],
    targetEpisodeNumbers: [...residue.targetEpisodeNumbers],
    targetSceneIds: [...(residue.targetSceneIds ?? [])],
    requiredSurface: [...residue.requiredSurface],
    sourceText: clean([residue.choiceAnchor, residue.authoringGuidance, residue.sourceMaterial.feedbackEcho, residue.sourceMaterial.feedbackProgress].filter(Boolean).join(' ')),
    blocking: residue.priority === 'major',
    provenance: {
      source: residue.source === 'branch_contract' ? 'branch_contract' : 'residue_plan',
      confidence: 'authoritative',
    },
  }));
}

function compileTwistContracts(plan: SeasonPlan, scenes: PlannedScene[]): NarrativeTwistContract[] {
  return (plan.informationLedger ?? [])
    .filter((entry) => entry.plannedRevealEpisode != null && Boolean(entry.sourceText || entry.description))
    .map((entry) => {
      const episodeScenes = scenes.filter((scene) => scene.episodeNumber === entry.plannedRevealEpisode).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const evidence = premiseEvidencePatterns(clean(entry.sourceText || entry.description));
      return {
        id: `twist:${entry.id}`,
        episodeNumber: entry.plannedRevealEpisode!,
        targetSceneIds: episodeScenes.filter((scene) => scene.paysOff.some((id) => id === entry.id) || scene.requiredBeats?.some((beat) => evidence.some((pattern) => clean(beat.mustDepict).toLowerCase().includes(pattern)))).map((scene) => scene.id),
        sourceText: clean(entry.sourceText || entry.description),
        beatRole: 'revelation',
        requiredEvidence: evidence.slice(0, 6),
        blocking: Boolean(entry.isBoxQuestion && entry.sourceText),
        provenance: entry.sourceText ? 'treatment_required' : 'season_architecture',
      } satisfies NarrativeTwistContract;
    });
}

function collapseConstraintOnlySceneShells(scenePlan: SeasonScenePlan): void {
  const removedToTarget = new Map<string, string>();
  const episodeNumbers = Array.from(new Set(scenePlan.scenes.map((scene) => scene.episodeNumber)));
  for (const episodeNumber of episodeNumbers) {
    const spine = scenePlan.episodeSpines?.[episodeNumber];
    if (!spine?.units.length) continue;
    const episodeScenes = scenePlan.scenes
      .filter((scene) => scene.episodeNumber === episodeNumber)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    if (episodeScenes.length <= 3) continue;
    const depictionScenes = episodeScenes.filter((scene) => {
      const unit = scene.spineUnitId ? spine.units.find((candidate) => candidate.id === scene.spineUnitId) : undefined;
      // A concrete-looking turn on a scene that does not own a canonical spine
      // unit is still planner scaffolding. Treating it as authored here lets a
      // pressure shell survive compilation and later become a branch target.
      // Resolve every spine unit against the current episode so a unit whose
      // positional shell was collapsed can still identify its real owner.
      const ownsCanonicalSpineUnit = spine.units.some((candidate, index) => {
        const sourceScene = episodeScenes.find((candidateScene) => candidateScene.spineUnitId === candidate.id)
          ?? episodeScenes[index]
          ?? episodeScenes[0];
        return sourceScene && spineUnitOwnerScene(candidate, episodeScenes, sourceScene).id === scene.id;
      });
      const directAuthoredContent = (scene.requiredBeats ?? []).some((beat) =>
        beat.contractKind !== 'identity_constraint' && clean(beat.mustDepict || beat.sourceTurn),
      ) || Boolean(
        scene.turnContract
        && ownsCanonicalSpineUnit
        && !isGenericScenePlannerText(scene.turnContract.turnEvent)
        && !isQuestionShapedTurnText(scene.turnContract.turnEvent),
      );
      const matchedOwner = unit ? spineUnitOwnerScene(unit, episodeScenes, scene) : scene;
      return isDepictionScene(scene, unit, true)
        && !isPressureOnlyScene(scene)
        && (directAuthoredContent || matchedOwner.id === scene.id);
    });
    for (const shell of episodeScenes) {
      const shellSpineUnit = shell.spineUnitId
        ? spine.units.find((unit) => unit.id === shell.spineUnitId)
        : undefined;
      const hasAuthoredBeat = (shell.requiredBeats ?? []).some((beat) =>
        beat.contractKind !== 'identity_constraint' && clean(beat.mustDepict || beat.sourceTurn),
      );
      const hasExplicitSpineUnit = Boolean(
        shellSpineUnit
        && (hasAuthoredBeat
          || shellSpineUnit.kind === 'bond'
          || shellSpineUnit.kind === 'test'
          || shellSpineUnit.kind === 'threshold'
          || (shellSpineUnit.obligations?.length ?? 0) > 0),
      );
      if (depictionScenes.includes(shell) || hasExplicitSpineUnit || shell.kind === 'encounter' || shell.encounter || shell.planningOrigin) continue;
      const shellText = sceneSourceText(shell);
      if (!isQuestionShapedTurnText(shellText) && !isQuestionShapedAnchor(shellText) && !isGenericScenePlannerText(shellText) && !isPressureOnlyScene(shell)) continue;
      const target = [...depictionScenes]
        .sort((a, b) => {
          const aDistance = Math.abs(a.order - shell.order);
          const bDistance = Math.abs(b.order - shell.order);
          if (aDistance !== bDistance) return aDistance - bDistance;
          const aIsLater = a.order >= shell.order ? 0 : 1;
          const bIsLater = b.order >= shell.order ? 0 : 1;
          return aIsLater - bIsLater || a.order - b.order;
        })[0];
      if (!target) continue;
      target.narrativeConstraints = uniqueStrings([
        ...(target.narrativeConstraints ?? []),
        shellText,
        shell.stakes,
      ]);
      target.mechanicPressure = [...(target.mechanicPressure ?? []), ...(shell.mechanicPressure ?? [])];
      target.relationshipPacing = [...(target.relationshipPacing ?? []), ...(shell.relationshipPacing ?? [])];
      target.arcPressureContracts = [...(target.arcPressureContracts ?? []), ...(shell.arcPressureContracts ?? [])];
      target.seasonPromiseContracts = [...(target.seasonPromiseContracts ?? []), ...(shell.seasonPromiseContracts ?? [])];
      target.storyCircleBeatContracts = [...(target.storyCircleBeatContracts ?? []), ...(shell.storyCircleBeatContracts ?? [])];
      target.stakesArchitectureContracts = [...(target.stakesArchitectureContracts ?? []), ...(shell.stakesArchitectureContracts ?? [])];
      target.setsUp = uniqueStrings([...target.setsUp, ...shell.setsUp]);
      target.paysOff = uniqueStrings([...target.paysOff, ...shell.paysOff]);
      if (shell.hasChoice) {
        target.hasChoice = true;
        target.choiceType ??= shell.choiceType;
        target.consequenceTier ??= shell.consequenceTier;
        target.budgetWeight = Math.max(target.budgetWeight ?? 0, shell.budgetWeight ?? 0);
      }
      removedToTarget.set(shell.id, target.id);
    }
  }
  if (removedToTarget.size === 0) return;
  const resolveSceneId = (id: string): string => removedToTarget.get(id) ?? id;
  scenePlan.scenes = scenePlan.scenes.filter((scene) => !removedToTarget.has(scene.id));
  for (const scene of scenePlan.scenes) {
    scene.setsUp = uniqueStrings(scene.setsUp.map(resolveSceneId)).filter((id) => id !== scene.id);
    scene.paysOff = uniqueStrings(scene.paysOff.map(resolveSceneId)).filter((id) => id !== scene.id);
  }
  scenePlan.setupPayoffEdges = scenePlan.setupPayoffEdges
    .map((edge) => ({ ...edge, from: resolveSceneId(edge.from), to: resolveSceneId(edge.to) }))
    .filter((edge, index, edges) => edge.from !== edge.to && edges.findIndex((candidate) => candidate.from === edge.from && candidate.to === edge.to) === index);
  scenePlan.byEpisode = Object.fromEntries(
    episodeNumbers.map((episodeNumber) => [
      episodeNumber,
      scenePlan.scenes
        .filter((scene) => scene.episodeNumber === episodeNumber)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .map((scene) => scene.id),
    ]),
  );
}

function alignGroupPacingWithSpineOwners(scenePlan: SeasonScenePlan): void {
  const normalizeGroupId = (value: string): string => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  for (const spine of Object.values(scenePlan.episodeSpines ?? {})) {
    const episodeScenes = scenePlan.scenes.filter((scene) => scene.episodeNumber === spine.episodeNumber);
    for (const unit of spine.units) {
      const groupName = plannedGroupFormation({ title: unit.text });
      if (!groupName) continue;
      const groupId = normalizeGroupId(groupName);
      const owner = episodeScenes.find((scene) => scene.spineUnitId === unit.id);
      if (!owner || (owner.relationshipPacing ?? []).some((contract) => contract.groupId && normalizeGroupId(contract.groupId) === groupId)) continue;
      const donor = episodeScenes.find((scene) => (scene.relationshipPacing ?? []).some((contract) =>
        contract.groupId && normalizeGroupId(contract.groupId) === groupId,
      ));
      if (!donor) continue;
      const moved = (donor.relationshipPacing ?? []).filter((contract) =>
        contract.groupId && normalizeGroupId(contract.groupId) === groupId,
      );
      for (const contract of moved) {
        if (contract.milestone?.kind === 'group_formation') contract.milestone.choiceSceneId = owner.id;
      }
      donor.relationshipPacing = (donor.relationshipPacing ?? []).filter((contract) => !moved.includes(contract));
      owner.relationshipPacing = [...(owner.relationshipPacing ?? []), ...moved];
      if (moved.some((contract) => contract.milestone?.kind === 'group_formation')) {
        owner.hasChoice = true;
        owner.choiceType = 'relationship';
      }
    }
  }
}

function dependencyId(parts: string[]): string {
  return `dependency:${parts.map(slug).filter(Boolean).join(':')}`;
}

function firstEventInEpisode(events: NarrativeEventContract[], episodeNumber: number): NarrativeEventContract | undefined {
  return events
    .filter((event) => event.episodeNumber === episodeNumber && event.realizationMode === 'depiction')
    .sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id))[0];
}

function lastEventInEpisode(events: NarrativeEventContract[], episodeNumber: number): NarrativeEventContract | undefined {
  return events
    .filter((event) => event.episodeNumber === episodeNumber && event.realizationMode === 'depiction')
    .sort((a, b) => b.sourceOrder - a.sourceOrder || b.id.localeCompare(a.id))[0];
}

function eventForScene(events: NarrativeEventContract[], sceneId: string): NarrativeEventContract | undefined {
  return events.find((event) => event.ownerSceneId === sceneId);
}

function eventForSceneOrEpisodeBoundary(
  events: NarrativeEventContract[],
  scenes: PlannedScene[],
  sceneId: string,
  boundary: 'first' | 'last',
): NarrativeEventContract | undefined {
  const direct = eventForScene(events, sceneId);
  if (direct) return direct;
  const scene = scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) return undefined;
  return boundary === 'first'
    ? firstEventInEpisode(events, scene.episodeNumber)
    : lastEventInEpisode(events, scene.episodeNumber);
}

function dependencyFromResidue(
  obligation: SeasonResidueObligation,
  events: NarrativeEventContract[],
): NarrativeDependencyContract | undefined {
  const source = obligation.sourceSceneId
    ? eventForScene(events, obligation.sourceSceneId)
    : lastEventInEpisode(events, obligation.sourceEpisodeNumber);
  if (!source || obligation.targetEpisodeNumbers.length === 0) return undefined;
  const targetScene = obligation.targetSceneIds?.[0];
  const target = targetScene
    ? eventForScene(events, targetScene)
    : firstEventInEpisode(events, Math.min(...obligation.targetEpisodeNumbers));
  return {
    id: dependencyId([obligation.id]),
    fromEventId: source.id,
    toEventId: target?.id,
    relation: 'sets_up',
    sourceEpisodeNumber: obligation.sourceEpisodeNumber,
    targetEpisodeNumbers: [...obligation.targetEpisodeNumbers],
    targetSceneIds: [...(obligation.targetSceneIds ?? [])],
    branchConditionKeys: obligation.conditionKey ? [obligation.conditionKey] : [],
    payoffWindow: obligation.targetEpisodeNumbers.length > 0
      ? {
        minEpisode: Math.min(...obligation.targetEpisodeNumbers),
        maxEpisode: Math.max(...obligation.targetEpisodeNumbers),
      }
      : undefined,
    requiredSurfaces: [...obligation.requiredSurface],
    priority: obligation.priority,
    sourceContractIds: [obligation.id, ...(obligation.treatmentContractIds ?? [])],
    description: obligation.authoringGuidance || obligation.choiceAnchor,
  };
}

function validateGraph(graph: NarrativeContractGraph): NarrativeContractIssue[] {
  const issues: NarrativeContractIssue[] = [];
  const presenceIds = new Set<string>();
  const presenceKeys = new Set<string>();
  for (const contract of graph.characterPresenceContracts) {
    if (presenceIds.has(contract.id)) {
      issues.push({ code: 'duplicate_character_presence_contract', severity: 'error', message: `Duplicate character presence contract "${contract.id}".`, episodeNumber: contract.episodeNumber, sceneId: contract.sceneId });
    }
    presenceIds.add(contract.id);
    const key = `${contract.episodeNumber}:${contract.sceneId}:${contract.characterId}`;
    if (presenceKeys.has(key)) {
      issues.push({ code: 'duplicate_character_presence_surface', severity: 'error', message: `Character "${contract.characterName}" has multiple presence contracts on scene "${contract.sceneId}".`, episodeNumber: contract.episodeNumber, sceneId: contract.sceneId });
    }
    presenceKeys.add(key);
    if (contract.mode === 'anonymous_plant' && contract.readerNameAllowed) {
      issues.push({ code: 'anonymous_presence_allows_name', severity: 'error', message: `Anonymous character plant "${contract.characterName}" allows its roster name on the reader surface.`, episodeNumber: contract.episodeNumber, sceneId: contract.sceneId });
    }
    if (contract.mode === 'offscreen_reference' && contract.readerNameAllowed) {
      issues.push({ code: 'offscreen_presence_allows_name', severity: 'error', message: `Offscreen character reference "${contract.characterName}" is marked reader-visible.`, episodeNumber: contract.episodeNumber, sceneId: contract.sceneId });
    }
  }
  const eventById = new Map<string, NarrativeEventContract>();
  const authoredSourceOwners = new Map<string, string>();
  for (const event of graph.events) {
    if (eventById.has(event.id)) {
      issues.push({ code: 'duplicate_event_id', severity: 'error', message: `Duplicate narrative event id "${event.id}".`, eventId: event.id, episodeNumber: event.episodeNumber });
    }
    eventById.set(event.id, event);
    for (const sourceContractId of event.sourceContractIds) {
      const priorOwner = authoredSourceOwners.get(sourceContractId);
      if (priorOwner && priorOwner !== event.id && event.provenance.confidence === 'authoritative') {
        issues.push({
          code: 'duplicate_authored_event',
          severity: 'error',
          message: `Authored contract "${sourceContractId}" resolves to multiple narrative events ("${priorOwner}" and "${event.id}").`,
          eventId: event.id,
          episodeNumber: event.episodeNumber,
        });
      } else if (!priorOwner) {
        authoredSourceOwners.set(sourceContractId, event.id);
      }
    }
    if (event.realizationMode === 'depiction' && !event.targetSceneIds.includes(event.ownerSceneId ?? '')) {
      issues.push({
        code: 'depiction_target_mismatch',
        severity: 'error',
        message: `Depiction event "${event.id}" owner scene is not present in its explicit target scene set.`,
        eventId: event.id,
        episodeNumber: event.episodeNumber,
      });
    }
    if (event.realizationMode === 'depiction' && (event.ownershipPolicy !== 'exactly_one_scene' || !event.ownerSceneId)) {
      issues.push({ code: 'depiction_without_owner', severity: 'error', message: `Depiction event "${event.id}" has no unique owner scene.`, eventId: event.id, episodeNumber: event.episodeNumber });
    }
    for (const prerequisiteId of event.prerequisiteEventIds) {
      const prerequisite = graph.events.find((candidate) => candidate.id === prerequisiteId);
      if (!prerequisite) {
        issues.push({ code: 'missing_event_prerequisite', severity: 'error', message: `Event "${event.id}" references missing prerequisite "${prerequisiteId}".`, eventId: event.id, episodeNumber: event.episodeNumber });
      } else if (prerequisite.episodeNumber !== event.episodeNumber) {
        issues.push({ code: 'cross_episode_local_prerequisite', severity: 'error', message: `Event "${event.id}" uses cross-episode prerequisite "${prerequisiteId}"; use a dependency contract instead.`, eventId: event.id, episodeNumber: event.episodeNumber });
      }
    }
  }
  for (const dependency of graph.dependencies) {
    const source = eventById.get(dependency.fromEventId);
    const target = dependency.toEventId ? eventById.get(dependency.toEventId) : undefined;
    if (!source) {
      issues.push({ code: 'missing_dependency_source', severity: 'error', message: `Dependency "${dependency.id}" has missing source event "${dependency.fromEventId}".`, dependencyId: dependency.id });
    }
    if (dependency.toEventId && !target) {
      issues.push({ code: 'missing_dependency_target', severity: 'error', message: `Dependency "${dependency.id}" has missing target event "${dependency.toEventId}".`, dependencyId: dependency.id });
    }
    if (source && dependency.sourceEpisodeNumber !== source.episodeNumber) {
      issues.push({ code: 'dependency_source_episode_mismatch', severity: 'error', message: `Dependency "${dependency.id}" source episode does not match event "${source.id}".`, dependencyId: dependency.id });
    }
    if (target && !dependency.targetEpisodeNumbers.includes(target.episodeNumber)) {
      issues.push({ code: 'dependency_target_episode_mismatch', severity: 'error', message: `Dependency "${dependency.id}" target episode does not include event "${target.id}".`, dependencyId: dependency.id });
    }
    if (dependency.targetSceneIds.some((sceneId) => !graph.events.some((event) => event.ownerSceneId === sceneId))) {
      issues.push({ code: 'dangling_dependency_scene_target', severity: 'error', message: `Dependency "${dependency.id}" references a scene with no depiction event owner.`, dependencyId: dependency.id });
    }
    if (dependency.targetEpisodeNumbers.some((episode) => episode < dependency.sourceEpisodeNumber)) {
      issues.push({ code: 'backward_cross_episode_dependency', severity: 'error', message: `Dependency "${dependency.id}" targets an episode before its source.`, dependencyId: dependency.id });
    }
  }
  const stateIds = new Set<string>();
  const stateAliases = new Map<string, string>();
  for (const state of graph.stateContracts ?? []) {
    if (stateIds.has(state.canonicalStateId)) {
      issues.push({ code: 'duplicate_state_contract', severity: 'error', message: `Duplicate canonical state contract "${state.canonicalStateId}".` });
    }
    stateIds.add(state.canonicalStateId);
    for (const alias of state.aliases) {
      const prior = stateAliases.get(alias);
      if (prior && prior !== state.canonicalStateId) {
        issues.push({ code: 'ambiguous_state_alias', severity: 'error', message: `State alias "${alias}" resolves to both "${prior}" and "${state.canonicalStateId}".` });
      }
      stateAliases.set(alias, state.canonicalStateId);
    }
    if (!state.targetEpisodeNumbers.includes(state.sourceEpisodeNumber)) {
      issues.push({ code: 'state_source_episode_missing', severity: 'error', message: `State contract "${state.id}" does not include its source episode ${state.sourceEpisodeNumber}.` });
    }
  }
  for (const premise of graph.premiseContracts ?? []) {
    const evidenceCandidateCount = premise.evidenceAtoms?.length ?? premise.evidencePatterns.length;
    if (premise.minimumEvidenceHits < 1 || premise.minimumEvidenceHits > evidenceCandidateCount) {
      issues.push({ code: 'invalid_premise_evidence_threshold', severity: 'error', message: `Premise contract "${premise.id}" has an invalid evidence threshold.` });
    }
  }
  if (graph.semanticEventIr?.premises?.length) {
    const premiseIds = new Set((graph.premiseContracts ?? []).filter((premise) => premise.blocking).map((premise) => premise.id));
    const semanticLoadByScene = new Map<string, number>();
    for (const task of graph.realizationTasks ?? []) {
      if (!task.sceneId || !task.blocking || !premiseIds.has(task.contractId)) continue;
      const semanticClaims = task.evidenceAtoms.filter((atom) => atom.verificationAuthority === 'semantic_judge').length;
      semanticLoadByScene.set(task.sceneId, (semanticLoadByScene.get(task.sceneId) ?? 0) + semanticClaims);
    }
    for (const [sceneId, semanticClaims] of semanticLoadByScene) {
      if (semanticClaims <= MAX_BLOCKING_PREMISE_PROPOSITIONS_PER_SCENE) continue;
      issues.push({
        code: 'semantic_premise_capacity_exceeded',
        severity: 'error',
        message: `Scene "${sceneId}" owns ${semanticClaims} blocking premise propositions; the per-scene capacity is ${MAX_BLOCKING_PREMISE_PROPOSITIONS_PER_SCENE}. Recompile premise propositions or distribute the contracts before scene generation.`,
        sceneId,
      });
    }
  }
  for (const seed of graph.seedContracts ?? []) {
    for (const stateId of seed.stateContractIds) {
      if (!stateIds.has(stateId.replace(/^state:/, '').replace(/-+/g, '_')) && !stateIds.has(stateId)) {
        issues.push({ code: 'seed_state_contract_missing', severity: 'error', message: `Seed contract "${seed.id}" references missing state contract "${stateId}".` });
      }
    }
    if (seed.targetEpisodeNumbers.some((episode) => episode < seed.sourceEpisodeNumber)) {
      issues.push({ code: 'backward_seed_target', severity: 'error', message: `Seed contract "${seed.id}" targets an episode before its source.` });
    }
  }
  for (const transition of graph.transitionContracts ?? []) {
    if (!transition.fromSceneId || !transition.toSceneId) {
      issues.push({ code: 'transition_scene_missing', severity: 'error', message: `Transition contract "${transition.id}" is missing a scene endpoint.` });
    }
  }
  return issues;
}

function topologicalEvents(events: NarrativeEventContract[]): { ordered: NarrativeEventContract[]; issues: NarrativeContractIssue[] } {
  const issues: NarrativeContractIssue[] = [];
  const byId = new Map(events.map((event) => [event.id, event]));
  const indegree = new Map(events.map((event) => [event.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const event of events) {
    for (const prerequisiteId of event.prerequisiteEventIds) {
      if (!byId.has(prerequisiteId)) continue;
      indegree.set(event.id, (indegree.get(event.id) ?? 0) + 1);
      outgoing.set(prerequisiteId, [...(outgoing.get(prerequisiteId) ?? []), event.id]);
    }
  }
  const ready = events.filter((event) => indegree.get(event.id) === 0);
  const ordered: NarrativeEventContract[] = [];
  const sortReady = () => ready.sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id));
  sortReady();
  while (ready.length > 0) {
    const event = ready.shift()!;
    ordered.push(event);
    for (const nextId of outgoing.get(event.id) ?? []) {
      indegree.set(nextId, (indegree.get(nextId) ?? 1) - 1);
      if (indegree.get(nextId) === 0) ready.push(byId.get(nextId)!);
    }
    sortReady();
  }
  if (ordered.length !== events.length) {
    const blocked = events.filter((event) => !ordered.some((candidate) => candidate.id === event.id));
    issues.push({ code: 'event_chronology_cycle', severity: 'error', message: `Episode event chronology contains a cycle: ${blocked.map((event) => event.id).join(', ')}.`, episodeNumber: events[0]?.episodeNumber });
    ordered.push(...blocked.sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id)));
  }
  return { ordered, issues };
}

export function compileNarrativeContractGraph(
  plan: SeasonPlan,
  scenePlan: Pick<SeasonScenePlan, 'scenes' | 'setupPayoffEdges' | 'episodeSpines' | 'sourceHash' | 'semanticEventIr'>,
): NarrativeContractGraph {
  const events: NarrativeEventContract[] = [];
  const compilationIssues: NarrativeContractIssue[] = [
    ...foldLegacyAbstractTestUnits(scenePlan),
    ...splitCompoundWritingAftermathScenes(scenePlan),
  ];
  const spineEventIds = new Map<string, string>();
  const scenes = [...scenePlan.scenes].sort((a, b) => a.episodeNumber - b.episodeNumber || a.order - b.order || a.id.localeCompare(b.id));
  const knownLocations = uniqueStrings([
    ...(plan.locationIntroductions ?? []).map((location) => location.locationName),
    ...scenes.flatMap((scene) => scene.locations ?? []),
  ]);
  const spineUnitTexts = new Set(
    Object.values(scenePlan.episodeSpines ?? {})
      .flatMap((spine) => spine.units)
      .map((unit) => clean(unit.text).toLowerCase())
      .filter(Boolean),
  );
  const emittedSupplementalTexts = new Set<string>();
  const semanticSeeds = new Map<string, SemanticContractEventSeed>();

  const spineEntries: Array<{ scene: PlannedScene; spineUnit?: EpisodeSpineUnit }> = [];
  const consumedSpineUnitIds = new Set<string>();
  for (const scene of scenes) {
    const spine = scenePlan.episodeSpines?.[scene.episodeNumber];
    const spineUnit = scene.spineUnitId ? spine?.units.find((unit) => unit.id === scene.spineUnitId) : undefined;
    if (spineUnit) {
      spineEntries.push({ scene, spineUnit });
      consumedSpineUnitIds.add(spineUnit.id);
    }
  }
  // Preserve authored spine units whose positional scene was collapsed as a
  // constraint-only shell. They still need a canonical event owner.
  for (const spine of Object.values(scenePlan.episodeSpines ?? {})) {
    for (const spineUnit of spine.units) {
      if (consumedSpineUnitIds.has(spineUnit.id)) continue;
      const episodeScenes = scenes.filter((scene) => scene.episodeNumber === spine.episodeNumber);
      const sourceScene = episodeScenes.find((scene) => scene.kind === (spineUnit.sceneKind === 'encounter' ? 'encounter' : 'standard'))
        ?? episodeScenes[0];
      if (sourceScene) spineEntries.push({ scene: sourceScene, spineUnit });
    }
  }
  for (const scene of scenes) {
    if (!scene.spineUnitId) spineEntries.push({ scene });
  }

  for (const entry of spineEntries) {
    const scene = entry.scene;
    const spine = scenePlan.episodeSpines?.[scene.episodeNumber];
    const spineUnit = entry.spineUnit;
    const ownerScene = spineUnit ? spineUnitOwnerScene(spineUnit, scenes, scene) : scene;
    const hasWritingHelper = scenes.some((candidate) =>
      candidate.episodeNumber === scene.episodeNumber && candidate.planningOrigin?.splitKind === 'late_night_writing',
    );
    const hasAftermathHelper = scenes.some((candidate) =>
      candidate.episodeNumber === scene.episodeNumber
      && candidate.planningOrigin?.kind === 'binder_split'
      && (candidate.planningOrigin.splitKind === 'viral_aftermath'
        || candidate.planningOrigin.splitKind === 'public_blog_aftermath'),
    );
    const cue = explicitCue(scene, spineUnit, hasWritingHelper);
    const originalText = sceneSourceText(scene, spineUnit);
    const splitLateNightPayoff = spineUnit?.kind === 'late_night_writing'
      && /\s+and\s+by\s+(?:evening|morning|dawn|night)\b/i.test(originalText);
    const text = cue === 'blogAftermath' && hasWritingHelper ? aftermathOnlyText(originalText) : originalText;
    const depiction = isDepictionScene(scene, spineUnit, Boolean(spine?.units.length));
    const eventSourceContractIds = spineUnit && scene.spineUnitId !== spineUnit.id
      ? [spineUnit.id]
      : sourceContractIds(scene, spineUnit);
    const eventText = splitLateNightPayoff ? writingOnlyText(originalText) : text;
    const id = eventIdFor(scene, spineUnit, splitLateNightPayoff ? 'lateNightWriting' : cue, eventText, eventSourceContractIds);
    const event: NarrativeEventContract = {
      id,
      episodeNumber: scene.episodeNumber,
      sourceOrder: spineUnit?.order ?? scene.order,
      sourceText: eventText,
      sourceContractIds: eventSourceContractIds,
      realizationMode: depiction ? 'depiction' : 'context_only',
      ownershipPolicy: depiction ? 'exactly_one_scene' : 'no_scene_owner',
      prerequisiteEventIds: [],
      targetSceneIds: depiction ? [ownerScene.id] : [],
      targetSpineUnitIds: spineUnit ? [spineUnit.id] : [],
      ownerSceneId: depiction ? ownerScene.id : undefined,
      cue: splitLateNightPayoff ? 'lateNightWriting' : cue ?? (!spineUnit ? diagnosticCue(text) : undefined),
      evidenceRequirements: eventEvidenceRequirements(id, splitLateNightPayoff ? 'lateNightWriting' : cue, originalText),
      realizationAtoms: depiction
        ? eventAndSupportingRealizationAtoms(id, eventText, knownLocations, spineUnit?.supportingIntents, ownerScene, scenePlan.semanticEventIr)
        : undefined,
      routeRealizationPolicy: routeRealizationPolicy(splitLateNightPayoff ? 'lateNightWriting' : cue, originalText),
      requiredOutcomeTiers: routeRealizationPolicy(splitLateNightPayoff ? 'lateNightWriting' : cue, originalText) === 'all_routes'
        ? [...CANONICAL_ROUTE_TIERS]
        : undefined,
      provenance: {
        source: spineUnit ? 'episode_spine' : depiction ? 'treatment_contract' : 'season_plan',
        confidence: spineUnit || scene.planningOrigin || scene.requiredBeats?.length ? 'authoritative' : cue ? 'deterministic' : 'heuristic',
      },
    };
    if (depiction) {
      const sourceTexts = Array.from(new Set([
        clean(eventText),
        ...(spineUnit?.supportingIntents ?? [])
          .filter((intent) => intent.kind === 'behavioral_intent')
          .map((intent) => clean(intent.intentText)),
      ].filter(Boolean)));
      semanticSeeds.set(id, {
        eventId: id,
        sourceText: clean(eventText),
        sources: sourceTexts.map((source, index) => ({ id: `${id}:source:${index + 1}`, text: source })),
      });
    }
    events.push(event);
    if (spineUnit) spineEventIds.set(spineUnit.id, id);

    // Required beats can project independent authored events onto a scene. Do
    // not merge them into the scene's primary event: retain their own identity
    // so ownership can move without changing the primary turn or its location.
    for (const [beatIndex, beat] of (scene.requiredBeats ?? []).entries()) {
      if (beat.contractKind === 'identity_constraint' || !['authored', 'signature', 'coldopen'].includes(beat.tier)) continue;
      const beatText = clean(beat.mustDepict || beat.sourceTurn);
      const normalizedBeat = beatText.toLowerCase();
      if (!beatText || normalizedBeat === clean(eventText).toLowerCase()) continue;
      if (spineUnitTexts.has(normalizedBeat) || emittedSupplementalTexts.has(`${scene.episodeNumber}:${normalizedBeat}`)) continue;
      if (!isIndependentSupplementalDepiction(scene.episodeNumber, beatText, beat.id)) continue;
      emittedSupplementalTexts.add(`${scene.episodeNumber}:${normalizedBeat}`);
      const supplementalCue = diagnosticCue(beatText);
      const supplementalId = eventIdFor(scene, undefined, supplementalCue, beatText, [beat.id]);
      events.push({
        id: supplementalId,
        episodeNumber: scene.episodeNumber,
        sourceOrder: scene.order + ((beatIndex + 1) / 1000),
        sourceText: beatText,
        sourceContractIds: [beat.id],
        realizationMode: 'depiction',
        ownershipPolicy: 'exactly_one_scene',
        prerequisiteEventIds: [],
        targetSceneIds: [scene.id],
        targetSpineUnitIds: [],
        ownerSceneId: scene.id,
        cue: supplementalCue,
        evidenceRequirements: eventEvidenceRequirements(supplementalId, supplementalCue, beatText),
        realizationAtoms: eventRealizationAtoms(supplementalId, beatText, knownLocations, scenePlan.semanticEventIr),
        routeRealizationPolicy: routeRealizationPolicy(supplementalCue, beatText),
        requiredOutcomeTiers: routeRealizationPolicy(supplementalCue, beatText) === 'all_routes'
          ? [...CANONICAL_ROUTE_TIERS]
          : undefined,
        provenance: { source: 'treatment_contract', confidence: 'authoritative' },
      });
      semanticSeeds.set(supplementalId, {
        eventId: supplementalId,
        sourceText: beatText,
        sources: [{ id: `${supplementalId}:source:1`, text: beatText }],
      });
    }
    if (depiction && splitLateNightPayoff && !hasAftermathHelper) {
      const aftermathId = eventIdFor(scene, spineUnit, 'blogAftermath', aftermathOnlyText(originalText));
      const aftermathText = aftermathOnlyText(originalText);
      events.push({
        ...event,
        id: aftermathId,
        sourceOrder: (spineUnit?.order ?? scene.order) + 0.1,
        sourceText: aftermathText,
        sourceContractIds: [
          ...event.sourceContractIds.map((sourceContractId) => `${sourceContractId}:aftermath`),
          `${event.id}:compound-aftermath`,
        ],
        prerequisiteEventIds: [id],
        cue: 'blogAftermath',
        evidenceRequirements: eventEvidenceRequirements(aftermathId, 'blogAftermath', aftermathText),
        realizationAtoms: eventRealizationAtoms(aftermathId, aftermathText, knownLocations, scenePlan.semanticEventIr),
      });
      semanticSeeds.set(aftermathId, {
        eventId: aftermathId,
        sourceText: aftermathText,
        sources: [{ id: `${aftermathId}:source:1`, text: aftermathText }],
      });
    }
  }

  if (scenePlan.semanticEventIr) {
    const expectedSemanticSeeds = [...semanticSeeds.values()].sort((left, right) => left.eventId.localeCompare(right.eventId));
    const semanticValidation = validateAuthoredEventSemanticIR(
      scenePlan.semanticEventIr,
      expectedSemanticSeeds,
      knownLocations,
    );
    if (!semanticValidation.passed) {
      compilationIssues.push(...semanticValidation.issues.map((message) => ({
        code: 'semantic_contract_ir_invalid',
        severity: 'error' as const,
        message,
      })));
    }
  }

  compilationIssues.push(...foldInterpretiveStoryCircleContracts(scenePlan, events));

  // A destination mentioned by an event is not necessarily its staged scene.
  // Repair the narrow, deterministic case where the owner was assigned to a
  // referenced destination while the event atoms identify exactly one staged
  // location. Ambiguous mismatches remain blocking validation errors.
  for (const event of events) {
    if (!event.ownerSceneId || event.realizationMode !== 'depiction') continue;
    const owner = scenes.find((scene) => scene.id === event.ownerSceneId);
    const staged = stagedLocationsForAtoms(event.realizationAtoms);
    if (!owner || staged.length !== 1 || owner.locations?.[0] === staged[0]) continue;
    const referenced = new Set((event.realizationAtoms ?? []).flatMap((atom) => atom.referencedLocations ?? []));
    if (owner.locations?.[0] && referenced.has(owner.locations[0])) {
      const from = owner.locations[0];
      owner.locations = [staged[0]];
      compilationIssues.push({
        code: 'scene_location_repaired_from_reference',
        severity: 'warning',
        message: `Scene "${owner.id}" location was repaired from referenced destination "${from}" to staged event location "${staged[0]}".`,
        eventId: event.id,
        episodeNumber: event.episodeNumber,
        sceneId: owner.id,
      });
    }
  }

  // An explicitly bound ESC event is the authoritative staged action for its
  // dedicated scene. If the generic scene shell retained the episode's first
  // location, repair that shell from the event rather than treating the
  // mismatch as ambiguous prose inference.
  for (const event of events) {
    if (!event.ownerSceneId || event.targetSpineUnitIds.length !== 1) continue;
    const owner = scenes.find((scene) => scene.id === event.ownerSceneId);
    const staged = stagedLocationsForAtoms(event.realizationAtoms);
    if (!owner || owner.spineUnitId !== event.targetSpineUnitIds[0] || staged.length !== 1
      || sameLocation(owner.locations?.[0], staged[0])) continue;
    const boundPrimaryCount = events.filter((candidate) =>
      candidate.ownerSceneId === owner.id && candidate.targetSpineUnitIds.length > 0,
    ).length;
    if (boundPrimaryCount !== 1) continue;
    const from = owner.locations?.[0];
    owner.locations = [staged[0]];
    compilationIssues.push({
      code: 'scene_location_repaired_from_bound_event',
      severity: 'warning',
      message: `Scene "${owner.id}" location was repaired from "${from || 'unspecified'}" to its bound event location "${staged[0]}".`,
      eventId: event.id,
      episodeNumber: event.episodeNumber,
      sceneId: owner.id,
    });
  }

  // Rebind an independently identified event to a compatible scene when its
  // current owner is at the wrong staged location. This is monotonic: event
  // identity, source text, chronology, and scene topology remain unchanged.
  // Ambiguous or missing candidates are left for the executability gate.
  for (const event of events) {
    if (!event.ownerSceneId || event.realizationMode !== 'depiction') continue;
    const owner = scenes.find((scene) => scene.id === event.ownerSceneId);
    const staged = stagedLocationsForAtoms(event.realizationAtoms);
    if (!owner || staged.length !== 1 || sameLocation(owner.locations?.[0], staged[0])) continue;
    const candidates = scenes.filter((scene) =>
      scene.episodeNumber === event.episodeNumber
      && sameLocation(scene.locations?.[0], staged[0]),
    );
    const preferredKind = event.cue === 'threatEncounter' ? 'encounter' : 'standard';
    const preferred = candidates.some((scene) => scene.kind === preferredKind)
      ? candidates.filter((scene) => scene.kind === preferredKind)
      : candidates;
    const ranked = preferred.sort((left, right) =>
      Math.abs(left.order - event.sourceOrder) - Math.abs(right.order - event.sourceOrder)
      || left.order - right.order
      || left.id.localeCompare(right.id),
    );
    if (ranked.length !== 1 && ranked[0] && ranked[1]
      && Math.abs(ranked[0].order - event.sourceOrder) === Math.abs(ranked[1].order - event.sourceOrder)) {
      continue;
    }
    const target = ranked[0];
    if (!target || target.id === owner.id) continue;
    event.ownerSceneId = target.id;
    event.targetSceneIds = [target.id];
    compilationIssues.push({
      code: 'event_owner_rebound_to_staged_location',
      severity: 'warning',
      message: `Event "${event.id}" was rebound from scene "${owner.id}" to compatible scene "${target.id}" at "${staged[0]}".`,
      eventId: event.id,
      episodeNumber: event.episodeNumber,
      sceneId: target.id,
    });
  }

  for (const event of events) {
    const spineUnitId = event.targetSpineUnitIds[0];
    const spine = scenePlan.episodeSpines?.[event.episodeNumber];
    const unit = spineUnitId ? spine?.units.find((candidate) => candidate.id === spineUnitId) : undefined;
    event.prerequisiteEventIds = (unit?.prerequisites ?? []).map((id) => spineEventIds.get(id)).filter((id): id is string => Boolean(id));
  }

  for (const episodeNumber of Array.from(new Set(events.map((event) => event.episodeNumber)))) {
    const episodeEvents = events.filter((event) => event.episodeNumber === episodeNumber && event.realizationMode === 'depiction');
    const threat = episodeEvents.find((event) => event.cue === 'threatEncounter');
    const writing = episodeEvents.find((event) => event.cue === 'lateNightWriting');
    const aftermath = episodeEvents.find((event) => event.cue === 'blogAftermath');
    if (threat && writing && !writing.prerequisiteEventIds.includes(threat.id)) writing.prerequisiteEventIds.push(threat.id);
    if (writing && aftermath && !aftermath.prerequisiteEventIds.includes(writing.id)) aftermath.prerequisiteEventIds.push(writing.id);
  }

  const dependencies: NarrativeDependencyContract[] = [];
  for (const event of events) {
    for (const prerequisiteId of event.prerequisiteEventIds) {
      dependencies.push({
        id: dependencyId([prerequisiteId, event.id, 'causes']),
        fromEventId: prerequisiteId,
        toEventId: event.id,
        relation: 'causes',
        sourceEpisodeNumber: event.episodeNumber,
        targetEpisodeNumbers: [event.episodeNumber],
        targetSceneIds: event.ownerSceneId ? [event.ownerSceneId] : [],
        branchConditionKeys: [],
        requiredSurfaces: ['scene_turn'],
        priority: 'major',
        sourceContractIds: [...event.sourceContractIds],
      });
    }
  }
  for (const edge of scenePlan.setupPayoffEdges) {
    const from = eventForSceneOrEpisodeBoundary(events, scenePlan.scenes, edge.from, 'last');
    const to = eventForSceneOrEpisodeBoundary(events, scenePlan.scenes, edge.to, 'first');
    if (!from || !to) {
      compilationIssues.push({
        code: 'dangling_setup_payoff_target',
        severity: 'error',
        message: `Setup/payoff edge references an unowned scene (from "${edge.from}" to "${edge.to}").`,
        sceneId: !from ? edge.from : edge.to,
      });
      continue;
    }
    if (from.episodeNumber === to.episodeNumber && !to.prerequisiteEventIds.includes(from.id)) {
      to.prerequisiteEventIds.push(from.id);
    }
    dependencies.push({
      id: dependencyId([from.id, to.id, 'setup-payoff']),
      fromEventId: from.id,
      toEventId: to.id,
      relation: 'pays_off',
      sourceEpisodeNumber: from.episodeNumber,
      targetEpisodeNumbers: [to.episodeNumber],
      targetSceneIds: [to.ownerSceneId!],
      branchConditionKeys: [],
      payoffWindow: { minEpisode: to.episodeNumber, maxEpisode: to.episodeNumber },
      requiredSurfaces: ['scene_turn', 'final_prose'],
      priority: 'moderate',
      sourceContractIds: [dependencyId([edge.from, edge.to, 'setup-payoff'])],
      description: edge.description,
    });
  }
  for (const residue of plan.residuePlan ?? []) {
    const dependency = dependencyFromResidue(residue, events);
    if (dependency) {
      dependencies.push(dependency);
    } else {
      compilationIssues.push({
        code: 'unresolved_residue_source',
        severity: 'error',
        message: `Residue obligation "${residue.id}" could not be bound to a canonical source event.`,
        dependencyId: residue.id,
        episodeNumber: residue.sourceEpisodeNumber,
      });
    }
  }

  const dedupedDependencies = [...new Map(dependencies.map((dependency) => [dependency.id, dependency])).values()];
  const characterPresenceContracts = compileCharacterPresenceContracts(plan, scenePlan);
  const identityScheduleContracts = compileIdentityScheduleContracts(plan, characterPresenceContracts);
  const premiseContracts = compilePremiseContracts(plan, scenes, scenePlan.semanticEventIr);
  const stateContracts = compileStateContracts(plan);
  const seedContracts = compileSeedContracts(plan, stateContracts);
  const transitionContracts = compileTransitionContracts(scenes);
  const choiceResidueContracts = compileChoiceResidueContracts(plan);
  const twistContracts = compileTwistContracts(plan, scenes);
  const graph: NarrativeContractGraph = {
    version: NARRATIVE_CONTRACT_GRAPH_VERSION,
    compilerVersion: NARRATIVE_CONTRACT_COMPILER_VERSION,
    storyId: plan.id || slug(plan.sourceTitle || 'story'),
    sourceHash: '',
    narrativeVoice: 'second_person',
    knownLocationNames: knownLocations,
    semanticEventIr: scenePlan.semanticEventIr,
    events,
    characterPresenceContracts,
    identityScheduleContracts,
    characterRoleConstraints: compileCharacterRoleConstraints(plan, identityScheduleContracts),
    episodeTopologyContracts: compileEpisodeTopologyContracts(plan),
    premiseContracts,
    stateContracts,
    seedContracts,
    transitionContracts,
    choiceResidueContracts,
    twistContracts,
    dependencies: dedupedDependencies,
    validation: { passed: true, issues: [] },
  };
  // Persist the graph in the same deterministic topological order used by the
  // episode projections. The raw scene walk can encounter a collapsed shell
  // after its real owner; leaving that order in the canonical artifact makes
  // downstream consumers re-infer chronology from array position.
  const orderedGraphEvents: NarrativeEventContract[] = [];
  for (const episodeNumber of Array.from(new Set(events.map((event) => event.episodeNumber))).sort((a, b) => a - b)) {
    const episodeOrder = topologicalEvents(events.filter((event) => event.episodeNumber === episodeNumber));
    orderedGraphEvents.push(...episodeOrder.ordered);
    compilationIssues.push(...episodeOrder.issues);
  }
  graph.events = orderedGraphEvents;
  if (scenePlan.semanticEventIr) {
    const semanticValidation = validateAuthoredEventSemanticIR(
      scenePlan.semanticEventIr,
      semanticContractEventSeeds(graph),
      knownLocations,
      semanticContractPremiseSeeds(graph),
    );
    if (!semanticValidation.passed) {
      compilationIssues.push(...semanticValidation.issues.map((message) => ({
        code: 'semantic_contract_ir_invalid',
        severity: 'error' as const,
        message,
      })));
    }
  }
  graph.realizationTasks = compileNarrativeRealizationTasks(graph, scenes);
  graph.sourceHash = stableHash({
    compilerVersion: graph.compilerVersion,
    scenePlanSourceHash: scenePlan.sourceHash,
    semanticEventIrSourceHash: scenePlan.semanticEventIr?.sourceHash,
    semanticEventIrHash: scenePlan.semanticEventIr ? stableHash(scenePlan.semanticEventIr) : undefined,
    knownLocationNames: graph.knownLocationNames,
    events: graph.events,
    characterPresenceContracts: graph.characterPresenceContracts,
    identityScheduleContracts: graph.identityScheduleContracts,
    characterRoleConstraints: graph.characterRoleConstraints,
    episodeTopologyContracts: graph.episodeTopologyContracts,
    premiseContracts: graph.premiseContracts,
    stateContracts: graph.stateContracts,
    seedContracts: graph.seedContracts,
    transitionContracts: graph.transitionContracts,
    choiceResidueContracts: graph.choiceResidueContracts,
    twistContracts: graph.twistContracts,
    realizationTasks: graph.realizationTasks,
    dependencies: graph.dependencies,
  });
  graph.validation.issues = [...compilationIssues, ...validateGraph(graph)];
  graph.validation.passed = !graph.validation.issues.some((issue) => issue.severity === 'error');
  return graph;
}

function sameLocation(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return slug(left) === slug(right);
}

const LOCATION_TRANSITION_SIGNAL = /\b(?:arriv(?:e|es|ed|ing)|bring(?:s|ing)?|brought|carry|carries|carried|drive(?:s|n)?|drove|escort(?:s|ed|ing)?|flee(?:s|ing)?|fled|follow(?:s|ed|ing)?|lead(?:s|ing)?|led|leave(?:s|ing)?|left|reach(?:es|ed|ing)?|return(?:s|ed|ing)?|ride(?:s|ing)?|rode|run(?:s|ning)?|ran|take(?:s|n|ing)?|took|travel(?:s|ed|ing)?|walk(?:s|ed|ing)?)\b/i;

function atomRequiresPriorLocation(
  atomId: string,
  priorLocationAtomIds: Set<string>,
  atomsById: Map<string, NonNullable<NarrativeEventContract['realizationAtoms']>[number]>,
  visited = new Set<string>(),
): boolean {
  if (visited.has(atomId)) return false;
  visited.add(atomId);
  const atom = atomsById.get(atomId);
  if (!atom) return false;
  for (const prerequisiteId of atom.prerequisiteAtomIds ?? []) {
    if (priorLocationAtomIds.has(prerequisiteId)
      || atomRequiresPriorLocation(prerequisiteId, priorLocationAtomIds, atomsById, visited)) return true;
  }
  return false;
}

/**
 * A scene may move through locations when the authored atoms explicitly model
 * one continuous journey. This is intentionally stricter than merely seeing a
 * prerequisite chain: the first atom at each new location must describe travel
 * and depend on action staged at the preceding location.
 */
function isSequentialLocationTransition(event: NarrativeEventContract): boolean {
  const stagedAtoms = (event.realizationAtoms ?? []).filter((atom) => atom.required && atom.stagedLocation);
  const locationSequence: string[] = [];
  for (const atom of stagedAtoms) {
    const location = atom.stagedLocation!;
    if (!sameLocation(locationSequence[locationSequence.length - 1], location)) locationSequence.push(location);
  }
  if (locationSequence.length < 2) return false;
  if (new Set(locationSequence.map(slug)).size !== locationSequence.length) return false;

  const atomsById = new Map(stagedAtoms.map((atom) => [atom.id, atom]));
  for (let locationIndex = 1; locationIndex < locationSequence.length; locationIndex += 1) {
    const location = locationSequence[locationIndex];
    const firstAtomAtLocation = stagedAtoms.find((atom) => sameLocation(atom.stagedLocation, location));
    if (!firstAtomAtLocation) return false;
    const transitionText = [
      firstAtomAtLocation.description,
      firstAtomAtLocation.sourceText,
      ...(firstAtomAtLocation.semanticCriteria ?? []),
      ...firstAtomAtLocation.acceptedPatterns,
    ].filter(Boolean).join(' ');
    if (!LOCATION_TRANSITION_SIGNAL.test(transitionText)) return false;

    const priorLocation = locationSequence[locationIndex - 1];
    const priorLocationAtomIds = new Set(
      stagedAtoms.filter((atom) => sameLocation(atom.stagedLocation, priorLocation)).map((atom) => atom.id),
    );
    if (!atomRequiresPriorLocation(firstAtomAtLocation.id, priorLocationAtomIds, atomsById)) return false;
  }
  return true;
}

/** Validate that immutable event obligations can actually be staged by their owner scenes. */
export function validateEpisodePlanExecutability(
  graph: NarrativeContractGraph,
  scenes: PlannedScene[],
  episodeNumber: number,
): NarrativeContractIssue[] {
  const issues: NarrativeContractIssue[] = [];
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  for (const event of graph.events.filter((candidate) => candidate.episodeNumber === episodeNumber && candidate.realizationMode === 'depiction')) {
    const owner = event.ownerSceneId ? sceneById.get(event.ownerSceneId) : undefined;
    if (!owner) continue;
    const staged = stagedLocationsForAtoms(event.realizationAtoms);
    if (staged.length > 1) {
      if (sameLocation(owner.locations?.[0], staged[0]) && isSequentialLocationTransition(event)) {
        issues.push({
          code: 'event_sequential_location_transition',
          severity: 'warning',
          message: `Event "${event.id}" explicitly moves through a prerequisite-ordered location sequence (${staged.join(' -> ')}).`,
          eventId: event.id,
          episodeNumber,
          sceneId: owner.id,
        });
        continue;
      }
      issues.push({
        code: 'event_multiple_staged_locations',
        severity: 'error',
        message: `Event "${event.id}" requires meaningful action at multiple staged locations (${staged.join(', ')}); split or explicitly model the event before prose generation.`,
        eventId: event.id,
        episodeNumber,
        sceneId: owner.id,
      });
      continue;
    }
    const plannedLocation = owner.locations?.[0];
    if (staged.length === 1 && !sameLocation(staged[0], plannedLocation)) {
      issues.push({
        code: 'scene_location_event_mismatch',
        severity: 'error',
        message: `Event "${event.id}" stages action at "${staged[0]}" but owner scene "${owner.id}" is planned at "${plannedLocation || 'unspecified'}".`,
        eventId: event.id,
        episodeNumber,
        sceneId: owner.id,
      });
    }
  }
  for (const transition of graph.transitionContracts?.filter((candidate) => candidate.episodeNumber === episodeNumber) ?? []) {
    const from = sceneById.get(transition.fromSceneId);
    const to = sceneById.get(transition.toSceneId);
    if (from && transition.fromLocation && !sameLocation(from.locations?.[0], transition.fromLocation)) {
      issues.push({ code: 'transition_from_location_mismatch', severity: 'error', message: `Transition "${transition.id}" starts at "${transition.fromLocation}" but scene "${from.id}" is planned at "${from.locations?.[0] || 'unspecified'}".`, episodeNumber, sceneId: from.id });
    }
    if (to && transition.toLocation && !sameLocation(to.locations?.[0], transition.toLocation)) {
      issues.push({ code: 'transition_to_location_mismatch', severity: 'error', message: `Transition "${transition.id}" ends at "${transition.toLocation}" but scene "${to.id}" is planned at "${to.locations?.[0] || 'unspecified'}".`, episodeNumber, sceneId: to.id });
    }
  }
  return issues;
}

export function compileEpisodeEventPlan(
  graph: NarrativeContractGraph,
  scenes: PlannedScene[],
  episodeNumber: number,
): EpisodeEventPlan {
  const events = graph.events.filter((event) => event.episodeNumber === episodeNumber && event.realizationMode === 'depiction');
  const characterPresenceContracts = graph.characterPresenceContracts.filter((contract) => contract.episodeNumber === episodeNumber);
  // Every episode needs the complete identity schedule. Future identities are
  // constraints on the current episode, not irrelevant data: Episode 1 must
  // know that Victor may be planted visually but cannot be named until Episode
  // 2. Writers can filter the projection for display, but the immutable plan
  // must retain the future-name prohibitions.
  const identityScheduleContracts = [...(graph.identityScheduleContracts ?? [])];
  const characterRoleConstraints = (graph.characterRoleConstraints ?? []).filter((contract) => contract.episodeNumber === episodeNumber);
  const premiseContracts = (graph.premiseContracts ?? []).filter((contract) => contract.episodeNumber === episodeNumber);
  const stateContracts = (graph.stateContracts ?? []).filter((contract) => contract.sourceEpisodeNumber === episodeNumber || contract.targetEpisodeNumbers.includes(episodeNumber));
  const seedContracts = (graph.seedContracts ?? []).filter((contract) => contract.sourceEpisodeNumber === episodeNumber || contract.targetEpisodeNumbers.includes(episodeNumber));
  const transitionContracts = (graph.transitionContracts ?? []).filter((contract) => contract.episodeNumber === episodeNumber);
  const choiceResidueContracts = (graph.choiceResidueContracts ?? []).filter((contract) => contract.sourceEpisodeNumber === episodeNumber || contract.targetEpisodeNumbers.includes(episodeNumber));
  const twistContracts = (graph.twistContracts ?? []).filter((contract) => contract.episodeNumber === episodeNumber);
  const realizationTasks = (graph.realizationTasks ?? []).filter((task) => task.episodeNumber === episodeNumber);
  const { ordered, issues } = topologicalEvents(events);
  const assignments = ordered
    .filter((event): event is NarrativeEventContract & { ownerSceneId: string } => Boolean(event.ownerSceneId))
    .map((event, order) => ({ eventId: event.id, sceneId: event.ownerSceneId, order }));
  const assignmentIssues: NarrativeContractIssue[] = [];
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const assignedEventIds = new Set<string>();
  for (const assignment of assignments) {
    if (!sceneIds.has(assignment.sceneId)) {
      assignmentIssues.push({ code: 'event_owner_scene_missing', severity: 'error', message: `Event "${assignment.eventId}" is assigned to missing scene "${assignment.sceneId}".`, eventId: assignment.eventId, episodeNumber });
    }
    if (assignedEventIds.has(assignment.eventId)) {
      assignmentIssues.push({ code: 'event_multiple_owners', severity: 'error', message: `Event "${assignment.eventId}" has multiple owners in episode ${episodeNumber}.`, eventId: assignment.eventId, episodeNumber });
    }
    assignedEventIds.add(assignment.eventId);
  }
  for (const event of events) {
    if (!event.ownerSceneId || !sceneIds.has(event.ownerSceneId)) {
      assignmentIssues.push({ code: 'depiction_without_scene_assignment', severity: 'error', message: `Depiction event "${event.id}" is not assigned to a scene in episode ${episodeNumber}.`, eventId: event.id, episodeNumber });
    }
  }
  const executableIssues = validateEpisodePlanExecutability(graph, scenes, episodeNumber);
  const eventById = new Map(ordered.map((event) => [event.id, event]));
  const eventOrderByScene = new Map<string, number>();
  for (const assignment of assignments) {
    const prior = eventOrderByScene.get(assignment.sceneId);
    if (prior == null || assignment.order < prior) {
      eventOrderByScene.set(assignment.sceneId, assignment.order);
    }
  }
  const sceneOrder = [...scenes]
    .sort((a, b) => {
      const aOrder = eventOrderByScene.get(a.id);
      const bOrder = eventOrderByScene.get(b.id);
      if (aOrder != null && bOrder != null) return aOrder - bOrder;
      if (aOrder != null) return aOrder - b.order;
      if (bOrder != null) return a.order - bOrder;
      return a.order - b.order || a.id.localeCompare(b.id);
    })
    .map((scene) => scene.id);
  const sceneContexts = sceneOrder.map((sceneId) => {
    const owned = assignments.filter((assignment) => assignment.sceneId === sceneId).map((assignment) => assignment.eventId);
    const firstOwnedOrder = owned.length > 0 ? Math.min(...owned.map((id) => ordered.findIndex((event) => event.id === id))) : Number.MAX_SAFE_INTEGER;
    const prior = ordered.slice(0, firstOwnedOrder).map((event) => event.id);
    const forbidden = prior.filter((id) => {
      const cue = eventById.get(id)?.cue;
      return cue ? DUPLICATE_SENSITIVE_CUES.has(cue) : false;
    });
    return { sceneId, ownedEventIds: owned, priorEventIdsWithinEpisode: prior, forbiddenRestageEventIds: forbidden };
  });
  const due = graph.dependencies.filter((dependency) =>
    dependency.targetEpisodeNumbers.includes(episodeNumber) ||
    (dependency.payoffWindow && episodeNumber >= dependency.payoffWindow.minEpisode && episodeNumber <= dependency.payoffWindow.maxEpisode),
  );
  const plan: EpisodeEventPlan = {
    version: EPISODE_EVENT_PLAN_VERSION,
    compilerVersion: NARRATIVE_CONTRACT_COMPILER_VERSION,
    episodeNumber,
    sourceGraphHash: graph.sourceHash,
    orderedEventIds: ordered.map((event) => event.id),
    assignments,
    sceneOrder,
    sceneContexts,
    dueDependencyIds: due.map((dependency) => dependency.id),
    activeDependencyIds: graph.dependencies
      .filter((dependency) => dependency.sourceEpisodeNumber <= episodeNumber && dependency.targetEpisodeNumbers.some((target) => target >= episodeNumber))
      .map((dependency) => dependency.id),
    characterPresenceContracts,
    identityScheduleContracts,
    characterRoleConstraints,
    premiseContracts,
    stateContracts,
    seedContracts,
    transitionContracts,
    choiceResidueContracts,
    twistContracts,
    realizationTasks,
    validation: {
      passed: ![...issues, ...assignmentIssues, ...executableIssues].some((issue) => issue.severity === 'error'),
      issues: [...issues, ...assignmentIssues, ...executableIssues],
    },
  };
  return plan;
}

function ownedEvent(contract: NarrativeEventContract): SceneOwnedEvent | undefined {
  return {
    key: contract.id,
    eventContractId: contract.id,
    cue: contract.cue ?? 'storyTurn',
    text: contract.sourceText,
    sourceContractIds: [...contract.sourceContractIds],
  };
}

export function applyEpisodeEventPlans(
  graph: NarrativeContractGraph,
  scenes: PlannedScene[],
): Record<number, EpisodeEventPlan> {
  const plans: Record<number, EpisodeEventPlan> = {};
  const eventById = new Map(graph.events.map((event) => [event.id, event]));
  const episodeNumbers = Array.from(new Set(scenes.map((scene) => scene.episodeNumber))).sort((a, b) => a - b);
  const reordered: PlannedScene[] = [];
  for (const episodeNumber of episodeNumbers) {
    const episodeScenes = scenes.filter((scene) => scene.episodeNumber === episodeNumber);
    const plan = compileEpisodeEventPlan(graph, episodeScenes, episodeNumber);
    plans[episodeNumber] = plan;
    const sceneById = new Map(episodeScenes.map((scene) => [scene.id, scene]));
    const cueEventsSoFar: SceneOwnedEvent[] = [];
    plan.sceneOrder.forEach((sceneId, order) => {
      const scene = sceneById.get(sceneId);
      if (!scene) return;
      const context = plan.sceneContexts.find((candidate) => candidate.sceneId === sceneId)!;
      const contracts = context.ownedEventIds.map((id) => eventById.get(id)).filter((event): event is NarrativeEventContract => Boolean(event));
      const owned = contracts.map(ownedEvent).filter((event): event is SceneOwnedEvent => Boolean(event));
      const forbiddenIds = new Set(context.forbiddenRestageEventIds);
      const forbidden = cueEventsSoFar.filter((event) => forbiddenIds.has(event.eventContractId ?? event.key));
      scene.order = order;
      scene.narrativeEventIds = [...context.ownedEventIds];
      scene.narrativeEventOrder = context.ownedEventIds.length > 0
        ? Math.min(...context.ownedEventIds.map((id) => plan.orderedEventIds.indexOf(id)))
        : undefined;
      scene.narrativeEventPlanVersion = plan.version;
      scene.sceneEventOwnership = {
        id: `${scene.id}-event-ownership`,
        episodeNumber,
        sceneId: scene.id,
        ownedEvents: owned,
        priorEventsWithinEpisode: [...cueEventsSoFar],
        localAftermathEvents: owned,
        forbiddenRestageEvents: forbidden,
        sourceContractIds: Array.from(new Set(owned.flatMap((event) => event.sourceContractIds))),
        diagnostics: [],
        promptGuidance: [
          'Dramatize only the canonical events assigned to this scene.',
          'Treat prior episode-local events as already happened; show consequence or residue without restaging them.',
          'Cross-episode memory arrives through explicit dependency contracts, never through local event ownership.',
        ],
      };
      const primary = contracts[0];
      const existingTurn = clean(scene.turnContract?.turnEvent || scene.turnContract?.centralTurn);
      const shouldRefineTurn = primary?.id.endsWith(':aftermath')
        || !existingTurn
        || isGenericScenePlannerText(existingTurn)
        || isQuestionShapedTurnText(existingTurn)
        || isQuestionShapedAnchor(existingTurn);
      if (primary && scene.turnContract && shouldRefineTurn && primary.sourceText && primary.sourceText !== existingTurn) {
        scene.turnContract = {
          ...scene.turnContract,
          centralTurn: primary.sourceText,
          turnEvent: primary.sourceText,
        };
      }
      cueEventsSoFar.push(...owned);
      reordered.push(scene);
    });
  }
  scenes.splice(0, scenes.length, ...reordered);
  return plans;
}

/**
 * Restore the immutable canonical ownership projection after an LLM blueprint
 * normalization or a checkpoint round-trip. The model may acknowledge event
 * IDs, but it is never allowed to reconstruct ownership metadata itself.
 */
export function reprojectEpisodeEventPlan<T extends {
  id: string;
  episodeNumber?: number;
  narrativeEventIds?: string[];
  assignedEventIds?: string[];
  claimedEventIds?: string[];
  verifiedEventIds?: string[];
  realizedEventIds?: string[];
  narrativeEventOrder?: number;
  narrativeEventPlanVersion?: number;
  sceneEventOwnership?: PlannedScene['sceneEventOwnership'];
}>(
  graph: NarrativeContractGraph,
  eventPlan: EpisodeEventPlan,
  scenes: T[],
  episodeNumber: number,
): NarrativeContractIssue[] {
  const issues: NarrativeContractIssue[] = [];
  const eventById = new Map(graph.events.map((event) => [event.id, event]));
  const assignmentsByScene = new Map<string, string[]>();
  for (const assignment of eventPlan.assignments) {
    assignmentsByScene.set(assignment.sceneId, [
      ...(assignmentsByScene.get(assignment.sceneId) ?? []),
      assignment.eventId,
    ]);
  }
  const contextsByScene = new Map(eventPlan.sceneContexts.map((context) => [context.sceneId, context]));
  const orderedSceneIds = new Map(eventPlan.sceneOrder.map((sceneId, index) => [sceneId, index]));
  for (const scene of scenes) {
    const sceneEpisode = scene.episodeNumber ?? episodeNumber;
    if (sceneEpisode !== episodeNumber) {
      issues.push({
        code: 'projection_scene_episode_mismatch',
        severity: 'error',
        message: `Canonical ownership projection received scene "${scene.id}" from episode ${sceneEpisode}; expected ${episodeNumber}.`,
        sceneId: scene.id,
        episodeNumber,
      });
      continue;
    }
    const context = contextsByScene.get(scene.id);
    const ownedIds = [...(assignmentsByScene.get(scene.id) ?? [])];
      const ownedEvents = ownedIds
      .map((eventId) => eventById.get(eventId))
      .filter((event): event is NarrativeEventContract => Boolean(event))
      .map((event): SceneOwnedEvent => ({
        key: event.id,
        eventContractId: event.id,
        cue: event.cue ?? 'storyTurn',
        text: event.sourceText,
        sourceContractIds: [...event.sourceContractIds],
      }));
    if (ownedEvents.length !== ownedIds.length) {
      issues.push({
        code: 'projection_event_missing_from_graph',
        severity: 'error',
        message: `Canonical ownership projection for scene "${scene.id}" references an event absent from the graph.`,
        sceneId: scene.id,
        episodeNumber,
      });
    }
    const priorIds = context?.priorEventIdsWithinEpisode ?? [];
      const priorEvents = priorIds
      .map((eventId) => eventById.get(eventId))
      .filter((event): event is NarrativeEventContract => Boolean(event))
      .map((event): SceneOwnedEvent => ({
        key: event.id,
        eventContractId: event.id,
        cue: event.cue ?? 'storyTurn',
        text: event.sourceText,
        sourceContractIds: [...event.sourceContractIds],
      }));
    const forbidden = priorEvents.filter((event) => DUPLICATE_SENSITIVE_CUES.has(event.cue));
    scene.narrativeEventIds = ownedIds;
    scene.assignedEventIds = [...ownedIds];
    const claimed = scene.claimedEventIds ?? scene.realizedEventIds ?? [];
    scene.claimedEventIds = claimed.filter((eventId) => ownedIds.includes(eventId));
    scene.realizedEventIds = [...scene.claimedEventIds];
    scene.verifiedEventIds = (scene.verifiedEventIds ?? []).filter((eventId) => ownedIds.includes(eventId));
    scene.narrativeEventPlanVersion = eventPlan.version;
    scene.narrativeEventOrder = ownedIds.length > 0
      ? Math.min(...ownedIds.map((eventId) => eventPlan.orderedEventIds.indexOf(eventId)).filter((index) => index >= 0))
      : orderedSceneIds.get(scene.id);
    scene.sceneEventOwnership = {
      id: `${scene.id}-event-ownership`,
      episodeNumber,
      sceneId: scene.id,
      ownedEvents,
      priorEventsWithinEpisode: priorEvents,
      localAftermathEvents: ownedEvents,
      forbiddenRestageEvents: forbidden,
      sourceContractIds: Array.from(new Set(ownedEvents.flatMap((event) => event.sourceContractIds))),
      diagnostics: [],
      promptGuidance: [
        'Dramatize only the canonical events assigned to this scene.',
        'Treat prior episode-local events as already happened; show consequence or residue without restaging them.',
        'Cross-episode memory arrives through explicit dependency contracts, never through local event ownership.',
      ],
    };
  }
  return issues;
}

/**
 * Validate a blueprint's copied canonical projection without re-running the
 * legacy cue detector. StoryArchitect may elaborate prose and metadata, but
 * it cannot create, move, or duplicate event ownership.
 */
export function validateCanonicalEpisodeBlueprintProjection<T extends {
  id: string;
  episodeNumber?: number;
  location?: string;
  locations?: string[];
  narrativeEventIds?: string[];
  assignedEventIds?: string[];
  claimedEventIds?: string[];
  verifiedEventIds?: string[];
  realizedEventIds?: string[];
  narrativeEventOrder?: number;
  characterPresenceContracts?: NarrativeCharacterPresenceContract[];
  sceneEventOwnership?: { episodeNumber?: number; sceneId?: string; ownedEvents?: Array<{ eventContractId?: string; key?: string }> };
}>(eventPlan: EpisodeEventPlan, scenes: T[], episodeNumber: number): NarrativeContractIssue[] {
  const issues: NarrativeContractIssue[] = [];
  const actualSceneOrder = scenes.map((scene) => scene.id);
  const actualSceneIds = new Set(actualSceneOrder);
  // Deterministic architecture may remove an unowned generic shell. Such a
  // shell remains in an older EpisodeEventPlan revision, but it is not an
  // authored event owner and must not make the valid seven-scene projection
  // fail. Missing assigned scenes remain visible in the filtered expectation
  // and are reported below as ownership errors.
  const expectedSceneOrder = [...eventPlan.sceneOrder];
  for (const sceneId of expectedSceneOrder) {
    if (!actualSceneIds.has(sceneId)) {
      issues.push({
        code: 'blueprint_plan_scene_missing',
        severity: 'error',
        message: `Immutable EpisodeEventPlan scene "${sceneId}" is missing from the blueprint projection for episode ${episodeNumber}.`,
        sceneId,
        episodeNumber,
      });
    }
  }
  for (const sceneId of actualSceneOrder) {
    if (!eventPlan.sceneOrder.includes(sceneId)) {
      issues.push({
        code: 'blueprint_scene_outside_plan',
        severity: 'error',
        message: `Blueprint scene "${sceneId}" is outside the immutable EpisodeEventPlan for episode ${episodeNumber}.`,
        sceneId,
        episodeNumber,
      });
    }
  }
  if (actualSceneOrder.length !== expectedSceneOrder.length
    || actualSceneOrder.some((sceneId, index) => sceneId !== expectedSceneOrder[index])) {
    issues.push({
      code: 'blueprint_scene_order_drift',
      severity: 'error',
      message: `Blueprint scene order diverges from the immutable EpisodeEventPlan for episode ${episodeNumber}.`,
      episodeNumber,
    });
  }
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const presenceByScene = new Map<string, NarrativeCharacterPresenceContract[]>();
  for (const contract of eventPlan.characterPresenceContracts ?? []) {
    presenceByScene.set(contract.sceneId, [...(presenceByScene.get(contract.sceneId) ?? []), contract]);
  }
  const assignmentByScene = new Map<string, string[]>();
  const assignmentOwners = new Map<string, string>();
  for (const assignment of eventPlan.assignments) {
    const scene = sceneById.get(assignment.sceneId);
    if (!scene) {
      issues.push({ code: 'blueprint_event_scene_missing', severity: 'error', message: `Canonical event plan references missing blueprint scene "${assignment.sceneId}".`, sceneId: assignment.sceneId, episodeNumber });
      continue;
    }
    if (scene.episodeNumber != null && scene.episodeNumber !== episodeNumber) {
      issues.push({ code: 'blueprint_scene_episode_mismatch', severity: 'error', message: `Blueprint scene "${scene.id}" belongs to episode ${scene.episodeNumber}, not ${episodeNumber}.`, sceneId: scene.id, episodeNumber });
    }
    const priorOwner = assignmentOwners.get(assignment.eventId);
    if (priorOwner && priorOwner !== assignment.sceneId) {
      issues.push({ code: 'blueprint_event_multiple_owners', severity: 'error', message: `Canonical event "${assignment.eventId}" is assigned to both "${priorOwner}" and "${assignment.sceneId}".`, eventId: assignment.eventId, episodeNumber });
    }
    assignmentOwners.set(assignment.eventId, assignment.sceneId);
    assignmentByScene.set(assignment.sceneId, [...(assignmentByScene.get(assignment.sceneId) ?? []), assignment.eventId]);
  }
  for (const scene of scenes) {
    const allowed = new Set(assignmentByScene.get(scene.id) ?? []);
    const blueprintLocation = scene.location ?? scene.locations?.[0];
    const stagedLocations = Array.from(new Set((eventPlan.realizationTasks ?? [])
      .filter((task) => task.sceneId === scene.id && task.canonicalEventId && task.target.scope === 'owner')
      .flatMap((task) => task.evidenceAtoms.map((atom) => atom.stagedLocation).filter((value): value is string => Boolean(value)))));
    if (stagedLocations.length === 1 && blueprintLocation && !sameLocation(stagedLocations[0], blueprintLocation)) {
      issues.push({
        code: 'blueprint_scene_location_event_mismatch',
        severity: 'error',
        message: `Blueprint scene "${scene.id}" is at "${blueprintLocation}" but its canonical event stages action at "${stagedLocations[0]}".`,
        sceneId: scene.id,
        episodeNumber,
      });
    }
    const declared = new Set([
      ...(scene.narrativeEventIds ?? []),
      ...(scene.assignedEventIds ?? []),
      ...(scene.claimedEventIds ?? []),
      ...(scene.verifiedEventIds ?? []),
      ...(scene.realizedEventIds ?? []),
    ]);
    const projected = new Set((scene.sceneEventOwnership?.ownedEvents ?? []).map((event) => event.eventContractId ?? event.key).filter(Boolean) as string[]);
    for (const eventId of [...declared, ...projected]) {
      if (!allowed.has(eventId)) {
        issues.push({ code: 'blueprint_event_outside_assignment', severity: 'error', message: `Blueprint scene "${scene.id}" declares canonical event "${eventId}" outside its immutable assignment.`, eventId, sceneId: scene.id, episodeNumber });
      }
    }
    const expected = [...allowed].sort();
    const actual = [...projected].sort();
    if (expected.join('|') !== actual.join('|')) {
      issues.push({
        code: 'blueprint_event_projection_incomplete',
        severity: 'error',
        message: `Blueprint scene "${scene.id}" canonical ownership projection does not match its immutable assignment. Expected [${expected.join(', ')}], received [${actual.join(', ')}].`,
        sceneId: scene.id,
        episodeNumber,
      });
    }
    if (scene.sceneEventOwnership && scene.sceneEventOwnership.episodeNumber != null && scene.sceneEventOwnership.episodeNumber !== episodeNumber) {
      issues.push({ code: 'ownership_profile_episode_mismatch', severity: 'error', message: `Ownership profile for scene "${scene.id}" carries episode ${scene.sceneEventOwnership.episodeNumber}, expected ${episodeNumber}.`, sceneId: scene.id, episodeNumber });
    }
    const expectedPresence = presenceByScene.get(scene.id) ?? [];
    const actualPresence = new Set((scene.characterPresenceContracts ?? []).map((contract) => contract.id));
    for (const contract of expectedPresence) {
      if (!actualPresence.has(contract.id)) {
        issues.push({ code: 'blueprint_character_presence_missing', severity: 'error', message: `Blueprint scene "${scene.id}" dropped immutable character presence contract "${contract.id}".`, sceneId: scene.id, episodeNumber });
      }
    }
    for (const contract of scene.characterPresenceContracts ?? []) {
      if (!expectedPresence.some((expected) => expected.id === contract.id)) {
        issues.push({ code: 'blueprint_character_presence_outside_assignment', severity: 'error', message: `Blueprint scene "${scene.id}" declares character presence contract "${contract.id}" outside its immutable assignment.`, sceneId: scene.id, episodeNumber });
      }
    }
  }
  return issues;
}

export function compileAndApplyNarrativeContracts(
  plan: SeasonPlan,
  scenePlan: SeasonScenePlan,
): SeasonScenePlan {
  collapseConstraintOnlySceneShells(scenePlan);
  alignGroupPacingWithSpineOwners(scenePlan);
  const graph = compileNarrativeContractGraph(plan, scenePlan);
  if (!graph.validation.passed) {
    const blockers = graph.validation.issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.code}: ${issue.message}`);
    throw new PipelineError(`[NarrativeContractGraphGate] ${blockers.join(' | ')}`, 'season_planning', {
      agent: 'NarrativeContractCompiler',
      failure: {
        code: 'season_graph_invalid',
        ownerStage: 'season_plan',
        retryClass: 'none',
        issueCodes: graph.validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
        repairTarget: 'season-plan',
      },
      context: { graphSourceHash: graph.sourceHash, issues: graph.validation.issues },
    });
  }
  const episodeEventPlans = applyEpisodeEventPlans(graph, scenePlan.scenes);
  const setupPayoffEdges = projectSetupPayoffEdgesFromGraph(graph, scenePlan.scenes);
  const edgesByFrom = new Map<string, string[]>();
  const edgesByTo = new Map<string, string[]>();
  for (const edge of setupPayoffEdges) {
    edgesByFrom.set(edge.from, [...(edgesByFrom.get(edge.from) ?? []), edge.to]);
    edgesByTo.set(edge.to, [...(edgesByTo.get(edge.to) ?? []), edge.from]);
  }
  for (const scene of scenePlan.scenes) {
    scene.setsUp = [...(edgesByFrom.get(scene.id) ?? [])];
    scene.paysOff = [...(edgesByTo.get(scene.id) ?? [])];
  }
  return {
    ...scenePlan,
    byEpisode: Object.fromEntries(Array.from(new Set(scenePlan.scenes.map((scene) => scene.episodeNumber))).map((episodeNumber) => [
      episodeNumber,
      scenePlan.scenes
        .filter((scene) => scene.episodeNumber === episodeNumber)
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
        .map((scene) => scene.id),
    ])),
    narrativeContractGraph: graph,
    episodeEventPlans,
    // Legacy setup/payoff consumers receive a deterministic projection of the
    // graph. They no longer remain an independent source of event identity.
    setupPayoffEdges,
  };
}

/** Enforce scene-level executability only for episodes entering generation. */
export function assertSelectedEpisodeEventPlansExecutable(
  scenePlan: SeasonScenePlan,
  episodeNumbers: number[],
): void {
  const selected = new Set(episodeNumbers);
  const invalidPlans = Object.values(scenePlan.episodeEventPlans ?? {})
    .filter((eventPlan) => selected.has(eventPlan.episodeNumber) && !eventPlan.validation.passed);
  if (invalidPlans.length === 0) return;
  const blockers = invalidPlans.flatMap((eventPlan) =>
    eventPlan.validation.issues.map((issue) => `${issue.code}: ${issue.message}`),
  );
  throw new PipelineError(`[EpisodeEventPlanGate] ${blockers.join(' | ')}`, 'season_planning', {
    agent: 'NarrativeContractCompiler',
    failure: {
      code: 'episode_plan_invalid',
      ownerStage: 'episode_plan',
      retryClass: 'recompile_episode_plan',
      issueCodes: invalidPlans.flatMap((eventPlan) => eventPlan.validation.issues.map((issue) => issue.code)),
      repairTarget: `episode-plan:${invalidPlans.map((eventPlan) => eventPlan.episodeNumber).join(',')}`,
    },
    context: {
      invalidEpisodes: invalidPlans.map((eventPlan) => eventPlan.episodeNumber),
      episodePlanDiagnostics: invalidPlans.map((eventPlan) => ({
        episodeNumber: eventPlan.episodeNumber,
        sourceGraphHash: eventPlan.sourceGraphHash,
        assignments: eventPlan.assignments,
        issues: eventPlan.validation.issues,
      })),
    },
  });
}

/**
 * Project only canonical `pays_off` dependencies back into the legacy scene
 * edge shape. The reader never sees this metadata; keeping the projection
 * deterministic lets existing budget/validator consumers migrate without
 * allowing a stale hand-authored edge to create narrative truth on its own.
 */
export function projectSetupPayoffEdgesFromGraph(
  graph: NarrativeContractGraph,
  scenes: PlannedScene[],
): SetupPayoffEdge[] {
  const eventById = new Map(graph.events.map((event) => [event.id, event]));
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const projected: SetupPayoffEdge[] = [];
  for (const dependency of graph.dependencies) {
    if (dependency.relation !== 'pays_off') continue;
    const fromEvent = eventById.get(dependency.fromEventId);
    const toEvent = dependency.toEventId ? eventById.get(dependency.toEventId) : undefined;
    const from = fromEvent?.ownerSceneId;
    const to = toEvent?.ownerSceneId ?? dependency.targetSceneIds[0];
    if (!from || !to || !sceneById.has(from) || !sceneById.has(to)) continue;
    projected.push({
      from,
      to,
      description: dependency.description,
      span: fromEvent?.episodeNumber === toEvent?.episodeNumber ? 'same_episode' : 'cross_episode',
    });
  }
  return [...new Map(projected.map((edge) => [`${edge.from}|${edge.to}`, edge])).values()]
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}
