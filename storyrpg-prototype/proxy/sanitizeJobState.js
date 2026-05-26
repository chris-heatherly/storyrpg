const SENSITIVE_KEY_RE = /(api[_-]?key|token|secret|password|authorization|bearer)/i;
const LARGE_TEXT_KEY_RE = /(rawDocument|sourceText|documentText|fullText|prompt)$/i;
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-api03-[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bapikey-[A-Za-z0-9_-]{12,}\b/g,
];

function truncateString(value, maxLength = 1200) {
  if (typeof value !== 'string' || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function sanitizeString(value) {
  return SECRET_VALUE_PATTERNS.reduce(
    (next, pattern) => next.replace(pattern, '[redacted]'),
    value,
  );
}

function sanitizeJobState(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeJobState);

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      result[key] = typeof child === 'string' && child.trim() ? '[redacted]' : child;
    } else if (typeof child === 'string') {
      result[key] = sanitizeString(LARGE_TEXT_KEY_RE.test(key) ? truncateString(child) : child);
    } else if (child && typeof child === 'object') {
      result[key] = sanitizeJobState(child);
    } else {
      result[key] = child;
    }
  }
  return result;
}

function summarizeRequestPayload(payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  return sanitizeJobState({
    mode: payload.mode,
    storyTitle: payload.storyTitle,
    episodeCount: payload.episodeCount,
    outputDirectory: payload.imageGenerationInput?.outputDirectory || payload.config?.outputDir,
    imageProvider: payload.config?.imageGen?.provider,
    imageModel: payload.config?.imageGen?.model,
    assetGenerationMode: payload.config?.generation?.assetGenerationMode,
    hasGenerationInput: !!payload.generationInput,
    hasAnalysisInput: !!payload.analysisInput,
    hasImageGenerationInput: !!payload.imageGenerationInput,
  });
}

function publicResumeContext(context) {
  if (!context || typeof context !== 'object') return context;
  const { requestPayload, ...rest } = context;
  return sanitizeJobState({
    ...rest,
    requestPayloadSummary: summarizeRequestPayload(requestPayload),
  });
}

function publicCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') return checkpoint;
  const { resumeContext, ...rest } = checkpoint;
  return sanitizeJobState({
    ...rest,
    resumeContext: publicResumeContext(resumeContext),
  });
}

function publicJobState(job) {
  if (!job || typeof job !== 'object') return job;
  const {
    resumeContext,
    resumeCheckpoint,
    checkpoint,
    requestPayload,
    ...rest
  } = job;
  return sanitizeJobState({
    ...rest,
    resumeContext: publicResumeContext(resumeContext),
    resumeCheckpoint: resumeCheckpoint ? {
      jobId: resumeCheckpoint.jobId,
      createdAt: resumeCheckpoint.createdAt,
      updatedAt: resumeCheckpoint.updatedAt,
      steps: resumeCheckpoint.steps,
      artifacts: resumeCheckpoint.artifacts,
      outputs: resumeCheckpoint.outputs,
      lastEvent: resumeCheckpoint.lastEvent,
      failureContext: resumeCheckpoint.failureContext,
      resumeContext: publicResumeContext(resumeCheckpoint.resumeContext),
    } : undefined,
    checkpoint: publicCheckpoint(checkpoint),
    requestPayloadSummary: summarizeRequestPayload(requestPayload),
  });
}

module.exports = {
  publicCheckpoint,
  publicJobState,
  publicResumeContext,
  sanitizeJobState,
};
