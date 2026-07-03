import type { Story } from '../../types/story';

type EncounterOutcomeTier = 'success' | 'complicated' | 'failure';

type EncounterOutcomeLike = {
  tier?: string;
  narrativeText?: string;
  nextSituation?: unknown;
  nextBeatId?: string;
  isTerminal?: boolean;
  encounterOutcome?: string;
  cost?: unknown;
  visualContract?: {
    visibleCost?: string;
    visibleComplication?: string;
    immediateEffect?: string;
  };
};

type EncounterChoiceLike = {
  outcomes?: Partial<Record<EncounterOutcomeTier, EncounterOutcomeLike>>;
};

type EncounterBeatLike = {
  id?: string;
  choices?: EncounterChoiceLike[];
};

type EncounterLike = {
  beats?: EncounterBeatLike[];
  phases?: Array<{ beats?: EncounterBeatLike[] }>;
};

function terminalOutcomeForTier(tier: EncounterOutcomeTier): string {
  if (tier === 'success') return 'victory';
  if (tier === 'complicated') return 'partialVictory';
  return 'defeat';
}

function ensurePartialVictoryCost(outcome: EncounterOutcomeLike): void {
  if (outcome.tier !== 'complicated' || outcome.encounterOutcome !== 'partialVictory') return;
  const text = outcome.narrativeText || 'The choice works, but the cost stays visible.';
  if (!outcome.cost) {
    outcome.cost = {
      domain: 'mixed',
      severity: 'minor',
      whoPays: 'protagonist',
      immediateEffect: text,
      visibleComplication: text,
    };
  }
  outcome.visualContract = {
    ...(outcome.visualContract || {}),
    visibleCost: outcome.visualContract?.visibleCost || text,
  };
}

function collectEncounterBeats(encounter: EncounterLike): EncounterBeatLike[] {
  const beats: EncounterBeatLike[] = [];
  if (Array.isArray(encounter.beats)) beats.push(...encounter.beats);
  for (const phase of encounter.phases || []) {
    if (Array.isArray(phase?.beats)) beats.push(...phase.beats);
  }
  return beats;
}

export function normalizeEncounterOutcomeNavigation(story: Story): number {
  let repaired = 0;

  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      const encounter = scene.encounter as EncounterLike | undefined;
      if (!encounter) continue;
      const encounterBeats = collectEncounterBeats(encounter);
      if (encounterBeats.length === 0) continue;

      // W3 (2026-07-03): the nextSituation-cloning fallback arm is DELETED —
      // post-flip (2a9170f9) no generated encounter carries an embedded
      // situation to clone, so an unrouted outcome chains to the next beat or
      // terminates. Routing completeness for new content is already enforced
      // at parse time (validateStructure + routeDanglingOutcomesToAuthoredStorylets);
      // this pass remains the final-contract regression net for non-agent authors.
      for (let beatIndex = 0; beatIndex < encounterBeats.length; beatIndex += 1) {
        const beat = encounterBeats[beatIndex];
        const nextBeat = encounterBeats[beatIndex + 1];
        for (const choice of beat.choices || []) {
          for (const tier of ['success', 'complicated', 'failure'] as const) {
            const outcome = choice.outcomes?.[tier];
            if (!outcome || outcome.nextSituation || outcome.nextBeatId || outcome.isTerminal) continue;
            if (nextBeat?.id) {
              outcome.nextBeatId = nextBeat.id;
            } else {
              outcome.isTerminal = true;
              outcome.encounterOutcome = outcome.encounterOutcome || terminalOutcomeForTier(tier);
              ensurePartialVictoryCost(outcome);
            }
            repaired += 1;
          }
        }
      }
    }
  }

  return repaired;
}
