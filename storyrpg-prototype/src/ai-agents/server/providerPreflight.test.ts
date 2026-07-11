import { describe, expect, it, vi } from 'vitest';
import { PipelineError } from '../pipeline/errors';
import { narrativeProviderPreflight, validateNarrativeJobContract } from './providerPreflight';

describe('narrativeProviderPreflight', () => {
  it('deduplicates Gemini model checks and validates before generation', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ name: 'models/gemini-2.5-pro' }), { status: 200 }));
    const result = await narrativeProviderPreflight({
      agents: {
        architect: { provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'key' },
        writer: { provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'key' },
      },
      qualityCouncilEnabled: false,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.checked).toEqual([{ provider: 'gemini', model: 'gemini-2.5-pro' }]);
  });

  it('blocks missing credentials as a non-retryable settings defect', async () => {
    await expect(narrativeProviderPreflight({
      agents: { writer: { provider: 'gemini', model: 'gemini-2.5-pro' } },
      qualityCouncilEnabled: false,
    })).rejects.toMatchObject({
      code: 'provider_configuration_invalid',
      ownerStage: 'provider',
      retryClass: 'none',
    });
  });

  it('blocks invalid keys or missing models with typed failure ownership', async () => {
    const fetchImpl = vi.fn(async () => new Response('API key not valid', { status: 400 }));
    let failure: unknown;
    try {
      await narrativeProviderPreflight({
        agents: { writer: { provider: 'gemini', model: 'gemini-missing', apiKey: 'bad' } },
        qualityCouncilEnabled: false,
        fetchImpl,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PipelineError);
    expect(failure).toMatchObject({ code: 'provider_model_unavailable', retryClass: 'none', repairTarget: 'job-settings' });
  });

  it('rejects council routes when Story Council is disabled', async () => {
    await expect(narrativeProviderPreflight({
      agents: {
        writer: { provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'key' },
        qualityCouncilFinal: { provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'key' },
      },
      qualityCouncilEnabled: false,
      fetchImpl: vi.fn(async () => new Response('{}', { status: 200 })),
    })).rejects.toMatchObject({ code: 'provider_configuration_invalid' });
  });

  it('rejects a Gemini-only job before provider calls when a route drifts', () => {
    expect(() => validateNarrativeJobContract({
      agents: {
        architect: { provider: 'gemini', model: 'gemini-2.5-pro' },
        writer: { provider: 'anthropic', model: 'claude-sonnet' },
      },
    }, { geminiOnly: true, textOnly: true, qualityCouncilEnabled: false })).toThrow(/non-Gemini/i);
  });

  it('rejects media-enabled text-only jobs and council drift as immutable config defects', () => {
    expect(() => validateNarrativeJobContract({ imageGen: { enabled: true }, agents: {} }, { textOnly: true })).toThrow(/Text-only/i);
    expect(() => validateNarrativeJobContract({ qualityCouncil: { enabled: false }, agents: { qualityCouncilFinal: {} } }, { qualityCouncilEnabled: false })).toThrow(/council routes/i);
  });
});
