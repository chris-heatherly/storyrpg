import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  GateRepairRouter,
  analyzeSceneTreatmentDensity,
  analyzeEpisodeTreatmentDensity,
  isTreatmentDensityExpandable,
  isUnsafeTreatmentDensityReport,
  unsafeTreatmentDensityReports,
  hasTimelineCue,
} from './gateRepairRouter';

const issue = (validator: string, message: string, sceneId = 's1-1', episodeNumber = 1) => ({
  validator,
  message,
  sceneId,
  episodeNumber,
  severity: 'error',
});

describe('GateRepairRouter', () => {
  it('routes a missing simple detail to same-scene retry', () => {
    const router = new GateRepairRouter({
      densityReports: [{
        episodeNumber: 1,
        sceneId: 's1-2',
        hardUnits: 2,
        totalUnits: 3,
        threshold: { hardUnits: 4, totalUnits: 6, profile: 'standard' },
        obligations: [],
        overloaded: false,
        overloadReasons: [],
        explicitTimeJumpCount: 0,
        recommendedDirective: 'same_scene_retry',
      }],
    });

    const route = router.routeIssue(issue(
      'RequiredBeatRealizationValidator',
      'Authored required beat is missing from scene "s1-2": "Kylie finds the crescent card under the door."',
      's1-2',
    ));

    expect(route.kind).toBe('same_scene_retry');
    expect(route.unsafeForProsePatch).toBe(false);
  });

  it('routes a missing time-coded authored beat to cluster rewrite', () => {
    const router = new GateRepairRouter();
    const route = router.routeIssue(issue(
      'RequiredBeatRealizationValidator',
      'Authored required beat is missing from scene "s1-1": "On night two, Mika swaps out Kylie\'s shoes before night three at the rooftop bar."',
    ));

    expect(route.kind).toBe('scene_cluster_rewrite');
    expect(route.unsafeForProsePatch).toBe(true);
  });

  it('keeps already-localized compact time/count misses in same-scene repair', () => {
    const router = new GateRepairRouter({
      story: {
        episodes: [{
          number: 1,
          scenes: [{
            id: 's1-5',
            beats: [{ id: 'b1', text: 'The petition page refreshes. It has 12,000 signatures.' }],
          }],
        }],
      } as any,
    });
    const route = router.routeIssue(issue(
      'RequiredBeatRealizationValidator',
      'Authored required beat is missing from scene "s1-5": "By noon it has 12,000 signatures."',
      's1-5',
    ));

    expect(route.kind).toBe('same_scene_retry');
    expect(route.unsafeForProsePatch).toBe(false);
  });

  it('routes overloaded scene findings to blueprint rebalance', () => {
    const router = new GateRepairRouter({
      densityReports: [{
        episodeNumber: 1,
        sceneId: 's1-1',
        hardUnits: 7,
        totalUnits: 8,
        threshold: { hardUnits: 5, totalUnits: 6, profile: 'opening' },
        obligations: [],
        overloaded: true,
        overloadReasons: ['hard units 7 exceed 5'],
        explicitTimeJumpCount: 0,
        recommendedDirective: 'blueprint_rebalance',
      }],
    });

    const route = router.routeIssue(issue(
      'RequiredBeatRealizationValidator',
      'Authored required beat is missing from scene "s1-1": "Kylie posts the blog before the car leaves."',
    ));

    expect(route.kind).toBe('blueprint_rebalance');
  });

  it('routes expandable density warnings to cluster repair instead of blueprint rebalance', () => {
    const densityReport = {
      episodeNumber: 1,
      sceneId: 's1-rooftop-setup',
      hardUnits: 3,
      totalUnits: 5,
      threshold: { hardUnits: 4, totalUnits: 6, profile: 'standard' as const },
      obligations: [],
      overloaded: true,
      overloadReasons: ['scene has 2 explicit time cue(s)'],
      explicitTimeJumpCount: 2,
      recommendedDirective: 'blueprint_rebalance' as const,
    };
    const router = new GateRepairRouter({
      densityReports: [densityReport],
    });

    const route = router.routeIssue(issue(
      'RequiredBeatRealizationValidator',
      'Authored required beat is missing from scene "s1-rooftop-setup": "On night three, Kylie locks eyes with Victor across the room."',
      's1-rooftop-setup',
    ));

    expect(isUnsafeTreatmentDensityReport(densityReport)).toBe(false);
    expect(route.kind).toBe('scene_cluster_rewrite');
  });

  it('defers residue obligations outside the generated slice', () => {
    const router = new GateRepairRouter({ generatedThroughEpisode: 3 });
    const route = router.routeIssue(issue(
      'ResidueObligationValidator',
      'Residue payoff is planned for a later episode outside this partial-season slice.',
      's1-3',
      4,
    ));

    expect(route.kind).toBe('partial_scope_defer');
  });

  it('keeps continuity contradictions out of direct prose insertion', () => {
    const router = new GateRepairRouter();
    const route = router.routeIssue(issue(
      'ContinuityChecker',
      'Timeline contradiction: scene publishes the post before the authored writing beat happens after night three.',
    ));

    expect(route.kind).toBe('blueprint_rebalance');
    expect(route.unsafeForProsePatch).toBe(true);
  });
});

describe('treatment density guard', () => {
  it('passes a high-water-style scene load', () => {
    const report = analyzeSceneTreatmentDensity({
      id: 's2-2',
      requiredBeats: [
        { id: 'rb1', tier: 'authored', sourceTurn: 'Kylie follows Mika inside.', mustDepict: 'Kylie follows Mika inside Vâlcescu Club.' },
        { id: 'rb2', tier: 'seed', sourceTurn: 'The card matters.', mustDepict: 'The crescent card warms in her pocket.' },
      ],
      turnContract: {
        turnId: 'turn',
        source: 'treatment',
        centralTurn: 'Kylie chooses curiosity over safety.',
        beforeState: 'Outside',
        turnEvent: 'She steps through the side entrance.',
        afterState: 'Inside',
        handoff: 'Music pulls her deeper.',
      },
      choicePoint: {
        type: 'expression',
        stakes: { want: 'know', cost: 'exposure', identity: 'observer' },
        description: 'Choose how openly to enter.',
        optionHints: ['Blend in', 'Make a scene'],
      },
      keyBeats: [],
    } as never, { episodeNumber: 2, sceneIndex: 1 });

    expect(report.overloaded).toBe(false);
    expect(report.hardUnits).toBeLessThanOrEqual(report.threshold.hardUnits);
  });

  it('flags an overloaded cold-open/rooftop/attack/blog scene', () => {
    const report = analyzeSceneTreatmentDensity({
      id: 's1-1',
      requiredBeats: [
        { id: 'cold', tier: 'coldopen', sourceTurn: 'Sadie calls.', mustDepict: 'Sadie calls before the weekend post goes up.' },
        { id: 'blog', tier: 'authored', sourceTurn: 'Blog post.', mustDepict: 'Kylie publishes the pre-weekend blog post before leaving Bucharest.' },
        { id: 'roof', tier: 'authored', sourceTurn: 'Rooftop.', mustDepict: 'Night three at a rooftop bar at sunset, Kylie catches both men watching her.' },
        { id: 'attack', tier: 'signature', sourceTurn: 'Attack.', mustDepict: 'Cișmigiu at 1am: fog, a shadow, a scream, and a rescue.' },
      ],
      signatureMoment: 'Cișmigiu at 1am: fog, a shadow, a scream, and a rescue.',
      authoredTreatmentFields: [
        { id: 'enc1', episodeNumber: 1, fieldName: 'Encounter', sourceText: 'The attack establishes the supernatural threat.', contractKind: 'encounter_anchor', requiredRealization: ['encounter', 'final_prose'], targetSceneIds: ['s1-1'], blockingLevel: 'treatment' },
        { id: 'field1', episodeNumber: 1, fieldName: 'Pressure', sourceText: 'Blog orbit pressure.', contractKind: 'pressure_lane', requiredRealization: ['final_prose'], targetSceneIds: ['s1-1'], blockingLevel: 'treatment' },
      ],
      turnContract: {
        turnId: 'turn',
        source: 'treatment',
        centralTurn: 'Observer becomes prey.',
        beforeState: 'Curious',
        turnEvent: 'The rescue changes the rules.',
        afterState: 'Marked',
        handoff: 'Victor notices.',
      },
      choicePoint: {
        type: 'dilemma',
        stakes: { want: 'survive', cost: 'truth', identity: 'observer' },
        description: 'Decide what to post.',
        optionHints: ['Publish', 'Wait'],
      },
      keyBeats: ['Introduce Mika on-page.'],
    } as never, { episodeNumber: 1, sceneIndex: 0 });

    expect(report.overloaded).toBe(true);
    expect(report.recommendedDirective).toBe('blueprint_rebalance');
    expect(report.overloadReasons.join(' ')).toMatch(/hard units|time cue/);
  });

  it('allows small non-encounter overages to be handled by beat expansion', () => {
    const report = analyzeSceneTreatmentDensity({
      id: 's1-2',
      requiredBeats: [
        { id: 'rb1', tier: 'authored', sourceTurn: 'Kylie arrives.', mustDepict: 'Kylie steps through the club doors.' },
        { id: 'rb2', tier: 'authored', sourceTurn: 'Mika notices.', mustDepict: 'Mika notices Kylie before the crowd does.' },
        { id: 'rb3', tier: 'authored', sourceTurn: 'Victor watches.', mustDepict: 'Victor watches from the mezzanine.' },
        { id: 'rb4', tier: 'seed', sourceTurn: 'The card warms.', mustDepict: 'The crescent card warms inside Kylie\'s pocket.' },
      ],
      turnContract: {
        turnId: 'turn',
        source: 'treatment',
        centralTurn: 'Curiosity becomes exposure.',
        beforeState: 'Outside',
        turnEvent: 'Kylie chooses to stay visible.',
        afterState: 'Exposed',
        handoff: 'The club notices.',
      },
      keyBeats: [],
    } as never, { episodeNumber: 1, sceneIndex: 1 });

    expect(report.overloaded).toBe(true);
    expect(isTreatmentDensityExpandable(report)).toBe(true);
    expect(isUnsafeTreatmentDensityReport(report)).toBe(false);
  });

  it('marks overloaded encounter scenes as unsafe before encounter generation', () => {
    const report = analyzeSceneTreatmentDensity({
      id: 'treatment-enc-1-1',
      encounter: { id: 'treatment-enc-1-1' },
      requiredBeats: [
        { id: 'rb1', tier: 'authored', sourceTurn: 'Fog gathers.', mustDepict: 'Fog gathers around Kylie at 1am.' },
        { id: 'rb2', tier: 'authored', sourceTurn: 'A shadow moves.', mustDepict: 'A shadow moves behind the trees.' },
        { id: 'rb3', tier: 'authored', sourceTurn: 'A scream cuts through.', mustDepict: 'A scream cuts through the park.' },
        { id: 'rb4', tier: 'authored', sourceTurn: 'Victor intervenes.', mustDepict: 'Victor intervenes before the attacker reaches her.' },
      ],
      authoredTreatmentFields: [
        { id: 'enc1', episodeNumber: 1, fieldName: 'Encounter', sourceText: 'The attack encounter establishes the supernatural threat.', contractKind: 'encounter_anchor', requiredRealization: ['encounter', 'final_prose'], targetSceneIds: ['treatment-enc-1-1'], blockingLevel: 'treatment' },
        { id: 'enc2', episodeNumber: 1, fieldName: 'Conflict', sourceText: 'The attacker can be resisted but not defeated.', contractKind: 'encounter_conflict', requiredRealization: ['encounter', 'final_prose'], targetSceneIds: ['treatment-enc-1-1'], blockingLevel: 'treatment' },
      ],
      turnContract: {
        turnId: 'turn',
        source: 'treatment',
        centralTurn: 'Kylie becomes prey.',
        beforeState: 'Alone',
        turnEvent: 'The rescue changes her understanding of Bucharest.',
        afterState: 'Marked',
        handoff: 'The next morning, she questions what happened.',
      },
      choicePoint: {
        type: 'tactical',
        stakes: { want: 'survive', cost: 'exposure', identity: 'witness' },
        description: 'Choose how to react.',
        optionHints: ['Run', 'Hide'],
      },
      keyBeats: [],
    } as never, { episodeNumber: 1, sceneIndex: 2 });

    expect(report.overloaded).toBe(true);
    expect(isTreatmentDensityExpandable(report)).toBe(false);
    expect(isUnsafeTreatmentDensityReport(report)).toBe(true);
    expect(unsafeTreatmentDensityReports([report])).toEqual([report]);
  });

  it('recognizes timeline cues used by repair routing', () => {
    expect(hasTimelineCue('On night two, the key changes hands before the rooftop on night three.')).toBe(true);
    expect(hasTimelineCue('Kylie notices the crescent card under the door.')).toBe(false);
  });
});

describe('Bite Me regression harness', () => {
  const highWaterDir = join(process.cwd(), 'generated-stories/bite-me_2026-06-22T18-20-50');
  const firstRegressionDir = join(process.cwd(), 'generated-stories/bite-me_2026-06-22T22-30-53');
  const hasArtifacts = existsSync(join(highWaterDir, 'episode-1-blueprint.json'))
    && existsSync(join(highWaterDir, '07b-final-story-contract.json'))
    && existsSync(join(firstRegressionDir, 'episode-1-blueprint.json'))
    && existsSync(join(firstRegressionDir, '07b-final-story-contract.failed.json'));

  it.runIf(hasArtifacts)('keeps the 18:20 high-water run as passing behavioral evidence', () => {
    const blueprint = JSON.parse(readFileSync(join(highWaterDir, 'episode-1-blueprint.json'), 'utf8'));
    const qa = JSON.parse(readFileSync(join(highWaterDir, 'episode-1-qa-report.json'), 'utf8'));
    const finalContract = JSON.parse(readFileSync(join(highWaterDir, '07b-final-story-contract.json'), 'utf8'));
    const density = analyzeEpisodeTreatmentDensity(blueprint.scenes, 1);

    expect(qa.overallScore).toBeGreaterThanOrEqual(90);
    expect(finalContract.passed).toBe(true);
    expect(finalContract.blockingIssues).toHaveLength(0);
    expect(density.filter((report) => report.overloaded)).toEqual([]);
  });

  it.runIf(hasArtifacts)('catches the 22:30 overloaded cold-open regression before SceneWriter stuffing', () => {
    const blueprint = JSON.parse(readFileSync(join(firstRegressionDir, 'episode-1-blueprint.json'), 'utf8'));
    const qa = JSON.parse(readFileSync(join(firstRegressionDir, 'episode-1-qa-report.json'), 'utf8'));
    const finalContract = JSON.parse(readFileSync(join(firstRegressionDir, '07b-final-story-contract.failed.json'), 'utf8'));
    const density = analyzeEpisodeTreatmentDensity(blueprint.scenes, 1);
    const s11 = density.find((report) => report.sceneId === 's1-1');

    expect(qa.overallScore).toBeLessThan(90);
    expect(finalContract.passed).toBe(false);
    expect(s11?.overloaded).toBe(true);
    expect(s11?.recommendedDirective).toBe('blueprint_rebalance');
    expect(s11?.overloadReasons.join(' ')).toMatch(/hard units|time cue/);
  });
});
