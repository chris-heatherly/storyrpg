import { describe, expect, it } from 'vitest';

import { planSceneCoverage, type CoverageCharacter } from './cinematicCoveragePlanner';

const characters: CoverageCharacter[] = [
  { id: 'protagonist', name: 'Hikari Hoshino' },
  { id: 'mika', name: 'Mika Kuroda' },
  { id: 'yui', name: 'Yui Aizawa' },
  { id: 'kenji', name: 'Kenji Tanaka' },
];

const biteMeCharacters: CoverageCharacter[] = [
  { id: 'char-kylie-marinescu', name: 'Kylie Marinescu' },
  { id: 'char-mika-drgan', name: 'Mika Drăgan' },
  { id: 'char-victor-vlcescu', name: 'Victor Vâlcescu' },
];

describe('planSceneCoverage', () => {
  it('keeps dialogue beats from becoming empty environment shots', () => {
    const plan = planSceneCoverage({
      sceneId: 'scene-transfer',
      sceneCharacterIds: ['protagonist', 'mika', 'yui'],
      protagonistId: 'protagonist',
      characters,
      beats: [
        {
          id: 'beat-5',
          text: '"Please introduce yourself," Sensei says gently. The girl bows, deeper than necessary.',
        },
      ],
    });

    const beat = plan.beats[0];
    expect(beat.visualCast.activeCharacterIds).toContain('yui');
    expect(beat.visualCast.activeCharacterIds.length).toBeGreaterThan(0);
    expect(beat.coveragePlan.stagingPattern).not.toBe('environment');
  });

  it('uses two-shot or OTS coverage for 1:1 conversation', () => {
    const plan = planSceneCoverage({
      sceneId: 'scene-cafe',
      sceneCharacterIds: ['protagonist', 'mika'],
      protagonistId: 'protagonist',
      characters,
      beats: [
        {
          id: 'beat-1',
          speaker: 'Mika Kuroda',
          text: '"She seems sweet," Mika whispers to Hikari.',
        },
      ],
    });

    expect(plan.beats[0].visualCast.foregroundCharacterIds).toEqual(expect.arrayContaining(['mika', 'protagonist']));
    expect(['two-shot', 'ots-speaker']).toContain(plan.beats[0].coveragePlan.stagingPattern);
    expect(plan.beats[0].coveragePlan.visualContinuity?.mode).toBe('fresh_composition');
  });

  it('keeps a silent future payoff character visible as an observer', () => {
    const plan = planSceneCoverage({
      sceneId: 'scene-argument',
      sceneCharacterIds: ['protagonist', 'mika', 'kenji'],
      protagonistId: 'protagonist',
      characters,
      beats: [
        {
          id: 'beat-1',
          speaker: 'Mika Kuroda',
          text: '"You always do this," Mika says to Hikari.',
        },
        {
          id: 'beat-2',
          text: 'Kenji watches from the doorway, deciding whether to intervene.',
          isKeyStoryBeat: true,
        },
      ],
    });

    expect(plan.beats[0].visualCast.payoffRelevantCharacterIds).toContain('kenji');
    expect(plan.beats[0].visualCast.backgroundCharacterIds).toContain('kenji');
    expect(plan.beats[0].coveragePlan.stagingPattern).toBe('triangle');
  });

  it('pushes closer through an escalating dialogue run', () => {
    const plan = planSceneCoverage({
      sceneId: 'scene-escalation',
      sceneCharacterIds: ['protagonist', 'kenji'],
      protagonistId: 'protagonist',
      characters,
      beats: [
        { id: 'beat-1', speaker: 'Kenji Tanaka', text: '"We need to talk," Kenji says to Hikari.' },
        { id: 'beat-2', speaker: 'Hikari Hoshino', text: '"About what?" Hikari asks Kenji.' },
        { id: 'beat-3', speaker: 'Kenji Tanaka', text: '"About the truth!" Kenji says.' },
      ],
    });

    expect(plan.beats.map(beat => beat.coveragePlan.shotDistance)).toEqual(['MCU', 'CU', 'ECU']);
  });

  it('flags repeated unearned solitary/window compositions', () => {
    const plan = planSceneCoverage({
      sceneId: 'scene-window',
      sceneCharacterIds: ['protagonist'],
      protagonistId: 'protagonist',
      characters,
      beats: [
        { id: 'beat-1', text: 'Hikari looks out the window.' },
        { id: 'beat-2', text: 'Hikari stares into the distance.' },
        { id: 'beat-3', text: 'Hikari waits by the balcony railing.' },
      ],
    });

    expect(plan.diagnostics.solitaryCompositionWarnings).toEqual([
      expect.stringContaining('beat-3'),
    ]);
  });

  it('does not turn a club location surname or anonymous doorman into Victor staging', () => {
    const plan = planSceneCoverage({
      sceneId: 'scene-club-door',
      sceneCharacterIds: ['char-kylie-marinescu', 'char-mika-drgan', 'char-victor-vlcescu'],
      protagonistId: 'char-kylie-marinescu',
      characters: biteMeCharacters,
      beats: [
        {
          id: 'beat-1',
          text: "You stand before Vâlcescu Club's velvet rope while the doorman judges your dress.",
        },
        {
          id: 'beat-2',
          text: '"Darling, you look lost." A woman with a platinum bob appears beside you. "First time at Vâlcescu?"',
        },
        {
          id: 'beat-3',
          text: 'Mika laughs and gestures you toward the door.',
        },
      ],
    });

    expect(plan.beats[0].visualCast.sceneCharacterIds).not.toContain('char-victor-vlcescu');
    expect(plan.beats[0].coveragePlan.requiredVisibleCharacterIds).toEqual(['char-kylie-marinescu']);
    expect(plan.beats[1].visualCast.sceneCharacterIds).not.toContain('char-victor-vlcescu');
    expect(plan.beats[1].coveragePlan.requiredVisibleCharacterIds).toEqual(['char-kylie-marinescu']);
    expect(plan.beats[2].coveragePlan.requiredVisibleCharacterIds).toEqual(
      expect.arrayContaining(['char-kylie-marinescu', 'char-mika-drgan'])
    );
  });
});
