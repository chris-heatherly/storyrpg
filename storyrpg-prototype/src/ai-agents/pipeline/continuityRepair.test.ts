import { describe, expect, it } from 'vitest';
import {
  selectRepairableContinuityFindings,
  scenesNeedingRepair,
  buildContinuityRepairGuidance,
  mergeRewrittenBeatsIntoStory,
  type ContinuityFinding,
} from './continuityRepair';

const findings: ContinuityFinding[] = [
  { severity: 'error', type: 'state_conflict', location: { sceneId: 'scene-4', beatId: 'beat-4-3' }, description: "Lysandra's blade-work wounds Vraxxan, but she is a scholar." },
  { severity: 'warning', type: 'state_conflict', location: { sceneId: 'scene-2' }, description: 'minor' },          // not error → skipped
  { severity: 'error', type: 'missing_setup', location: { sceneId: 'scene-1' }, description: 'prop' },             // not a repairable type → skipped
  { severity: 'error', type: 'impossible_knowledge', location: {}, description: 'no scene' },                       // no sceneId → skipped
];

describe('selectRepairableContinuityFindings', () => {
  it('keeps only error-severity prose-contradiction findings that point at a scene', () => {
    const sel = selectRepairableContinuityFindings(findings);
    expect(sel).toHaveLength(1);
    expect(sel[0].location?.sceneId).toBe('scene-4');
  });
  it('scenesNeedingRepair lists distinct scenes', () => {
    expect(scenesNeedingRepair(findings)).toEqual(['scene-4']);
  });
});

describe('buildContinuityRepairGuidance', () => {
  it('includes the contradiction and the capability canon facts', () => {
    const g = buildContinuityRepairGuidance('scene-4', findings, ['Lysandra has no established combat training.']);
    expect(g).toContain('blade-work');
    expect(g).toContain('no established combat training');
  });
  it('returns empty when the scene has nothing to repair', () => {
    expect(buildContinuityRepairGuidance('scene-9', findings, [])).toBe('');
  });
});

describe('mergeRewrittenBeatsIntoStory', () => {
  it('replaces only prose of matching beats by id', () => {
    const story = {
      episodes: [{ scenes: [{ id: 'scene-4', beats: [
        { id: 'beat-4-3', text: 'old', textVariants: [{ x: 1 }] },
        { id: 'beat-4-4', text: 'keep' },
      ] }] }],
    };
    const merged = mergeRewrittenBeatsIntoStory(story as any, 'scene-4', [
      { id: 'beat-4-3', text: 'new prose', textVariants: [] },
      { id: 'missing', text: 'ignored' },
    ]);
    expect(merged).toBe(1);
    expect(story.episodes[0].scenes[0].beats[0].text).toBe('new prose');
    expect(story.episodes[0].scenes[0].beats[1].text).toBe('keep');
  });

  it('does not overwrite with empty rewritten text', () => {
    const story = { episodes: [{ scenes: [{ id: 's', beats: [{ id: 'b', text: 'orig' }] }] }] };
    mergeRewrittenBeatsIntoStory(story as any, 's', [{ id: 'b', text: '   ' }]);
    expect(story.episodes[0].scenes[0].beats[0].text).toBe('orig');
  });
});
