import { describe, expect, it } from 'vitest';
import {
  buildSceneVisualStoryboardPlan,
  chunkStoryboardBeats,
  validateVisualStoryboardPacket,
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

  it('supports twelve 9:16 storyboard panels per planning sheet', () => {
    const beats = Array.from({ length: 13 }, (_, index) => ({
      id: `beat-${index + 1}`,
      text: `Beat ${index + 1}`,
    }));

    const plan = buildSceneVisualStoryboardPlan({
      sceneId: 'scene-1',
      scopedSceneId: 'episode-1-scene-1',
      sceneName: 'The Great Moot Gathers',
      slots: visualPlanSlotsFromBeats('episode-1-scene-1', beats),
      panelCap: 12,
    });

    expect(plan.sheets).toHaveLength(2);
    expect(plan.sheets.map((sheet) => sheet.panelCount)).toEqual([12, 1]);
    expect(plan.sheets[0].canvas).toEqual({ width: 4096, height: 5460, columns: 4, rows: 3 });
    expect(plan.panels[0].cropBox).toEqual({ x: 0, y: 0, width: 1024, height: 1820 });
    expect(plan.panels[4].cropBox).toEqual({ x: 0, y: 1820, width: 1024, height: 1820 });
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

  it('chunks beat storyboard preflight input at the configured cap', () => {
    const beats = Array.from({ length: 14 }, (_, index) => ({ id: `beat-${index + 1}` }));
    expect(chunkStoryboardBeats(beats, 6).map((chunk) => chunk.map((beat) => beat.id))).toEqual([
      ['beat-1', 'beat-2', 'beat-3', 'beat-4', 'beat-5', 'beat-6'],
      ['beat-7', 'beat-8', 'beat-9', 'beat-10', 'beat-11', 'beat-12'],
      ['beat-13', 'beat-14'],
    ]);
  });

  it('validates packet coverage, shot variety, and third-person camera rules', () => {
    const packet = {
      version: 1 as const,
      generatedAt: 'now',
      requestedMode: 'visual-storyboard' as const,
      effectiveMode: 'visual-storyboard' as const,
      sceneId: 'scene-1',
      scopedSceneId: 'episode-1-scene-1',
      sceneName: 'Lobby',
      chunkIndex: 0,
      beatIds: ['beat-1', 'beat-2', 'beat-3'],
      sceneMasterPrompt: {
        style: 'cartoon',
        styleNegatives: 'photorealism',
        location: 'hotel lobby',
        lightingColor: 'warm',
        castPolicy: 'only planned cast',
        thirdPersonCameraRule: 'third-person observer only',
        referenceSummary: [],
      },
      continuityBible: {
        locationLayout: 'hotel',
        lightingArc: 'warm',
        characterBlocking: 'consistent',
        costumeState: 'consistent',
        importantProps: [],
      },
      sequenceGrammar: {
        sceneVisualArc: 'arc',
        cameraProgression: 'progression',
        shotRhythm: ['establishing', 'relationship', 'reaction'] as any,
        motifProgression: [],
        powerBlocking: 'clear',
        silentReadabilityGoal: 'readable',
      },
      shots: [
        {
          beatId: 'beat-1',
          slotId: 'story-beat:episode-1-scene-1::beat-1',
          sequenceRole: 'establishing' as const,
          shotSize: 'LS',
          cameraAngle: 'eye-level',
          cameraHeight: 'eye',
          cameraSide: 'left',
          thirdPersonPov: 'observer' as const,
          focalCharacterIds: [],
          requiredVisibleCharacterIds: [],
          optionalBackgroundCharacterIds: [],
          offscreenCharacterIds: [],
          dramaticReason: 'establish geography',
          promptFields: { action: 'Lobby gleams.' },
          referencePack: { required: [], optional: [], missing: [] },
        },
      ],
      validation: { passed: true, issues: [] },
    };

    const result = validateVisualStoryboardPacket(packet);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('missing shot for beat-2');
    expect(result.issues).toContain('missing shot for beat-3');
  });
});
