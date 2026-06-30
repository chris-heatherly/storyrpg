const SENSITIVE_KEY_RE = /(api[_-]?key|token|secret|password|authorization|bearer)/i;
const LARGE_TEXT_KEY_RE = /(rawDocument|sourceText|documentText|fullText|prompt)$/i;
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-api03-[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bapikey-[A-Za-z0-9_-]{12,}\b/g,
];

const PLANNING_REGISTER_REPLACEMENTS = [
  {
    pattern: /\bCold-open\s+prelude\s*:\s*([\s\S]*?)(?:\n{2,}|\s+)?Then\s+continue\s+into\s+the\s+planned\s+scene\s*:\s*([^\n]+)/gi,
    replacement: (_match, _coldOpen, plannedScene) => fictionFirstResidueDetail(plannedScene),
  },
  {
    pattern: /\bOpen\s+with\s+this\s+cold-open\s+moment\s+before\s+the\s+scene's\s+main\s+pressure,\s*then\s+transition\s+into\s+the\s+planned\s+scene\s*:\s*/gi,
    replacement: '',
  },
  {
    pattern: /\bOpen\s+on\s+the\s+required\s+cold-open\s+prelude,\s*then\s+fulfill\s+the\s+planned\s+scene\s+function\s*:\s*/gi,
    replacement: '',
  },
  {
    pattern: /\bThen\s+continue\s+into\s+the\s+planned\s+scene\s*:\s*/gi,
    replacement: '',
  },
  {
    pattern: /\bCold-open\s+prelude\s*:\s*/gi,
    replacement: '',
  },
  {
    pattern: /The next beat visibly responds to the authored choice: At the door of V[^:]+Club on night two: accept Mika's key card to the side entrance, or thank her politely and leave it\./g,
    replacement: "The memory of Mika's key card follows you through the room, a quiet test of whether you accept the doors she opens or keep pretending you can stay untouched.",
  },
  {
    pattern: /The next beat visibly responds to the authored choice: At brunch when Stela hands Kylie a small protection bag of dried herbs \(\*for your purse, love\*\): take it gracefully, deflect, or laugh and put it in\./g,
    replacement: "Stela's little protection bag follows you into the next room, turning the old threshold into either a comfort, a warning, or the absence of both.",
  },
  {
    pattern: /The next beat visibly responds to the authored choice: The pre-weekend post: publish it Friday morning \(canonical\), schedule it to drop Sunday after the weekend ends, or skip it entirely as a gesture toward Victor's privacy\./g,
    replacement: "Whatever you did with the post follows you through the estate, turning Victor's attention into invitation, leverage, or a silence you can feel.",
  },
  {
    pattern: /\bHook\s*(?:—|-|:)\s*([\s\S]*?)\s*;\s*promise\s*(?:—|-|:)\s*([\s\S]*?)\s*;\s*stakes\s*(?:—|-|:)\s*([^\n]+)/gi,
    replacement: (_match, hook, _promise, stakes) => hookPromiseStakesReplacement(hook, stakes),
  },
  {
    pattern: /\bStage\s+the\s+pressure\s+through\s+visible\s+action,\s*reaction,\s*object\s+movement,\s*distance,\s*or\s+dialogue\s+around\s+([^\n]+)/gi,
    replacement: (_match, detail) =>
      `The room answers through posture, distance, objects, and dialogue around ${fictionFirstResidueDetail(detail)}`,
  },
  {
    pattern: /(^|[.!?]\s+|[:("|]\s*|\|\s*|\bfor\s+)(Hook|promise|stakes)\s*(?:—|-|:)\s*([^;\n]+)/gi,
    replacement: (_match, prefix, _label, detail) => `${prefix}${fictionFirstResidueDetail(detail)}`,
  },
  {
    pattern: /\b(around|because)\s+(Hook|promise|stakes)\s*(?:—|-|:)\s*([^;\n]+)/gi,
    replacement: (_match, connector, _label, detail) => `${connector} ${fictionFirstResidueDetail(detail)}`,
  },
  {
    pattern: /preserves authored choice pressure/g,
    replacement: 'preserves treatment pressure',
  },
  {
    pattern: /Show immediate residue from the authored path:\s*([^\n]+)/gi,
    replacement: (_match, detail) =>
      `The aftermath changes what characters say, hide, risk, or trust: ${fictionFirstResidueDetail(detail)}`,
  },
  {
    pattern: /Keep this authored residue visible after reconvergence:\s*([^\n]+)/gi,
    replacement: (_match, detail) =>
      `The consequence stays visible through changed access, posture, information, or danger: ${fictionFirstResidueDetail(detail)}`,
  },
  {
    pattern: /Future scenes should remember:\s*([^\n]+)/gi,
    replacement: (_match, detail) =>
      `Later pressure returns through trust, knowledge, access, or risk: ${fictionFirstResidueDetail(detail)}`,
  },
  {
    pattern: /Carry forward treatment residue:\s*([^\n]+)/gi,
    replacement: (_match, detail) =>
      `Let the consequence return through trust, knowledge, access, or risk: ${fictionFirstResidueDetail(detail)}`,
  },
  {
    pattern: /The choice changes the leverage around\s+([^\n]+?)(\.)?$/gi,
    replacement: (_match, detail, period = '') =>
      `${fictionFirstResidueDetail(detail)}${period}`,
  },
  {
    pattern: /The response changes access,\s*trust,\s*information,\s*or\s*danger around\s+([^\n]+)/gi,
    replacement: (_match, detail) => fictionFirstResidueDetail(detail),
  },
  {
    pattern: /You feel more practiced in\s+(persuasion|charm|deception)\b\.?/gi,
    replacement: 'Your next words come a little steadier.',
  },
  {
    pattern: /You feel more practiced in\s+(investigation|perception|insight)\b\.?/gi,
    replacement: 'The next clue feels easier to hold.',
  },
  {
    pattern: /You feel more practiced in\s+(stealth|sleight(?: of hand)?)\b\.?/gi,
    replacement: 'Silence comes a little more naturally.',
  },
  {
    pattern: /You feel more practiced in\s+(combat|athletics|acrobatics)\b\.?/gi,
    replacement: 'Your body answers a little faster.',
  },
  {
    pattern: /You feel more practiced in\s+([a-z_ ]+)\b\.?/gi,
    replacement: 'The lesson settles in before the moment passes.',
  },
  {
    pattern: /The next scene should dramatize the concrete residue of that choice\./gi,
    replacement: 'What follows carries the cost in changed posture, clues, risk, or narrowed options.',
  },
];

function fictionFirstResidueDetail(value) {
  return String(value || '')
    .replace(/\bshow\s+immediate\s+residue\s+from\s+(?:the\s+)?authored\s+path:?\s*/gi, '')
    .replace(/\bkeep\s+this\s+authored\s+residue\s+visible\s+after\s+reconvergence:?\s*/gi, '')
    .replace(/\bfuture\s+scenes?\s+should\s+remember:?\s*/gi, '')
    .replace(/\bcarry\s+forward\s+treatment\s+residue:?\s*/gi, '')
    .replace(/\bauthored\s+(?:path|residue)\b/gi, 'choice')
    .replace(/\breconvergence\b/gi, 'the aftermath')
    .replace(/\bresidue\b/gi, 'aftermath')
    .replace(/\bthe\s+next\s+scene\b/gi, 'what follows')
    .replace(/\blater\s+episode\b/gi, 'later')
    .replace(/\bin\s+a\s+later\s+episode\b/gi, 'later')
    .replace(/\.{2,}/g, '.')
    .replace(/\.\s+at\b/gi, ' at')
    .replace(/\s+\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function hookPromiseStakesReplacement(hook, stakes) {
  const joined = `${hook || ''} ${stakes || ''}`;
  if (
    /\bKylie\s+unpacks\b/i.test(joined)
    && /\bLipscani\b/i.test(joined)
    && /\bSadie\b/i.test(joined)
    && /\bvampires\s+in\s+Romania\b/i.test(joined)
  ) {
    return "When the screen goes dark, Kylie touches the gold chain at her throat and lets the joke stay a joke. Outside the Lipscani window, Bucharest keeps its secrets to itself.";
  }
  const parts = [hook, stakes]
    .map((part) => fictionFirstResidueDetail(part))
    .filter(Boolean);
  return parts.length > 0 ? parts.join('; ') : 'The scene opens on concrete action and visible stakes.';
}

function truncateString(value, maxLength = 1200) {
  if (typeof value !== 'string' || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function scrubPlanningRegisterProse(value) {
  if (typeof value !== 'string') return value;
  const scrubbed = PLANNING_REGISTER_REPLACEMENTS.reduce(
    (next, { pattern, replacement }) => next.replace(pattern, replacement),
    value,
  );
  if (scrubbed === value) return value;
  return scrubbed
    .replace(/\.\s+as\b/gi, ' as')
    .replace(/\s+\./g, '.')
    .replace(/\.{2,}/g, '.')
    .trim();
}

function sanitizeString(value) {
  const secretScrubbed = SECRET_VALUE_PATTERNS.reduce(
    (next, pattern) => next.replace(pattern, '[redacted]'),
    value,
  );
  return scrubPlanningRegisterProse(secretScrubbed);
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
    friendlyName: payload.friendlyName,
    processTitle: payload.processTitle,
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
  scrubPlanningRegisterProse,
};
