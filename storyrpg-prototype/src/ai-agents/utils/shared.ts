/**
 * Shared Utility Functions
 * 
 * Common utilities used across agents, validators, and pipelines.
 */

// ========================================
// ARRAY NORMALIZATION
// ========================================

/**
 * Normalize a value to an array.
 * Handles: undefined, null, single values, and arrays.
 */
export function normalizeArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

/**
 * Normalize a value to a non-empty array with a default.
 */
export function normalizeArrayWithDefault<T>(
  value: T | T[] | undefined | null,
  defaultValue: T[]
): T[] {
  const normalized = normalizeArray(value);
  return normalized.length > 0 ? normalized : defaultValue;
}

/**
 * Ensure all items in an array are valid (not null/undefined).
 */
export function filterValidItems<T>(items: (T | null | undefined)[]): T[] {
  return items.filter((item): item is T => item !== null && item !== undefined);
}

// ========================================
// STRING NORMALIZATION
// ========================================

/**
 * Normalize a string value with a default.
 */
export function normalizeString(
  value: string | undefined | null,
  defaultValue: string = ''
): string {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return String(value).trim() || defaultValue;
}

/**
 * Normalize a string to a specific set of allowed values.
 */
export function normalizeEnum<T extends string>(
  value: string | undefined | null,
  allowedValues: readonly T[],
  defaultValue: T
): T {
  const normalized = normalizeString(value).toLowerCase() as T;
  return allowedValues.includes(normalized) ? normalized : defaultValue;
}

// ========================================
// ERROR HANDLING
// ========================================

/**
 * Extract error message from any error type.
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Create a standardized error result for agents.
 */
export function createErrorResult<T>(error: unknown): { success: false; error: string; data?: T } {
  return {
    success: false,
    error: extractErrorMessage(error),
  };
}

/**
 * Create a standardized success result for agents.
 */
export function createSuccessResult<T>(data: T): { success: true; data: T; error?: undefined } {
  return {
    success: true,
    data,
  };
}

/**
 * Wrap an async operation with standardized error handling.
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: string
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const data = await operation();
    return createSuccessResult(data);
  } catch (error) {
    const message = extractErrorMessage(error);
    console.error(`[${context}] Error:`, message);
    return createErrorResult(error);
  }
}

// ========================================
// LOGGING UTILITIES
// ========================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLogLevel: LogLevel = 'info';

/**
 * Set the global log level.
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * Get the current log level.
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

/**
 * Check if a log level should be displayed.
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
}

/**
 * Create a logger for a specific context.
 */
export function createLogger(context: string) {
  const prefix = `[${context}]`;
  
  return {
    debug: (...args: unknown[]) => {
      if (shouldLog('debug')) {
        console.log(prefix, ...args);
      }
    },
    info: (...args: unknown[]) => {
      if (shouldLog('info')) {
        console.log(prefix, ...args);
      }
    },
    warn: (...args: unknown[]) => {
      if (shouldLog('warn')) {
        console.warn(prefix, ...args);
      }
    },
    error: (...args: unknown[]) => {
      if (shouldLog('error')) {
        console.error(prefix, ...args);
      }
    },
  };
}

// ========================================
// RETRY UTILITIES
// ========================================

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
};

/**
 * Retry an async operation with exponential backoff.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.delayMs;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt === opts.maxAttempts) {
        throw error;
      }
      
      if (opts.shouldRetry && !opts.shouldRetry(error, attempt)) {
        throw error;
      }
      
      console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await sleep(delay);
      delay *= opts.backoffMultiplier || 1;
    }
  }
  
  throw lastError;
}

// ========================================
// ASYNC UTILITIES
// ========================================

/**
 * Sleep for a specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run promises with a concurrency limit.
 */
export async function withConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  operation: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  
  for (let i = 0; i < items.length; i++) {
    const promise = operation(items[i], i).then(result => {
      results[i] = result;
    });
    
    executing.push(promise);
    
    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove completed promises
      for (let j = executing.length - 1; j >= 0; j--) {
        const p = executing[j];
        // Check if promise is settled by racing with an immediate resolve
        const settled = await Promise.race([
          p.then(() => true).catch(() => true),
          Promise.resolve(false)
        ]);
        if (settled) {
          executing.splice(j, 1);
        }
      }
    }
  }
  
  await Promise.all(executing);
  return results;
}

/**
 * Run promises in batches.
 */
export async function batchProcess<T, R>(
  items: T[],
  batchSize: number,
  operation: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await operation(batch);
    results.push(...batchResults);
  }
  
  return results;
}

// ========================================
// OBJECT UTILITIES
// ========================================

/**
 * Deep merge two objects.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };
  
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = result[key];
    
    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }
  
  return result;
}

/**
 * Pick specific keys from an object.
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specific keys from an object.
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}

// ========================================
// VALIDATION UTILITIES
// ========================================

/**
 * Check if a value is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Check if a value is a non-empty array.
 */
export function isNonEmptyArray<T>(value: unknown): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Check if a value is a positive number.
 */
export function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && !isNaN(value);
}

/**
 * Check if a value is a valid ID (non-empty string).
 */
export function isValidId(value: unknown): value is string {
  return isNonEmptyString(value) && /^[a-z0-9_-]+$/i.test(value);
}
