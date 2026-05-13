import { describe, it, expect } from 'vitest';
import { NPCDepthValidator } from './NPCDepthValidator';

describe('NPCDepthValidator', () => {
  describe('inferTier', () => {
    const validator = new NPCDepthValidator();

    it('maps major/antagonist/ally roles to core tier', () => {
      expect(validator.inferTier({ importance: 'major' })).toBe('core');
      expect(validator.inferTier({ role: 'antagonist' })).toBe('core');
      expect(validator.inferTier({ role: 'ally' })).toBe('core');
    });

    it('maps supporting importance and neutral role to supporting tier', () => {
      expect(validator.inferTier({ importance: 'supporting' })).toBe('supporting');
      expect(validator.inferTier({ role: 'neutral' })).toBe('supporting');
    });

    it('defaults unknown shapes to background tier', () => {
      expect(validator.inferTier({})).toBe('background');
      expect(validator.inferTier({ importance: 'minor' })).toBe('background');
    });
  });

  describe('getMissingDimensions', () => {
    const validator = new NPCDepthValidator();

    it('returns all missing dimensions for core NPCs', () => {
      expect(validator.getMissingDimensions('core', ['trust'])).toEqual([
        'affection',
        'respect',
        'fear',
      ]);
    });

    it('returns empty when a supporting NPC already has enough dimensions', () => {
      expect(
        validator.getMissingDimensions('supporting', ['trust', 'affection'])
      ).toEqual([]);
    });

    it('suggests additional dimensions when supporting NPC is under the threshold', () => {
      const missing = validator.getMissingDimensions('supporting', ['trust']);
      expect(missing).toHaveLength(1);
      expect(missing).not.toContain('trust');
    });
  });

  describe('validate', () => {
    it('emits an issue for a core NPC that is missing dimensions', async () => {
      const validator = new NPCDepthValidator({ level: 'error' });
      const result = await validator.validate({
        npcs: [
          {
            id: 'npc1',
            name: 'Reyna',
            tier: 'core',
            relationshipDimensions: ['trust', 'affection'],
          },
        ],
      });

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].location?.npcId).toBe('npc1');
      expect(result.passed).toBe(false);
    });

    it('passes when every NPC meets their tier requirements', async () => {
      const validator = new NPCDepthValidator();
      const result = await validator.validate({
        npcs: [
          {
            id: 'core',
            name: 'Main',
            tier: 'core',
            relationshipDimensions: ['trust', 'affection', 'respect', 'fear'],
          },
          {
            id: 'support',
            name: 'Sidekick',
            tier: 'supporting',
            relationshipDimensions: ['trust', 'respect'],
          },
          {
            id: 'bg',
            name: 'Passerby',
            tier: 'background',
            relationshipDimensions: ['trust'],
          },
        ],
      });

      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('validateCast', () => {
    it('filters out the protagonist', async () => {
      const validator = new NPCDepthValidator();
      const result = await validator.validateCast([
        { id: 'hero', name: 'Hero', role: 'protagonist' },
      ]);
      expect(result.npcAnalysis.size).toBe(0);
      expect(result.passed).toBe(true);
    });

    it('maps initialStats to relationship dimensions', async () => {
      const validator = new NPCDepthValidator();
      const result = await validator.validateCast([
        {
          id: 'npc',
          name: 'Guide',
          role: 'ally',
          initialStats: { trust: 1, affection: 1, respect: 1, fear: 1 },
        },
      ]);
      const entry = result.npcAnalysis.get('npc')!;
      expect(entry.actualDimensions.sort()).toEqual(
        ['affection', 'fear', 'respect', 'trust'].sort()
      );
      expect(entry.missingDimensions).toEqual([]);
    });
  });

  describe('getSummary', () => {
    it('tallies valid vs total NPCs per tier', async () => {
      const validator = new NPCDepthValidator();
      const result = await validator.validate({
        npcs: [
          {
            id: 'core1',
            name: 'A',
            tier: 'core',
            relationshipDimensions: ['trust', 'affection', 'respect', 'fear'],
          },
          {
            id: 'core2',
            name: 'B',
            tier: 'core',
            relationshipDimensions: ['trust'],
          },
          {
            id: 'support',
            name: 'C',
            tier: 'supporting',
            relationshipDimensions: ['trust', 'respect'],
          },
        ],
      });

      const summary = validator.getSummary(result);
      expect(summary).toMatchObject({
        coreNPCsTotal: 2,
        coreNPCsValid: 1,
        supportingNPCsTotal: 1,
        supportingNPCsValid: 1,
        backgroundNPCsTotal: 0,
      });
    });
  });
});
