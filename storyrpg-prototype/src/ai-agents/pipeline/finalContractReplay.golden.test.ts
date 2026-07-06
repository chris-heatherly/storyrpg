/**
 * Final-contract replay goldens — bite-me 2026-07-05T20-47-31 abort.
 *
 * That run generated a complete, QA-passing episode and then aborted at the
 * final story contract on two findings:
 *
 *  1. `route_duplicate_event` on s1-6 — a FALSE POSITIVE: the scene is Kylie
 *     writing the blog post about the park attack (a sanctioned recap), but
 *     the choice label "Grab Mika's phone and start drafting a new post right
 *     now." tripped the threatEncounter cue regex on the word "Grab".
 *  2. `prose_style_violation` (tense drift) on s1-2 — a REAL defect (the
 *     whole scene was written in past tense), but the repair router had no
 *     rule for NarrativeFailureModeValidator, classified it architecture-class,
 *     and starved the LLM repair that exists for exactly this finding.
 *
 * The fixtures are the REAL scenes from that run's final story snapshot.
 * These tests replay both failures offline (sub-second, no LLM) and pin the
 * fixes: cue findings must be arbitrated before they block, tense drift must
 * repair scene-wide and route to prose repair.
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import { FinalStoryContractValidator } from '../validators/FinalStoryContractValidator';
import { RouteContinuityValidator } from '../validators/RouteContinuityValidator';
import { NarrativeFailureModeValidator } from '../validators/NarrativeFailureModeValidator';
import {
  RouteRestageArbiter,
  arbitrateRouteRestageFindings,
  type RestageClaim,
} from '../validators/routeRestageArbiter';
import { GateRepairRouter } from '../remediation/gateRepairRouter';
import { buildTenseDriftRepairHandler } from '../remediation/tenseDriftRepairHandler';
import { selectSceneProseRepairs } from '../remediation/sceneProseRepairHandler';
import { isSceneWideTenseDrift, sceneTenseCensus } from '../utils/proseTense';

function loadSceneFixture(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8'));
}

function storyWithScenes(scenes: Array<Record<string, unknown>>): Story {
  return {
    id: 'bite-me-replay',
    title: 'Bite Me',
    episodes: [{
      id: 'ep1-dating-after-dusk',
      number: 1,
      title: 'Dating After Dusk',
      startingSceneId: scenes[0].id,
      scenes,
    }],
  } as unknown as Story;
}

/** The exact blocking issue the run aborted on (99-pipeline-errors.json). */
const REAL_RESTAGE_ISSUE = {
  type: 'route_duplicate_event',
  severity: 'error',
  message: 'Reader route s1-1 -> s1-2 -> s1-3 -> s1-4 -> treatment-enc-1-1 -> s1-6 -> s1-7 -> s1-blog-aftermath restages threatEncounter in "s1-6" after that event was already owned earlier. Later scenes may carry aftermath or residue only: "REST: Walking home through Cismigiu, she is attacked and rescued by the impossibly handsome stranger, who walks her to her threshold and vanishes. establishes what feels stable, de".',
  episodeNumber: 1,
  sceneId: 's1-6',
  validator: 'RouteContinuityValidator',
  suggestion: 'Rewrite the later scene as consequence, memory, public reaction, changed access, or distinct escalation instead of replaying the owned event.',
};

const REAL_TENSE_ISSUE = {
  type: 'prose_style_violation',
  severity: 'error',
  message: '[Tense drift] Beat "beat-s1-2-03b" appears to narrate live action in past tense: "She came around the counter: linen blouse, embroidered hem..."',
  sceneId: 's1-2',
  beatId: 'beat-s1-2-03b',
  validator: 'NarrativeFailureModeValidator',
  suggestion: 'Rewrite live reader-facing action in present tense.',
};

function stubArbiter(restaged: boolean, seen?: RestageClaim[][]): () => RouteRestageArbiter {
  return () => ({
    execute: async (claims: RestageClaim[]) => {
      seen?.push(claims);
      return {
        success: true,
        data: { verdicts: claims.map((c) => ({ id: c.id, restaged, evidence: 'stub' })) },
      };
    },
  }) as unknown as RouteRestageArbiter;
}

describe('route restage false positive (s1-6 replay)', () => {
  it('the cue heuristic still flags the blog-recap scene — the false-positive class arbitration exists for', () => {
    const story = storyWithScenes([loadSceneFixture('bite-me-ep1-scene-s1-6-final.json')]);
    const result = new RouteContinuityValidator().validate({ story });
    const restage = result.issues.filter((issue) => issue.type === 'route_duplicate_event');
    expect(restage.length).toBeGreaterThan(0);
    expect(restage[0].sceneId).toBe('s1-6');
  });

  it('arbitration shows the arbiter the full detection surface, including the offending choice label', async () => {
    const story = storyWithScenes([loadSceneFixture('bite-me-ep1-scene-s1-6-final.json')]);
    const seen: RestageClaim[][] = [];
    const report = { passed: false, blockingIssues: [{ ...REAL_RESTAGE_ISSUE }], warnings: [] };
    await arbitrateRouteRestageFindings({ report, story, arbiter: stubArbiter(false, seen) });
    expect(seen).toHaveLength(1);
    expect(seen[0][0].prose).toContain("Grab Mika's phone");
    expect(seen[0][0].eventText).toContain('Walking home through Cismigiu');
  });

  it('a refuted cue finding downgrades to an annotated warning and the report passes', async () => {
    const story = storyWithScenes([loadSceneFixture('bite-me-ep1-scene-s1-6-final.json')]);
    const report = { passed: false, blockingIssues: [{ ...REAL_RESTAGE_ISSUE }], warnings: [] as Array<{ message?: string }> };
    const outcome = await arbitrateRouteRestageFindings({ report, story, arbiter: stubArbiter(false) });
    expect(outcome).toMatchObject({ considered: 1, refuted: 1, confirmed: 0 });
    expect(report.passed).toBe(true);
    expect(report.blockingIssues).toHaveLength(0);
    expect(report.warnings[0].message).toContain('cue-heuristic false positive');
  });

  it('an UNCORROBORATED cue finding (arbiter unavailable) demotes instead of aborting the run', async () => {
    const story = storyWithScenes([loadSceneFixture('bite-me-ep1-scene-s1-6-final.json')]);
    const report = { passed: false, blockingIssues: [{ ...REAL_RESTAGE_ISSUE }], warnings: [] as Array<{ message?: string }> };
    const outcome = await arbitrateRouteRestageFindings({ report, story, arbiter: () => null });
    expect(outcome).toMatchObject({ considered: 1, demotedUncorroborated: 1 });
    expect(report.passed).toBe(true);
    expect(report.warnings[0].message).toContain('unarbitrated cue heuristic');
  });

  it('a CONFIRMED restage stays blocking and routes to a live prose repair path, not an architecture dead end', async () => {
    const story = storyWithScenes([loadSceneFixture('bite-me-ep1-scene-s1-6-final.json')]);
    const report = { passed: false, blockingIssues: [{ ...REAL_RESTAGE_ISSUE }], warnings: [] };
    const outcome = await arbitrateRouteRestageFindings({ report, story, arbiter: stubArbiter(true) });
    expect(outcome).toMatchObject({ considered: 1, confirmed: 1 });
    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toHaveLength(1);

    // The confirmed finding must not starve LLM repair: it routes to a
    // scene-cluster rewrite (the validator's own suggestion is a prose
    // rewrite), not to blueprint_rebalance/diagnostic_stop.
    const route = new GateRepairRouter({ story }).routeIssue(report.blockingIssues[0]);
    expect(route.kind).toBe('scene_cluster_rewrite');
  });

  it('non-cue route findings are not touched by arbitration', async () => {
    const story = storyWithScenes([loadSceneFixture('bite-me-ep1-scene-s1-6-final.json')]);
    const fallbackIssue = {
      type: 'unsafe_fallback_prose',
      severity: 'error',
      message: 'Deterministic fallback prose shipped in s1-6.',
      sceneId: 's1-6',
      validator: 'RouteContinuityValidator',
    };
    const report = { passed: false, blockingIssues: [fallbackIssue], warnings: [] };
    const outcome = await arbitrateRouteRestageFindings({ report, story, arbiter: () => null });
    expect(outcome.considered).toBe(0);
    expect(report.blockingIssues).toHaveLength(1);
  });
});

describe('scene-wide tense drift (s1-2 replay)', () => {
  it('the s1-2 scene from the failed run reads as scene-wide past-tense drift, not a one-beat slip', () => {
    const scene = loadSceneFixture('bite-me-ep1-scene-s1-2-final.json');
    const census = sceneTenseCensus((scene as { beats?: Array<{ id?: string; text?: string }> }).beats);
    expect(isSceneWideTenseDrift(census)).toBe(true);
    expect(census.driftedBeatIds).toContain('beat-s1-2-03b');
  });

  it('tense-drift findings route to same-scene prose repair, not an architecture dead end', () => {
    const route = new GateRepairRouter().routeIssue({ ...REAL_TENSE_ISSUE });
    expect(route.kind).toBe('same_scene_retry');
    expect(route.sceneIds).toEqual(['s1-2']);
  });

  it('the deterministic tense handler repairs the WHOLE drifted scene and clears the validator', async () => {
    const scene = loadSceneFixture('bite-me-ep1-scene-s1-2-final.json');
    const story = storyWithScenes([scene]);
    const handler = buildTenseDriftRepairHandler();

    const result = await handler({ story, blockingIssues: [{ ...REAL_TENSE_ISSUE }] });
    expect(result.changed).toBe(true);

    const census = sceneTenseCensus((scene as { beats?: Array<{ id?: string; text?: string }> }).beats);
    expect(isSceneWideTenseDrift(census)).toBe(false);

    const validation = new NarrativeFailureModeValidator().validate({ story });
    const tenseErrors = validation.issues.filter(
      (issue) => issue.code === 'tense_drift' && issue.severity === 'error',
    );
    expect(tenseErrors).toEqual([]);
  });
});

/**
 * bite-me 2026-07-05T23-54-17 abort — episode locking, NOT the final contract.
 *
 * s1-1 opened on a scenic establishing shot (the taxi ride into Bucharest) and
 * anchored the player only in beat 2. PovClarityValidator flagged the opening
 * anchor at scene time, the scene was accepted as degraded, and the scene-lock
 * gate then hard-aborted the run on that STALE finding with no repair route.
 *
 * The fix has two halves, both pinned here and in sceneLocks.test.ts:
 *  - the lock gate defers craft findings to the final contract (two-tier), and
 *  - the final contract now detects the opening-anchor miss on CURRENT text
 *    (GATE_POV_ANCHOR) and routes it to a same-scene LLM rewrite.
 */
describe('opening-anchor POV lock abort (s1-1 replay, 2026-07-05T23-54-17)', () => {
  // The REAL first two beats from the run's scene-s1-1 checkpoint.
  const realS11Scene = {
    id: 's1-1',
    name: 'Arrival in Bucharest',
    startingBeatId: 's1-1_b1',
    beats: [
      {
        id: 's1-1_b1',
        text: 'The taxi from Otopeni smells of stale cigarettes and cheap air freshener. Outside, Bucharest slides past the smudged glass: Belle Epoque facades next to concrete blocks, a city of beautiful scars.',
      },
      {
        id: 's1-1_b2',
        text: 'The driver heaves your two suitcases onto the curb. They look small on the wide, cracked pavement of Strada Lipscani. This is it. The entire contents of a life, rebuilt after a very public breakup, standing on a foreign street.',
      },
    ],
  };

  it('the final contract detects the opening-anchor miss on the CURRENT text as a repairable blocker', async () => {
    const story = storyWithScenes([realS11Scene]);
    const report = await new FinalStoryContractValidator().validate({ story });

    const anchor = report.blockingIssues.find((issue) => issue.type === 'pov_anchor_missing');
    expect(anchor).toBeDefined();
    expect(anchor).toMatchObject({
      sceneId: 's1-1',
      beatId: 's1-1_b1',
      validator: 'PovClarityValidator',
      severity: 'error',
    });
  });

  it('the finding routes to a same-scene rewrite and is admitted by the scene-prose repair handler', () => {
    const issue = {
      type: 'pov_anchor_missing',
      severity: 'error' as const,
      message: 'Scene "Arrival in Bucharest" opens without anchoring the player character — the first prose beat never uses you/your or {{player.name}}.',
      episodeNumber: 1,
      sceneId: 's1-1',
      beatId: 's1-1_b1',
      validator: 'PovClarityValidator',
      suggestion: 'Rewrite the first beat so it anchors the player with you/your or {{player.name}} before focusing on NPCs, setting, or exposition.',
    };

    const route = new GateRepairRouter().routeIssue(issue);
    expect(route.kind).toBe('same_scene_retry');
    expect(route.sceneIds).toEqual(['s1-1']);

    const groups = selectSceneProseRepairs([issue]);
    expect([...groups.keys()]).toEqual(['s1-1']);
  });

  it('a scene that anchors the player in its first beat raises no anchor finding', async () => {
    const anchoredScene = {
      ...realS11Scene,
      beats: [
        { id: 's1-1_b1', text: 'Your taxi from Otopeni smells of stale cigarettes. Outside, Bucharest slides past the smudged glass.' },
        ...realS11Scene.beats.slice(1),
      ],
    };
    const story = storyWithScenes([anchoredScene]);
    const report = await new FinalStoryContractValidator().validate({ story });
    expect(report.blockingIssues.filter((issue) => issue.type === 'pov_anchor_missing')).toEqual([]);
    expect(report.warnings.filter((issue) => issue.type === 'pov_anchor_missing')).toEqual([]);
  });
});
