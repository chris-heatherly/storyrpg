import { describe, expect, it, vi } from 'vitest';

// Capture diagnostics instead of writing run artifacts to disk.
vi.mock('../utils/pipelineOutputWriter', () => ({
  saveEarlyDiagnostic: vi.fn(async () => undefined),
}));

import { SceneCriticContinuity, type SceneCriticContinuityDeps } from './sceneCriticContinuity';
import { saveEarlyDiagnostic } from '../utils/pipelineOutputWriter';
import type { PipelineConfig } from '../config';
import type { Story } from '../../types';
import type { SceneContent } from '../agents/SceneWriter';
import type { SceneCritic } from '../agents/SceneCritic';
import type { CharacterBible } from '../agents/CharacterDesigner';
import type { QAReport } from '../agents/QAAgents';

/**
 * End-to-end repair-pass shape of bite-me 2026-07-02T23-54-38: the QA judge's
 * one blocking finding named its beat only in prose (structured location
 * empty), and the planned setup (s1-1 owned the socialMeet cue introducing
 * Mika) was never depicted. The repair must (a) anchor the finding from its
 * text, (b) re-author the flagged use-site scene, and (c) ALSO re-author the
 * owning scene that dropped the introduction.
 */
describe('SceneCriticContinuity.repairContinuityFindings (run-shaped)', () => {
  const makeFixture = () => {
    const story = {
      episodes: [{
        scenes: [
          { id: 's1-1', beats: [{ id: 's1-1-b1', text: 'Kylie unpacks alone in the Lipscani apartment.' }] },
          { id: 's1-2', beats: [
            { id: 's1-2-b1', text: 'The Dusk Club hums.' },
            { id: 's1-2-b2', text: '"Try the negroni," Mika says.' },
          ] },
        ],
      }],
    } as unknown as Story;
    const sceneContents = [
      { sceneId: 's1-1', beats: [{ id: 's1-1-b1', text: 'Kylie unpacks alone in the Lipscani apartment.' }] },
      { sceneId: 's1-2', beats: [
        { id: 's1-2-b1', text: 'The Dusk Club hums.' },
        { id: 's1-2-b2', text: '"Try the negroni," Mika says.' },
      ] },
    ] as unknown as SceneContent[];
    const qaReport = {
      continuity: {
        overallScore: 75,
        issueCount: { errors: 1, warnings: 0, suggestions: 0 },
        issues: [{
          severity: 'error',
          type: 'missing_setup',
          // The judge supplied NO structured location — only prose names the beat.
          location: {},
          description: 'Mika is mentioned by name and speaks in s1-2-b2, but the reader has not been introduced to her on-page yet.',
          conflictsWith: "char-mika-dragan: Knows: Kylie's best friend",
          suggestedFix: "Introduce Mika Dragan in an earlier scene, or rephrase s1-2-b2 to introduce her as 'a friend' before naming her.",
        }],
        passedChecks: [],
        recommendations: [],
      },
    } as unknown as QAReport;
    const criticCalls: Array<{ sceneId: string; directorNotes?: string; flaggedBeatIds?: string[] }> = [];
    const sceneCritic = {
      execute: vi.fn(async (input: { scene: SceneContent; directorNotes?: string; flaggedBeatIds?: string[] }) => {
        criticCalls.push({ sceneId: input.scene.sceneId, directorNotes: input.directorNotes, flaggedBeatIds: input.flaggedBeatIds });
        const beatId = input.scene.sceneId === 's1-1' ? 's1-1-b1' : 's1-2-b2';
        return {
          success: true,
          data: { rewrittenBeats: [{ id: beatId, text: `repaired prose for ${input.scene.sceneId}` }], overallCommentary: '' },
        };
      }),
    } as unknown as SceneCritic;
    const deps: SceneCriticContinuityDeps = {
      config: { agents: {} } as unknown as PipelineConfig,
      emit: vi.fn(),
      sceneCritic,
      buildContinuityCharacterKnowledge: () => [],
      buildContinuityTimeline: () => [],
    };
    return { story, sceneContents, qaReport, criticCalls, deps };
  };
  const plannedScenes = [
    { id: 's1-arrival-cold-open', sceneEventOwnership: { ownedEvents: [{ cue: 'arrival', text: 'Kylie Marinescu arrives in Bucharest.' }] } },
    { id: 's1-1', sceneEventOwnership: { ownedEvents: [{ cue: 'socialMeet', text: 'Kylie forms the Dusk Club with Mika and Stela over velvet booths.' }] } },
    { id: 's1-2' },
  ];
  const characterBible = { characters: [] } as unknown as CharacterBible;

  it('anchors the finding from prose, repairs the use-site AND the owning scene', async () => {
    const { story, sceneContents, qaReport, criticCalls, deps } = makeFixture();
    const repair = new SceneCriticContinuity(deps);
    await repair.repairContinuityFindings(
      story, sceneContents, characterBible, qaReport, '/dev/null-out', undefined,
      { plannedScenes },
    );

    // (a) the mined location is written back onto the report
    expect(qaReport.continuity!.issues[0].location).toEqual({ sceneId: 's1-2', beatId: 's1-2-b2' });

    // (b) use-site repair: flagged beat targeted, guidance carries the finding
    const useSite = criticCalls.find((call) => call.sceneId === 's1-2');
    expect(useSite?.flaggedBeatIds).toEqual(['s1-2-b2']);
    expect(useSite?.directorNotes).toContain('introduced to her on-page');

    // (c) owning-scene repair: the dropped socialMeet event is the guidance
    const owner = criticCalls.find((call) => call.sceneId === 's1-1');
    expect(owner?.flaggedBeatIds).toEqual([]);
    expect(owner?.directorNotes).toContain('cue: socialMeet');
    expect(owner?.directorNotes).toContain('Dusk Club');

    // Both scenes' prose actually merged into the story and sceneContents.
    const scenes = (story as unknown as { episodes: Array<{ scenes: Array<{ id: string; beats: Array<{ id: string; text: string }> }> }> }).episodes[0].scenes;
    expect(scenes.find((s) => s.id === 's1-2')!.beats[1].text).toBe('repaired prose for s1-2');
    expect(scenes.find((s) => s.id === 's1-1')!.beats[0].text).toBe('repaired prose for s1-1');

    // Diagnostic records the retarget so "did repair fire?" is artifact-answerable.
    const diagnostic = vi.mocked(saveEarlyDiagnostic).mock.calls.at(-1)?.[2] as {
      repaired: Array<{ sceneId: string }>;
      ownerRetargets: Array<{ ownerSceneId: string; findingSceneId: string; cue?: string }>;
      candidateScenes: string[];
    };
    expect(diagnostic.candidateScenes).toEqual(['s1-2', 's1-1']);
    expect(diagnostic.repaired.map((r) => r.sceneId).sort()).toEqual(['s1-1', 's1-2']);
    expect(diagnostic.ownerRetargets).toEqual([
      { ownerSceneId: 's1-1', findingSceneId: 's1-2', cue: 'socialMeet', entity: 'mika' },
    ]);
  });

  it('without an ownership plan, still anchors and repairs the flagged scene alone', async () => {
    const { story, sceneContents, qaReport, criticCalls, deps } = makeFixture();
    const repair = new SceneCriticContinuity(deps);
    await repair.repairContinuityFindings(
      story, sceneContents, characterBible, qaReport, '/dev/null-out', undefined,
    );
    expect(criticCalls.map((call) => call.sceneId)).toEqual(['s1-2']);
    expect(qaReport.continuity!.issues[0].location).toEqual({ sceneId: 's1-2', beatId: 's1-2-b2' });
  });

  it('A3: flag-gated pass feeds advisory critic notes into directorNotes and prioritizes the most-flagged scene', async () => {
    const { sceneContents, criticCalls, deps } = makeFixture();
    const { flagSceneForCritic, addCriticNote } = await import('../remediation/sceneCriticFlags');
    // s1-1: one bare flag. s1-2: flag + two concrete advisory notes.
    flagSceneForCritic(sceneContents[0], 'realization-retry');
    flagSceneForCritic(sceneContents[1], 'advisory-planting-miss');
    addCriticNote(sceneContents[1], 'Work this planted moment into the scene naturally: Stela slides a business card across the bar.');
    addCriticNote(sceneContents[1], 'The scene must end with a motivated departure: Kylie decides to head for the rooftop.');

    const pass = new SceneCriticContinuity({ ...deps, config: { agents: {}, sceneCritic: { enabled: false, maxScenesPerEpisode: 1 } } as unknown as PipelineConfig });
    await pass.runSceneCriticPass(sceneContents, characterBible);

    // Budget of 1: the scene with flag+2 notes wins over the bare flag.
    expect(criticCalls.map((call) => call.sceneId)).toEqual(['s1-2']);
    expect(criticCalls[0].directorNotes).toContain('ADDRESS THESE SPECIFIC GAPS');
    expect(criticCalls[0].directorNotes).toContain('Stela slides a business card');
    expect(criticCalls[0].directorNotes).toContain('motivated departure');
  });
});
