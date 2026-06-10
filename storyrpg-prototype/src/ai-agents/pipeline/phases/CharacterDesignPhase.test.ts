import { describe, expect, it, vi } from 'vitest';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

import { CharacterDesignPhase, CharacterDesignPhaseDeps } from './CharacterDesignPhase';
import { PipelineError } from '../errors';
import type { PipelineEvent } from '../events';
import type { PipelineContext } from './index';

function makeBible(): any {
  return { characters: [{ id: 'hero', name: 'Hero' }, { id: 'npc-1', name: 'Mara' }] };
}

function makeDeps(overrides: Partial<CharacterDesignPhaseDeps> = {}): CharacterDesignPhaseDeps {
  return {
    characterDesigner: { execute: vi.fn(async () => ({ success: true, data: makeBible() })) } as any,
    cachedPipelineMemory: null,
    ...overrides,
  };
}

function makeBrief(): any {
  return {
    story: { title: 'Test Story', genre: 'fantasy', tone: 'hopeful', themes: ['trust'] },
    episode: { number: 1 },
    protagonist: { id: 'hero', name: 'Hero', description: 'a hero' },
    npcs: [
      { id: 'npc-1', name: 'Mara', role: 'ally', description: 'a friend', importance: 'major' },
      { id: 'hero', name: 'Hero', role: 'protagonist', description: 'duplicate id', importance: 'major' },
      { id: 'npc-2', name: 'HERO', role: 'villain', description: 'duplicate name', importance: 'minor' },
    ],
    world: { premise: 'a world' },
  };
}

function makeContext(events: PipelineEvent[]): PipelineContext {
  return {
    config: { validation: { enabled: true } } as any,
    emit: (event) => events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
  } as PipelineContext;
}

describe('CharacterDesignPhase', () => {
  it('deduplicates protagonist-colliding NPCs and returns the bible', async () => {
    const execute = vi.fn(async () => ({ success: true, data: makeBible() }));
    const deps = makeDeps({ characterDesigner: { execute } as any });
    const events: PipelineEvent[] = [];

    const bible = await new CharacterDesignPhase(deps).run(
      makeBrief(), { worldRules: ['rule'], customs: [] } as any, makeContext(events),
    );

    expect(bible.characters).toHaveLength(2);
    const input = (execute.mock.calls[0] as unknown[])[0] as any;
    // protagonist + npc-1 only; the id and name collisions are filtered
    expect(input.charactersToCreate.map((c: any) => c.id)).toEqual(['hero', 'npc-1']);
    expect(input.charactersToCreate[0].role).toBe('protagonist');
    expect(events.some(e => e.type === 'agent_complete'
      && (e as any).message === 'Created 2 character profiles')).toBe(true);
  });

  it('demotes a non-player protagonist-roled profile to ally (single-protagonist invariant)', async () => {
    // G12 endsong: the love-interest co-lead came back role:'protagonist'
    // alongside the real player character, breaking every role-keyed consumer.
    const bible = {
      characters: [
        { id: 'hero', name: 'Hero', role: 'ally' }, // designer mislabeled the player too
        { id: 'char-aethavyr-truesong', name: 'Aethavyr Truesong', role: 'protagonist' },
        { id: 'npc-1', name: 'Mara', role: 'ally' },
      ],
    };
    const deps = makeDeps({
      characterDesigner: { execute: vi.fn(async () => ({ success: true, data: bible })) } as any,
    });
    const events: PipelineEvent[] = [];

    const out = await new CharacterDesignPhase(deps).run(
      makeBrief(), { worldRules: [], customs: [] } as any, makeContext(events),
    );

    const byId = Object.fromEntries(out.characters.map((c: any) => [c.id, c.role]));
    expect(byId['hero']).toBe('protagonist');                  // player re-asserted
    expect(byId['char-aethavyr-truesong']).toBe('ally');       // co-lead demoted
    expect(byId['npc-1']).toBe('ally');                        // untouched
    expect(events.some(e => e.type === 'warning'
      && /Demoted 1 non-player 'protagonist'/.test((e as any).message))).toBe(true);
  });

  it('throws PipelineError when the designer fails', async () => {
    const deps = makeDeps({
      characterDesigner: { execute: vi.fn(async () => ({ success: false, error: 'no parse' })) } as any,
    });

    await expect(
      new CharacterDesignPhase(deps).run(makeBrief(), { worldRules: [], customs: [] } as any, makeContext([])),
    ).rejects.toBeInstanceOf(PipelineError);
  });
});
