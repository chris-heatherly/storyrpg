import { createHash } from 'node:crypto';
import fs from 'node:fs';

export const ANALYSIS_CACHE_VERSION = 1;
export const ANALYSIS_EXTRACTION_CONTRACT_VERSION = 'source-analysis-season-plan-v1';

export interface AnalysisCacheIdentity {
  sourceText: string;
  provider: string;
  model: string;
  options: Record<string, unknown>;
}

export interface AnalysisCacheEnvelope<T> {
  version: typeof ANALYSIS_CACHE_VERSION;
  fingerprint: string;
  sourceHash: string;
  extractionContractVersion: typeof ANALYSIS_EXTRACTION_CONTRACT_VERSION;
  provider: string;
  model: string;
  options: Record<string, unknown>;
  createdAt: string;
  result: T;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function analysisCacheFingerprint(identity: AnalysisCacheIdentity): {
  fingerprint: string;
  sourceHash: string;
} {
  const sourceHash = sha256(identity.sourceText);
  const fingerprint = sha256(JSON.stringify(stableValue({
    version: ANALYSIS_CACHE_VERSION,
    extractionContractVersion: ANALYSIS_EXTRACTION_CONTRACT_VERSION,
    sourceHash,
    provider: identity.provider,
    model: identity.model,
    options: identity.options,
  })));
  return { fingerprint, sourceHash };
}

export function writeAnalysisCache<T>(
  cachePath: string,
  identity: AnalysisCacheIdentity,
  result: T,
): AnalysisCacheEnvelope<T> {
  const hashes = analysisCacheFingerprint(identity);
  const envelope: AnalysisCacheEnvelope<T> = {
    version: ANALYSIS_CACHE_VERSION,
    ...hashes,
    extractionContractVersion: ANALYSIS_EXTRACTION_CONTRACT_VERSION,
    provider: identity.provider,
    model: identity.model,
    options: stableValue(identity.options) as Record<string, unknown>,
    createdAt: new Date().toISOString(),
    result,
  };
  fs.writeFileSync(cachePath, JSON.stringify(envelope));
  return envelope;
}

export function readAnalysisCache<T>(
  cachePath: string,
  identity: AnalysisCacheIdentity,
): T | undefined {
  if (!fs.existsSync(cachePath)) return undefined;
  try {
    const envelope = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Partial<AnalysisCacheEnvelope<T>>;
    const expected = analysisCacheFingerprint(identity);
    if (
      envelope.version !== ANALYSIS_CACHE_VERSION
      || envelope.extractionContractVersion !== ANALYSIS_EXTRACTION_CONTRACT_VERSION
      || envelope.fingerprint !== expected.fingerprint
      || envelope.sourceHash !== expected.sourceHash
      || !envelope.result
    ) return undefined;
    return envelope.result;
  } catch {
    return undefined;
  }
}
