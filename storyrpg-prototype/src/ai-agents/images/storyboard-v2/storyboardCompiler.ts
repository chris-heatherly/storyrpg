import type { SceneContent } from '../../agents/SceneWriter';
import type { CharacterBible } from '../../agents/CharacterDesigner';
import type { EncounterStructure } from '../../agents/EncounterArchitect';
import { getEncounterBeats } from '../../utils/encounterImageCoverage';
import { CharacterIdResolver, type CharacterResolutionResult } from './characterIdResolver';

export type StoryboardSlotFamily =
  | 'story-beat'
  | 'encounter-setup'
  | 'encounter-outcome'
  | 'encounter-situation'
  | 'storylet-aftermath';

export interface StoryboardCharacter {
  id: string;
  name: string;
  description: string;
  attire?: string;
  features?: string[];
}

export interface StoryboardPanelSlot {
  id: string;
  family: StoryboardSlotFamily;
  sceneId: string;
  scopedSceneId: string;
  beatId: string;
  label: string;
  narrativeText: string;
  speaker?: string;
  mood?: string;
  visualMoment?: string;
  primaryAction?: string;
  emotionalRead?: string;
  mustShowDetail?: string;
  relationshipDynamic?: string;
  visibleCost?: string;
  storyboardRole?: string;
  storyboardFrameId?: string;
  visualNarrative?: string;
  branchLabel?: string;
  outcomeName?: string;
  outcomeTier?: 'success' | 'complicated' | 'failure';
  choiceMapKey?: string;
  situationKey?: string;
  visibleCharacterIds: string[];
  unresolvedCharacterIds?: string[];
  characterAliases?: Array<{ input: string; canonicalId: string; reason: string }>;
  characterResolutionWarnings?: string[];
  sequenceIndex?: number;
}

export interface StoryboardScenePacket {
  sceneId: string;
  scopedSceneId: string;
  sceneName: string;
  setting?: string;
  mood?: string;
  characters: StoryboardCharacter[];
  panels: StoryboardPanelSlot[];
  diagnostics?: {
    unresolvedCharacterIds: string[];
    warnings: string[];
  };
}

const OUTCOME_TIERS = ['success', 'complicated', 'failure'] as const;

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const GENERIC_BACKGROUND_CHARACTER_LABELS = new Set([
  'attendant',
  'barista',
  'bystander',
  'clerk',
  'commuter',
  'crowd',
  'customer',
  'driver',
  'guest',
  'host',
  'neighbor',
  'onlooker',
  'passerby',
  'passer by',
  'patron',
  'pedestrian',
  'server',
  'shopper',
  'spectator',
  'staff',
  'stranger',
  'vendor',
  'waiter',
  'waitress',
  'worker',
]);

function isGenericBackgroundCharacterLabel(value: string): boolean {
  const normalized = normalize(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (GENERIC_BACKGROUND_CHARACTER_LABELS.has(normalized)) return true;
  return /^(?:background|generic|unnamed|random|nearby|passing)\s+(?:person|people|extra|extras|guest|guests|pedestrian|pedestrians|patron|patrons|bystander|bystanders|worker|workers|shopper|shoppers)$/.test(normalized);
}

function containsNonGenericCapitalizedName(text: string): boolean {
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) || [];
  return matches.some((match) => !isGenericBackgroundCharacterLabel(match));
}

export function detectVisibleCharacterIds(
  text: string,
  speaker: string | undefined,
  sceneCharacterIds: string[],
  characterBible: CharacterBible,
  protagonistId?: string,
): string[] {
  const resolver = new CharacterIdResolver(characterBible, { id: protagonistId });
  return detectVisibleCharacters({
    text,
    speaker,
    sceneCharacterIds,
    resolver,
  }).canonicalIds;
}

function characterSummary(characterBible: CharacterBible, ids: string[]): StoryboardCharacter[] {
  return ids
    .map((id) => characterBible.characters.find((character) => character.id === id))
    .filter((character): character is NonNullable<typeof character> => Boolean(character))
    .map((character) => ({
      id: character.id,
      name: character.name,
      description: normalize(character.physicalDescription || character.description || character.overview),
      attire: normalize(character.typicalAttire),
      features: Array.isArray(character.distinctiveFeatures) ? character.distinctiveFeatures.slice(0, 5) : [],
    }));
}

function collectExplicitCharacterInputs(source: any): string[] {
  const values = [
    source?.speakerCharacterId,
    source?.characterId,
    source?.npcId,
    ...(Array.isArray(source?.visibleCharacterIds) ? source.visibleCharacterIds : []),
    ...(Array.isArray(source?.requiredVisibleCharacterIds) ? source.requiredVisibleCharacterIds : []),
    ...(Array.isArray(source?.characters) ? source.characters : []),
    ...(Array.isArray(source?.characterIds) ? source.characterIds : []),
  ];
  return values
    .map((value) => typeof value === 'string' ? value : value?.id || value?.characterId || value?.name)
    .map(normalize)
    .filter(Boolean);
}

function detectVisibleCharacters(params: {
  text?: string;
  speaker?: string;
  sceneCharacterIds: string[];
  resolver: CharacterIdResolver;
  explicit?: unknown[];
  fallbackToSceneCast?: boolean;
}): CharacterResolutionResult {
  const { text = '', speaker, sceneCharacterIds, resolver, explicit = [], fallbackToSceneCast = true } = params;
  const textDetected = resolver.detectFromTextWithAliases(`${speaker || ''}\n${text}`);
  const explicitResolved = resolver.resolveInputs([...explicit, speaker]);
  const sceneResolved = resolver.resolveInputs(sceneCharacterIds);
  const explicitUnresolvedIds = explicitResolved.unresolvedIds.filter((id) => !isGenericBackgroundCharacterLabel(id));
  const sceneUnresolvedIds = sceneResolved.unresolvedIds.filter((id) => !isGenericBackgroundCharacterLabel(id));
  const ids = Array.from(new Set([
    ...explicitResolved.canonicalIds,
    ...textDetected.canonicalIds,
  ]));
  const warnings = explicitUnresolvedIds.length
    ? [`Unresolved character ids/aliases: ${Array.from(new Set(explicitUnresolvedIds)).join(', ')}`]
    : [];

  if (ids.length === 0 && fallbackToSceneCast) {
    if (/\{\{\s*player\.|\b(you|your|yourself)\b/i.test(text) && resolver.protagonistCanonicalId) {
      ids.push(resolver.protagonistCanonicalId);
      warnings.push('Used protagonist fallback for player-template/protagonist language.');
    } else if (sceneResolved.canonicalIds.length > 0 && /\b(he|she|they|him|her|them|his|hers|their|face|eyes|hands|voice|argues?|speaks?|asks?|leans?|looks?|stares?)\b/i.test(text)) {
      ids.push(...sceneResolved.canonicalIds.slice(0, 3));
      warnings.push('Used scene cast fallback because character language was present but no named character resolved.');
    }
  }

  for (const unresolved of sceneUnresolvedIds) {
    if (!warnings.some((warning) => warning.includes(unresolved))) {
      warnings.push(`Scene cast id did not resolve to a CharacterBible id: ${unresolved}`);
    }
  }

  if (containsNonGenericCapitalizedName(text) && ids.length === 0) {
    warnings.push('Panel text appears to contain named characters but no character reference ids resolved.');
  }

  return {
    canonicalIds: Array.from(new Set(ids)),
    unresolvedIds: Array.from(new Set([...explicitUnresolvedIds, ...sceneUnresolvedIds])),
    aliases: [...explicitResolved.aliases, ...textDetected.aliases],
    warnings: Array.from(new Set(warnings)),
  };
}

function panelCharacterFields(resolution: CharacterResolutionResult): Pick<StoryboardPanelSlot, 'visibleCharacterIds' | 'unresolvedCharacterIds' | 'characterAliases' | 'characterResolutionWarnings'> {
  return {
    visibleCharacterIds: resolution.canonicalIds,
    unresolvedCharacterIds: resolution.unresolvedIds.length ? resolution.unresolvedIds : undefined,
    characterAliases: resolution.aliases.length ? resolution.aliases : undefined,
    characterResolutionWarnings: resolution.warnings.length ? resolution.warnings : undefined,
  };
}

function encounterSituationKey(beatId: string, choiceMapKey: string, tier: string): string {
  return `${beatId}::${choiceMapKey}::${tier}::situation`;
}

function visualContractFields(source: any): Partial<StoryboardPanelSlot> {
  const contract = source?.visualContract || {};
  return {
    visualMoment: normalize(contract.visualMoment),
    primaryAction: normalize(contract.primaryAction),
    emotionalRead: normalize(contract.emotionalRead || contract.emotionalCore || contract.keyExpression),
    mustShowDetail: normalize(contract.mustShowDetail || contract.visibleObject || contract.visibleCost),
    relationshipDynamic: normalize(contract.relationshipDynamic),
    visibleCost: normalize(contract.visibleCost),
    storyboardRole: normalize(source?.storyboardRole),
    storyboardFrameId: normalize(source?.storyboardFrameId),
    visualNarrative: normalize(contract.visualNarrative),
  };
}

function collectEncounterChoicePanels(params: {
  panels: StoryboardPanelSlot[];
  choices: Array<{ id: string; text?: string; outcomes?: Record<string, any> }>;
  sceneId: string;
  scopedSceneId: string;
  beatId: string;
  pathPrefix: string;
  sceneCharacterIds: string[];
  characterBible: CharacterBible;
  resolver: CharacterIdResolver;
  protagonistId?: string;
}): void {
  const {
    panels,
    choices,
    sceneId,
    scopedSceneId,
    beatId,
    pathPrefix,
    sceneCharacterIds,
    characterBible,
    resolver,
    protagonistId,
  } = params;

  for (const choice of choices || []) {
    const choiceMapKey = pathPrefix ? `${pathPrefix}::${choice.id}` : choice.id;
    for (const tier of OUTCOME_TIERS) {
      const outcome = choice.outcomes?.[tier];
      if (!outcome) continue;
      const narrativeText = normalize(outcome.narrativeText || choice.text || `${tier} outcome`);
      const characterResolution = detectVisibleCharacters({
        text: [
          narrativeText,
          choice.text,
          ...Object.values(visualContractFields(outcome)).map(normalize),
        ].filter(Boolean).join('\n'),
        sceneCharacterIds,
        resolver,
        explicit: [...collectExplicitCharacterInputs(choice), ...collectExplicitCharacterInputs(outcome)],
      });
      panels.push({
        id: `encounter-outcome:${scopedSceneId}:${beatId}:${choiceMapKey}:${tier}`,
        family: 'encounter-outcome',
        sceneId,
        scopedSceneId,
        beatId,
        label: `${choice.text || choice.id} - ${tier}`,
        narrativeText,
        branchLabel: choiceMapKey,
        outcomeTier: tier,
        choiceMapKey,
        ...visualContractFields(outcome),
        ...panelCharacterFields(characterResolution),
      });

      if (outcome.nextSituation) {
        const setupText = normalize(outcome.nextSituation.setupText);
        const situationKey = encounterSituationKey(beatId, choiceMapKey, tier);
        const situationCharacterResolution = detectVisibleCharacters({
          text: [
            setupText,
            ...Object.values(visualContractFields(outcome.nextSituation)).map(normalize),
          ].filter(Boolean).join('\n'),
          sceneCharacterIds,
          resolver,
          explicit: collectExplicitCharacterInputs(outcome.nextSituation),
        });
        panels.push({
          id: `encounter-situation:${scopedSceneId}:${situationKey}`,
          family: 'encounter-situation',
          sceneId,
          scopedSceneId,
          beatId,
          label: `${choice.text || choice.id} - ${tier} next situation`,
          narrativeText: setupText,
          branchLabel: choiceMapKey,
          outcomeTier: tier,
          choiceMapKey,
          situationKey,
          ...visualContractFields(outcome.nextSituation),
          ...panelCharacterFields(situationCharacterResolution),
        });
        collectEncounterChoicePanels({
          ...params,
          choices: outcome.nextSituation.choices || [],
          pathPrefix: `${choiceMapKey}::${tier}`,
        });
      }
    }
  }
}

export function compileStoryboardScenePacket(params: {
  scene: SceneContent;
  scopedSceneId: string;
  characterBible: CharacterBible;
  protagonistId?: string;
  protagonistName?: string;
  encounter?: EncounterStructure;
}): StoryboardScenePacket {
  const { scene, scopedSceneId, characterBible, protagonistId, protagonistName, encounter } = params;
  const resolver = new CharacterIdResolver(characterBible, { id: protagonistId, name: protagonistName });
  const rawSceneCharacterIds = Array.from(new Set([
    ...(Array.isArray(scene.charactersInvolved) ? scene.charactersInvolved : []),
    ...(encounter?.npcStates?.map((npc) => npc.npcId).filter(Boolean) || []),
    protagonistId,
  ].filter((id): id is string => Boolean(id))));
  const sceneResolution = resolver.resolveInputs(rawSceneCharacterIds);
  const sceneCharacterIds = Array.from(new Set([
    ...sceneResolution.canonicalIds,
    resolver.protagonistCanonicalId,
  ].filter((id): id is string => Boolean(id))));

  const panels: StoryboardPanelSlot[] = [];
  for (const beat of scene.beats || []) {
    const text = [
      beat.text,
      beat.visualMoment,
      beat.primaryAction,
      beat.emotionalRead,
      beat.mustShowDetail,
    ].map(normalize).filter(Boolean).join('\n');
    const characterResolution = detectVisibleCharacters({
      text,
      speaker: beat.speaker,
      sceneCharacterIds,
      resolver,
      explicit: collectExplicitCharacterInputs(beat),
    });
    panels.push({
      id: `story-beat:${scopedSceneId}:${beat.id}`,
      family: 'story-beat',
      sceneId: scene.sceneId,
      scopedSceneId,
      beatId: beat.id,
      label: beat.visualMoment || beat.id,
      narrativeText: beat.text,
      speaker: beat.speaker,
      mood: beat.speakerMood,
      visualMoment: beat.visualMoment,
      primaryAction: beat.primaryAction,
      emotionalRead: beat.emotionalRead,
      mustShowDetail: beat.mustShowDetail,
      ...panelCharacterFields(characterResolution),
    });
  }

  for (const beat of getEncounterBeats(encounter as any)) {
    const encounterBeat = beat as any;
    const setupText = normalize(encounterBeat.setupText || encounterBeat.description || encounterBeat.name);
    const characterResolution = detectVisibleCharacters({
      text: [
        setupText,
        encounterBeat.name,
        ...Object.values(visualContractFields(encounterBeat)).map(normalize),
      ].filter(Boolean).join('\n'),
      sceneCharacterIds,
      resolver,
      explicit: collectExplicitCharacterInputs(encounterBeat),
    });
    panels.push({
      id: `encounter-setup:${scopedSceneId}:${encounterBeat.id}`,
      family: 'encounter-setup',
      sceneId: scene.sceneId,
      scopedSceneId,
      beatId: encounterBeat.id,
      label: encounterBeat.name || encounterBeat.id,
      narrativeText: setupText,
      mood: encounterBeat.phase,
      ...visualContractFields(encounterBeat),
      ...panelCharacterFields(characterResolution),
    });
    collectEncounterChoicePanels({
      panels,
      choices: encounterBeat.choices || [],
      sceneId: scene.sceneId,
      scopedSceneId,
      beatId: encounterBeat.id,
      pathPrefix: '',
      sceneCharacterIds,
      characterBible,
      protagonistId: resolver.protagonistCanonicalId,
      resolver,
    });
  }

  for (const [outcomeName, storylet] of Object.entries(encounter?.storylets || {})) {
    if (!storylet) continue;
    for (const beat of storylet.beats || []) {
      const characterResolution = detectVisibleCharacters({
        text: [
          beat.text,
          ...Object.values(visualContractFields(beat)).map(normalize),
        ].filter(Boolean).join('\n'),
        speaker: beat.speaker || beat.speakerName,
        sceneCharacterIds,
        resolver,
        explicit: collectExplicitCharacterInputs(beat),
      });
      panels.push({
        id: `storylet-aftermath:${scopedSceneId}:${outcomeName}:${beat.id}`,
        family: 'storylet-aftermath',
        sceneId: scene.sceneId,
        scopedSceneId,
        beatId: beat.id,
        label: `${outcomeName}: ${beat.id}`,
        narrativeText: beat.text,
        speaker: beat.speaker || beat.speakerName,
        mood: beat.speakerMood || storylet.tone,
        outcomeName,
        ...visualContractFields(beat),
        ...panelCharacterFields(characterResolution),
      });
    }
  }

  panels.forEach((panel, index) => {
    panel.sequenceIndex = index + 1;
  });

  const packetCharacterIds = Array.from(new Set([
    ...sceneCharacterIds,
    ...panels.flatMap((panel) => panel.visibleCharacterIds),
  ]));

  return {
    sceneId: scene.sceneId,
    scopedSceneId,
    sceneName: scene.sceneName,
    setting: normalize((scene.settingContext as any)?.description),
    mood: Array.isArray(scene.moodProgression) ? scene.moodProgression.join(' -> ') : undefined,
    characters: characterSummary(characterBible, packetCharacterIds),
    panels,
    diagnostics: {
      unresolvedCharacterIds: Array.from(new Set([
        ...sceneResolution.unresolvedIds,
        ...panels.flatMap((panel) => panel.unresolvedCharacterIds || []),
      ])),
      warnings: Array.from(new Set([
        ...sceneResolution.warnings,
        ...panels.flatMap((panel) => panel.characterResolutionWarnings || []),
      ])),
    },
  };
}
