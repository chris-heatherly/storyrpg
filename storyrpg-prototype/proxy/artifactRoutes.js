const fs = require('fs');
const path = require('path');

const STATUS_ORDER = ['clean', 'stale', 'invalid', 'blocked'];

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveInside(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  const rootAbs = path.resolve(root);
  if (resolved !== rootAbs && !resolved.startsWith(`${rootAbs}${path.sep}`)) return null;
  return resolved;
}

function currentIndexPath(runDir, episodeNumber) {
  return typeof episodeNumber === 'number'
    ? path.join(runDir, 'artifacts', 'episodes', String(episodeNumber).padStart(3, '0'), 'current.json')
    : path.join(runDir, 'artifacts', 'current.json');
}

function loadCurrentIndex(runDir, episodeNumber) {
  const current = readJsonIfExists(currentIndexPath(runDir, episodeNumber));
  return current?.version === 1 && current.artifacts && typeof current.artifacts === 'object'
    ? current
    : { version: 1, artifacts: {} };
}

function loadArtifactRef(runDir, ref) {
  if (!ref || typeof ref.path !== 'string') return null;
  const abs = resolveInside(runDir, ref.path);
  if (!abs) return null;
  const artifact = readJsonIfExists(abs);
  if (!artifact || artifact.artifactId !== ref.artifactId || artifact.payloadHash !== ref.payloadHash) return null;
  return artifact;
}

function evaluateArtifactRef(runDir, ref) {
  const artifact = loadArtifactRef(runDir, ref);
  if (!artifact) {
    return { kind: ref?.kind, episodeNumber: ref?.episodeNumber, revision: ref?.revision, status: 'blocked', reasons: ['artifact missing'] };
  }
  if (artifact.status === 'invalid' || artifact.validation?.passed === false) {
    return {
      kind: ref.kind,
      episodeNumber: ref.episodeNumber,
      revision: ref.revision,
      status: 'invalid',
      reasons: ['artifact validation failed'],
      issueCount: Array.isArray(artifact.validation?.issues) ? artifact.validation.issues.length : 0,
    };
  }
  if (artifact.status === 'stale') {
    return { kind: ref.kind, episodeNumber: ref.episodeNumber, revision: ref.revision, status: 'stale', reasons: ['artifact marked stale'] };
  }

  const missing = [];
  const changed = [];
  for (const upstream of artifact.upstream || []) {
    const loaded = loadArtifactRef(runDir, upstream);
    if (!loaded) {
      missing.push(`${upstream.kind}:${upstream.revision}`);
      continue;
    }
    const current = loadCurrentIndex(runDir, upstream.episodeNumber).artifacts?.[upstream.kind];
    if (loaded.payloadHash !== upstream.payloadHash || (current && current.artifactId !== upstream.artifactId)) {
      changed.push(`${upstream.kind}:${upstream.revision}`);
    }
  }
  if (missing.length > 0) {
    return { kind: ref.kind, episodeNumber: ref.episodeNumber, revision: ref.revision, status: 'blocked', reasons: [`missing upstream: ${missing.join(', ')}`] };
  }
  if (changed.length > 0) {
    return { kind: ref.kind, episodeNumber: ref.episodeNumber, revision: ref.revision, status: 'stale', reasons: [`changed upstream: ${changed.join(', ')}`] };
  }
  return { kind: ref.kind, episodeNumber: ref.episodeNumber, revision: ref.revision, status: 'clean', reasons: [] };
}

function rollupStatus(reports) {
  return reports.reduce((worst, report) => {
    return STATUS_ORDER.indexOf(report.status) > STATUS_ORDER.indexOf(worst) ? report.status : worst;
  }, 'clean');
}

function summarizeCurrentIndex(runDir, episodeNumber) {
  const current = loadCurrentIndex(runDir, episodeNumber);
  const reports = Object.values(current.artifacts || {}).map((ref) => evaluateArtifactRef(runDir, ref));
  const counts = reports.reduce((acc, report) => {
    acc[report.status] = (acc[report.status] || 0) + 1;
    return acc;
  }, {});
  return {
    status: rollupStatus(reports),
    artifactCount: reports.length,
    statusCounts: counts,
    reports,
    updatedAt: current.updatedAt,
  };
}

function completionWatermarkPath(runDir, episodeNumber) {
  return path.join(runDir, 'checkpoints', `episode-${episodeNumber}-complete.json`);
}

function summarizeEpisodeLock(runDir, episodeNumber, status) {
  const watermark = readJsonIfExists(completionWatermarkPath(runDir, episodeNumber));
  const lock = watermark?.lock || {};
  const runtimeContractPassed = lock.runtimeContractPassed === true;
  const canonRequired = typeof lock.seasonCanonArtifact === 'string' && lock.seasonCanonArtifact.length > 0;
  const canonSealed = lock.canonSealed === true || (!canonRequired && lock.canonSealed !== false);
  const locked = runtimeContractPassed && canonSealed && status === 'clean';
  const reasons = [];
  if (!watermark) reasons.push('missing completion watermark');
  if (!runtimeContractPassed) reasons.push('runtime contract not confirmed');
  if (canonRequired && lock.canonSealed !== true) reasons.push('canon seal not confirmed');
  if (status !== 'clean') reasons.push(`artifact graph is ${status}`);
  return {
    locked,
    runtimeContractPassed,
    canonSealed: lock.canonSealed,
    incrementalContractArtifact: lock.incrementalContractArtifact,
    seasonCanonArtifact: lock.seasonCanonArtifact,
    reasons,
  };
}

function summarizeContextOutObligations(runDir, episodeNumber) {
  const contextOutRef = loadCurrentIndex(runDir, episodeNumber).artifacts?.['context-out'];
  const contextOut = contextOutRef ? loadArtifactRef(runDir, contextOutRef) : null;
  const obligations = Array.isArray(contextOut?.payload?.unresolvedObligations)
    ? contextOut.payload.unresolvedObligations
    : [];
  const byKind = obligations.reduce((acc, obligation) => {
    const kind = typeof obligation?.kind === 'string' ? obligation.kind : 'unknown';
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});
  return {
    unresolvedCount: obligations.length,
    byKind,
  };
}

function summarizeSeasonCanon(runDir) {
  const canon = readJsonIfExists(path.join(runDir, 'season-canon.json'));
  if (!canon || canon.version !== 1) {
    return {
      present: false,
      sealedEpisodeCount: 0,
      sealedEpisodes: [],
      worldFactCount: 0,
      knowledgeCount: 0,
      relationshipCount: 0,
      numericViolationCount: 0,
    };
  }
  return {
    present: true,
    storyId: canon.storyId,
    sealedEpisodeCount: Array.isArray(canon.sealedEpisodes) ? canon.sealedEpisodes.length : 0,
    sealedEpisodes: Array.isArray(canon.sealedEpisodes) ? canon.sealedEpisodes : [],
    worldFactCount: Array.isArray(canon.worldFacts) ? canon.worldFacts.length : 0,
    knowledgeCount: Array.isArray(canon.knowledge) ? canon.knowledge.length : 0,
    relationshipCount: Array.isArray(canon.relationships) ? canon.relationships.length : 0,
    numericViolationCount: Array.isArray(canon.numericViolations) ? canon.numericViolations.length : 0,
  };
}

function listEpisodeNumbers(runDir) {
  const episodesDir = path.join(runDir, 'artifacts', 'episodes');
  if (!fs.existsSync(episodesDir)) return [];
  return fs.readdirSync(episodesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

function scanArtifactRun(storiesDir, runId) {
  const runDir = resolveInside(storiesDir, runId);
  if (!runDir || !fs.existsSync(path.join(runDir, 'artifacts'))) return null;
  const globals = summarizeCurrentIndex(runDir);
  const episodes = listEpisodeNumbers(runDir).map((episodeNumber) => {
    const summary = summarizeCurrentIndex(runDir, episodeNumber);
    return {
      episodeNumber,
      ...summary,
      lock: summarizeEpisodeLock(runDir, episodeNumber, summary.status),
      obligations: summarizeContextOutObligations(runDir, episodeNumber),
    };
  });
  return {
    runId,
    status: rollupStatus([globals, ...episodes]),
    canon: summarizeSeasonCanon(runDir),
    globals,
    episodes,
  };
}

function listArtifactRuns(storiesDir) {
  if (!fs.existsSync(storiesDir)) return [];
  return fs.readdirSync(storiesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(storiesDir, name, 'artifacts')))
    .sort((a, b) => {
      const aStat = fs.statSync(path.join(storiesDir, a, 'artifacts'));
      const bStat = fs.statSync(path.join(storiesDir, b, 'artifacts'));
      return bStat.mtimeMs - aStat.mtimeMs;
    });
}

function registerArtifactRoutes(app, { storiesDir }) {
  if (!storiesDir) throw new Error('registerArtifactRoutes requires storiesDir');

  app.get('/artifacts/health', (req, res) => {
    const rawRunId = typeof req.query.runId === 'string' ? req.query.runId.trim() : '';
    if (rawRunId && (rawRunId.includes('..') || path.isAbsolute(rawRunId))) {
      return res.status(400).json({ success: false, error: 'Invalid runId' });
    }

    const runIds = rawRunId ? [rawRunId] : listArtifactRuns(storiesDir).slice(0, 12);
    const runs = runIds
      .map((runId) => scanArtifactRun(storiesDir, runId))
      .filter(Boolean);

    return res.json({ success: true, runs });
  });
}

module.exports = {
  registerArtifactRoutes,
  scanArtifactRun,
  evaluateArtifactRef,
};
