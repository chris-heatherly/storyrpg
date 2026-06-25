/**
 * CharacterArcTracker normalization tests. The LLM call is mocked — these
 * cover the parse-side guarantees the wiring relies on: axis whitelisting,
 * delta clamping, relationship-target filtering to real character-bible NPCs
 * (with display-name → id rewriting), and the fail-open empty plan on error.
 */

import { describe, it, expect, vi } from 'vitest';
import { CharacterArcTracker, CharacterArcTrackerInput } from './CharacterArcTracker';
import type { CharacterBible } from './CharacterDesigner';
import type { EpisodeBlueprint } from './StoryArchitect';
import type { AgentConfig } from '../config';

const config = { provider: 'anthropic', model: 'test-model', temperature: 0.7, maxTokens: 100 } as AgentConfig;

function makeInput(): CharacterArcTrackerInput {
  return {
    episodeBlueprint: {
      episodeId: 'episode-1',
      scenes: [{ id: 's1-1', purpose: 'setup', description: 'Opening' }],
    } as unknown as EpisodeBlueprint,
    characterBible: {
      characters: [
        { id: 'hero', name: 'Hero', role: 'protagonist' },
        { id: 'mara', name: 'Mara', role: 'ally' },
      ],
    } as unknown as CharacterBible,
    episodeIndex: 1,
    totalEpisodes: 3,
  };
}

function trackerReturning(json: unknown): CharacterArcTracker {
  const tracker = new CharacterArcTracker(config);
  vi.spyOn(tracker as unknown as { callLLM: () => Promise<string> }, 'callLLM')
    .mockResolvedValue(JSON.stringify(json));
  return tracker;
}

describe('CharacterArcTracker normalization', () => {
  it('whitelists identity axes and clamps deltas to [-40, 40]', async () => {
    const tracker = trackerReturning({
      episodeId: 'episode-1',
      arcPhaseHeadline: 'Test',
      identityTargets: [
        { axis: 'mercy_justice', delta: 95, rationale: 'big swing' },
        { axis: 'charisma', delta: 10, rationale: 'not a real axis' },
      ],
      relationshipTargets: [],
      milestones: [],
    });
    const res = await tracker.execute(makeInput());
    expect(res.success).toBe(true);
    expect(res.data?.identityTargets).toEqual([
      { axis: 'mercy_justice', delta: 40, rationale: 'big swing' },
    ]);
  });

  it('filters relationship targets to real NPCs and rewrites display names to ids', async () => {
    const tracker = trackerReturning({
      episodeId: 'episode-1',
      arcPhaseHeadline: 'Test',
      identityTargets: [],
      relationshipTargets: [
        { npcId: 'mara', trustDelta: -10, trajectory: 'warm → guarded', rationale: 'r1' },
        { npcId: 'MARA', bondDelta: 5, trajectory: 'name form', rationale: 'r2' },
        { npcId: 'ghost-npc', trustDelta: 3, trajectory: 'unknown', rationale: 'r3' },
        { npcId: 'hero', trustDelta: 3, trajectory: 'protagonist is not an NPC', rationale: 'r4' },
      ],
      milestones: [],
    });
    const res = await tracker.execute(makeInput());
    expect(res.data?.relationshipTargets.map((r) => r.npcId)).toEqual(['mara', 'mara']);
  });

  it('fails open with an empty plan when the LLM call throws', async () => {
    const tracker = new CharacterArcTracker(config);
    vi.spyOn(tracker as unknown as { callLLM: () => Promise<string> }, 'callLLM')
      .mockRejectedValue(new Error('boom'));
    const res = await tracker.execute(makeInput());
    expect(res.success).toBe(true);
    expect(res.error).toContain('boom');
    expect(res.data).toEqual({
      episodeId: 'episode-1',
      arcPhaseHeadline: '',
      identityTargets: [],
      relationshipTargets: [],
      milestones: [],
    });
  });

  it('includes the NPC roster (protagonist excluded) in the prompt', async () => {
    const tracker = trackerReturning({
      episodeId: 'episode-1', arcPhaseHeadline: '', identityTargets: [], relationshipTargets: [], milestones: [],
    });
    await tracker.execute(makeInput());
    const spy = (tracker as unknown as { callLLM: ReturnType<typeof vi.fn> }).callLLM;
    const prompt = spy.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('- mara (Mara, ally)');
    expect(prompt).not.toContain('- hero (Hero');
  });

  it('compacts oversized season plans before prompting', async () => {
    const tracker = trackerReturning({
      episodeId: 'episode-2', arcPhaseHeadline: '', identityTargets: [], relationshipTargets: [], milestones: [],
    });
    await tracker.execute({
      ...makeInput(),
      episodeIndex: 2,
      totalEpisodes: 8,
      seasonArcPlan: {
        sourceTitle: 'Bite Me',
        seasonTitle: 'Bite Me',
        notes: 'RAW_NOTES_SHOULD_NOT_APPEAR'.repeat(1000),
        residuePlan: { obligations: Array.from({ length: 100 }, () => ({ sourceText: 'RAW_RESIDUE_SHOULD_NOT_APPEAR' })) },
        arcs: [
          { name: 'Champagne', description: 'Glossy rom-com pressure that curdles into dread.'.repeat(100) },
        ],
        episodes: [
          { episodeNumber: 1, title: 'Previous Episode', synopsis: 'Previous pressure.' },
          {
            episodeNumber: 2,
            title: 'Current Episode',
            synopsis: 'Current pressure.',
            treatmentGuidance: {
              dramaticQuestion: 'Can Kylie trust the attention she is getting?',
              rawStructuralRole: 'RAW_GUIDANCE_SHOULD_NOT_APPEAR'.repeat(1000),
              majorChoicePressures: Array.from({ length: 20 }, (_, i) => `choice pressure ${i + 1}`),
            },
          },
          { episodeNumber: 4, title: 'Far Future Episode', synopsis: 'Should stay out of the compact window.' },
        ],
      },
    });
    const spy = (tracker as unknown as { callLLM: ReturnType<typeof vi.fn> }).callLLM;
    const prompt = spy.mock.calls[0][0][0].content as string;

    expect(prompt.length).toBeLessThan(20000);
    expect(prompt).toContain('Bite Me');
    expect(prompt).toContain('Current Episode');
    expect(prompt).toContain('Previous Episode');
    expect(prompt).not.toContain('Far Future Episode');
    expect(prompt).not.toContain('RAW_NOTES_SHOULD_NOT_APPEAR');
    expect(prompt).not.toContain('RAW_RESIDUE_SHOULD_NOT_APPEAR');
    expect(prompt).not.toContain('RAW_GUIDANCE_SHOULD_NOT_APPEAR');
  });
});
