/**
 * Lightweight structured logger.
 *
 * Why this exists:
 *   - Gives us a single choke point for console output so the ESLint
 *     `no-console` rule can enforce that production code goes through the
 *     logger instead of sprinkling `console.log` everywhere.
 *   - Supports per-module scopes and levels without pulling in a heavy
 *     dependency like pino/winston (RN-safe).
 *   - Level is driven by `EXPO_PUBLIC_LOG_LEVEL` (e.g. `debug`, `info`,
 *     `warn`, `error`, `silent`). Defaults to `info` in production and
 *     `debug` when `__DEV__` or `NODE_ENV !== 'production'`.
 *
 * Usage:
 *   import { createLogger } from '@/utils/logger';
 *   const log = createLogger('GeneratorScreen');
 *   log.info('starting job', { jobId });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

function resolveDefaultLevel(): LogLevel {
  const envLevel = (
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_LOG_LEVEL) ||
    (typeof process !== 'undefined' && process.env?.LOG_LEVEL) ||
    ''
  )
    .toString()
    .trim()
    .toLowerCase();
  if (envLevel && envLevel in LEVEL_ORDER) {
    return envLevel as LogLevel;
  }
  const isProd =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
  return isProd ? 'info' : 'debug';
}

let currentLevel: LogLevel = resolveDefaultLevel();

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatScope(scope?: string): string {
  return scope ? `[${scope}]` : '';
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (subScope: string) => Logger;
}

export function createLogger(scope?: string): Logger {
  const prefix = formatScope(scope);
  return {
    debug: (...args) => {
      if (!shouldLog('debug')) return;
      console.log(prefix, ...args);
    },
    info: (...args) => {
      if (!shouldLog('info')) return;
      console.info(prefix, ...args);
    },
    warn: (...args) => {
      if (!shouldLog('warn')) return;
      console.warn(prefix, ...args);
    },
    error: (...args) => {
      if (!shouldLog('error')) return;
      console.error(prefix, ...args);
    },
    child: (subScope: string) =>
      createLogger(scope ? `${scope}:${subScope}` : subScope),
  };
}

export const logger = createLogger();
