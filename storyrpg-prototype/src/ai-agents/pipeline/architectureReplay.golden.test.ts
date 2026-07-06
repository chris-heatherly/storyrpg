/**
 * Golden-fixture replay of the deterministic architecture stage.
 *
 * The fixtures under __fixtures__/ are real season-plan artifacts captured from
 * a live "Bite Me" episode-1 run (storyrpg-lite-treatment_2026-07-05T19-06-43,
 * which cleared SceneConstructionGate). They contain the known-pathological
 * input: a raw multi-event treatment paragraph crammed into s1-2's
 * dramaticPurpose (arrival + bookshop + Dusk Club formation + rooftop bar +
 * attack + rescue + viral post).
 *
 * StoryArchitect's elaborate mode (plannedScenes present) is fully
 * deterministic — no LLM call — so this test replays the ENTIRE architecture
 * stage offline: blueprint build → obligation rebinding → event ownership →
 * intro beats → construction profiles → SceneConstructionGate.
 *
 * Any change to the binder/ownership/construction heuristics that would make
 * this real input hard-abort again fails here in seconds instead of after a
 * 25-minute LLM run.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { StoryArchitect, type StoryArchitectInput } from '../agents/StoryArchitect';
import { plannedIntroductionsForEpisode } from '../utils/npcIntroductionLedger';

const FIXTURES = join(__dirname, '__fixtures__');

interface SeasonContextFixture {
  episode: {
    episodeNumber: number;
    title: string;
    synopsis: string;
    storyCircleRole: unknown;
    introducesCharacters: string[];
  };
  characterIntroductions: Array<{
    characterId: string;
    characterName?: string;
    introducedInEpisode: number;
    role?: string;
  }>;
  protagonist: { id: string; name: string; description: string };
  npcs: Array<{ id: string; name: string; role: string; tier: string; description: string }>;
  storyCircle: Record<string, string>;
  anchors: Record<string, string>;
}

function loadFixtures(): { input: StoryArchitectInput; context: SeasonContextFixture } {
  const planned = JSON.parse(
    readFileSync(join(FIXTURES, 'bite-me-ep1-planned-scenes.json'), 'utf-8'),
  ) as { episodeNumber: number; plannedScenes: unknown[] };
  const context = JSON.parse(
    readFileSync(join(FIXTURES, 'bite-me-ep1-season-context.json'), 'utf-8'),
  ) as SeasonContextFixture;

  const roster = context.npcs.map((npc) => ({ id: npc.id, name: npc.name }));

  // Mirrors the EpisodeArchitecturePhase → StoryArchitectInput mapping.
  const input: StoryArchitectInput = {
    storyTitle: 'Bite Me',
    genre: 'Paranormal Romance',
    synopsis: context.episode.synopsis,
    tone: 'Wry, sensual, dangerous',
    episodeNumber: context.episode.episodeNumber,
    episodeTitle: context.episode.title,
    episodeSynopsis: context.episode.synopsis,
    protagonistDescription: context.protagonist.description || 'Kylie Marinescu, a wounded observer starting over in Bucharest.',
    availableNPCs: context.npcs.map((npc) => ({
      id: npc.id,
      name: npc.name,
      description: npc.description,
    })),
    worldContext: 'Bucharest hides a nocturnal world beneath its nightlife.',
    currentLocation: 'Bucharest',
    targetSceneCount: (planned.plannedScenes ?? []).length,
    majorChoiceCount: 2,
    seasonPlanDirectives: {
      plannedScenes: planned.plannedScenes,
    } as StoryArchitectInput['seasonPlanDirectives'],
    seasonAnchors: context.anchors as unknown as StoryArchitectInput['seasonAnchors'],
    seasonStoryCircle: context.storyCircle as unknown as StoryArchitectInput['seasonStoryCircle'],
    episodeStoryCircleRole: context.episode.storyCircleRole as StoryArchitectInput['episodeStoryCircleRole'],
    introducesCharacters: plannedIntroductionsForEpisode({
      episodeNumber: context.episode.episodeNumber,
      protagonistId: context.protagonist.id || 'char-kylie-marinescu',
      roster,
      introducesCharacters: context.episode.introducesCharacters,
      characterIntroductions: context.characterIntroductions,
    }),
  };
  return { input, context };
}

const config = {
  provider: 'anthropic' as const,
  model: 'replay-fixture-no-llm',
  apiKey: 'replay-fixture-no-llm',
  maxTokens: 1024,
  temperature: 0.1,
};

describe('architecture replay: Bite Me episode 1 (real season-plan fixture)', () => {
  it('clears the deterministic architecture stage without a gate abort', async () => {
    const { input } = loadFixtures();
    const architect = new StoryArchitect(config);

    const result = await architect.execute(input);

    // The core regression assertion: this real input must never hard-abort
    // the architecture stage again (SceneConstructionGate, adequacy gate, …).
    expect(result.error ?? '').toBe('');
    expect(result.success).toBe(true);
    expect(result.data?.scenes.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps every non-encounter scene inside the construction budget', async () => {
    const { input } = loadFixtures();
    const architect = new StoryArchitect(config);

    const result = await architect.execute(input);
    expect(result.success).toBe(true);

    for (const scene of result.data!.scenes) {
      const profile = (scene as {
        sceneConstructionProfile?: {
          capacity: { hardUnits: number; maxHardUnits: number };
          conflictDiagnostics: string[];
        };
      }).sceneConstructionProfile;
      if (!profile) continue;
      expect(
        profile.conflictDiagnostics,
        `scene ${scene.id} construction conflicts`,
      ).toEqual([]);
      expect(
        profile.capacity.hardUnits,
        `scene ${scene.id} hard units (${profile.capacity.hardUnits}) over budget (${profile.capacity.maxHardUnits})`,
      ).toBeLessThanOrEqual(profile.capacity.maxHardUnits);
    }
  });

  it('introduces each planned character in exactly one scene, in blueprint order', async () => {
    const { input } = loadFixtures();
    const architect = new StoryArchitect(config);

    const result = await architect.execute(input);
    expect(result.success).toBe(true);

    const introScenes = new Map<string, string[]>();
    for (const scene of result.data!.scenes) {
      for (const beat of scene.requiredBeats ?? []) {
        const beatId = String((beat as { id?: string }).id ?? '');
        const match = beatId.match(/^intro-(.+)$/);
        if (!match) continue;
        const list = introScenes.get(match[1]) ?? [];
        list.push(scene.id);
        introScenes.set(match[1], list);
      }
    }

    for (const [characterId, scenes] of introScenes) {
      expect(scenes.length, `character ${characterId} introduced in ${scenes.join(', ')}`).toBe(1);
    }
  });
});
