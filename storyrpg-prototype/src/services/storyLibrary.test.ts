import type { Story } from '../types';

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
  },
}));

const { createStoryCatalogEntry, normalizeStoryMediaUrls } = await import('./storyLibrary');

function createStory(): Story {
  return {
    id: 'story-1',
    title: 'Test Story',
    genre: 'mystery',
    synopsis: 'A test story.',
    coverImage: 'generated-stories/story-1/cover.jpg',
    initialState: {
      attributes: {
        charm: 1,
        wit: 2,
        courage: 3,
        empathy: 4,
        resolve: 5,
        resourcefulness: 6,
      },
      skills: {},
      tags: [],
      inventory: [],
    },
    npcs: [],
    episodes: [
      {
        id: 'episode-1',
        number: 1,
        title: 'Episode 1',
        synopsis: 'Start',
        coverImage: 'generated-stories/story-1/episode-1.jpg',
        startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1',
            name: 'Scene 1',
            backgroundImage: 'generated-stories/story-1/scene-1.jpg',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                text: 'Hello',
                image: 'generated-stories/story-1/beat-1.jpg',
                choices: [],
              },
            ],
            encounter: {
              id: 'enc-1',
              type: 'dramatic',
              name: 'Encounter',
              description: 'A branching moment',
              goalClock: { id: 'g', name: 'Goal', description: 'Goal', segments: 4, filled: 0, type: 'goal' },
              threatClock: { id: 't', name: 'Threat', description: 'Threat', segments: 4, filled: 0, type: 'threat' },
              stakes: { victory: 'Win', defeat: 'Lose' },
              startingPhaseId: 'phase-1',
              phases: [
                {
                  id: 'phase-1',
                  name: 'Phase 1',
                  description: 'Start',
                  situationImage: 'generated-stories/story-1/encounter-phase.jpg',
                  beats: [
                    {
                      id: 'enc-beat-1',
                      phase: 'setup',
                      name: 'Beat',
                      setupText: 'Setup',
                      situationImage: 'generated-stories/story-1/encounter-beat.jpg',
                      choices: [
                        {
                          id: 'choice-1',
                          text: 'Choose',
                          approach: 'bold',
                          outcomes: {
                            success: {
                              tier: 'success',
                              goalTicks: 1,
                              threatTicks: 0,
                              narrativeText: 'Success',
                              outcomeImage: 'generated-stories/story-1/encounter-success.jpg',
                              nextSituation: {
                                setupText: 'Next',
                                situationImage: 'generated-stories/story-1/encounter-next.jpg',
                                choices: [],
                              },
                            },
                            complicated: {
                              tier: 'complicated',
                              goalTicks: 1,
                              threatTicks: 1,
                              narrativeText: 'Complicated',
                            },
                            failure: {
                              tier: 'failure',
                              goalTicks: 0,
                              threatTicks: 1,
                              narrativeText: 'Failure',
                            },
                          },
                        },
                      ],
                    },
                  ] as any,
                },
              ],
              outcomes: {},
              storylets: {
                victory: {
                  id: 'sv',
                  name: 'Victory',
                  triggerOutcome: 'victory',
                  tone: 'triumphant',
                  narrativeFunction: 'Aftermath',
                  startingBeatId: 'sv-1',
                  consequences: [],
                  beats: [
                    {
                      id: 'sv-1',
                      text: 'Aftermath',
                      image: 'generated-stories/story-1/storylet.jpg',
                    },
                  ],
                },
              },
            } as any,
          },
        ],
      },
    ],
  };
}

describe('storyLibrary', () => {
  it('creates a lightweight catalog entry', () => {
    const story = createStory();
    const entry = createStoryCatalogEntry(story, { outputDir: 'generated-stories/story-1/' });

    expect(entry.id).toBe('story-1');
    expect(entry.episodeCount).toBe(1);
    expect(entry.episodes).toHaveLength(1);
    expect(entry.episodes[0].title).toBe('Episode 1');
    expect(entry.outputDir).toBe('generated-stories/story-1/');
  });

  it('normalizes generated story media urls through the proxy host', () => {
    const story = createStory();
    const normalized = normalizeStoryMediaUrls(story);

    expect(normalized.coverImage).toBe('http://localhost:3001/generated-stories/story-1/cover.jpg');
    expect(normalized.episodes[0].coverImage).toBe('http://localhost:3001/generated-stories/story-1/episode-1.jpg');
    expect(normalized.episodes[0].scenes[0].backgroundImage).toBe('http://localhost:3001/generated-stories/story-1/scene-1.jpg');
    expect(normalized.episodes[0].scenes[0].beats[0].image).toBe('http://localhost:3001/generated-stories/story-1/beat-1.jpg');
    expect(normalized.episodes[0].scenes[0].encounter?.phases[0].situationImage).toBe(
      'http://localhost:3001/generated-stories/story-1/encounter-phase.jpg'
    );
    expect((normalized.episodes[0].scenes[0].encounter?.phases[0].beats[0] as any).choices[0].outcomes.success.outcomeImage).toBe(
      'http://localhost:3001/generated-stories/story-1/encounter-success.jpg'
    );
    expect((normalized.episodes[0].scenes[0].encounter?.storylets?.victory?.beats[0] as any).image).toBe(
      'http://localhost:3001/generated-stories/story-1/storylet.jpg'
    );
  });
});
