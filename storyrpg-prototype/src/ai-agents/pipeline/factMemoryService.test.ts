import { describe, expect, it, vi } from 'vitest';

import { ArtifactMemoryService } from './artifactMemoryService';
import { FactMemoryService } from './factMemoryService';
import type { PipelineMemory } from './pipelineMemory';

describe('FactMemoryService', () => {
  it('extracts and writes granular scene facts from adopted scene artifacts', async () => {
    const writeArtifactSnapshot = vi.fn(async () => undefined);
    const writeFactSnapshot = vi.fn(async () => undefined);
    const memory = { writeArtifactSnapshot, writeFactSnapshot, cognifyDatasets: vi.fn(async () => undefined) } as unknown as PipelineMemory;
    const artifactMemory = new ArtifactMemoryService(memory);
    const factMemory = new FactMemoryService(memory);
    const envelope = await artifactMemory.writeArtifact({
      artifactKind: 'scene-content',
      storyId: 'Bite Me',
      episodeNumber: 2,
      sceneId: 'scene-4',
      lifecycle: 'scene-authoring',
      agentRole: 'SceneWriter',
      characterIds: ['mara-voss'],
      payload: {
        sceneId: 'scene-4',
        sceneName: 'The Alley',
        summary: 'Mara finds the marked door.',
        beats: [
          { id: 'beat-1', text: 'Mara sees the chalk sigil.', residue: 'Mara now knows where Edric went.' },
          { id: 'beat-2', text: 'The lock clicks open.', callback: 'The key from the garden pays off.' },
        ],
      },
    });

    const facts = await factMemory.writeFactsForArtifact(envelope);
    await factMemory.flush();

    expect(facts.map((fact) => fact.factKind)).toEqual(expect.arrayContaining([
      'scene-canon',
      'residue-obligation',
      'callback-obligation',
    ]));
    expect(writeFactSnapshot).toHaveBeenCalled();
    expect((memory.cognifyDatasets as any)).toHaveBeenCalledWith(['storyrpg-run-bite-me'], { background: true });
    expect((writeFactSnapshot.mock.calls[0] as unknown[])[0]).toMatchObject({
      storyId: 'Bite Me',
      runId: 'bite-me',
      episodeNumber: 2,
      sceneId: 'scene-4',
      artifactRefs: [{ artifactKind: 'scene-content', artifactId: envelope.artifactId, contentHash: envelope.contentHash }],
    });
  });

  it('queues fact writes serially in the background without blocking the caller', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writeFactSnapshot = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate;
      inFlight -= 1;
    });
    const memory = {
      writeArtifactSnapshot: vi.fn(async () => undefined),
      writeFactSnapshot,
      cognifyDatasets: vi.fn(async () => undefined),
    } as unknown as PipelineMemory;
    const artifactMemory = new ArtifactMemoryService(memory);
    const factMemory = new FactMemoryService(memory);
    const envelope = await artifactMemory.writeArtifact({
      artifactKind: 'scene-content',
      storyId: 'Bite Me',
      episodeNumber: 1,
      sceneId: 'scene-1',
      lifecycle: 'scene-authoring',
      agentRole: 'SceneWriter',
      payload: {
        sceneId: 'scene-1',
        sceneName: 'Cold Open',
        summary: 'Kylie meets the stranger.',
        beats: [
          { id: 'beat-1', text: 'A knock at the door.', residue: 'Kylie saw the ring.' },
          { id: 'beat-2', text: 'The stranger smiles.', callback: 'The ring from the flyer pays off.' },
        ],
      },
    });

    const facts = await factMemory.writeFactsForArtifact(envelope);

    // Caller returns immediately with extracted facts; writes drain behind it.
    expect(facts.length).toBeGreaterThan(1);
    release();
    await factMemory.flush();
    expect(writeFactSnapshot).toHaveBeenCalledTimes(facts.length);
    expect(maxInFlight).toBe(1);
  });

  it('keeps draining the queue after a queued write fails', async () => {
    const writeFactSnapshot = vi.fn()
      .mockRejectedValueOnce(new Error('cognee timeout'))
      .mockResolvedValue(undefined);
    const memory = {
      writeArtifactSnapshot: vi.fn(async () => undefined),
      writeFactSnapshot,
      cognifyDatasets: vi.fn(async () => undefined),
    } as unknown as PipelineMemory;
    const artifactMemory = new ArtifactMemoryService(memory);
    const factMemory = new FactMemoryService(memory);
    const envelope = await artifactMemory.writeArtifact({
      artifactKind: 'scene-content',
      storyId: 'Bite Me',
      episodeNumber: 1,
      sceneId: 'scene-2',
      lifecycle: 'scene-authoring',
      agentRole: 'SceneWriter',
      payload: {
        sceneId: 'scene-2',
        sceneName: 'The Club',
        summary: 'The Dusk Club convenes.',
        beats: [{ id: 'beat-1', text: 'Candles gutter.', residue: 'The club knows.' }],
      },
    });

    const facts = await factMemory.writeFactsForArtifact(envelope);
    await expect(factMemory.flush()).resolves.toBeUndefined();

    expect(writeFactSnapshot).toHaveBeenCalledTimes(facts.length);
    expect(memory.cognifyDatasets).toHaveBeenCalledWith(['storyrpg-run-bite-me'], { background: true });
  });

  it('marks validator-derived findings as validated facts with validator refs', async () => {
    const memory = {
      writeArtifactSnapshot: vi.fn(async () => undefined),
      writeFactSnapshot: vi.fn(async () => undefined),
    } as unknown as PipelineMemory;
    const artifactMemory = new ArtifactMemoryService(memory);
    const factMemory = new FactMemoryService(memory);
    const envelope = await artifactMemory.writeArtifact({
      artifactKind: 'qa-report',
      storyId: 'Bite Me',
      lifecycle: 'full-qa',
      validator: 'IntegratedBestPracticesValidator',
      payload: {
        overallPassed: false,
        blockingIssues: [{ message: 'Choice consequence does not affect later state.' }],
      },
    });

    const facts = factMemory.extractFacts(envelope);

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      factKind: 'validator-failure',
      subjectId: 'IntegratedBestPracticesValidator',
      status: 'validated',
      validatorRefs: [{ validator: 'IntegratedBestPracticesValidator', lifecycle: 'full-qa', outcome: 'failed' }],
    });
  });
});
