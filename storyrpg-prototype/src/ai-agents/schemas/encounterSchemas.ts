import type { StructuredJsonSchema } from '../agents/BaseAgent';

const stringArray = {
  type: 'array',
  items: { type: 'string' },
} as const;

const shortString = (maxLength: number) => ({ type: 'string', maxLength }) as const;

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

// `immediateEffect` + `visibleComplication` are REQUIRED whenever a cost is
// authored: these are the two reader-facing strings the converter otherwise
// backfills with registered template prose ("Relief arrives with a
// complication still attached."), which the no-boilerplate mandate then
// blocks. Requiring them makes the LLM author the cost at the source.
const encounterCost = {
  type: 'object',
  additionalProperties: false,
  required: ['immediateEffect', 'visibleComplication'],
  properties: {
    domain: shortString(80),
    severity: shortString(80),
    whoPays: shortString(120),
    immediateEffect: shortString(260),
    visibleComplication: shortString(260),
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
    // A terminal partialVictory outcome MUST author its cost (prompt-enforced;
    // the schema makes the field REACHABLE — with additionalProperties:false
    // and no cost property, the LLM previously could not emit one at all, so
    // the deterministic default cost was injected on every partial victory).
    cost: encounterCost,
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
    // A terminal partialVictory outcome MUST author its cost (prompt-enforced;
    // the schema makes the field REACHABLE — with additionalProperties:false
    // and no cost property, the LLM previously could not emit one at all, so
    // the deterministic default cost was injected on every partial victory).
    cost: encounterCost,
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
    // See phase2Outcome.cost — reachable so partial victories carry an
    // authored cost instead of the deterministic template.
    cost: encounterCost,
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
    id: shortString(120),
    text: shortString(420),
    nextBeatId: shortString(120),
    isTerminal: { type: 'boolean' },
  },
} as const;

const leanStoryletBeat = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: {
    text: shortString(420),
  },
} as const;

const storylet = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'triggerOutcome', 'tone', 'narrativeFunction', 'beats', 'startingBeatId', 'consequences'],
  properties: {
    id: shortString(120),
    name: shortString(80),
    triggerOutcome: shortString(40),
    tone: shortString(80),
    narrativeFunction: shortString(260),
    beats: {
      type: 'array',
      maxItems: 3,
      items: storyletBeat,
    },
    startingBeatId: shortString(120),
    consequences: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: shortString(80),
          flag: shortString(120),
          name: shortString(120),
          score: shortString(120),
          value: shortString(180),
          change: { type: 'number' },
          description: shortString(240),
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
          flag: shortString(120),
          value: { type: 'boolean' },
        },
      },
    },
    cost: encounterCost,
    nextSceneId: shortString(120),
  },
} as const;

const leanStorylet = (requireCost = false) => ({
  type: 'object',
  additionalProperties: false,
  required: [
    'beats',
    ...(requireCost ? ['cost'] : []),
  ],
  properties: {
    beats: {
      type: 'array',
      maxItems: 3,
      items: leanStoryletBeat,
    },
    cost: encounterCost,
  },
}) as const;

const compactStorylet = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'triggerOutcome', 'tone', 'narrativeFunction', 'beats', 'startingBeatId'],
  properties: {
    id: shortString(120),
    name: shortString(80),
    triggerOutcome: shortString(40),
    tone: shortString(80),
    narrativeFunction: shortString(260),
    beats: {
      type: 'array',
      maxItems: 3,
      items: storyletBeat,
    },
    startingBeatId: shortString(120),
    nextSceneId: shortString(120),
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

export function buildEncounterPhase1CompactJsonSchema(): StructuredJsonSchema {
  const compactPhase1Outcome = {
    type: 'object',
    additionalProperties: false,
    required: ['narrativeText', 'goalTicks', 'threatTicks'],
    properties: {
      narrativeText: shortString(260),
      goalTicks: { type: 'number' },
      threatTicks: { type: 'number' },
    },
  } as const;
  const compactPhase1Choice = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'text', 'approach', 'primarySkill', 'outcomes'],
    properties: {
      id: shortString(40),
      text: shortString(80),
      approach: shortString(40),
      primarySkill: shortString(80),
      impliedApproach: shortString(40),
      consequenceDomain: shortString(40),
      outcomes: {
        type: 'object',
        additionalProperties: false,
        required: ['success', 'complicated', 'failure'],
        properties: {
          success: compactPhase1Outcome,
          complicated: compactPhase1Outcome,
          failure: compactPhase1Outcome,
        },
      },
    },
  } as const;

  return {
    name: 'encounter_phase_1_compact',
    description: 'Compact encounter opening beat retry after Gemini budget/safety failures.',
    maxOutputTokens: 4096,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['sceneId', 'encounterType', 'goalClock', 'threatClock', 'stakes', 'openingBeat'],
      properties: {
        sceneId: shortString(120),
        encounterType: shortString(60),
        goalClock: clock,
        threatClock: clock,
        stakes,
        openingBeat: {
          type: 'object',
          additionalProperties: false,
          required: ['setupText', 'choices'],
          properties: {
            setupText: shortString(360),
            choices: {
              type: 'array',
              minItems: 3,
              maxItems: 3,
              items: compactPhase1Choice,
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
    maxOutputTokens: 16384,
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

export function buildEncounterStoryletJsonSchema(slotName = 'storylet'): StructuredJsonSchema {
  return {
    name: `encounter_phase_4_${slotName}`,
    description: `Encounter aftermath storylet for ${slotName}.`,
    maxOutputTokens: 16384,
    schema: storylet,
  };
}

export function buildEncounterStoryletDraftJsonSchema(slotName = 'storylet'): StructuredJsonSchema {
  const requireCost = slotName === 'partialVictory';
  return {
    name: `encounter_phase_4_${slotName}_draft`,
    description: `Compact authored aftermath prose draft for ${slotName}.`,
    maxOutputTokens: 4096,
    schema: leanStorylet(requireCost),
  };
}
