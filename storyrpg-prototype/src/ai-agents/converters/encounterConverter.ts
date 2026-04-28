/**
 * Encounter Converter
 * 
 * Converts EncounterStructure from EncounterArchitect to the runtime Encounter type.
 * Handles all GDD/TDD features: storylets, environmental elements, NPC states, etc.
 */

import {
  Encounter,
  EncounterCost,
  EncounterCostBearer,
  EncounterCostDomain,
  EncounterCostSeverity,
  EncounterNarrativeStyle,
  EncounterOutcome,
  EncounterType,
  EncounterClock,
  EncounterPhase,
  EncounterBeat,
  EncounterChoice,
  EncounterChoiceOutcome,
  EmbeddedEncounterChoice,
  GeneratedStorylet,
  StoryletBeat,
} from '../../types';

import {
  EncounterStructure,
  EncounterChoiceOutcome as LLMEncounterChoiceOutcome,
  EmbeddedEncounterChoice as LLMEmbeddedEncounterChoice,
} from '../agents/EncounterArchitect';
import { GeneratedStoryletDraft as LLMGeneratedStorylet } from '../types/encounterDraft';

import { SceneBlueprint } from '../agents/StoryArchitect';
import { convertStateChangesToConsequences } from './stateChangeConverter';

// ========================================
// TYPE MAPPINGS
// ========================================

/**
 * Map EncounterArchitect encounter types to runtime EncounterType.
 */
const ENCOUNTER_TYPE_MAPPING: Record<string, EncounterType> = {
  'combat': 'combat',
  'social': 'social',
  'romantic': 'romantic',
  'dramatic': 'dramatic',
  'exploration': 'exploration',
  'puzzle': 'puzzle',
  'chase': 'chase',
  'stealth': 'stealth',
  'mixed': 'mixed',
  'investigation': 'investigation',
  'survival': 'survival',
  'heist': 'heist',
  'negotiation': 'negotiation',
};

const ENCOUNTER_STYLE_MAPPING: Record<string, EncounterNarrativeStyle> = {
  combat: 'action',
  chase: 'action',
  heist: 'stealth',
  stealth: 'stealth',
  investigation: 'mystery',
  puzzle: 'mystery',
  negotiation: 'social',
  social: 'social',
  romantic: 'romantic',
  dramatic: 'dramatic',
  exploration: 'adventure',
  survival: 'adventure',
  mixed: 'mixed',
};

function normalizeEncounterType(rawType?: string): EncounterType {
  const normalized = (rawType || '').trim().toLowerCase().replace(/[\s_-]+/g, '_');
  if (normalized in ENCOUNTER_TYPE_MAPPING) {
    return ENCOUNTER_TYPE_MAPPING[normalized];
  }
  if (normalized === 'investigate' || normalized === 'discovery') return 'investigation';
  if (normalized === 'romance' || normalized === 'intimate' || normalized === 'confession') return 'romantic';
  if (normalized === 'drama' || normalized === 'interrogation' || normalized === 'confrontation') return 'dramatic';
  if (normalized === 'survive') return 'survival';
  return 'mixed';
}

function inferEncounterStyle(type: EncounterType, rawStyle?: string): EncounterNarrativeStyle {
  const normalizedStyle = (rawStyle || '').trim().toLowerCase().replace(/[\s_-]+/g, '_');
  if (normalizedStyle in ENCOUNTER_STYLE_MAPPING) {
    return ENCOUNTER_STYLE_MAPPING[normalizedStyle];
  }
  return ENCOUNTER_STYLE_MAPPING[type] || 'mixed';
}

function normalizeEncounterOutcome(outcome?: string): EncounterOutcome | undefined {
  if (!outcome) return undefined;
  if (outcome === 'partial_victory') return 'partialVictory';
  if (outcome === 'partialVictory' || outcome === 'victory' || outcome === 'defeat' || outcome === 'escape') {
    return outcome as EncounterOutcome;
  }
  return undefined;
}

function inferCostDomain(text: string, cost?: Partial<EncounterCost>): EncounterCostDomain {
  const lowered = `${text} ${cost?.visibleComplication || ''} ${cost?.immediateEffect || ''}`.toLowerCase();
  if (cost?.domain) return cost.domain;
  if (/(trust|affection|respect|fear|relationship)/.test(lowered)) return 'relationship';
  if (/(wound|injur|bleed|hurt|scar|pain)/.test(lowered)) return 'injury';
  if (/(delay|late|time|window|clock)/.test(lowered)) return 'time';
  if (/(exposed|seen|noticed|discover|reveal)/.test(lowered)) return 'exposure';
  if (/(reputation|shame|humiliat|public|rumor)/.test(lowered)) return 'reputation';
  if (/(secret|truth|clue|information|knowledge)/.test(lowered)) return 'information';
  if (/(position|ground|territory|vulnerable|cornered)/.test(lowered)) return 'position';
  if (/(spent|consume|deplete|resource|supply|ammo|gold|coin|item)/.test(lowered)) return 'resource';
  return 'mixed';
}

function inferCostSeverity(
  text: string,
  consequences: ReturnType<typeof convertStateChangesToConsequences>,
  cost?: Partial<EncounterCost>
): EncounterCostSeverity {
  if (cost?.severity) return cost.severity;
  if ((consequences?.length || 0) >= 3 || /(devastat|grave|severe|lasting|permanent)/i.test(text)) return 'severe';
  if ((consequences?.length || 0) >= 2 || /(major|heavy|serious|costly)/i.test(text)) return 'major';
  if ((consequences?.length || 0) >= 1 || /(frayed|delayed|wounded|shaken|exposed)/i.test(text)) return 'moderate';
  return 'minor';
}

function inferCostBearer(text: string, domain: EncounterCostDomain, cost?: Partial<EncounterCost>): EncounterCostBearer {
  if (cost?.whoPays) return cost.whoPays;
  if (domain === 'relationship') return 'relationship';
  if (/(ally|friend|partner|lover)/i.test(text)) return 'ally';
  if (/(city|village|crowd|world|estate|crew)/i.test(text)) return 'world';
  return 'protagonist';
}

function deriveEncounterCost(
  seed: {
    cost?: Partial<EncounterCost>;
    narrativeFunction?: string;
    outcomeText?: string;
    complication?: string;
    consequences?: ReturnType<typeof convertStateChangesToConsequences>;
  } | undefined
): EncounterCost | undefined {
  if (!seed) return undefined;
  const fallbackText = [
    seed.cost?.visibleComplication,
    seed.complication,
    seed.cost?.immediateEffect,
    seed.outcomeText,
    seed.narrativeFunction,
  ].filter(Boolean).join(' ');
  if (!fallbackText && (!seed.consequences || seed.consequences.length === 0)) {
    return undefined;
  }
  const domain = inferCostDomain(fallbackText, seed.cost);
  return {
    domain,
    severity: inferCostSeverity(fallbackText, seed.consequences || [], seed.cost),
    whoPays: inferCostBearer(fallbackText, domain, seed.cost),
    immediateEffect: seed.cost?.immediateEffect || seed.complication || seed.outcomeText || 'The objective is achieved, but the cost is immediate.',
    visibleComplication: seed.cost?.visibleComplication || seed.complication || seed.narrativeFunction || 'The cost of success is visible in the aftermath.',
    lingeringEffect: seed.cost?.lingeringEffect || seed.narrativeFunction,
    consequences: seed.cost?.consequences || seed.consequences,
  };
}

// ========================================
// STORYLET CONVERTER
// ========================================

/**
 * Convert an LLM-generated storylet to the runtime GeneratedStorylet type.
 * Handles StateChange -> Consequence conversion for all consequences.
 */
export function convertLLMStoryletToRuntime(
  storylet: LLMGeneratedStorylet | undefined
): GeneratedStorylet | undefined {
  if (!storylet) return undefined;

  const convertedConsequences = convertStateChangesToConsequences(storylet.consequences);
  const storyletCost = deriveEncounterCost({
    cost: (storylet as any).cost,
    narrativeFunction: storylet.narrativeFunction,
    outcomeText: storylet.beats?.[0]?.text,
    consequences: convertedConsequences,
  });

  return {
    id: storylet.id,
    name: storylet.name,
    triggerOutcome: storylet.triggerOutcome,
    tone: storylet.tone,
    narrativeFunction: storylet.narrativeFunction,
    startingBeatId: storylet.startingBeatId,
    setsFlags: storylet.setsFlags,
    nextSceneId: storylet.nextSceneId,
    cost: storyletCost,
    beats: storylet.beats.map((beat, idx, arr) => ({
      id: beat.id,
      text: beat.text,
      speaker: beat.speakerName,
      speakerMood: beat.speakerMood,
      image: (beat as any).image,
      visualContract: (beat as any).visualContract,
      cost: (beat as any).cost || storyletCost,
      nextBeatId: beat.nextBeatId ?? (idx < arr.length - 1 ? arr[idx + 1].id : undefined),
      isTerminal: beat.isTerminal ?? (idx === arr.length - 1),
      choices: beat.choices?.map(c => ({
        id: c.id,
        text: c.text,
        nextBeatId: c.nextBeatId,
        consequences: convertStateChangesToConsequences(c.consequences),
      })),
    })),
    consequences: convertedConsequences,
  };
}

/**
 * Convert all storylets in an EncounterStructure.
 * Guards against malformed LLM output where storylet values are bare strings
 * (e.g. ["victory", "defeat", "escape"]) instead of proper objects.
 */
export function convertEncounterStorylets(storylets?: {
  victory?: LLMGeneratedStorylet;
  partialVictory?: LLMGeneratedStorylet;
  defeat?: LLMGeneratedStorylet;
  escape?: LLMGeneratedStorylet;
}): {
  victory?: GeneratedStorylet;
  partialVictory?: GeneratedStorylet;
  defeat?: GeneratedStorylet;
  escape?: GeneratedStorylet;
} | undefined {
  if (!storylets) return undefined;

  const safeConvert = (
    value: LLMGeneratedStorylet | string | undefined,
    key: string
  ): GeneratedStorylet | undefined => {
    if (!value) return undefined;
    if (typeof value === 'string') {
      console.warn(`[encounterConverter] Storylet "${key}" is a bare string ("${value}"), skipping — expected an object`);
      return undefined;
    }
    if (typeof value !== 'object' || !value.beats || !Array.isArray(value.beats)) {
      console.warn(`[encounterConverter] Storylet "${key}" is malformed (missing beats array), skipping`);
      return undefined;
    }
    return convertLLMStoryletToRuntime(value);
  };

  const result = {
    victory: safeConvert(storylets.victory as LLMGeneratedStorylet | string, 'victory'),
    partialVictory: safeConvert(storylets.partialVictory as LLMGeneratedStorylet | string, 'partialVictory'),
    defeat: safeConvert(storylets.defeat as LLMGeneratedStorylet | string, 'defeat'),
    escape: safeConvert(storylets.escape as LLMGeneratedStorylet | string, 'escape'),
  };

  if (!result.victory && !result.partialVictory && !result.defeat && !result.escape) {
    console.warn('[encounterConverter] All storylets were invalid/empty — returning undefined');
    return undefined;
  }

  return result;
}

// ========================================
// OUTCOME & BRANCHING TREE CONVERTERS
// ========================================

/**
 * Convert a single LLM EncounterChoiceOutcome to the runtime type.
 * Preserves nextSituation (branching tree), outcomeImage, cinematicDescription, 
 * isTerminal, encounterOutcome, and recursively converts embedded choices.
 */
function convertOutcome(
  llmOutcome: LLMEncounterChoiceOutcome | undefined,
  tier: 'success' | 'complicated' | 'failure',
  defaults: { goalTicks: number; threatTicks: number; narrativeText: string }
): EncounterChoiceOutcome {
  if (!llmOutcome) {
    return {
      tier,
      goalTicks: defaults.goalTicks,
      threatTicks: defaults.threatTicks,
      narrativeText: defaults.narrativeText,
    };
  }

  const convertedConsequences = convertStateChangesToConsequences(llmOutcome.consequences);
  const normalizedOutcome = normalizeEncounterOutcome(llmOutcome.encounterOutcome);

  const result: EncounterChoiceOutcome = {
    tier,
    goalTicks: llmOutcome.goalTicks ?? defaults.goalTicks,
    threatTicks: llmOutcome.threatTicks ?? defaults.threatTicks,
    narrativeText: llmOutcome.narrativeText || defaults.narrativeText,
    nextBeatId: llmOutcome.nextBeatId,
    outcomeImage: llmOutcome.outcomeImage,
    cinematicDescription: llmOutcome.cinematicDescription,
    visualContract: (llmOutcome as any).visualContract,
    storyboardFrameId: (llmOutcome as any).storyboardFrameId,
    nextStoryboardFrameId: (llmOutcome as any).nextStoryboardFrameId,
    tacticalEffect: (llmOutcome as any).tacticalEffect,
    isTerminal: llmOutcome.isTerminal,
    encounterOutcome: normalizedOutcome,
    consequences: convertedConsequences,
    cost: normalizedOutcome === 'partialVictory'
      ? deriveEncounterCost({
          cost: (llmOutcome as any).cost,
          outcomeText: llmOutcome.narrativeText,
          consequences: convertedConsequences,
        })
      : undefined,
  };

  // Preserve branching tree: recursively convert nextSituation
  if (llmOutcome.nextSituation) {
    result.nextSituation = {
      setupText: llmOutcome.nextSituation.setupText,
      situationImage: llmOutcome.nextSituation.situationImage,
      cinematicSetup: llmOutcome.nextSituation.cinematicSetup,
      visualContract: (llmOutcome.nextSituation as any).visualContract,
      choices: (llmOutcome.nextSituation.choices || []).map(convertEmbeddedChoice),
    };
  }

  return result;
}

/**
 * Convert an LLM EmbeddedEncounterChoice to the runtime type.
 * Recursively converts outcomes which may contain further nextSituation trees.
 */
function convertEmbeddedChoice(llmChoice: LLMEmbeddedEncounterChoice): EmbeddedEncounterChoice {
  return {
    id: llmChoice.id,
    text: llmChoice.text,
    approach: llmChoice.approach,
    primarySkill: llmChoice.primarySkill,
    outcomes: {
      success: convertOutcome(llmChoice.outcomes?.success, 'success', { goalTicks: 2, threatTicks: 0, narrativeText: 'Success!' }),
      complicated: convertOutcome(llmChoice.outcomes?.complicated, 'complicated', { goalTicks: 1, threatTicks: 1, narrativeText: 'Partial success...' }),
      failure: convertOutcome(llmChoice.outcomes?.failure, 'failure', { goalTicks: 0, threatTicks: 2, narrativeText: 'Things go wrong...' }),
    },
    // Pre-encounter state payoff fields
    conditions: (llmChoice as any).conditions,
    showWhenLocked: (llmChoice as any).showWhenLocked,
    lockedText: (llmChoice as any).lockedText,
    statBonus: (llmChoice as any).statBonus,
  };
}

// ========================================
// MAIN CONVERTER
// ========================================

/**
 * Convert EncounterStructure from EncounterArchitect to the runtime Encounter type.
 * This is the main entry point for encounter conversion.
 */
export function convertEncounterStructureToEncounter(
  structure: EncounterStructure,
  sceneBlueprint: SceneBlueprint
): Encounter {
  // Map encounter type
  const encounterType = normalizeEncounterType(structure.encounterType);
  const encounterStyle = inferEncounterStyle(encounterType, structure.encounterStyle);

  // Create goal and threat clocks
  const goalClock: EncounterClock = {
    id: `${structure.sceneId}-goal`,
    name: structure.goalClock?.name || 'Objective Progress',
    description: structure.goalClock?.description || 'Progress toward completing the encounter objective',
    segments: structure.goalClock?.segments || 6,
    filled: 0,
    type: 'goal',
  };

  const threatClock: EncounterClock = {
    id: `${structure.sceneId}-threat`,
    name: structure.threatClock?.name || 'Danger Level',
    description: structure.threatClock?.description || 'Escalating threat as the encounter progresses',
    segments: structure.threatClock?.segments || 4,
    filled: 0,
    type: 'threat',
  };

  // Convert beats to EncounterBeats with full choice structure, preserving branching tree data
  const encounterBeats: EncounterBeat[] = (structure.beats || []).map(beat => {
    const choices: EncounterChoice[] = (beat.choices || []).map(choice => ({
      id: choice.id,
      text: choice.text,
      approach: choice.approach,
      primarySkill: choice.primarySkill,
      impliedApproach: choice.impliedApproach,
      skillAdvantage: choice.skillAdvantage,
      specialChoiceType: choice.specialChoiceType,
      outcomes: {
        success: convertOutcome(choice.outcomes?.success, 'success', { goalTicks: 2, threatTicks: 0, narrativeText: 'Success!' }),
        complicated: convertOutcome(choice.outcomes?.complicated, 'complicated', { goalTicks: 1, threatTicks: 1, narrativeText: 'Partial success...' }),
        failure: convertOutcome(choice.outcomes?.failure, 'failure', { goalTicks: 0, threatTicks: 2, narrativeText: 'Things go wrong...' }),
      },
      // Pre-encounter state payoff fields — passed through as-is (ConditionExpression JSON objects)
      conditions: (choice as any).conditions,
      showWhenLocked: (choice as any).showWhenLocked,
      lockedText: (choice as any).lockedText,
      statBonus: (choice as any).statBonus,
    }));

    return {
      id: beat.id,
      phase: beat.phase,
      name: beat.name,
      setupText: beat.setupText,
      // Pre-encounter state payoff: conditional situation text
      setupTextVariants: (beat as any).setupTextVariants,
      visualContract: (beat as any).visualContract,
      choices,
      escalationText: beat.escalationText,
      escalationImage: beat.escalationImage,
      cinematicSetup: beat.cinematicSetup,
      storyboardFrameId: (beat as any).storyboardFrameId,
      storyboardRole: (beat as any).storyboardRole,
    };
  });

  // Create encounter phase
  const phase: EncounterPhase = {
    id: `${structure.sceneId}-phase-1`,
    name: sceneBlueprint.name,
    description: sceneBlueprint.description,
    situationImage: '',
    beats: encounterBeats,
    onSuccess: {
      outcomeText: structure.stakes?.victory || 'You succeeded!',
    },
    onFailure: {
      outcomeText: structure.stakes?.defeat || 'Things didn\'t go as planned...',
    },
  };

  // Get next scene from blueprint
  const leadsToScenes = sceneBlueprint.leadsTo || [];
  const nextSceneId = leadsToScenes[0] || '';

  // Convert storylets
  const storylets = convertEncounterStorylets(structure.storylets);

  // Convert environmental elements
  const environmentalElements = (structure.environmentalElements || []).map(el => ({
    ...el,
    isActive: false,
    wasUsed: false,
  }));

  // Convert NPC states - fallback to 'wary' if LLM omitted initialDisposition
  const npcStates = (structure.npcStates || []).map(npc => ({
    ...npc,
    currentDisposition: npc.initialDisposition ?? 'wary',
  }));

  // Convert escalation triggers
  const escalationTriggers = (structure.escalationTriggers || []).map(trigger => ({
    ...trigger,
    hasTriggered: false,
  }));

  // Get consequences from storylets
  const victoryConsequences = storylets?.victory?.consequences || [];
  const partialVictoryConsequences = storylets?.partialVictory?.consequences || [];
  const defeatConsequences = storylets?.defeat?.consequences || [];
  const escapeConsequences = storylets?.escape?.consequences || [];
  const partialVictoryCost = deriveEncounterCost({
    cost: (structure as any).partialVictoryCost || storylets?.partialVictory?.cost,
    narrativeFunction: storylets?.partialVictory?.narrativeFunction,
    outcomeText: storylets?.partialVictory?.beats?.[0]?.text,
    complication: storylets?.partialVictory?.narrativeFunction,
    consequences: partialVictoryConsequences,
  });

  return {
    id: `${structure.sceneId}-encounter`,
    type: encounterType,
    style: encounterStyle,
    name: sceneBlueprint.name,
    description: sceneBlueprint.encounterDescription || sceneBlueprint.description,
    goalClock,
    threatClock,
    stakes: structure.stakes || {
      victory: 'Complete the objective successfully',
      defeat: 'Face the consequences of failure',
    },
    phases: [phase],
    startingPhaseId: phase.id,
    outcomes: {
      victory: {
        nextSceneId: structure.storylets?.victory?.nextSceneId || nextSceneId,
        outcomeText: structure.storylets?.victory?.beats?.[0]?.text || 'Victory! You overcame the challenge.',
        consequences: victoryConsequences.length > 0 ? victoryConsequences : undefined,
      },
      partialVictory: {
        nextSceneId: structure.storylets?.partialVictory?.nextSceneId || nextSceneId,
        outcomeText: structure.storylets?.partialVictory?.beats?.[0]?.text || 'You succeeded, but at a cost.',
        complication: structure.storylets?.partialVictory?.narrativeFunction || 'The situation is more complicated than expected.',
        consequences: partialVictoryConsequences.length > 0 ? partialVictoryConsequences : undefined,
        cost: partialVictoryCost,
      },
      defeat: {
        nextSceneId: structure.storylets?.defeat?.nextSceneId || nextSceneId,
        outcomeText: structure.storylets?.defeat?.beats?.[0]?.text || 'You were unable to achieve your goal.',
        consequences: defeatConsequences.length > 0 ? defeatConsequences : undefined,
      },
      escape: structure.storylets?.escape ? {
        nextSceneId: structure.storylets.escape.nextSceneId || nextSceneId,
        outcomeText: structure.storylets.escape.beats?.[0]?.text || 'You managed to escape.',
        consequences: escapeConsequences.length > 0 ? escapeConsequences : undefined,
      } : undefined,
    },
    // GDD/TDD features
    storylets,
    environmentalElements,
    npcStates,
    escalationTriggers,
    informationVisibility: structure.informationVisibility,
    pixarStakes: structure.pixarStakes,
    pixarSurprise: structure.pixarSurprise,
    // Preserve design metadata
    tensionCurve: structure.tensionCurve,
    estimatedDuration: structure.estimatedDuration,
    replayability: structure.replayability,
    designNotes: structure.designNotes,
    storyboard: (structure as any).storyboard,
    payoffContext: (structure as any).payoffContext,
  };
}
