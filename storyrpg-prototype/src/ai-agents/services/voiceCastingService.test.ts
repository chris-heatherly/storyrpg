import { describe, expect, it } from 'vitest';
import { voiceCastingService } from './voiceCastingService';

describe('voiceCastingService', () => {
  it('casts Gemini voices from the local TTS voice catalog', async () => {
    voiceCastingService.setProvider('gemini');
    const cast = await voiceCastingService.castVoices({
      protagonist: { id: 'hero' },
      characters: [
        {
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          pronouns: 'she/her',
          description: 'A warm but fierce young leader.',
          traits: ['warm', 'fierce'],
        },
        {
          id: 'mentor',
          name: 'Orin',
          role: 'mentor',
          pronouns: 'he/him',
          description: 'An elderly wise scholar with a measured voice.',
          traits: ['wise'],
        },
      ],
    } as any);

    expect(cast.provider).toBe('gemini');
    expect(cast.narrator.provider).toBe('gemini');
    expect(cast.characters).toHaveLength(2);
    expect(cast.characters.every((assignment) => assignment.provider === 'gemini')).toBe(true);
    expect(cast.totalVoicesAvailable).toBeGreaterThanOrEqual(10);
  });
});
