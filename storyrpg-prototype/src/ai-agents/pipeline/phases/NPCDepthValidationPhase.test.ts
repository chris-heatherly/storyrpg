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

import { NPCDepthValidationPhase, NPCDepthValidationPhaseDeps } from './NPCDepthValidationPhase';
import { ValidationError } from '../../../types/validation';
import type { PipelineEvent } from '../events';
import type { PipelineContext } from './index';

function makeDeps(overrides: Partial<NPCDepthValidationPhaseDeps> = {}): NPCDepthValidationPhaseDeps {
  return {
    npcDepthValidator: { validateCast: vi.fn(async () => ({ passed: true, issues: [] })) } as any,
    rerunCharacterDesign: vi.fn(async () => ({ characters: [{ id: 'npc-1', name: 'Mara Fixed' }] }) as any),
    ...overrides,
  };
}

function makeBrief(): any {
  return {
    story: { title: 'Test Story' },
    protagonist: { id: 'hero', name: 'Hero' },
    userPrompt: 'base prompt',
  };
}

function makeContext(events: PipelineEvent[], mode = 'advisory'): PipelineContext {
  return {
    config: { validation: { enabled: true, mode, rules: { npcDepth: { enabled: true } } } } as any,
    emit: (event) => events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
  } as PipelineContext;
}

const failedValidation = (count: number) => ({
  passed: false,
  issues: Array.from({ length: count }, (_, i) => ({
    level: 'error',
    message: `npc-${i} missing trust dimension`,
    suggestion: 'initialize it',
  })),
});

describe('NPCDepthValidationPhase', () => {
  it('passes cleanly without retrying', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];

    await new NPCDepthValidationPhase(deps).run(
      makeBrief(), {} as any, { characters: [] } as any, makeContext(events),
    );

    expect(deps.rerunCharacterDesign).not.toHaveBeenCalled();
    expect(events.some(e => e.type === 'phase_complete'
      && (e as any).message === 'NPC depth validation passed')).toBe(true);
  });

  it('skips entirely when the rule is disabled', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const context = {
      config: { validation: { enabled: true, mode: 'advisory', rules: { npcDepth: { enabled: false } } } } as any,
      emit: (event: any) => events.push(event),
      addCheckpoint: vi.fn(),
    } as unknown as PipelineContext;

    await new NPCDepthValidationPhase(deps).run(makeBrief(), {} as any, { characters: [] } as any, context);

    expect((deps.npcDepthValidator.validateCast as any)).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('adopts an improved retry bible in place with depth feedback in the prompt', async () => {
    const validateCast = vi.fn(async () => ({ passed: true, issues: [] }));
    validateCast.mockResolvedValueOnce(failedValidation(2) as any);
    const deps = makeDeps({ npcDepthValidator: { validateCast } as any });
    const characterBible: any = { characters: [{ id: 'npc-1', name: 'Mara' }] };
    const events: PipelineEvent[] = [];

    await new NPCDepthValidationPhase(deps).run(makeBrief(), {} as any, characterBible, makeContext(events));

    const retryBrief = (deps.rerunCharacterDesign as any).mock.calls[0][0];
    expect(retryBrief.userPrompt).toContain('CRITICAL NPC DEPTH FIXES REQUIRED');
    expect(retryBrief.userPrompt).toContain('missing trust dimension');
    // Adopted by Object.assign onto the shared reference
    expect(characterBible.characters[0].name).toBe('Mara Fixed');
    expect(events.some(e => e.type === 'phase_complete'
      && (e as any).message === 'NPC depth validation passed after repair')).toBe(true);
  });

  it('keeps the original bible when the retry does not improve', async () => {
    const validateCast = vi.fn(async () => failedValidation(2) as any);
    const deps = makeDeps({ npcDepthValidator: { validateCast } as any });
    const characterBible: any = { characters: [{ id: 'npc-1', name: 'Mara' }] };
    const events: PipelineEvent[] = [];

    await new NPCDepthValidationPhase(deps).run(makeBrief(), {} as any, characterBible, makeContext(events));

    expect(characterBible.characters[0].name).toBe('Mara');
    expect(events.some(e => e.type === 'checkpoint'
      && (e as any).message.includes('issues remain (advisory mode)'))).toBe(true);
  });

  it('throws ValidationError on unresolved errors in strict mode', async () => {
    const validateCast = vi.fn(async () => failedValidation(1) as any);
    const deps = makeDeps({ npcDepthValidator: { validateCast } as any });

    await expect(
      new NPCDepthValidationPhase(deps).run(
        makeBrief(), {} as any, { characters: [] } as any, makeContext([], 'strict'),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
