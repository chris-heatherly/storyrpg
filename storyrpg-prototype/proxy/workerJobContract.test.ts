import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateWorkerJobStartRequest } = require('./workerJobContract.js');

function validGenerationRequest() {
  const manifest = { version: 1, sourceKind: 'authored_lite', requestedEpisodes: [1] };
  return {
    protocolVersion: 2,
    mode: 'generation',
    payload: {
      config: {},
      generationInput: {
        brief: { story: { title: 'Bite Me' }, generationManifest: manifest },
        manifest,
      },
    },
    idempotencyKey: 'generation:bite-me:fresh-1',
    storyTitle: 'Bite Me',
    episodeCount: 1,
    launchMetadata: { launchServiceVersion: 1, providerPolicy: 'configured' },
  };
}

describe('worker job admission contract', () => {
  it('accepts a versioned generation request with both manifest copies', () => {
    expect(validateWorkerJobStartRequest(validGenerationRequest())).toEqual({ ok: true, issues: [] });
  });

  it('rejects stale protocol versions before worker spawn', () => {
    const result = validateWorkerJobStartRequest({ ...validGenerationRequest(), protocolVersion: 1 });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'launch_protocol_unsupported' }));
  });

  it('rejects generation without a committed manifest', () => {
    const request = validGenerationRequest();
    delete request.payload.generationInput.manifest;
    const result = validateWorkerJobStartRequest(request);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'generation_manifest_missing' }));
  });

  it('rejects split-brain manifest copies and episode ranges', () => {
    const request = validGenerationRequest();
    request.payload.generationInput.brief.generationManifest = {
      ...request.payload.generationInput.manifest,
      requestedEpisodes: [2],
    };
    request.payload.generationInput.episodeRange = { start: 1, end: 2, specific: [1, 2] };
    const result = validateWorkerJobStartRequest(request);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'generation_manifest_mismatch' }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'generation_episode_range_mismatch' }));
  });

  it('requires canonical launch metadata for narrative jobs', () => {
    const request = validGenerationRequest();
    delete request.launchMetadata;
    const result = validateWorkerJobStartRequest(request);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'launch_metadata_missing' }));
  });
});
