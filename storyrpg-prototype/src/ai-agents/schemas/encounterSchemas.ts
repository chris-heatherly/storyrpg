import type { StructuredJsonSchema } from '../agents/BaseAgent';

const stringArray = {
  type: 'array',
  items: { type: 'string' },
} as const;

const clock = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'segments', 'description'],
  properties: {
    name: { type: 'string' },
    segments: { type: 'number' },
    description: { type: 'string' },
  },
} as const;

const stakes = {
  type: 'object',
  additionalProperties: false,
  required: ['victory', 'defeat'],
  properties: {
    victory: { type: 'string' },
    defeat: { type: 'string' },
  },
} as const;

const reminderPlan = {
  type: 'object',
  additionalProperties: false,
  properties: {
    immediate: { type: 'string' },
    shortTerm: { type: 'string' },
    later: { type: 'string' },
  },
} as const;

const feedbackCue = {
  type: 'object',
  additionalProperties: false,
  properties: {
    echoSummary: { type: 'string' },
    progressSummary: { type: 'string' },
    checkClass: { type: 'string' },
  },
} as const;

const outcome = {
  type: 'object',
  additionalProperties: false,
  required: ['narrativeText', 'goalTicks', 'threatTicks'],
  properties: {
    narrativeText: { type: 'string' },
    goalTicks: { type: 'number' },
    threatTicks: { type: 'number' },
    isTerminal: { type: 'boolean' },
    encounterOutcome: { type: 'string' },
    relationshipConsequences: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          npcId: { type: 'string' },
          dimension: { type: 'string' },
          change: { type: 'number' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

const outcomes = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'complicated', 'failure'],
  properties: {
    success: outcome,
    complicated: outcome,
    failure: outcome,
  },
} as const;

const encounterChoice = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'text', 'approach', 'primarySkill', 'outcomes'],
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    approach: { type: 'string' },
    primarySkill: { type: 'string' },
    impliedApproach: { type: 'string' },
    consequenceDomain: { type: 'string' },
    reminderPlan,
    feedbackCue,
    outcomes,
  },
} as const;

const phase2Outcome = {
  type: 'object',
  additionalProperties: false,
  required: ['narrativeText', 'goalTicks', 'threatTicks', 'isTerminal', 'encounterOutcome'],
  properties: {
    narrativeText: { type: 'string' },
    goalTicks: { type: 'number' },
    threatTicks: { type: 'number' },
    isTerminal: { type: 'boolean' },
    encounterOutcome: { type: 'string' },
  },
} as const;

const phase2Choice = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'text', 'approach', 'primarySkill', 'outcomes'],
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    approach: { type: 'string' },
    primarySkill: { type: 'string' },
    outcomes: {
      type: 'object',
      additionalProperties: false,
      required: ['success', 'complicated', 'failure'],
      properties: {
        success: phase2Outcome,
        complicated: phase2Outcome,
        failure: phase2Outcome,
      },
    },
  },
} as const;

const compactOutcome = {
  type: 'object',
  additionalProperties: false,
  required: ['narrativeText', 'goalTicks', 'threatTicks'],
  properties: {
    narrativeText: { type: 'string' },
    goalTicks: { type: 'number' },
    threatTicks: { type: 'number' },
    isTerminal: { type: 'boolean' },
    encounterOutcome: { type: 'string' },
  },
} as const;

const compactEncounterChoice = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'text', 'approach', 'primarySkill', 'outcomes'],
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    approach: { type: 'string' },
    primarySkill: { type: 'string' },
    consequenceDomain: { type: 'string' },
    outcomes: {
      type: 'object',
      additionalProperties: false,
      required: ['success', 'complicated', 'failure'],
      properties: {
        success: compactOutcome,
        complicated: compactOutcome,
        failure: compactOutcome,
      },
    },
  },
} as const;

const compactEncounterBeat = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'setupText', 'choices'],
  properties: {
    id: { type: 'string' },
    setupText: { type: 'string' },
    choices: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: compactEncounterChoice,
    },
  },
} as const;

const phase2Situation = {
  type: 'object',
  additionalProperties: false,
  required: ['setupText', 'choices'],
  properties: {
    setupText: { type: 'string' },
    choices: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: phase2Choice,
    },
  },
} as const;

const condition = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string' },
    flag: { type: 'string' },
    npcId: { type: 'string' },
    dimension: { type: 'string' },
    operator: { type: 'string' },
    value: { type: 'string' },
  },
} as const;

const storyletBeat = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'text'],
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    nextBeatId: { type: 'string' },
    isTerminal: { type: 'boolean' },
  },
} as const;

const encounterCost = {
  type: 'object',
  additionalProperties: false,
  properties: {
    domain: { type: 'string' },
    severity: { type: 'string' },
    whoPays: { type: 'string' },
    immediateEffect: { type: 'string' },
    visibleComplication: { type: 'string' },
  },
} as const;

const storylet = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'triggerOutcome', 'tone', 'narrativeFunction', 'beats', 'startingBeatId', 'consequences'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    triggerOutcome: { type: 'string' },
    tone: { type: 'string' },
    narrativeFunction: { type: 'string' },
    beats: {
      type: 'array',
      maxItems: 3,
      items: storyletBeat,
    },
    startingBeatId: { type: 'string' },
    consequences: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string' },
          flag: { type: 'string' },
          name: { type: 'string' },
          score: { type: 'string' },
          value: { type: 'string' },
          change: { type: 'number' },
          description: { type: 'string' },
        },
      },
    },
    setsFlags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['flag', 'value'],
        properties: {
          flag: { type: 'string' },
          value: { type: 'boolean' },
        },
      },
    },
    cost: encounterCost,
    nextSceneId: { type: 'string' },
  },
} as const;

const compactStorylet = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'triggerOutcome', 'tone', 'narrativeFunction', 'beats', 'startingBeatId'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    triggerOutcome: { type: 'string' },
    tone: { type: 'string' },
    narrativeFunction: { type: 'string' },
    beats: {
      type: 'array',
      maxItems: 3,
      items: storyletBeat,
    },
    startingBeatId: { type: 'string' },
    nextSceneId: { type: 'string' },
  },
} as const;

const genericNamedObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    description: { type: 'string' },
    value: { type: 'string' },
  },
} as const;

export function buildEncounterStructureJsonSchema(): StructuredJsonSchema {
  return {
    name: 'encounter_structure',
    description: 'Complete playable encounter structure.',
    schema: {
      type: 'object',
      additionalProperties: true,
      required: ['sceneId', 'encounterType', 'beats', 'startingBeatId', 'goalClock', 'threatClock', 'stakes', 'storylets'],
      properties: {
        id: { type: 'string' },
        sceneId: { type: 'string' },
        encounterType: { type: 'string' },
        encounterStyle: { type: 'string' },
        beats: {
          type: 'array',
          items: compactEncounterBeat,
        },
        startingBeatId: { type: 'string' },
        goalClock: clock,
        threatClock: clock,
        stakes,
        tensionCurve: { type: 'array', items: genericNamedObject },
        storylets: {
          type: 'object',
          additionalProperties: true,
          required: ['victory', 'partialVictory', 'defeat', 'escape'],
          properties: {
            victory: compactStorylet,
            partialVictory: compactStorylet,
            defeat: compactStorylet,
            escape: compactStorylet,
          },
        },
        environmentalElements: { type: 'array', items: genericNamedObject },
        npcStates: { type: 'array', items: genericNamedObject },
        escalationTriggers: { type: 'array', items: genericNamedObject },
        informationVisibility: genericNamedObject,
        estimatedDuration: { type: 'string' },
        replayability: { type: 'string' },
        designNotes: { type: 'string' },
      },
    },
  };
}

export function buildEncounterPhase1JsonSchema(): StructuredJsonSchema {
  return {
    name: 'encounter_phase_1',
    description: 'Encounter opening beat with choice-specific outcomes.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['sceneId', 'encounterType', 'goalClock', 'threatClock', 'stakes', 'openingBeat'],
      properties: {
        sceneId: { type: 'string' },
        encounterType: { type: 'string' },
        goalClock: clock,
        threatClock: clock,
        stakes,
        openingBeat: {
          type: 'object',
          additionalProperties: false,
          required: ['setupText', 'choices'],
          properties: {
            setupText: { type: 'string' },
            choices: {
              type: 'array',
              minItems: 3,
              maxItems: 4,
              items: encounterChoice,
            },
          },
        },
      },
    },
  };
}

export function buildEncounterPhase2JsonSchema(): StructuredJsonSchema {
  return {
    name: 'encounter_phase_2',
    description: 'Encounter follow-up situations for one opening choice.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['choiceId', 'afterSuccess', 'afterComplicated', 'afterFailure'],
      properties: {
        choiceId: { type: 'string' },
        afterSuccess: phase2Situation,
        afterComplicated: phase2Situation,
        afterFailure: phase2Situation,
      },
    },
  };
}

export function buildEncounterPhase3JsonSchema(): StructuredJsonSchema {
  return {
    name: 'encounter_phase_3',
    description: 'Prior-state enrichment for an encounter opening beat.',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        setupTextVariants: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['condition', 'text'],
            properties: {
              condition,
              text: { type: 'string' },
            },
          },
        },
        statBonuses: {
          type: 'array',
          maxItems: 2,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['choiceRef', 'condition', 'difficultyReduction'],
            properties: {
              choiceRef: { type: 'string' },
              condition,
              difficultyReduction: { type: 'number' },
              flavorText: { type: 'string' },
            },
          },
        },
        conditionalChoices: {
          type: 'array',
          maxItems: 1,
          items: {
            ...encounterChoice,
            properties: {
              ...encounterChoice.properties,
              conditions: condition,
              showWhenLocked: { type: 'boolean' },
              lockedText: { type: 'string' },
            },
          },
        },
      },
    },
  };
}

export function buildEncounterPhase4JsonSchema(): StructuredJsonSchema {
  return {
    name: 'encounter_phase_4',
    description: 'Encounter aftermath storylets.',
    maxOutputTokens: 12000,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['victory', 'partialVictory', 'defeat', 'escape'],
      properties: {
        victory: storylet,
        partialVictory: storylet,
        defeat: storylet,
        escape: storylet,
      },
    },
  };
}
