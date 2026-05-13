import { describe, it, expect } from 'vitest';
import { collectImageRefs, walkStoryAssets, type ImageRef } from './storyAssetWalker';
import type { Story } from '../../types';

function makeMinimalStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'test-story',
    title: 'Test Story',
    genre: 'adventure',
    synopsis: 'A test story',
    coverImage: 'http://localhost:3001/cover.png',
    initialState: { attributes: {} as any, skills: {} as any, tags: [], inventory: [] },
    npcs: [{ id: 'npc-1', name: 'Alice', description: 'An NPC', portrait: 'http://localhost:3001/alice.png' }],
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        title: 'Episode 1',
        synopsis: 'Ep 1',
        coverImage: 'http://localhost:3001/ep-cover.png',
        scenes: [
          {
            id: 'scene-1',
            name: 'Scene 1',
            backgroundImage: 'http://localhost:3001/scene-bg.png',
            beats: [
              {
                id: 'beat-1',
                text: 'Hello world',
                image: 'http://localhost:3001/beat1.png',
                panelImages: ['http://localhost:3001/panel0.png', 'http://localhost:3001/panel1.png'],
              },
              {
                id: 'beat-2',
                text: 'Another beat',
                image: 'MISSING',
              },
            ],
            startingBeatId: 'beat-1',
          },
        ],
        startingSceneId: 'scene-1',
      },
    ],
    ...overrides,
  } as Story;
}

describe('storyAssetWalker', () => {
  describe('collectImageRefs', () => {
    it('collects all image refs from a minimal story', () => {
      const story = makeMinimalStory();
      const refs = collectImageRefs(story);

      const kinds = refs.map(r => r.kind);
      expect(kinds).toContain('story-cover');
      expect(kinds).toContain('npc-portrait');
      expect(kinds).toContain('episode-cover');
      expect(kinds).toContain('scene-background');
      expect(kinds).toContain('beat-image');
      expect(kinds).toContain('beat-panel');

      expect(refs.length).toBe(8); // cover + npc + ep-cover + scene-bg + beat1 + 2 panels + beat2(MISSING)
    });

    it('walks encounter choice tree outcomes', () => {
      const story = makeMinimalStory({
        episodes: [
          {
            id: 'ep-1', number: 1, title: 'Ep', synopsis: '', coverImage: '',
            startingSceneId: 'sc-1',
            scenes: [{
              id: 'sc-1', name: 'Scene', beats: [], startingBeatId: '',
              encounter: {
                id: 'enc-1', type: 'combat' as any, name: 'Fight', description: '',
                goalClock: { name: '', maxTicks: 6, currentTicks: 0 } as any,
                threatClock: { name: '', maxTicks: 4, currentTicks: 0 } as any,
                stakes: { victory: '', defeat: '' },
                phases: [{
                  id: 'ph-1', name: 'P1', description: '', situationImage: 'http://x/phase.png',
                  beats: [{
                    id: 'eb-1', phase: 'setup' as any, name: 'B', setupText: 'Setup',
                    situationImage: 'http://x/setup.png',
                    choices: [{
                      id: 'c1', text: 'Hit', approach: 'bold',
                      outcomes: {
                        success: {
                          tier: 'success' as const, goalTicks: 2, threatTicks: 0,
                          narrativeText: 'Win', outcomeImage: 'http://x/c1-s.png',
                          nextSituation: {
                            setupText: 'Next', situationImage: 'http://x/ns.png',
                            choices: [{
                              id: 'c2', text: 'Follow up', approach: 'bold',
                              outcomes: {
                                success: { tier: 'success' as const, goalTicks: 1, threatTicks: 0, narrativeText: 'Done', outcomeImage: 'http://x/c2-s.png', isTerminal: true },
                                complicated: { tier: 'complicated' as const, goalTicks: 1, threatTicks: 1, narrativeText: 'Meh', outcomeImage: 'http://x/c2-c.png', isTerminal: true },
                                failure: { tier: 'failure' as const, goalTicks: 0, threatTicks: 2, narrativeText: 'Bad', outcomeImage: 'http://x/c2-f.png', isTerminal: true },
                              },
                            }],
                          },
                        },
                        complicated: { tier: 'complicated' as const, goalTicks: 1, threatTicks: 1, narrativeText: 'OK', outcomeImage: 'http://x/c1-c.png', isTerminal: true },
                        failure: { tier: 'failure' as const, goalTicks: 0, threatTicks: 2, narrativeText: 'Bad', outcomeImage: 'http://x/c1-f.png', isTerminal: true },
                      },
                    }],
                  }],
                }],
                startingPhaseId: 'ph-1',
                outcomes: { victory: { nextSceneId: '', outcomeText: '' }, defeat: { nextSceneId: '', outcomeText: '' } },
                storylets: {
                  victory: {
                    id: 'sl-v', name: 'Victory', triggerOutcome: 'victory' as any,
                    tone: 'triumphant' as any, narrativeFunction: '', startingBeatId: 'slb-1',
                    consequences: [],
                    beats: [{ id: 'slb-1', text: 'You won', image: 'http://x/storylet-v.png' }],
                  },
                  defeat: {
                    id: 'sl-d', name: 'Defeat', triggerOutcome: 'defeat' as any,
                    tone: 'somber' as any, narrativeFunction: '', startingBeatId: 'slb-2',
                    consequences: [],
                    beats: [{ id: 'slb-2', text: 'You lost', image: 'http://x/storylet-d.png' }],
                  },
                },
              } as any,
            }],
          },
        ],
      });

      const refs = collectImageRefs(story);

      const urls = refs.map(r => r.url);
      // story cover + npc portrait
      expect(urls).toContain('http://localhost:3001/cover.png');
      expect(urls).toContain('http://localhost:3001/alice.png');
      // encounter phase + beat setup
      expect(urls).toContain('http://x/phase.png');
      expect(urls).toContain('http://x/setup.png');
      // c1 outcomes
      expect(urls).toContain('http://x/c1-s.png');
      expect(urls).toContain('http://x/c1-c.png');
      expect(urls).toContain('http://x/c1-f.png');
      // nextSituation
      expect(urls).toContain('http://x/ns.png');
      // c2 (nested) outcomes
      expect(urls).toContain('http://x/c2-s.png');
      expect(urls).toContain('http://x/c2-c.png');
      expect(urls).toContain('http://x/c2-f.png');
      // storylets
      expect(urls).toContain('http://x/storylet-v.png');
      expect(urls).toContain('http://x/storylet-d.png');
    });
  });

  describe('walkStoryAssets (skipHttpCheck)', () => {
    it('flags MISSING values', async () => {
      const story = makeMinimalStory();
      const report = await walkStoryAssets(story, { skipHttpCheck: true });

      expect(report.totalImages).toBe(8);
      expect(report.missing).toBe(1); // beat-2 has "MISSING"
      expect(report.verified).toBe(7);
    });
  });
});
