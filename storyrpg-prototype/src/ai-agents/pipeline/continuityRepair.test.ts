import { describe, expect, it } from 'vitest';
import {
  selectRepairableContinuityFindings,
  scenesNeedingRepair,
  buildContinuityRepairGuidance,
  mergeRewrittenBeatsIntoStory,
  applyRewrittenBeatsToSceneContents,
  mergeRevalidatedContinuityIssues,
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
  it('treats a scene-anchored timeline_error as repairable', () => {
    const timeline: ContinuityFinding[] = [
      {
        severity: 'error',
        type: 'timeline_error',
        location: { sceneId: 's3-3', beatId: 's3-3-beat-3b' },
        description: "Mika's car-window refusal placed at the estate, but the drive home is after Sunday breakfast.",
        suggestedFix: "Move the car-window detail to the drive-home beat.",
      },
    ];
    const sel = selectRepairableContinuityFindings(timeline);
    expect(sel).toHaveLength(1);
    expect(scenesNeedingRepair(timeline)).toEqual(['s3-3']);
    expect(buildContinuityRepairGuidance('s3-3', timeline, [])).toContain('car-window');
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

describe('applyRewrittenBeatsToSceneContents', () => {
  it('replaces only prose of matching beats, keyed on sceneId (not id)', () => {
    const sceneContents = [
      { sceneId: 'scene-4', beats: [
        { id: 'beat-4-3', text: 'old', textVariants: [{ x: 1 }] },
        { id: 'beat-4-4', text: 'keep' },
      ] },
      { sceneId: 'scene-5', beats: [{ id: 'beat-4-3', text: 'other-scene' }] },
    ];
    const merged = applyRewrittenBeatsToSceneContents(sceneContents as any, 'scene-4', [
      { id: 'beat-4-3', text: 'new prose', textVariants: [] },
      { id: 'missing', text: 'ignored' },
    ]);
    expect(merged).toBe(1);
    expect(sceneContents[0].beats[0].text).toBe('new prose');
    expect(sceneContents[0].beats[1].text).toBe('keep');
    // a same-id beat in a DIFFERENT scene is untouched
    expect(sceneContents[1].beats[0].text).toBe('other-scene');
  });

  it('does not overwrite with empty rewritten text and returns 0 for no rewrites', () => {
    const sceneContents = [{ sceneId: 's', beats: [{ id: 'b', text: 'orig' }] }];
    applyRewrittenBeatsToSceneContents(sceneContents as any, 's', [{ id: 'b', text: '  ' }]);
    expect(sceneContents[0].beats[0].text).toBe('orig');
    expect(applyRewrittenBeatsToSceneContents(sceneContents as any, 's', [])).toBe(0);
  });
});

describe('mergeRevalidatedContinuityIssues', () => {
  type Issue = { location?: { sceneId?: string }; severity: string; tag: string };
  const original: Issue[] = [
    { location: { sceneId: 's1' }, severity: 'error', tag: 'orig-s1' },
    { location: { sceneId: 's2' }, severity: 'error', tag: 'orig-s2' },
    { location: { sceneId: 's3' }, severity: 'warning', tag: 'orig-s3' },
  ];

  it('drops original findings for re-validated scenes and adopts the fresh residue for them', () => {
    const fresh: Issue[] = [
      { location: { sceneId: 's1' }, severity: 'error', tag: 'fresh-s1' }, // residue confirmed in s1
      { location: { sceneId: 's2' }, severity: 'error', tag: 'fresh-s2' }, // would be dropped (s2 not revalidated)
    ];
    const merged = mergeRevalidatedContinuityIssues(original, ['s1'], fresh);
    // s1 original gone, s1 fresh adopted; s2/s3 originals kept; s2 fresh NOT adopted (not revalidated)
    expect(merged.map((i) => i.tag).sort()).toEqual(['fresh-s1', 'orig-s2', 'orig-s3']);
  });

  it('prunes a repaired scene entirely when re-check returns no residue (success path)', () => {
    const merged = mergeRevalidatedContinuityIssues(original, ['s1'], []);
    expect(merged.map((i) => i.tag).sort()).toEqual(['orig-s2', 'orig-s3']);
  });

  it('never adopts a fresh second-opinion finding for an un-revalidated scene', () => {
    const fresh: Issue[] = [{ location: { sceneId: 's3' }, severity: 'error', tag: 'fresh-s3' }];
    const merged = mergeRevalidatedContinuityIssues(original, ['s1'], fresh);
    expect(merged.some((i) => i.tag === 'fresh-s3')).toBe(false);
  });
});
