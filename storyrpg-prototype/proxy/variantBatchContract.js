const { isDeepStrictEqual } = require('node:util');
const { validateWorkerJobStartRequest } = require('./workerJobContract');

const VARIANT_BATCH_PROTOCOL_VERSION = 1;
const MAX_VARIANTS_PER_BATCH = 4;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateVariantBatchStartRequest(value) {
  const issues = [];
  const add = (code, path, message) => issues.push({ code, path, message });
  if (!isRecord(value)) {
    add('variant_batch_invalid', '$', 'Variant Batch request must be an object.');
    return { ok: false, issues };
  }
  if (value.version !== VARIANT_BATCH_PROTOCOL_VERSION) {
    add('variant_batch_protocol_unsupported', 'version', `version must be ${VARIANT_BATCH_PROTOCOL_VERSION}.`);
  }
  if (value.kind !== 'variant-batch') add('variant_batch_kind_invalid', 'kind', 'kind must be variant-batch.');
  if (typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim()) {
    add('variant_batch_idempotency_missing', 'idempotencyKey', 'idempotencyKey is required.');
  }
  if (typeof value.storyTitle !== 'string' || !value.storyTitle.trim()) {
    add('variant_batch_story_title_missing', 'storyTitle', 'storyTitle is required.');
  }
  if (!Number.isInteger(value.variantCount) || value.variantCount < 2 || value.variantCount > MAX_VARIANTS_PER_BATCH) {
    add('variant_batch_size_invalid', 'variantCount', `variantCount must be between 2 and ${MAX_VARIANTS_PER_BATCH}.`);
  }
  if (!Array.isArray(value.requests) || value.requests.length !== value.variantCount) {
    add('variant_batch_children_invalid', 'requests', 'requests must contain exactly variantCount generation jobs.');
    return { ok: issues.length === 0, issues };
  }

  const seenVariantIds = new Set();
  const seenOrdinals = new Set();
  const seenIdempotencyKeys = new Set();
  let expectedBatchId;
  let expectedManifest;
  let expectedConfig;
  let expectedAnalysisHash;
  let expectedSeasonPlanHash;

  value.requests.forEach((request, index) => {
    const admission = validateWorkerJobStartRequest(request);
    for (const issue of admission.issues) {
      add(issue.code, `requests[${index}].${issue.path}`, issue.message);
    }
    if (request?.mode !== 'generation') {
      add('variant_batch_child_mode_invalid', `requests[${index}].mode`, 'Every Variant Batch child must be a generation job.');
      return;
    }
    if (request.storyTitle !== value.storyTitle) {
      add('variant_batch_story_title_mismatch', `requests[${index}].storyTitle`, 'Every child must use the batch storyTitle.');
    }
    if (seenIdempotencyKeys.has(request.idempotencyKey)) {
      add('variant_batch_child_idempotency_duplicate', `requests[${index}].idempotencyKey`, 'Child idempotency keys must be unique.');
    }
    seenIdempotencyKeys.add(request.idempotencyKey);
    const context = request?.payload?.generationInput?.runContext;
    if (!isRecord(context) || context.kind !== 'variant') {
      add('variant_batch_context_missing', `requests[${index}].payload.generationInput.runContext`, 'Variant runContext is required.');
      return;
    }
    if (typeof context.sharedAnalysisHash !== 'string' || !context.sharedAnalysisHash) {
      add('variant_batch_analysis_hash_missing', `requests[${index}].payload.generationInput.runContext.sharedAnalysisHash`, 'A locked shared analysis hash is required.');
    }
    if (!expectedBatchId) expectedBatchId = context.batchId;
    if (context.batchId !== expectedBatchId) {
      add('variant_batch_id_mismatch', `requests[${index}].payload.generationInput.runContext.batchId`, 'All children must share one batchId.');
    }
    if (context.total !== value.variantCount || context.ordinal !== index + 1) {
      add('variant_batch_ordinal_invalid', `requests[${index}].payload.generationInput.runContext`, 'Child ordinal/total must match its batch position.');
    }
    if (seenVariantIds.has(context.variantId)) add('variant_batch_variant_duplicate', `requests[${index}]`, 'variantId must be unique.');
    if (seenOrdinals.has(context.ordinal)) add('variant_batch_ordinal_duplicate', `requests[${index}]`, 'ordinal must be unique.');
    seenVariantIds.add(context.variantId);
    seenOrdinals.add(context.ordinal);

    const manifest = request.payload.generationInput.manifest;
    const config = request.payload.config;
    if (expectedManifest === undefined) expectedManifest = manifest;
    if (expectedConfig === undefined) expectedConfig = config;
    if (!isDeepStrictEqual(manifest, expectedManifest)) {
      add('variant_batch_manifest_mismatch', `requests[${index}].payload.generationInput.manifest`, 'All children must share one generation manifest.');
    }
    if (!isDeepStrictEqual(config, expectedConfig)) {
      add('variant_batch_config_mismatch', `requests[${index}].payload.config`, 'All children must share one pipeline configuration.');
    }
    if (expectedAnalysisHash === undefined) expectedAnalysisHash = context.sharedAnalysisHash;
    if (expectedSeasonPlanHash === undefined) expectedSeasonPlanHash = context.sharedSeasonPlanHash;
    if (context.sharedAnalysisHash !== expectedAnalysisHash || context.sharedSeasonPlanHash !== expectedSeasonPlanHash) {
      add('variant_batch_shared_hash_mismatch', `requests[${index}].payload.generationInput.runContext`, 'All children must share analysis and season-plan hashes.');
    }
  });

  return { ok: issues.length === 0, issues, batchId: expectedBatchId };
}

module.exports = {
  MAX_VARIANTS_PER_BATCH,
  VARIANT_BATCH_PROTOCOL_VERSION,
  validateVariantBatchStartRequest,
};
