// ========================================
// GAP-D end-to-end: dispatch → escalation
// ========================================
//
// The two halves of GAP-D are tested in isolation elsewhere:
//   - `runFidelityValidators.test.ts`        — the dispatch produces findings under a gate flag;
//   - `FinalStoryContractValidator.test.ts`  — pre-built findings escalate per §4.6.
//
// This file proves the FULL chain the pipeline actually runs in
// `enforceFinalStoryContract`: `runFidelityValidators(...)` → feed its
// `fidelityFindings` + `treatmentSourced` straight into
// `FinalStoryContractValidator.validate`. With the gate ON and a treatment source,
// a real conformance failure must become a BLOCKING error; with the gate OFF the
// whole path is inert (no fidelity violation, story still passes).

import { afterEach, describe, expect, it } from 'vitest';
import { FinalStoryContractValidator } from './FinalStoryContractValidator';
import { runFidelityValidators } from './runFidelityValidators';
import { TREATMENT_FIDELITY_GATE_FLAGS } from './treatmentFidelityGate';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { Story } from '../../types/story';

// Minimal story that passes the contract on its own (no structural blockers), so the
// only thing that can block is a dispatched fidelity finding.
function minimalStory(): Story {
  return {
    id: 'fidelity-fixture',
    title: 'Fidelity Fixture',
    genre: 'fantasy',
    synopsis: 'A small fixture story.',
    coverImage: '',
    initialState: { attributes: {}, skills: {}, tags: [], inventory: [] },
    npcs: [],
    episodes: [
      {
        id: 'episode-1',
        number: 1,
        title: 'The First Door',
        synopsis: 'A fixture episode.',
        coverImage: '',
        startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1',
            name: 'Opening Choice',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                text: 'The old door waits in the rain.',
                choices: [
                  {
                    id: 'choice-1',
                    text: 'Open the door carefully',
                    nextBeatId: 'beat-2',
                    consequences: [{ type: 'setFlag', flag: 'opened_carefully', value: true }],
                    reminderPlan: { immediate: 'The hinge stays quiet.', shortTerm: 'The quiet approach changes the next room.' },
                  },
                ],
              },
              {
                id: 'beat-2',
                text: 'Because you opened the door carefully, the room keeps its breath.',
                textVariants: [
                  { condition: { type: 'flag', flag: 'opened_carefully', value: true }, text: 'The careful opening still matters.' },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Story;
}

// A season plan whose plotTurn1 beat is anchored to the WRONG episode (authored Ep3,
// assigned Ep5) so StoryCircleAnchorConformanceValidator emits a blocking finding.
function misanchoredSeasonPlan(): SeasonPlan {
  return {
    episodes: [
      { episodeNumber: 1, structuralRole: ['hook'] },
      { episodeNumber: 3, structuralRole: ['rising'] },
      { episodeNumber: 5, structuralRole: ['plotTurn1'] },
    ],
  } as unknown as SeasonPlan;
}

function treatmentAnalysis(): SourceMaterialAnalysis {
  return {
    sourceFormat: 'story_treatment',
    treatmentSeasonGuidance: { beatEpisodeAnchors: { hook: 1, plotTurn1: 3 } },
    episodeBreakdown: [],
  } as unknown as SourceMaterialAnalysis;
}

const ANCHOR_FLAG = TREATMENT_FIDELITY_GATE_FLAGS.storyCircleAnchorConformance;

afterEach(() => {
  for (const flag of Object.values(TREATMENT_FIDELITY_GATE_FLAGS)) delete process.env[flag];
});

describe('GAP-D fidelity dispatch → FinalStoryContract escalation (end-to-end)', () => {
  it('gate ON + treatment-sourced: a conformance failure becomes a BLOCKING error', async () => {
    process.env[ANCHOR_FLAG] = '1';

    const fidelity = runFidelityValidators({
      story: minimalStory(),
      seasonPlan: misanchoredSeasonPlan(),
      sourceAnalysis: treatmentAnalysis(),
    });
    // Sanity: the dispatch itself produced a treatment-sourced error finding.
    expect(fidelity.treatmentSourced).toBe(true);
    expect(fidelity.fidelityFindings.some((f) => f.severity === 'error')).toBe(true);

    const report = await new FinalStoryContractValidator().validate({
      story: minimalStory(),
      fidelityFindings: fidelity.fidelityFindings,
      treatmentSourced: fidelity.treatmentSourced,
    });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues.some((i) => i.type === 'treatment_fidelity_violation')).toBe(true);
  });

  it('gate OFF (env kill-switch): the whole dispatch path is inert and the story still passes', async () => {
    // Wave-5 promoted these gates default-ON, so "off" now means the explicit env
    // kill-switch ("0") on every flag — proving a deploy can fully disable the path.
    for (const flag of Object.values(TREATMENT_FIDELITY_GATE_FLAGS)) process.env[flag] = '0';
    const fidelity = runFidelityValidators({
      story: minimalStory(),
      seasonPlan: misanchoredSeasonPlan(),
      sourceAnalysis: treatmentAnalysis(),
    });
    expect(fidelity.fidelityFindings).toEqual([]);

    const report = await new FinalStoryContractValidator().validate({
      story: minimalStory(),
      fidelityFindings: fidelity.fidelityFindings,
      treatmentSourced: fidelity.treatmentSourced,
    });

    expect(report.passed).toBe(true);
    expect(report.blockingIssues.some((i) => i.type === 'treatment_fidelity_violation')).toBe(false);
  });
});
