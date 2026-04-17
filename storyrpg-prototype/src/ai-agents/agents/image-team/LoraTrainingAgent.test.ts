import { describe, expect, it, vi } from 'vitest';

import type { LoraTrainingSettings } from '../../config';
import type { ArtStyleProfile } from '../../images/artStyleProfile';
import { LoraRegistry, type LoraRegistryIO } from '../../images/loraRegistry';
import type {
  LoraArtifact,
  LoraJobHandle,
  LoraJobStatus,
  LoraTrainerAdapter,
  LoraTrainingRequest,
} from '../../services/lora-training/LoraTrainerAdapter';
import {
  LoraTrainingAgent,
  type CharacterTrainingCandidate,
  type StyleTrainingCandidate,
} from './LoraTrainingAgent';

function makeMemoryIO(): LoraRegistryIO {
  const files = new Map<string, string>();
  return {
    async ensureDir() {},
    async writeBytes(filePath, base64) {
      files.set(filePath, `__bytes__:${base64}`);
    },
    async writeText(filePath, text) {
      files.set(filePath, text);
    },
    async readText(filePath) {
      return files.get(filePath);
    },
    async exists(filePath) {
      return files.has(filePath);
    },
    async listDir(dirPath) {
      const out: string[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(`${dirPath}/`)) continue;
        const rest = key.slice(dirPath.length + 1);
        if (rest.includes('/')) continue;
        out.push(rest);
      }
      return out;
    },
    async remove(filePath) {
      files.delete(filePath);
    },
    joinPath: (base, ...parts) => [base, ...parts].join('/'),
  };
}

function makeSettings(overrides: Partial<LoraTrainingSettings> = {}): LoraTrainingSettings {
  return {
    enabled: true,
    backend: 'kohya',
    characterThresholds: { minRefs: 3, tiers: ['core', 'major', 'supporting'], blockScenes: true },
    styleThresholds: { minEpisodes: 2, forceStyle: false },
    training: { rank: 32, steps: 1500, learningRate: 1e-4 },
    ...overrides,
  };
}

function makeAdapter(
  overrides: Partial<LoraTrainerAdapter> = {},
  options: { statusSequence?: LoraJobStatus[] } = {},
): LoraTrainerAdapter & { calls: { train: LoraTrainingRequest[]; install: LoraArtifact[] } } {
  const trainCalls: LoraTrainingRequest[] = [];
  const installCalls: LoraArtifact[] = [];
  const statusSequence = options.statusSequence ?? [
    { state: 'running', progress: 0.5 },
    { state: 'succeeded', progress: 1 },
  ];
  let idx = 0;
  const adapter: LoraTrainerAdapter = {
    id: 'mock-kohya',
    async train(req) {
      trainCalls.push(req);
      return {
        jobId: 'job-1',
        storyId: req.storyId,
        name: req.name,
        kind: req.kind,
        fingerprint: req.fingerprint,
      } as LoraJobHandle;
    },
    async pollStatus() {
      const status = statusSequence[Math.min(idx, statusSequence.length - 1)];
      idx++;
      return status;
    },
    async fetchArtifact(handle) {
      return {
        name: handle.name,
        kind: handle.kind,
        fingerprint: handle.fingerprint,
        storyId: handle.storyId,
        data: 'QUJDRA==',
      };
    },
    async installArtifact(artifact) {
      installCalls.push(artifact);
    },
    async preflight() {
      return { ok: true };
    },
    ...overrides,
  };
  return Object.assign(adapter, { calls: { train: trainCalls, install: installCalls } });
}

const STYLE: ArtStyleProfile = {
  name: 'graphic novel ink',
  family: 'comic',
  renderingTechnique: 'uniform line weight inked panels',
  colorPhilosophy: 'flat primaries',
  lightingApproach: 'graphic color-as-light',
  lineWeight: 'uniform clean line',
  compositionStyle: 'tableau clarity',
  moodRange: 'adventurous',
  acceptableDeviations: [],
  genreNegatives: [],
  positiveVocabulary: ['ligne claire', 'clean line'],
  inappropriateVocabulary: [],
};

function makeCharacterCandidate(
  overrides: Partial<CharacterTrainingCandidate> = {},
): CharacterTrainingCandidate {
  return {
    character: {
      id: 'hero',
      name: 'Hero',
      role: 'major',
      tier: 'major',
      physicalDescription: 'tall with auburn hair',
      distinctiveFeatures: ['crescent scar'],
      typicalAttire: 'leather long coat',
    },
    identityFingerprint: 'ident-1',
    references: [
      { viewKey: 'front', imagePath: '/tmp/hero/front.png' },
      { viewKey: 'three_quarter', imagePath: '/tmp/hero/3q.png' },
      { viewKey: 'profile', imagePath: '/tmp/hero/profile.png' },
    ],
    ...overrides,
  };
}

function makeStyleCandidate(
  overrides: Partial<StyleTrainingCandidate> = {},
): StyleTrainingCandidate {
  return {
    profile: STYLE,
    anchors: [
      { role: 'character', imagePath: '/tmp/style/character.png' },
      { role: 'arcStrip', imagePath: '/tmp/style/arc.png' },
    ],
    anchorHashes: ['hash-char', 'hash-arc'],
    episodeCount: 3,
    ...overrides,
  };
}

function makeAgent(
  settings: LoraTrainingSettings,
  adapter: LoraTrainerAdapter,
  provider: 'stable-diffusion' | 'nano-banana' | 'midapi' = 'stable-diffusion',
) {
  const registry = new LoraRegistry('story-1', '/tmp/story-1/loras', makeMemoryIO());
  return {
    registry,
    agent: new LoraTrainingAgent({
      storyId: 'story-1',
      provider,
      settings,
      adapter,
      registry,
      pollIntervalMs: 0,
      maxPollAttempts: 10,
      sleep: () => Promise.resolve(),
      logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
    }),
  };
}

describe('LoraTrainingAgent.shouldRun', () => {
  it('is false when the subsystem is disabled', () => {
    const { agent } = makeAgent(makeSettings({ enabled: false }), makeAdapter());
    expect(agent.shouldRun()).toBe(false);
  });
  it('is false when backend=disabled', () => {
    const { agent } = makeAgent(makeSettings({ backend: 'disabled' }), makeAdapter());
    expect(agent.shouldRun()).toBe(false);
  });
  it('is false for providers that cannot consume LoRAs', () => {
    const { agent } = makeAgent(makeSettings(), makeAdapter(), 'nano-banana');
    expect(agent.shouldRun()).toBe(false);
  });
  it('is true for stable-diffusion when enabled', () => {
    const { agent } = makeAgent(makeSettings(), makeAdapter());
    expect(agent.shouldRun()).toBe(true);
  });
});

describe('LoraTrainingAgent eligibility', () => {
  it('skips characters with too few refs', () => {
    const { agent } = makeAgent(makeSettings({ characterThresholds: { minRefs: 4, tiers: ['core', 'major', 'supporting'], blockScenes: true } }), makeAdapter());
    const result = agent.evaluateCharacterEligibility(makeCharacterCandidate());
    expect(result.eligible).toBe(false);
  });
  it('skips characters whose tier is excluded', () => {
    const { agent } = makeAgent(makeSettings({ characterThresholds: { minRefs: 1, tiers: ['core'], blockScenes: true } }), makeAdapter());
    const result = agent.evaluateCharacterEligibility(makeCharacterCandidate());
    expect(result.eligible).toBe(false);
  });
  it('accepts characters meeting thresholds', () => {
    const { agent } = makeAgent(makeSettings(), makeAdapter());
    const result = agent.evaluateCharacterEligibility(makeCharacterCandidate());
    expect(result.eligible).toBe(true);
  });
  it('skips single-episode style candidates unless forceStyle is set', () => {
    const { agent: a1 } = makeAgent(makeSettings(), makeAdapter());
    expect(a1.evaluateStyleEligibility(makeStyleCandidate({ episodeCount: 1 })).eligible).toBe(false);
    const { agent: a2 } = makeAgent(makeSettings({ styleThresholds: { minEpisodes: 2, forceStyle: true } }), makeAdapter());
    expect(a2.evaluateStyleEligibility(makeStyleCandidate({ episodeCount: 1 })).eligible).toBe(true);
  });
});

describe('LoraTrainingAgent.trainAll', () => {
  it('no-ops on providers without LoRA support', async () => {
    const { agent } = makeAgent(makeSettings(), makeAdapter(), 'nano-banana');
    const report = await agent.trainAll([makeCharacterCandidate()], makeStyleCandidate());
    expect(report.ran).toBe(false);
    expect(report.entries[0].outcome).toBe('skipped-provider');
  });

  it('trains a character and a style LoRA and writes records', async () => {
    const adapter = makeAdapter();
    const { agent, registry } = makeAgent(makeSettings(), adapter);
    const report = await agent.trainAll([makeCharacterCandidate()], makeStyleCandidate());
    expect(report.ran).toBe(true);
    expect(report.entries.map((e) => e.outcome)).toEqual(['trained', 'trained']);
    expect(adapter.calls.train).toHaveLength(2);
    expect(adapter.calls.install).toHaveLength(2);
    const snapshot = registry.getSnapshot();
    expect(Object.values(snapshot.records)).toHaveLength(2);
  });

  it('returns cached on the second run with the same fingerprint', async () => {
    const adapter = makeAdapter();
    const { agent } = makeAgent(makeSettings(), adapter);
    await agent.trainAll([makeCharacterCandidate()], undefined);
    const report = await agent.trainAll([makeCharacterCandidate()], undefined);
    expect(report.entries[0].outcome).toBe('cached');
    expect(adapter.calls.train).toHaveLength(1);
  });

  it('marks the entry failed when the adapter submit throws', async () => {
    const adapter = makeAdapter({
      async train() {
        throw new Error('backend down');
      },
    });
    const { agent } = makeAgent(makeSettings(), adapter);
    const report = await agent.trainAll([makeCharacterCandidate()], undefined);
    expect(report.entries[0].outcome).toBe('failed');
    expect(report.entries[0].reason).toMatch(/backend down/);
  });

  it('marks the entry failed when polling ends in failed state', async () => {
    const adapter = makeAdapter(
      {},
      { statusSequence: [{ state: 'running' }, { state: 'failed', error: 'CUDA OOM' }] },
    );
    const { agent } = makeAgent(makeSettings(), adapter);
    const report = await agent.trainAll([makeCharacterCandidate()], undefined);
    expect(report.entries[0].outcome).toBe('failed');
    expect(report.entries[0].reason).toMatch(/CUDA OOM/);
  });

  it('still registers the artifact if install fails', async () => {
    const adapter = makeAdapter({
      async installArtifact() {
        throw new Error('no shared volume');
      },
    });
    const { agent, registry } = makeAgent(makeSettings(), adapter);
    const report = await agent.trainAll([makeCharacterCandidate()], undefined);
    expect(report.entries[0].outcome).toBe('trained');
    expect(Object.keys(registry.getSnapshot().records)).toHaveLength(1);
  });

  it('emits progress events for every lifecycle stage', async () => {
    const events: any[] = [];
    const registry = new LoraRegistry('story-1', '/tmp/story-1/loras', makeMemoryIO());
    const adapter = makeAdapter();
    const agent = new LoraTrainingAgent({
      storyId: 'story-1',
      provider: 'stable-diffusion',
      settings: makeSettings(),
      adapter,
      registry,
      pollIntervalMs: 0,
      maxPollAttempts: 5,
      sleep: () => Promise.resolve(),
      logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
      onProgress: (e) => events.push(e.type),
    });
    await agent.trainAll([makeCharacterCandidate()], undefined);
    expect(events).toContain('start');
    expect(events).toContain('status');
    expect(events).toContain('complete');
  });
});
