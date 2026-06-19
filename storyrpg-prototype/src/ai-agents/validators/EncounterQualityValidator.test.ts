import { describe, expect, it } from 'vitest';
import { EncounterQualityValidator, applyEncounterQualityGate, scanEncounterTemplateProse, scanMalformedEncounterProse } from './EncounterQualityValidator';
import { TEMPLATE_SIGNATURES } from '../agents/EncounterArchitect';
import type { Story } from '../../types';

function storyWithEncounter(encounter: any): Story {
  return {
    id: 's', title: 'T', genre: 'g', synopsis: '', coverImage: '',
    initialState: { attributes: {} as any, skills: {} as any, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'ep-1', number: 1, title: 'E', synopsis: '', coverImage: '', startingSceneId: 'scene-3',
      scenes: [{ id: 'scene-3', name: 'Encounter', startingBeatId: 'b1', leadsTo: ['episode-end'], beats: [{ id: 'b1', text: 'residue' }], encounter }],
    } as any],
  } as Story;
}

const bespokeEncounter = (goal = 3) => ({
  id: 'scene-3-encounter', type: 'dramatic',
  goalClock: { segments: goal, filled: 0 }, threatClock: { segments: 2, filled: 0 },
  phases: [{
    id: 'p1',
    beats: [{
      id: 'enc-b1',
      setupText: 'Vraxxan steps from the far shadow of the pass, his dagger drinking the Sunblade’s light.',
      choices: [
        { id: 'c1', text: 'Break formation and drive the Sunblade at Vraxxan.', outcomes: { success: { narrativeText: 'Your blade scores his shoulder.' } } },
        { id: 'c2', text: 'Hold the line and read his stance.', outcomes: { success: { narrativeText: 'You catch the tell in his footwork.' } } },
        { id: 'c3', text: 'Name his design aloud to fracture his composure.', outcomes: { success: { narrativeText: 'The truth lands; he hesitates.' } } },
      ],
    }],
  }],
  outcomes: {
    victory: { outcomeText: 'Vraxxan withdraws wounded; the pass belongs to the living.' },
  },
});

describe('EncounterQualityValidator', () => {
  it('passes a fully-authored encounter', () => {
    const report = new EncounterQualityValidator().validate({ story: storyWithEncounter(bespokeEncounter(3)) });
    expect(report.passed).toBe(true);
    expect(report.blockingIssues).toEqual([]);
  });

  it('BLOCKS an encounter whose prose contains template signatures (template collapse)', () => {
    const enc = bespokeEncounter(3);
    // Inject the generic deterministic-fallback situation text.
    enc.phases[0].beats[0].setupText = `This is the moment that decides everything. Lysandra and Aethavyr face the final test.`;
    // ...and generic outcome text.
    (enc.outcomes as any).victory.outcomeText = 'An unexpected solution presents itself. Aethavyr takes it.';
    const report = new EncounterQualityValidator().validate({ story: storyWithEncounter(enc) });
    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'encounter_template_collapse', sceneId: 'scene-3' }),
    ]));
  });

  it('BLOCKS a degraded encounter whose clock cannot be covered', () => {
    const enc = bespokeEncounter(6); // 3 choices, goal 6 → under-covered
    const telemetryBySceneId = new Map([['scene-3', { degraded: true }]]);
    const report = new EncounterQualityValidator().validate({ story: storyWithEncounter(enc), telemetryBySceneId });
    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'encounter_clock_coverage_gap', sceneId: 'scene-3' }),
    ]));
  });

  it('does NOT flag an under-covered clock when telemetry is healthy (avoids nested-branch false positives)', () => {
    const enc = bespokeEncounter(6);
    const telemetryBySceneId = new Map([['scene-3', { degraded: false }]]);
    const report = new EncounterQualityValidator().validate({ story: storyWithEncounter(enc), telemetryBySceneId });
    expect(report.blockingIssues.filter((i) => i.type === 'encounter_clock_coverage_gap')).toEqual([]);
  });

  it('exposes a non-empty signature list', () => {
    expect(TEMPLATE_SIGNATURES.length).toBeGreaterThan(5);
  });

  it('scanEncounterTemplateProse (generation-time acceptance check) finds hits and clears on bespoke prose', () => {
    // The same scan ContentGenerationPhase runs before ACCEPTING an encounter
    // (no-boilerplate mandate): hits here trigger regen-with-feedback, and an
    // exhausted regen with hits fails the episode at generation time.
    expect(scanEncounterTemplateProse(bespokeEncounter(3))).toEqual([]);
    const enc = bespokeEncounter(3);
    enc.phases[0].beats[0].setupText = 'This is the moment that decides everything.';
    (enc.outcomes as any).victory.outcomeText = 'An unexpected solution presents itself.';
    const hits = scanEncounterTemplateProse(enc);
    expect(hits).toContain('This is the moment that decides everything');
    expect(hits).toContain('An unexpected solution presents itself');
  });

  it('BLOCKS malformed second-person replacement residue from the G22 encounter class', () => {
    const enc = bespokeEncounter(3);
    enc.phases[0].beats[0].setupText =
      "Night three. You're on you rooftop as You Dusk Club hums across you bar.";
    enc.phases[0].beats[0].choices[0].text = 'Hold you charcoal stranger\'s gaze and walk over';
    (enc.phases[0].beats[0].choices[0].outcomes.success as any).narrativeText =
      'You kiss takes, and the maze folds around you maze\' exit.';

    const malformed = scanMalformedEncounterProse(enc);
    expect(malformed).toEqual(expect.arrayContaining([
      expect.stringContaining('you-rooftop'),
      expect.stringContaining('imperative-you-adjective-noun'),
      expect.stringContaining('you-kiss-takes'),
    ]));

    const report = new EncounterQualityValidator().validate({ story: storyWithEncounter(enc) });
    expect(report.passed).toBe(false);
    expect(report.blockingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'encounter_malformed_prose', sceneId: 'scene-3' }),
    ]));
  });

  it('does NOT false-positive ordinary second-person prose around a bar', () => {
    const enc = bespokeEncounter(3);
    enc.phases[0].beats[0].setupText =
      'You watch the bar until Victor turns, then keep your charcoal clutch close.';
    enc.phases[0].beats[0].choices[0].text = 'Hold your nerve and cross the room';
    (enc.phases[0].beats[0].choices[0].outcomes.success as any).narrativeText =
      'You kiss him on the cheek and your path stays open.';

    expect(scanMalformedEncounterProse(enc)).toEqual([]);
    const report = new EncounterQualityValidator().validate({ story: storyWithEncounter(enc) });
    expect(report.blockingIssues.filter(i => i.type === 'encounter_malformed_prose')).toEqual([]);
  });

  it('detects template prose buried DEEP in a nextSituation branch (depth-limit regression)', () => {
    // The Endsong bug: a phase-3 conditional choice shipped the deterministic
    // template as its nextSituation branch at depth ~10. The old depth>8 cutoff
    // stopped the scan before reaching it, so template-collapse silently passed.
    const enc = bespokeEncounter(3);
    // Bury a template signature ~10 levels deep on choice c4's branch.
    (enc.phases[0].beats[0].choices as any).push({
      id: 'c4', text: 'A state-unlocked move', approach: 'tactical', primarySkill: 'perception',
      outcomes: {
        success: {
          narrativeText: 'It lands.',
          nextSituation: {
            setupText: 'This is the moment that decides everything. They face the final test.',
            choices: [{ id: 'x', text: 'Push for a decisive outcome' }],
          },
        },
      },
    });
    const report = new EncounterQualityValidator().validate({ story: storyWithEncounter(enc) });
    expect(report.passed).toBe(false);
    expect(report.blockingIssues.some((i) => i.type === 'encounter_template_collapse')).toBe(true);
  });
});

describe('applyEncounterQualityGate remediation', () => {
  it('shrinks a degraded under-covered clock to authored coverage and does NOT block', () => {
    const enc = bespokeEncounter(6); // 3 bespoke choices, goal 6 → under-covered
    const story = storyWithEncounter(enc);
    const report = { passed: true, blockingIssues: [] as any[], warnings: [] as any[] };

    applyEncounterQualityGate(report, story, [{ sceneId: 'scene-3', degraded: true }]);

    // Clock shrunk to the authored choice count (3), so it ships playable.
    const shrunk = (story.episodes[0].scenes[0] as any).encounter;
    expect(shrunk.goalClock.segments).toBe(3);
    expect(shrunk.threatClock.segments).toBeLessThan(2 + 1); // threat scaled down too
    // No coverage-gap block remains.
    expect(report.passed).toBe(true);
    expect(report.blockingIssues.filter((i) => i.type === 'encounter_clock_coverage_gap')).toEqual([]);
  });

  it('still BLOCKS template-collapse (unfixable) even after shrink remediation', () => {
    const enc = bespokeEncounter(6);
    enc.phases[0].beats[0].setupText = 'This is the moment that decides everything. A and B face the final test.';
    const story = storyWithEncounter(enc);
    const report = { passed: true, blockingIssues: [] as any[], warnings: [] as any[] };

    applyEncounterQualityGate(report, story, [{ sceneId: 'scene-3', degraded: true }]);

    expect(report.passed).toBe(false);
    expect(report.blockingIssues.some((i) => i.type === 'encounter_template_collapse')).toBe(true);
  });
});
