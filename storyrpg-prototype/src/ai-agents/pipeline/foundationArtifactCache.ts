/**
 * Cross-run foundation artifact cache (R1.6).
 * Content-addressed store for WorldBible / CharacterBible keyed by brief + model
 * + compiler versions. Opt out with STORYRPG_BYPASS_ARTIFACT_CACHE=1.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NARRATIVE_CONTRACT_COMPILER_VERSION } from './narrativeContractCompiler';
import { resolveGateConfigHash } from '../remediation/gateDefaults';

export const FOUNDATION_CACHE_VERSION = 1;

export type FoundationArtifactKind = 'world_bible' | 'character_bible';

export interface FoundationCacheIdentity {
  kind: FoundationArtifactKind;
  briefFingerprint: string;
  provider: string;
  model: string;
  compilerVersions: Record<string, string>;
  gateConfigHash: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`;
}

export function briefFoundationFingerprint(brief: {
  story?: unknown;
  world?: unknown;
  protagonist?: unknown;
  userPrompt?: string;
  rawDocument?: string;
  seasonPlan?: { sourceHash?: string; storyCircle?: unknown; anchors?: unknown } | null;
}): string {
  return sha256(stableStringify({
    story: brief.story,
    world: brief.world,
    protagonist: brief.protagonist,
    userPrompt: brief.userPrompt ?? '',
    rawDocument: typeof brief.rawDocument === 'string' ? brief.rawDocument.slice(0, 80_000) : '',
    season: brief.seasonPlan
      ? {
          sourceHash: brief.seasonPlan.sourceHash,
          storyCircle: brief.seasonPlan.storyCircle,
          anchors: brief.seasonPlan.anchors,
        }
      : null,
  }));
}

export function foundationCacheFingerprint(identity: FoundationCacheIdentity): string {
  return sha256(stableStringify({
    version: FOUNDATION_CACHE_VERSION,
    ...identity,
  }));
}

export function defaultFoundationCacheDir(baseDir = 'generated-stories'): string {
  return path.join(baseDir, '.foundation-cache');
}

function cacheFilePath(cacheDir: string, fingerprint: string, kind: FoundationArtifactKind): string {
  return path.join(cacheDir, `${kind}-${fingerprint.slice(0, 32)}.json`);
}

export function isFoundationCacheBypassed(): boolean {
  return process.env.STORYRPG_BYPASS_ARTIFACT_CACHE === '1';
}

export function buildFoundationCacheIdentity(input: {
  kind: FoundationArtifactKind;
  brief: Parameters<typeof briefFoundationFingerprint>[0];
  provider: string;
  model: string;
}): FoundationCacheIdentity {
  return {
    kind: input.kind,
    briefFingerprint: briefFoundationFingerprint(input.brief),
    provider: input.provider,
    model: input.model,
    compilerVersions: {
      narrativeContract: NARRATIVE_CONTRACT_COMPILER_VERSION,
      foundationCache: String(FOUNDATION_CACHE_VERSION),
    },
    gateConfigHash: resolveGateConfigHash(),
  };
}

export function readFoundationArtifact<T>(
  cacheDir: string,
  identity: FoundationCacheIdentity,
): T | undefined {
  if (isFoundationCacheBypassed()) return undefined;
  const fingerprint = foundationCacheFingerprint(identity);
  const filePath = cacheFilePath(cacheDir, fingerprint, identity.kind);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      version?: number;
      fingerprint?: string;
      result?: T;
    };
    if (
      envelope.version !== FOUNDATION_CACHE_VERSION
      || envelope.fingerprint !== fingerprint
      || !envelope.result
    ) return undefined;
    return envelope.result;
  } catch {
    return undefined;
  }
}

export function writeFoundationArtifact<T>(
  cacheDir: string,
  identity: FoundationCacheIdentity,
  result: T,
): void {
  if (isFoundationCacheBypassed()) return;
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const fingerprint = foundationCacheFingerprint(identity);
    const filePath = cacheFilePath(cacheDir, fingerprint, identity.kind);
    fs.writeFileSync(filePath, JSON.stringify({
      version: FOUNDATION_CACHE_VERSION,
      fingerprint,
      identity,
      createdAt: new Date().toISOString(),
      result,
    }));
  } catch {
    // Cache is best-effort.
  }
}
