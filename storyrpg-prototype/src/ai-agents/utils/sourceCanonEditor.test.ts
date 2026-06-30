import { describe, expect, it } from 'vitest';

import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import {
  applyCanonEditProposal,
  applyCanonToSourceAnalysis,
  buildCanonEditProposal,
  commitCanonStep,
  createCanonWizardState,
  updateWizardStateAfterApproval,
  updateWizardStateAfterEdit,
} from './sourceCanonEditor';
import { buildLockedStoryCanon } from './sourceCanonBuilder';

const storyCircle = {
  you: 'Mara keeps the lighthouse ledger alone.',
  need: 'Mara needs to admit the harbor silence is killing people.',
  go: 'The black lantern calls her below the tide line.',
  search: 'Mara tests the drowned records and bargains with ghosts.',
  find: 'The ledger names her family as the first keepers.',
  take: 'The harbor demands a public confession and a private loss.',
  return: 'Mara brings the truth back to the bell tower.',
  change: 'The town learns to mourn aloud instead of feeding the light.',
};

function analysis(): SourceMaterialAnalysis {
  return {
    sourceTitle: 'Harbor Light',
    sourceFormat: 'prompt',
    totalWordCount: 120,
    genre: 'supernatural mystery',
    tone: 'salt-stung dread',
    themes: ['truth costs silence', 'grief needs witnesses'],
    setting: {
      timePeriod: 'present day',
      location: 'a stormbound harbor town',
      worldDetails: 'A lighthouse answers grief with dangerous bargains.',
    },
    storyArcs: [{
      id: 'arc-light',
      name: 'The Light',
      description: 'Mara learns whether the lighthouse is memorial or prison.',
      estimatedEpisodeRange: { start: 1, end: 2 },
    }],
    anchors: {
      stakes: 'The town and Mara\'s dead sister\'s memory.',
      goal: 'prove what the lighthouse is taking',
      incitingIncident: 'The lantern speaks in her sister\'s voice.',
      climax: 'Mara rings the bell during the storm confession.',
    },
    storyCircle,
    episodeBreakdown: [
      {
        episodeNumber: 1,
        title: 'The Lantern Job',
        synopsis: 'Mara accepts the first impossible message.',
        sourceChapters: ['prompt'],
        sourceSummary: 'Mara enters the lighthouse mystery.',
        plotPoints: [],
        mainCharacters: ['Mara'],
        supportingCharacters: [],
        locations: ['Lighthouse'],
        estimatedSceneCount: 4,
        estimatedChoiceCount: 3,
        storyCircleRole: [{ beat: 'you', roleKind: 'primary', source: 'distribution' }],
        narrativeFunction: {
          setup: 'Mara works alone.',
          conflict: 'The lantern speaks.',
          resolution: 'Mara opens the ledger.',
        },
      },
      {
        episodeNumber: 2,
        title: 'Breakwater Oath',
        synopsis: 'Mara pays for the first answer.',
        sourceChapters: ['prompt'],
        sourceSummary: 'Mara pays for the truth.',
        plotPoints: [],
        mainCharacters: ['Mara'],
        supportingCharacters: [],
        locations: ['Breakwater'],
        estimatedSceneCount: 4,
        estimatedChoiceCount: 3,
        storyCircleRole: [{ beat: 'go', roleKind: 'primary', source: 'distribution' }],
        narrativeFunction: {
          setup: 'Mara leaves the tower.',
          conflict: 'The harbor demands a name.',
          resolution: 'Mara makes an oath.',
        },
      },
    ],
    totalEstimatedEpisodes: 2,
    protagonist: {
      id: 'char-mara',
      name: 'Mara',
      description: 'A lighthouse keeper who files grief into ledgers.',
      arc: 'Learns truth must be witnessed, not archived.',
    },
    majorCharacters: [],
    keyLocations: [],
    analysisTimestamp: new Date('2026-06-28T00:00:00Z'),
    confidenceScore: 90,
    warnings: [],
    resolvedEndingMode: 'multiple',
    detectedEndingMode: 'multiple',
    resolvedEndings: [],
  } as SourceMaterialAnalysis;
}

describe('sourceCanonEditor', () => {
  it('marks downstream wizard steps invalidated after an approved story fact edit', () => {
    const canon = buildLockedStoryCanon({ analysis: analysis() });
    const identityFact = canon.facts.find((fact) => fact.domain === 'story' && fact.kind === 'identity');
    const proposal = buildCanonEditProposal(canon, identityFact!.id, 'title', 'Harbor Light Revised');
    const editedCanon = applyCanonEditProposal(canon, proposal!);
    const approvedState = {
      ...createCanonWizardState(canon, [1]),
      stepStatus: { story: 'approved', peopleWorld: 'approved', episodesEndings: 'approved' } as const,
    };

    const nextState = updateWizardStateAfterEdit(approvedState, editedCanon, 'story');

    expect(nextState.stepStatus.story).toBe('draft');
    expect(nextState.stepStatus.peopleWorld).toBe('invalidated');
    expect(nextState.stepStatus.episodesEndings).toBe('invalidated');
  });

  it('relocks source canon when a wizard step passes validation', () => {
    const canon = buildLockedStoryCanon({ analysis: analysis() });
    const committed = commitCanonStep(canon, 'story', 2);
    const nextState = updateWizardStateAfterApproval(createCanonWizardState(canon), committed.canon, 'story', committed.validation);

    expect(committed.validation.passed).toBe(true);
    expect(committed.canon.lockStatus).toBe('locked');
    expect(committed.canon.lockManifest.requiredConceptsSatisfied).toBe(true);
    expect(nextState.stepStatus.story).toBe('approved');
    expect(nextState.activeStep).toBe('peopleWorld');
  });

  it('mirrors edited canonical identity and episode facts back into source analysis', () => {
    const canon = buildLockedStoryCanon({ analysis: analysis() });
    const identityFact = canon.facts.find((fact) => fact.domain === 'story' && fact.kind === 'identity');
    const episodeFact = canon.facts.find((fact) => fact.domain === 'episode' && fact.episodeNumber === 1);
    const withTitle = applyCanonEditProposal(canon, buildCanonEditProposal(canon, identityFact!.id, 'title', 'Harbor Light Revised')!);
    const withEpisode = applyCanonEditProposal(withTitle, buildCanonEditProposal(withTitle, episodeFact!.id, 'title', 'The Bell Ledger')!);

    const updated = applyCanonToSourceAnalysis(analysis(), withEpisode);

    expect(updated.sourceTitle).toBe('Harbor Light Revised');
    expect(updated.episodeBreakdown[0].title).toBe('The Bell Ledger');
    expect(updated.sourceCanon?.facts.find((fact) => fact.id === identityFact!.id)?.value).toMatchObject({
      title: 'Harbor Light Revised',
    });
  });
});
