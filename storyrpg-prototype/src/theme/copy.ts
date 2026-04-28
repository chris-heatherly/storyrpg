// Canonical reader UI copy so beats, storylets, and encounters stay in sync.
// Do not inline these strings in individual components — always import from here.

export const CONTINUE_COPY = {
  default: 'CONTINUE',
  nextScene: 'CONTINUE',
  storylet: 'CONTINUE',
  recap: 'CONTINUE',
  growth: 'CONTINUE',
  encounterConclude: 'CONCLUDE ENCOUNTER',
  encounterVictory: 'CONCLUDE ENCOUNTER',
  encounterResults: 'CONCLUDE ENCOUNTER',
} as const;

export const EYEBROWS = {
  episodeRecap: 'EPISODE RECAP',
  cost: 'THE COST',
  outcomeHeader: {
    success: 'Well Played',
    complicated: 'Not Without Cost',
    failure: 'A Costly Misstep',
  },
} as const;
