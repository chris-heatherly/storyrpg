import type {
  Consequence,
  EncounterChoiceOutcome,
  EncounterOutcome,
} from '../types';

export type EncounterOutcomeTier = 'success' | 'complicated' | 'failure';

export interface EncounterConsequencePayload {
  consequences: Consequence[];
  delayedConsequences: NonNullable<EncounterChoiceOutcome['delayedConsequences']>;
}

function buildEncounterMemoryFlags(
  encounterId: string,
  choiceId: string,
  tier: EncounterOutcomeTier,
  terminalOutcome?: EncounterOutcome
): Consequence[] {
  const flags: Consequence[] = [
    {
      type: 'setFlag',
      flag: `encounter.${encounterId}.choice.${choiceId}.${tier}`,
      value: true,
    },
  ];

  if (terminalOutcome) {
    flags.push({
      type: 'setFlag',
      flag: `encounter.${encounterId}.outcome.${terminalOutcome}`,
      value: true,
    });
  }

  return flags;
}

export function buildEncounterConsequencePayload(params: {
  encounterId: string;
  choiceId: string;
  tier: EncounterOutcomeTier;
  outcome?: EncounterChoiceOutcome;
}): EncounterConsequencePayload {
  const { encounterId, choiceId, tier, outcome } = params;
  const terminalOutcome = outcome?.isTerminal ? outcome.encounterOutcome : undefined;

  return {
    consequences: [
      ...buildEncounterMemoryFlags(encounterId, choiceId, tier, terminalOutcome),
      ...(outcome?.consequences ?? []),
      ...(outcome?.cost?.consequences ?? []),
    ],
    delayedConsequences: outcome?.delayedConsequences ?? [],
  };
}
