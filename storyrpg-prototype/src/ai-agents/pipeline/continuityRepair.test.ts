import { describe, expect, it, vi } from 'vitest';
import {
  selectRepairableContinuityFindings,
  scenesNeedingRepair,
  buildContinuityRepairGuidance,
  resolveMissingSetupOwnerTargets,
  buildMissingSetupOwnerGuidance,
  mergeRewrittenBeatsIntoStory,
  mergeRewrittenEncounterBeatsIntoStory,
  applyRewrittenBeatsToSceneContents,
  mergeRevalidatedContinuityIssues,
  type ContinuityFinding,
  type OwnershipPlannedSceneLite,
} from './continuityRepair';

const findings: ContinuityFinding[] = [
  { severity: 'error', type: 'state_conflict', location: { sceneId: 'scene-4', beatId: 'beat-4-3' }, description: "Lysandra's blade-work wounds Vraxxan, but she is a scholar." },
  { severity: 'warning', type: 'state_conflict', location: { sceneId: 'scene-2' }, description: 'minor' },          // not error → skipped
  { severity: 'error', type: 'missing_setup', location: { sceneId: 'scene-1' }, description: 'prop' },             // repairable since bite-me 2026-07-02
  { severity: 'error', type: 'impossible_knowledge', location: {}, description: 'no scene' },                       // no sceneId → skipped
];

describe('selectRepairableContinuityFindings', () => {
  it('keeps only error-severity scene-anchored findings', () => {
    const sel = selectRepairableContinuityFindings(findings);
    expect(sel).toHaveLength(2);
    expect(sel.map((f) => f.location?.sceneId).sort()).toEqual(['scene-1', 'scene-4']);
  });
  it('scenesNeedingRepair lists distinct scenes', () => {
    expect(scenesNeedingRepair(findings).sort()).toEqual(['scene-1', 'scene-4']);
  });
  it('treats a scene-anchored missing_setup as repairable (bite-me 2026-07-02T23-54-38)', () => {
    const setup: ContinuityFinding[] = [
      {
        severity: 'error',
        type: 'missing_setup',
        location: { sceneId: 's1-2', beatId: 's1-2-b2' },
        description: 'Mika is mentioned by name and speaks in s1-2-b2, but the reader has not been introduced to her on-page yet.',
        suggestedFix: "Rephrase s1-2-b2 to introduce her as 'a friend' before naming her.",
      },
    ];
    const sel = selectRepairableContinuityFindings(setup);
    expect(sel).toHaveLength(1);
    expect(buildContinuityRepairGuidance('s1-2', setup, [])).toContain('introduced to her on-page');
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

describe('resolveMissingSetupOwnerTargets (owning-scene retargeting)', () => {
  // Mirrors bite-me 2026-07-02T23-54-38: Mika speaks unintroduced in s1-2 while
  // planned scene s1-1 owned the socialMeet cue whose text names her — the
  // TreatmentEventLedgerValidator advisory "socialMeet owned but not depicted"
  // was the same defect, downgraded by the composite-treatment-bundle rule.
  const mikaFinding: ContinuityFinding = {
    severity: 'error',
    type: 'missing_setup',
    location: { sceneId: 's1-2', beatId: 's1-2-b2' },
    description: 'Mika is mentioned by name and speaks in s1-2-b2, but the reader has not been introduced to her on-page yet.',
    conflictsWith: "char-mika-dragan: Knows: Kylie's best friend",
    suggestedFix: "Introduce Mika Dragan in an earlier scene, or rephrase s1-2-b2 to introduce her as 'a friend' before naming her.",
  };
  const plannedScenes: OwnershipPlannedSceneLite[] = [
    {
      id: 's1-arrival-cold-open',
      sceneEventOwnership: { ownedEvents: [{ cue: 'arrival', text: 'Kylie Marinescu arrives in Bucharest as a charming, wounded observer.' }] },
    },
    {
      id: 's1-1',
      sceneEventOwnership: { ownedEvents: [{ cue: 'socialMeet', text: 'Kylie forms the Dusk Club with Mika and Stela over velvet booths and too-dark negronis.' }] },
    },
    { id: 's1-2', sceneEventOwnership: { ownedEvents: [] } },
    { id: 's1-3', sceneEventOwnership: { ownedEvents: [{ cue: 'socialMeet', text: 'At a rooftop bar she catches the attention of a man in a charcoal suit.' }] } },
  ];

  it('retargets a missing_setup at the closest earlier scene whose owned event names the entity', () => {
    const targets = resolveMissingSetupOwnerTargets([mikaFinding], plannedScenes);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      ownerSceneId: 's1-1',
      findingSceneId: 's1-2',
      cue: 'socialMeet',
      entity: 'mika',
    });
    expect(targets[0].eventText).toContain('Dusk Club');
  });

  it('builds owner guidance carrying the dropped event, the use-site, and the canon facts', () => {
    const [target] = resolveMissingSetupOwnerTargets([mikaFinding], plannedScenes);
    const guidance = buildMissingSetupOwnerGuidance(target, ['Mika Dragan is Kylie\'s best friend.']);
    expect(guidance).toContain('cue: socialMeet');
    expect(guidance).toContain('Dusk Club');
    expect(guidance).toContain('s1-2');
    expect(guidance).toContain('introduced to her on-page');
    expect(guidance).toContain('best friend');
  });

  it('returns nothing without an ownership plan, a preceding owner, or an entity link', () => {
    expect(resolveMissingSetupOwnerTargets([mikaFinding], undefined)).toEqual([]);
    expect(resolveMissingSetupOwnerTargets([mikaFinding], [])).toEqual([]);
    // finding scene first in the plan → nothing precedes it
    expect(resolveMissingSetupOwnerTargets(
      [{ ...mikaFinding, location: { sceneId: 's1-arrival-cold-open' } }],
      plannedScenes,
    )).toEqual([]);
    // no earlier owned event mentions the entity
    expect(resolveMissingSetupOwnerTargets([mikaFinding], [
      { id: 's1-1', sceneEventOwnership: { ownedEvents: [{ cue: 'arrival', text: 'Kylie lands in Bucharest.' }] } },
      { id: 's1-2' },
    ])).toEqual([]);
  });

  it('only considers missing_setup errors (not warnings, not other repairable types)', () => {
    const warning: ContinuityFinding = { ...mikaFinding, severity: 'warning' };
    const stateConflict: ContinuityFinding = { ...mikaFinding, type: 'state_conflict' };
    expect(resolveMissingSetupOwnerTargets([warning], plannedScenes)).toEqual([]);
    expect(resolveMissingSetupOwnerTargets([stateConflict], plannedScenes)).toEqual([]);
  });

  it('falls back to capitalized description tokens when no char-* id is present', () => {
    const noCharId: ContinuityFinding = {
      severity: 'error',
      type: 'missing_setup',
      location: { sceneId: 's1-2' },
      description: 'Stela speaks in this scene but the reader has never met her.',
      suggestedFix: 'Introduce Stela earlier.',
    };
    const targets = resolveMissingSetupOwnerTargets([noCharId], plannedScenes);
    expect(targets).toHaveLength(1);
    expect(targets[0].ownerSceneId).toBe('s1-1');
    expect(targets[0].entity).toBe('Stela');
  });

  it('dedupes multiple findings resolving to the same owner/use-site pair', () => {
    const second: ContinuityFinding = { ...mikaFinding, description: 'Mika hands over the folklore book unintroduced.' };
    expect(resolveMissingSetupOwnerTargets([mikaFinding, second], plannedScenes)).toHaveLength(1);
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

  it('reports rewrites whose id matched NO beat (drifted ids) via onUnmatched', () => {
    const story = { episodes: [{ scenes: [{ id: 'scene-4', beats: [{ id: 'beat-4-3', text: 'old' }] }] }] };
    const unmatched: string[][] = [];
    const merged = mergeRewrittenBeatsIntoStory(
      story as any,
      'scene-4',
      [{ id: 'beat-4-3', text: 'new prose' }, { id: 'drifted-id', text: 'lost' }],
      (ids) => unmatched.push(ids),
    );
    expect(merged).toBe(1);
    expect(unmatched).toEqual([['drifted-id']]); // the rewrite that landed nowhere is surfaced
  });

  it('does NOT call onUnmatched when every rewrite matched (the clean path)', () => {
    const story = { episodes: [{ scenes: [{ id: 's', beats: [{ id: 'b', text: 'old' }] }] }] };
    const onUnmatched = vi.fn();
    mergeRewrittenBeatsIntoStory(story as any, 's', [{ id: 'b', text: 'new' }], onUnmatched);
    expect(onUnmatched).not.toHaveBeenCalled();
  });

  it('re-derives unsafe visualMoment/primaryAction from rewritten beat.text', () => {
    const synopsis =
      'She wanders into a bookshop owned by Stela who befriends her and introduces Kylie to the secret nightlife world of Valescu Club and her other friend Mika.';
    const story = {
      episodes: [{ scenes: [{
        id: 's1-3',
        beats: [{
          id: 'b1',
          text: synopsis,
          visualMoment: synopsis,
          primaryAction: synopsis,
        }],
      }] }],
    };
    mergeRewrittenBeatsIntoStory(story as any, 's1-3', [{
      id: 'b1',
      text: 'You slip between the shelves while Stela names the club like a dare.',
    }]);
    const beat = story.episodes[0].scenes[0].beats[0];
    expect(beat.text).toMatch(/^You slip/);
    expect(beat.visualMoment).not.toMatch(/She wanders into a bookshop/i);
    expect(beat.primaryAction).not.toMatch(/She wanders into a bookshop/i);
    expect(beat.visualMoment).toMatch(/You slip between the shelves/);
  });
});

describe('mergeRewrittenEncounterBeatsIntoStory', () => {
  const encounterStory = () => ({
    episodes: [{ scenes: [{
      id: 'treatment-enc-1-1',
      beats: [], // encounter scenes carry no flat beats
      encounter: {
        phases: [{ beats: [{ id: 'beat-1', setupText: 'old phase prose', text: '' }] }],
        storylets: [
          { beats: [{ id: 'sv-1', text: 'old storylet prose', textVariants: [{ text: 'old variant' }] }] },
          { beats: [{ id: 'sp-1', text: 'untouched' }] },
        ],
      },
    }] }],
  });

  it('writes storylet rewrites to `text` and phase rewrites to `setupText`', () => {
    const story = encounterStory();
    const merged = mergeRewrittenEncounterBeatsIntoStory(story as any, 'treatment-enc-1-1', [
      { id: 'beat-1', text: 'new phase prose' },
      { id: 'sv-1', text: 'new storylet prose', textVariants: [] },
    ]);
    expect(merged).toBe(2);
    const enc = story.episodes[0].scenes[0].encounter as any;
    // Phase beat: prose written to setupText, NOT text.
    expect(enc.phases[0].beats[0].setupText).toBe('new phase prose');
    expect(enc.phases[0].beats[0].text).toBe('');
    // Storylet beat: prose written to text, variants replaced.
    expect(enc.storylets[0].beats[0].text).toBe('new storylet prose');
    expect(enc.storylets[0].beats[0].textVariants).toEqual([]);
    // Unmatched storylet beat untouched.
    expect(enc.storylets[1].beats[0].text).toBe('untouched');
  });

  it('handles a record-shaped storylets map', () => {
    const story = {
      episodes: [{ scenes: [{
        id: 'enc', beats: [],
        encounter: { storylets: { sv: { beats: [{ id: 'sv-1', text: 'old' }] } } },
      }] }],
    };
    const merged = mergeRewrittenEncounterBeatsIntoStory(story as any, 'enc', [{ id: 'sv-1', text: 'new' }]);
    expect(merged).toBe(1);
    expect((story.episodes[0].scenes[0].encounter.storylets as any).sv.beats[0].text).toBe('new');
  });

  it('does not overwrite with empty rewritten text', () => {
    const story = encounterStory();
    mergeRewrittenEncounterBeatsIntoStory(story as any, 'treatment-enc-1-1', [{ id: 'sv-1', text: '  ' }]);
    expect(story.episodes[0].scenes[0].encounter.storylets[0].beats[0].text).toBe('old storylet prose');
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
