import { describe, expect, it } from 'vitest';
import {
  buildRealizedEpisodeSoFarSummary,
  buildRealizedSceneSummary,
  buildRealizedTimelineHandoff,
  realizedClosingExcerpt,
  resolveGraphPredecessor,
} from './realizedContext';
import type { SceneContent } from '../agents/SceneWriter';
import type { SceneBlueprint } from '../agents/StoryArchitect';

function blueprint(id: string, leadsTo: string[], overrides: Partial<SceneBlueprint> = {}): SceneBlueprint {
  return {
    id,
    name: `Scene ${id}`,
    description: `Description of ${id}`,
    location: `loc-${id}`,
    mood: 'tense',
    purpose: 'transition',
    npcsPresent: [],
    leadsTo,
    ...overrides,
  } as unknown as SceneBlueprint;
}

function content(sceneId: string, beatTexts: string[], overrides: Partial<SceneContent> = {}): SceneContent {
  return {
    sceneId,
    sceneName: `Scene ${sceneId}`,
    beats: beatTexts.map((text, i) => ({ id: `${sceneId}-b${i + 1}`, text })),
    startingBeatId: `${sceneId}-b1`,
    moodProgression: [],
    charactersInvolved: [],
    keyMoments: [],
    continuityNotes: [],
    ...overrides,
  } as SceneContent;
}

describe('resolveGraphPredecessor', () => {
  // Branch layout: s1 → (s2a | s2b) → s3. Generation order is array order,
  // so sceneContents[i-1] for s2b would be its SIBLING s2a — the bug R2 fixes.
  const scenes = [
    blueprint('s1', ['s2a', 's2b']),
    blueprint('s2a', ['s3']),
    blueprint('s2b', ['s3']),
    blueprint('s3', []),
  ];

  it('resolves the branch SOURCE for a scene inside a branch, not the generated sibling', () => {
    const generated = new Map([
      ['s1', content('s1', ['The door opens.'])],
      ['s2a', content('s2a', ['You go left.'])],
    ]);
    const predecessor = resolveGraphPredecessor(scenes, 's2b', (id) => generated.get(id));
    expect(predecessor?.blueprint.id).toBe('s1');
    expect(predecessor?.incomingCount).toBe(1);
  });

  it('returns undefined for the opening scene', () => {
    expect(resolveGraphPredecessor(scenes, 's1', () => undefined)).toBeUndefined();
  });

  it('returns undefined when no graph predecessor has been generated yet', () => {
    expect(resolveGraphPredecessor(scenes, 's2b', () => undefined)).toBeUndefined();
  });

  it('reports all realized incoming branches at a reconvergence point and picks the closest-before deterministically', () => {
    const generated = new Map([
      ['s1', content('s1', ['The door opens.'])],
      ['s2a', content('s2a', ['You go left.'])],
      ['s2b', content('s2b', ['You go right.'])],
    ]);
    const predecessor = resolveGraphPredecessor(scenes, 's3', (id) => generated.get(id));
    expect(predecessor?.blueprint.id).toBe('s2b');
    expect(predecessor?.incomingCount).toBe(2);
  });
});

describe('realizedClosingExcerpt', () => {
  it('keeps the TAIL of the last beats (how the scene ended)', () => {
    const scene = content('s1', [
      'Opening beat that should not appear.',
      `${'filler '.repeat(100)}`,
      'Mika presses the key card into your hand and walks away.',
    ]);
    const excerpt = realizedClosingExcerpt(scene, 120);
    expect(excerpt.length).toBeLessThanOrEqual(120);
    expect(excerpt).toContain('walks away.');
    expect(excerpt).not.toContain('Opening beat');
  });

  it('returns empty for a scene with no prose', () => {
    expect(realizedClosingExcerpt(content('s1', []))).toBe('');
  });
});

describe('buildRealizedSceneSummary', () => {
  it('combines realized name, location/time anchors, key moments, and the closing prose', () => {
    const scene = content('s1', ['You take the card.'], {
      sceneName: 'Club Door',
      keyMoments: ['Mika offers the key card'],
      settingContext: { locationId: 'loc-valescu-club', locationName: 'Vâlcescu Club' } as SceneContent['settingContext'],
    });
    const summary = buildRealizedSceneSummary(scene, blueprint('s1', [], { timeOfDay: 'night' }));
    expect(summary).toContain('Previous scene (as written): Club Door');
    expect(summary).toContain('Vâlcescu Club');
    expect(summary).toContain('night');
    expect(summary).toContain('Key moments: Mika offers the key card');
    expect(summary).toContain('Closing prose: "You take the card."');
  });

  it('prettifies a raw location id when no locationName was realized', () => {
    const scene = content('s1', ['You wait.'], { locationId: 'loc-valescu-club' });
    expect(buildRealizedSceneSummary(scene)).toContain('[Valescu Club]');
  });
});

describe('buildRealizedEpisodeSoFarSummary', () => {
  it('appends the realized closing excerpt for generated scenes and falls back to the blueprint blurb otherwise', () => {
    const scenes = [
      blueprint('s1', ['s2'], { description: 'Kylie arrives at the club.' }),
      blueprint('s2', ['s3'], { description: 'Mika tests her at the door.' }),
    ];
    const generated = new Map([
      ['s1', content('s1', ['The queue parts. Mika waves you in.'])],
    ]);
    const summary = buildRealizedEpisodeSoFarSummary(scenes, (id) => generated.get(id));
    expect(summary).toContain('as written, it ends: "The queue parts. Mika waves you in."');
    expect(summary).toContain('2. Scene s2');
    expect(summary).toContain('Mika tests her at the door.');
    expect(summary?.split('\n')[1]).not.toContain('as written');
  });

  it('returns undefined when nothing precedes the scene', () => {
    expect(buildRealizedEpisodeSoFarSummary([], () => undefined)).toBeUndefined();
  });
});

describe('buildRealizedTimelineHandoff', () => {
  const scenes = [
    blueprint('s1', ['s2a', 's2b'], { location: 'loc-club', timeOfDay: 'night' }),
    blueprint('s2a', ['s3'], { location: 'loc-alley', timeOfDay: 'night' }),
    blueprint('s2b', ['s3'], { location: 'loc-rooftop', timeOfDay: 'dawn' }),
  ];

  it('hands off from the explicit GRAPH predecessor instead of array order', () => {
    const handoff = buildRealizedTimelineHandoff(scenes, scenes[2], scenes[0]);
    expect(handoff?.previous?.sceneName).toBe('Scene s1');
    expect(handoff?.previous?.location).toBe('loc-club');
    expect(handoff?.locationChanged).toBe(true);
    expect(handoff?.timeChanged).toBe(true);
  });

  it('falls back to blueprint-array order when no predecessor is resolvable', () => {
    const handoff = buildRealizedTimelineHandoff(scenes, scenes[2], undefined);
    expect(handoff?.previous?.sceneName).toBe('Scene s2a');
  });

  it('returns undefined for the first scene with no predecessor', () => {
    expect(buildRealizedTimelineHandoff(scenes, scenes[0], undefined)).toBeUndefined();
  });
});
