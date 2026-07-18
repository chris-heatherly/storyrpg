const { isDeepStrictEqual } = require('node:util');

const WORKER_JOB_PROTOCOL_VERSION = 2;
const GENERATION_LAUNCH_SERVICE_VERSION = 1;
const WORKER_MODES = new Set(['analysis', 'generation', 'image-generation', 'compile-episode']);
const SOURCE_KINDS = new Set(['invent', 'authored', 'authored_lite', 'derived_from_lite']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidEpisodeList(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((episode) => Number.isInteger(episode) && episode > 0)
    && new Set(value).size === value.length;
}

function isValidGenerationManifest(value) {
  return isRecord(value)
    && value.version === 1
    && SOURCE_KINDS.has(value.sourceKind)
    && isValidEpisodeList(value.requestedEpisodes);
}

function validateWorkerJobStartRequest(value) {
  const issues = [];
  const add = (code, path, message) => issues.push({ code, path, message });
  if (!isRecord(value)) {
    add('worker_request_invalid', '$', 'Worker start request must be an object.');
    return { ok: false, issues };
  }
  if (value.protocolVersion !== WORKER_JOB_PROTOCOL_VERSION) {
    add('launch_protocol_unsupported', 'protocolVersion', `protocolVersion must be ${WORKER_JOB_PROTOCOL_VERSION}.`);
  }
  if (!WORKER_MODES.has(value.mode)) add('worker_mode_invalid', 'mode', 'Worker mode is unsupported.');
  if (!isRecord(value.payload)) add('worker_payload_missing', 'payload', 'Worker payload must be an object.');
  if (typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim()) {
    add('worker_idempotency_key_missing', 'idempotencyKey', 'idempotencyKey is required.');
  }
  if (typeof value.storyTitle !== 'string' || !value.storyTitle.trim()) {
    add('worker_story_title_missing', 'storyTitle', 'storyTitle is required.');
  }
  if (value.launchMetadata != null && !isRecord(value.launchMetadata)) {
    add('launch_metadata_invalid', 'launchMetadata', 'launchMetadata must be an object.');
  }
  if (value.mode === 'analysis' || value.mode === 'generation') {
    if (!isRecord(value.launchMetadata)) {
      add('launch_metadata_missing', 'launchMetadata', 'Narrative jobs must be prepared by the canonical launch service.');
    } else {
      if (value.launchMetadata.launchServiceVersion !== GENERATION_LAUNCH_SERVICE_VERSION) {
        add('launch_service_version_unsupported', 'launchMetadata.launchServiceVersion', `launchServiceVersion must be ${GENERATION_LAUNCH_SERVICE_VERSION}.`);
      }
      if (value.launchMetadata.providerPolicy !== 'configured' && value.launchMetadata.providerPolicy !== 'gemini-only') {
        add('launch_provider_policy_invalid', 'launchMetadata.providerPolicy', 'providerPolicy is invalid.');
      }
    }
  }
  if (!isRecord(value.payload)) return { ok: issues.length === 0, issues };
  if (!isRecord(value.payload.config)) add('worker_config_missing', 'payload.config', 'config is required.');

  if (value.mode === 'analysis') {
    const input = value.payload.analysisInput;
    if (!isRecord(input)) add('analysis_input_missing', 'payload.analysisInput', 'analysisInput is required.');
    else {
      if (typeof input.sourceText !== 'string') add('analysis_source_missing', 'payload.analysisInput.sourceText', 'sourceText must be a string.');
      if (typeof input.title !== 'string' || !input.title.trim()) add('analysis_title_missing', 'payload.analysisInput.title', 'title is required.');
    }
  }

  if (value.mode === 'generation') {
    const input = value.payload.generationInput;
    if (!isRecord(input)) add('generation_input_missing', 'payload.generationInput', 'generationInput is required.');
    else {
      if (!isRecord(input.brief)) add('generation_brief_missing', 'payload.generationInput.brief', 'brief is required.');
      if (!isRecord(input.manifest)) {
        add('generation_manifest_missing', 'payload.generationInput.manifest', 'Every generation request requires a manifest.');
      } else if (!isValidGenerationManifest(input.manifest)) {
        add('generation_manifest_invalid', 'payload.generationInput.manifest', 'Manifest version, source kind, or episode scope is invalid.');
      }
      if (isRecord(input.brief) && !isRecord(input.brief.generationManifest)) {
        add('generation_brief_manifest_missing', 'payload.generationInput.brief.generationManifest', 'The committed manifest must also be embedded in the brief.');
      }
      if (isValidGenerationManifest(input.manifest) && isRecord(input.brief?.generationManifest)
        && !isDeepStrictEqual(input.manifest, input.brief.generationManifest)) {
        add('generation_manifest_mismatch', 'payload.generationInput.brief.generationManifest', 'Brief and worker-input manifests must be identical.');
      }
      if (isValidGenerationManifest(input.manifest) && input.episodeRange != null) {
        const specific = input.episodeRange?.specific;
        const expected = input.manifest.requestedEpisodes;
        if (!isRecord(input.episodeRange) || !isDeepStrictEqual(specific, expected)
          || input.episodeRange.start !== Math.min(...expected)
          || input.episodeRange.end !== Math.max(...expected)) {
          add('generation_episode_range_mismatch', 'payload.generationInput.episodeRange', 'episodeRange must exactly match the committed manifest scope.');
        }
      }
      if (isValidGenerationManifest(input.manifest) && value.episodeCount != null
        && value.episodeCount !== input.manifest.requestedEpisodes.length) {
        add('generation_episode_count_mismatch', 'episodeCount', 'episodeCount must match the committed manifest scope.');
      }
    }
  }

  if (value.mode === 'image-generation') {
    const input = value.payload.imageGenerationInput;
    if (!isRecord(input) || typeof input.outputDirectory !== 'string' || !input.outputDirectory.trim()) {
      add('image_generation_output_missing', 'payload.imageGenerationInput.outputDirectory', 'Image generation requires outputDirectory.');
    }
  }

  if (value.mode === 'compile-episode') {
    const input = value.payload.compileEpisodeInput;
    if (!isRecord(input) || typeof input.outputDirectory !== 'string' || !isRecord(input.request)) {
      add('compile_episode_input_invalid', 'payload.compileEpisodeInput', 'Compile episode requires outputDirectory and request.');
    }
  }
  return { ok: issues.length === 0, issues };
}

module.exports = {
  GENERATION_LAUNCH_SERVICE_VERSION,
  WORKER_JOB_PROTOCOL_VERSION,
  validateWorkerJobStartRequest,
};
