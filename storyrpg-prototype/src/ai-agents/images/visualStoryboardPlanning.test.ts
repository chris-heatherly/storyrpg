import { describe, expect, it } from 'vitest';
import {
  buildSceneVisualStoryboardPlan,
  visualPlanSlotsFromBeats,
  visualPlanSlotsFromEncounterManifest,
  visualPlanSlotsFromStoryletManifest,
} from './visualStoryboardPlanning';
import type { EncounterImageSlot } from '../encounters/encounterSlotManifest';
import type { StoryletSlot } from '../encounters/storyletSlotManifest';

describe('visualStoryboardPlanning', () => {
  it('splits beat scenes into readable storyboard sheets with complete slot coverage', () => {
    const beats = Array.from({ length: 17 }, (_, index) => ({
      id: `beat-${index + 1}`,
      text: `Beat ${index + 1}`,
    }));

    const plan = buildSceneVisualStoryboardPlan({
      sceneId: 'scene-1',
      scopedSceneId: 'episode-1-scene-1',
      sceneName: 'The Great Moot Gathers',
      slots: visualPlanSlotsFromBeats('episode-1-scene-1', beats),
      panelCap: 6,
    });

    expect(plan.sheets).toHaveLength(3);
    expect(plan.sheets.map((sheet) => sheet.panelCount)).toEqual([6, 6, 5]);
    expect(plan.coverage.finalSlotCount).toBe(17);
    expect(plan.coverage.mappedFinalSlotCount).toBe(17);
    expect(plan.coverage.missingFinalSlotIds).toEqual([]);
    expect(plan.panels[0].sequenceRole).toBe('establishing');
    expect(plan.sequenceGrammar.silentReadabilityGoal).toContain('without prose');
  });

  it('keeps all encounter and storylet paths in branch-aware substoryboards', () => {
    const encounterSlots: EncounterImageSlot[] = [
      {
        kind: 'setup',
        sceneId: 'scene-3',
        scopedSceneId: 'episode-1-scene-3',
        beatId: 'beat-1',
        choiceMapKey: '',
        treeDepth: 0,
        baseIdentifier: 'encounter-episode-1-scene-3-beat-1-setup',
      },
      {
        kind: 'outcome',
        sceneId: 'scene-3',
        scopedSceneId: 'episode-1-scene-3',
        beatId: 'beat-1',
        choiceMapKey: 'c1',
        tier: 'success',
        treeDepth: 0,
        baseIdentifier: 'encounter-episode-1-scene-3-beat-1-c1-success',
      },
      {
        kind: 'outcome',
        sceneId: 'scene-3',
        scopedSceneId: 'episode-1-scene-3',
        beatId: 'beat-1',
        choiceMapKey: 'c1::success::c2',
        tier: 'failure',
        treeDepth: 1,
        baseIdentifier: 'encounter-episode-1-scene-3-beat-1-c1-success-c2-failure',
      },
    ];
    const storyletSlots: StoryletSlot[] = [
      {
        sceneId: 'scene-3',
        scopedSceneId: 'episode-1-scene-3',
        outcomeName: 'partialVictory',
        beatId: 'pv-1',
        baseIdentifier: 'storylet-episode-1-scene-3-partialVictory-pv-1',
        coverageKey: 'storylet:scene-3::partialVictory::pv-1',
        beat: { id: 'pv-1', text: 'The price becomes visible.' },
        storyletTone: 'tense',
      },
    ];

    const plan = buildSceneVisualStoryboardPlan({
      sceneId: 'scene-3',
      scopedSceneId: 'episode-1-scene-3',
      sceneName: 'Accusations and Fury',
      slots: [
        ...visualPlanSlotsFromEncounterManifest(encounterSlots),
        ...visualPlanSlotsFromStoryletManifest(storyletSlots),
      ],
      panelCap: 2,
      branchAware: true,
    });

    expect(plan.coverage.finalSlotCount).toBe(4);
    expect(plan.coverage.mappedFinalSlotCount).toBe(4);
    expect(plan.coverage.duplicateFinalSlotIds).toEqual([]);
    expect(plan.coverage.missingFinalSlotIds).toEqual([]);
    expect(plan.sheets.some((sheet) => sheet.branchPath === 'c1')).toBe(true);
    expect(plan.sheets.some((sheet) => sheet.branchPath === 'storylet:partialVictory')).toBe(true);
    expect(plan.sequenceGrammar.branchVisualLanguage?.failure).toContain('colder');
  });
});
