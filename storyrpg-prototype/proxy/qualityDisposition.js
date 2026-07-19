const fs = require('fs');
const path = require('path');

const QUALITY_DISPOSITION_FILENAME = 'quality-disposition.json';

function parseJsonFile(absPath) {
  if (!fs.existsSync(absPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

function validDisposition(value) {
  return value
    && typeof value === 'object'
    && value.version === 1
    && (value.status === 'promoted' || value.status === 'held')
    && typeof value.eligibleForReader === 'boolean';
}

function deriveLegacyDisposition(summary) {
  const score = summary?.qualityScore;
  if (typeof score !== 'number') return null;
  const caps = Array.isArray(summary?.qualityScoreBasis?.caps) ? summary.qualityScoreBasis.caps : [];
  const blockingCapCount = caps.filter((cap) => Number(cap?.maxScore) < 90).length;
  const eligibleForReader = score >= 70 && blockingCapCount === 0;
  return {
    version: 1,
    status: eligibleForReader ? 'promoted' : 'held',
    band: eligibleForReader ? 'ship' : score < 50 ? 'block' : 'warn',
    eligibleForReader,
    reasonCodes: eligibleForReader ? [] : [blockingCapCount > 0 ? 'blocking_quality_caps' : 'legacy_quality_band'],
    score,
    capIds: caps.map((cap) => cap?.id).filter(Boolean),
    blockingCapCount,
    qaEvidenceStale: false,
    createdAt: '',
    legacyDerived: true,
  };
}

function readQualityDisposition(storyDir) {
  const sidecar = parseJsonFile(path.join(storyDir, QUALITY_DISPOSITION_FILENAME));
  if (validDisposition(sidecar)) return sidecar;
  const manifest = parseJsonFile(path.join(storyDir, 'manifest.json'));
  if (validDisposition(manifest?.summary?.qualityDisposition)) return manifest.summary.qualityDisposition;
  return deriveLegacyDisposition(manifest?.summary);
}

function isReaderEligible(disposition) {
  if (!disposition) return true;
  // Historical manifests predate the atomic promotion contract. Their score is
  // useful for catalog ranking, but cannot be treated as a publication verdict.
  if (disposition.legacyDerived === true) return true;
  if (disposition.override?.approvedBy && disposition.override?.approvedAt && disposition.override?.reason) return true;
  return disposition.status === 'promoted'
    && disposition.band === 'ship'
    && disposition.eligibleForReader === true;
}

module.exports = {
  QUALITY_DISPOSITION_FILENAME,
  deriveLegacyDisposition,
  isReaderEligible,
  readQualityDisposition,
};
