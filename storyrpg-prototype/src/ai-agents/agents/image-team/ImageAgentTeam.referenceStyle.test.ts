import { describe, expect, it, vi } from 'vitest';

import { ImageAgentTeam, type CharacterReferenceSheet } from './ImageAgentTeam';

const agentConfig = {
  provider: 'anthropic' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1000,
  temperature: 0.2,
};

const rawSeasonStyle =
  'Fashionable anime art style, elegant contemporary aesthetic, trend-forward wardrobe design, high-fashion editorial sensibility, glossy magazine-like finish, low visual noise, no photorealism.';

function makeSheet(
  promptText = 'Mika Kuroda, front view, reference sheet style',
  negativePrompt = 'background',
): CharacterReferenceSheet {
  return {
    characterId: 'char-mika-kuroda',
    characterName: 'Mika Kuroda',
    views: [
      {
        viewType: 'front',
        viewName: 'front',
        purpose: 'identity',
        prompt: {
          prompt: promptText,
          negativePrompt,
          aspectRatio: '1:1',
        },
      } as any,
    ],
    visualAnchors: ['blunt black bob', 'oversized black jacket'],
    colorPalette: ['black', 'bone'],
    silhouetteNotes: 'structured',
    consistencyChecklist: [],
  };
}

describe('ImageAgentTeam reference style contract', () => {
  it('locks no-user-ref individual views to the full raw season style', async () => {
    const team = new ImageAgentTeam(agentConfig, rawSeasonStyle);
    const generateImage = vi.fn(async (prompt, identifier, metadata, referenceImages) => ({
      prompt,
      identifier,
      metadata,
      referenceImages,
      imageUrl: 'mock://ref.png',
    }));

    await team.generateIndividualViewImages(makeSheet(), { generateImage });

    const prompt = generateImage.mock.calls[0][0];
    expect(prompt.style).toBe(rawSeasonStyle);
    expect(prompt.prompt).toContain(`Art style: ${rawSeasonStyle}`);
    expect(prompt.prompt).toContain('clean full-body character identity reference');
    expect(prompt.prompt).not.toMatch(/\breference sheet style\b/i);
    expect(prompt.negativePrompt).not.toMatch(/\breference sheet style\b/i);
  });

  it('removes generic reference-sheet wording from generated negative prompts before preflight', async () => {
    const team = new ImageAgentTeam(agentConfig, rawSeasonStyle);
    const generateImage = vi.fn(async (prompt, identifier, metadata, referenceImages) => ({
      prompt,
      identifier,
      metadata,
      referenceImages,
      imageUrl: 'mock://ref.png',
    }));

    await team.generateIndividualViewImages(
      makeSheet('Mika Kuroda, front view', 'background, reference sheet style, labels'),
      { generateImage },
    );

    const prompt = generateImage.mock.calls[0][0];
    expect(prompt.negativePrompt).toContain('clean full-body character identity reference');
    expect(prompt.negativePrompt).not.toMatch(/\breference sheet style\b/i);
  });

  it('blocks no-user-ref character refs when no season style reached the runtime', async () => {
    const team = new ImageAgentTeam(agentConfig);
    const generateImage = vi.fn();

    await expect(
      team.generateIndividualViewImages(makeSheet('Mika Kuroda, front view'), { generateImage }),
    ).rejects.toThrow(/missing season style/);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('passes user visual refs while still retaining style context', async () => {
    const team = new ImageAgentTeam(agentConfig, rawSeasonStyle);
    const generateImage = vi.fn(async (prompt, identifier, metadata, referenceImages) => ({
      prompt,
      identifier,
      metadata,
      referenceImages,
      imageUrl: 'mock://ref.png',
    }));
    const userRef = { data: Buffer.from('visual-ref').toString('base64'), mimeType: 'image/png' };

    await team.generateIndividualViewImages(makeSheet('Mika Kuroda, front view'), { generateImage }, undefined, [userRef]);

    const prompt = generateImage.mock.calls[0][0];
    const refs = generateImage.mock.calls[0][3];
    expect(prompt.style).toBe(rawSeasonStyle);
    expect(prompt.prompt).toContain(`Art style: ${rawSeasonStyle}`);
    expect(refs).toHaveLength(1);
    expect(refs[0].role).toBe('user-provided-character-reference');
  });
});
