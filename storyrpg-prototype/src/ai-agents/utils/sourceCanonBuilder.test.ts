import { describe, expect, it } from 'vitest';

import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { CanonFact } from '../../types/storyCanon';
import { buildLockedStoryCanon } from './sourceCanonBuilder';
import { appendCanonFact } from './storyCanonStore';
import { extractTreatmentFromMarkdown } from './treatmentExtraction';

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

function analysis(overrides: Partial<SourceMaterialAnalysis> = {}): SourceMaterialAnalysis {
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
    ...overrides,
  } as SourceMaterialAnalysis;
}

describe('buildLockedStoryCanon', () => {
  it('derives missing mandatory canon concepts and locks them at source stage', () => {
    const canon = buildLockedStoryCanon({
      analysis: analysis(),
      userPrompt: 'A lighthouse mystery about grief and truth.',
    });

    expect(canon.lockStatus).toBe('locked');
    expect(canon.lockManifest.requiredConceptsSatisfied).toBe(true);
    expect(canon.facts.every((fact) => fact.createdAtStage === 'source')).toBe(true);
    expect(canon.facts.every((fact) => fact.status === 'canonical')).toBe(true);
    expect(canon.facts.filter((fact) => fact.domain === 'ending')).toHaveLength(3);
    expect(canon.facts.some((fact) => fact.domain === 'npc' && fact.kind === 'npc_profile')).toBe(true);
    expect(canon.derivationReport.missingBeforeDerivation.length).toBeGreaterThan(0);
  });

  it('preserves lite treatment identity as the canon input kind', () => {
    const treatment = extractTreatmentFromMarkdown(`# StoryRPG Lite Treatment

## 1. Story Premise
- **Title:** Harbor Light
- **Genre:** supernatural mystery
- **Tone:** salt-stung dread
- **High concept pitch:** The Ring meets a haunted lighthouse ledger.
- **Logline:** Mara must expose the harbor before the bell eats another name.
- **Core fantasy:** Bargain with ghosts and decide what truth costs.
- **Themes:** grief; witness; truth
- **Audience promise:** Every answer costs somebody silence.

## 2. Story Circle Season Spine
- **You (Ep1):** Mara keeps the ledger alone.
- **Need (Ep1):** Mara needs witnesses.
- **Go (Ep2):** Mara crosses below the tide line.
- **Search (Ep2):** Mara tests drowned records.
- **Find (Ep2):** Mara finds her family name.
- **Take (Ep2):** Mara pays with a confession.
- **Return (Ep2):** Mara returns to the tower.
- **Change (Ep2):** The town learns to mourn aloud.

## 7. Episode Outline
### Episode 1: The Lantern Job
- **Story Circle role:** you + need
- **High-level description:** Mara hears the lantern.
- **Major pressure:** The lantern speaks in her sister's voice.
- **Likely consequence:** Mara opens the ledger.

## 8. Alternate Endings
### Ending 1: The Witness
Mara tells the truth.
### Ending 2: The Keeper
Mara preserves the lie.
### Ending 3: The Exile
Mara leaves with the ghosts.
`);

    const canon = buildLockedStoryCanon({
      analysis: analysis({ treatmentSeasonGuidance: treatment.seasonGuidance }),
      sourceText: 'lite treatment source',
      treatment,
    });

    expect(canon.inputKind).toBe('story-treatment-lite');
    expect(canon.facts.find((fact) => fact.domain === 'story' && fact.kind === 'promise')?.source).toBe('explicit_input');
  });
});

describe('appendCanonFact', () => {
  it('appends generated facts without mutating locked source facts', () => {
    const canon = buildLockedStoryCanon({ analysis: analysis() });
    const fact: CanonFact = {
      id: 'canon-character-injury-mara-ep2',
      domain: 'character',
      kind: 'injury_event',
      subjectId: 'char-mara',
      value: 'Mara burns her palm on the black lantern.',
      source: 'beat_realization',
      confidence: 'high',
      derivedFromFactIds: ['canon-episode-episode-profile-episode-2'],
      status: 'derived',
      createdAtStage: 'beat',
      episodeNumber: 2,
      sceneId: 'scene-2-3',
      beatId: 'beat-4',
    };

    const updated = appendCanonFact(canon, fact);

    expect(updated).not.toBe(canon);
    expect(updated.facts).toHaveLength(canon.facts.length + 1);
    expect(canon.facts.some((existing) => existing.id === fact.id)).toBe(false);
  });

  it('rejects overwrite attempts against existing canon fact ids', () => {
    const canon = buildLockedStoryCanon({ analysis: analysis() });
    const existing = canon.facts[0];

    expect(() => appendCanonFact(canon, { ...existing, value: 'changed' })).toThrow(/already exists/);
  });
});
