import { describe, it, expect } from 'vitest';
import { repairPropIntroduction, repairAndRevalidatePropIntroduction } from './propIntroductionRepair';

const roster = [
  { id: 'char-mihaela-mika-drgan', name: "Mihaela 'Mika' Drăgan" },
  { id: 'char-carmen-vidal', name: 'Carmen Vidal' },
];

describe('repairPropIntroduction', () => {
  it('resolves a raw label to the canonical cast id in place', () => {
    const scenes = [{ sceneId: 's1', referencedEntityIds: ['mika'] }];
    const { fixedCount } = repairPropIntroduction(scenes, roster);
    expect(fixedCount).toBe(1);
    expect(scenes[0].referencedEntityIds[0]).toBe('char-mihaela-mika-drgan');
  });

  it('leaves an already-canonical id untouched', () => {
    const scenes = [{ sceneId: 's1', referencedEntityIds: ['char-carmen-vidal'] }];
    const { fixedCount } = repairPropIntroduction(scenes, roster);
    expect(fixedCount).toBe(0);
    expect(scenes[0].referencedEntityIds[0]).toBe('char-carmen-vidal');
  });

  it('does NOT drop or rewrite a genuinely-unknown reference (must stay an error)', () => {
    const scenes = [{ sceneId: 's1', referencedEntityIds: ['the-ghost-of-nobody'] }];
    const { fixedCount } = repairPropIntroduction(scenes, roster);
    expect(fixedCount).toBe(0);
    expect(scenes[0].referencedEntityIds).toEqual(['the-ghost-of-nobody']);
  });

  it('resolves by full-name variant too', () => {
    const scenes = [{ sceneId: 's1', referencedEntityIds: ['Carmen Vidal'] }];
    const { fixedCount } = repairPropIntroduction(scenes, roster);
    expect(fixedCount).toBe(1);
    expect(scenes[0].referencedEntityIds[0]).toBe('char-carmen-vidal');
  });

  it('no-ops on an empty roster', () => {
    const scenes = [{ sceneId: 's1', referencedEntityIds: ['mika'] }];
    const { fixedCount } = repairPropIntroduction(scenes, []);
    expect(fixedCount).toBe(0);
  });

  it('emits a ledger record only when something was resolved', () => {
    expect(repairPropIntroduction([{ sceneId: 's', referencedEntityIds: ['mika'] }], roster).records).toHaveLength(1);
    expect(repairPropIntroduction([{ sceneId: 's', referencedEntityIds: ['char-carmen-vidal'] }], roster).records).toHaveLength(0);
  });
});

describe('repairAndRevalidatePropIntroduction (loop)', () => {
  it('resolves a label-variant reference and re-validates to a pass', async () => {
    const scenes = [{ sceneId: 's1', sceneName: 'Opening', referencedEntityIds: ['carmen_vidal'] }];
    const out = await repairAndRevalidatePropIntroduction(scenes, roster);
    expect(out.passed).toBe(true);
    expect(out.fixedCount).toBe(1);
    expect(scenes[0].referencedEntityIds[0]).toBe('char-carmen-vidal');
  });

  it('still fails (does not pass) when a reference is genuinely unknown', async () => {
    const scenes = [{ sceneId: 's1', sceneName: 'Opening', referencedEntityIds: ['ghost-of-nobody'] }];
    const out = await repairAndRevalidatePropIntroduction(scenes, roster);
    expect(out.passed).toBe(false);
    expect(out.fixedCount).toBe(0);
  });

  it('passes immediately (no repair) when references are already canonical', async () => {
    const scenes = [{ sceneId: 's1', sceneName: 'Opening', referencedEntityIds: ['char-carmen-vidal'] }];
    const out = await repairAndRevalidatePropIntroduction(scenes, roster);
    expect(out.passed).toBe(true);
    expect(out.fixedCount).toBe(0);
  });
});
