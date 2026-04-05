import { Story } from '../../types';

type JsonRecord = Record<string, unknown>;

interface DeepSanitizeOptions {
  removeDataUrls?: boolean;
  removeKeys?: string[];
}

interface PipelineTransferOptions {
  maxEvents?: number;
  maxCheckpoints?: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepSanitizeValue<T>(value: T, options: DeepSanitizeOptions): T {
  if (typeof value === 'string') {
    if (options.removeDataUrls && value.startsWith('data:')) {
      return '' as T;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepSanitizeValue(item, options)) as T;
  }

  if (!isRecord(value)) {
    return value;
  }

  const next: JsonRecord = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'imageData' || key === 'base64') continue;
    if (options.removeKeys?.includes(key)) continue;
    next[key] = deepSanitizeValue(raw, options);
  }
  return next as T;
}

export function sanitizeStoryForPersistence(story: Story): Story {
  return deepSanitizeValue(cloneJson(story), {
    removeDataUrls: true,
    removeKeys: ['checkpoints', 'agentWorkingFiles'],
  });
}

export function sanitizeStoryForTransfer(story: Story): Story {
  return deepSanitizeValue(cloneJson(story), {
    removeDataUrls: true,
  });
}

export function sanitizePipelineResultForTransfer<T extends JsonRecord>(
  result: T,
  options: PipelineTransferOptions = {},
): T {
  const sanitized = deepSanitizeValue(cloneJson(result), {
    removeDataUrls: true,
  }) as T & {
    events?: unknown[];
    checkpoints?: unknown[];
    story?: Story;
  };

  if (sanitized.story) {
    sanitized.story = sanitizeStoryForTransfer(sanitized.story);
  }

  if (Array.isArray(sanitized.events) && typeof options.maxEvents === 'number') {
    sanitized.events = sanitized.events.slice(-options.maxEvents);
  }

  if (Array.isArray(sanitized.checkpoints) && typeof options.maxCheckpoints === 'number') {
    sanitized.checkpoints = sanitized.checkpoints.slice(-options.maxCheckpoints);
  }

  return sanitized;
}
