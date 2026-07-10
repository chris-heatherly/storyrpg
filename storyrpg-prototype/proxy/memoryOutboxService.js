const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createMemoryOutboxService({ memoryRoot, lifecycle, baseUrl, apiKey, token }) {
  if (!memoryRoot || !lifecycle || !baseUrl || !token) {
    throw new Error('createMemoryOutboxService requires memoryRoot, lifecycle, baseUrl, and token');
  }

  const root = path.join(memoryRoot, 'cognee-outbox');
  const pendingDir = path.join(root, 'pending');
  const processingDir = path.join(root, 'processing');
  const completedDir = path.join(root, 'completed');
  const deadLetterDir = path.join(root, 'dead-letter');
  const dirtyDatasetsFile = path.join(root, 'dirty-datasets.json');
  for (const dir of [pendingDir, processingDir, completedDir, deadLetterDir]) fs.mkdirSync(dir, { recursive: true });

  let draining = false;

  const headers = (json = true) => {
    const value = {};
    if (json) value['Content-Type'] = 'application/json';
    if (apiKey) value['X-Api-Key'] = apiKey;
    return value;
  };

  const endpoint = (name) => `${baseUrl.replace(/\/+$/, '')}/api/v1/${name}`;

  function atomicWrite(file, value) {
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }

  function loadDirtyDatasets() {
    try {
      const parsed = JSON.parse(fs.readFileSync(dirtyDatasetsFile, 'utf8'));
      return Array.isArray(parsed) ? new Set(parsed.filter((value) => typeof value === 'string')) : new Set();
    } catch {
      return new Set();
    }
  }

  function saveDirtyDatasets(datasets) {
    atomicWrite(dirtyDatasetsFile, Array.from(datasets).sort());
  }

  function enqueue(record) {
    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const entry = { schemaVersion: 1, id, createdAt: new Date().toISOString(), attempts: 0, record };
    atomicWrite(path.join(pendingDir, `${id}.json`), entry);
    void drain();
    return { id, queued: true };
  }

  function isRetryable(error) {
    return /\b(408|409|423|429|500|502|503|504)\b|timeout|abort|lock|econn|network/i.test(String(error?.message || error));
  }

  async function addRecord(record) {
    const body = new FormData();
    body.append('data', new Blob([[
      `# ${record.title}`,
      `Kind: ${record.kind}`,
      record.metadata ? `Metadata:\n${JSON.stringify(record.metadata, null, 2)}` : null,
      '',
      record.text,
    ].filter((part) => part != null).join('\n')], { type: 'text/markdown' }), `${String(record.title || 'memory').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'memory'}.md`);
    body.append('datasetName', record.dataset || 'storyrpg-project');
    for (const node of record.nodeSet || []) body.append('node_set', node);
    body.append('run_in_background', 'true');
    const response = await fetch(endpoint('add'), { method: 'POST', headers: headers(false), body });
    if (!response.ok) throw new Error(`Cognee add failed: ${response.status} ${await response.text()}`);
  }

  async function cognifyDirtyDatasets() {
    const dirty = loadDirtyDatasets();
    if (!dirty.size) return;
    const datasets = Array.from(dirty);
    const response = await fetch(endpoint('cognify'), {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ datasets, runInBackground: true, run_in_background: true }),
    });
    if (!response.ok) throw new Error(`Cognee cognify failed: ${response.status} ${await response.text()}`);
    saveDirtyDatasets(new Set());
  }

  async function drain() {
    if (draining || lifecycle.activeWorkers.size > 0) return;
    draining = true;
    try {
      const files = fs.readdirSync(pendingDir).filter((file) => file.endsWith('.json')).sort();
      const dirty = loadDirtyDatasets();
      for (const file of files) {
        if (lifecycle.activeWorkers.size > 0) break;
        const pendingPath = path.join(pendingDir, file);
        const processingPath = path.join(processingDir, file);
        try {
          fs.renameSync(pendingPath, processingPath);
        } catch {
          continue;
        }
        let entry;
        try {
          entry = JSON.parse(fs.readFileSync(processingPath, 'utf8'));
          await addRecord(entry.record);
          dirty.add(entry.record.dataset || 'storyrpg-project');
          fs.renameSync(processingPath, path.join(completedDir, file));
        } catch (error) {
          entry = entry || { attempts: 0 };
          entry.attempts = Number(entry.attempts || 0) + 1;
          entry.lastError = String(error?.message || error).slice(0, 2000);
          entry.lastAttemptAt = new Date().toISOString();
          const destination = !isRetryable(error) || entry.attempts >= 8
            ? path.join(deadLetterDir, file)
            : path.join(pendingDir, file);
          atomicWrite(destination, entry);
          fs.rmSync(processingPath, { force: true });
        }
      }
      saveDirtyDatasets(dirty);
      if (lifecycle.activeWorkers.size === 0) await cognifyDirtyDatasets();
    } catch (error) {
      console.warn('[CogneeOutbox] drain failed:', error?.message || error);
    } finally {
      draining = false;
    }
  }

  function status() {
    const count = (dir) => fs.readdirSync(dir).filter((file) => file.endsWith('.json')).length;
    return {
      pending: count(pendingDir),
      processing: count(processingDir),
      completed: count(completedDir),
      deadLetter: count(deadLetterDir),
      dirtyDatasets: loadDirtyDatasets().size,
      draining,
      activeStoryWorkers: lifecycle.activeWorkers.size,
    };
  }

  function authorize(req, res) {
    if (req.get('X-StoryRPG-Memory-Token') === token) return true;
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }

  function registerRoutes(app) {
    app.post('/internal/memory/outbox', (req, res) => {
      if (!authorize(req, res)) return;
      if (!req.body?.record || typeof req.body.record !== 'object') return res.status(400).json({ error: 'Missing record' });
      res.status(202).json(enqueue(req.body.record));
    });
    app.post('/internal/memory/outbox/drain', (req, res) => {
      if (!authorize(req, res)) return;
      void drain();
      res.json(status());
    });
    app.get('/internal/memory/outbox/status', (req, res) => {
      if (!authorize(req, res)) return;
      res.json(status());
    });
  }

  const timer = setInterval(() => { void drain(); }, 2_000);
  timer.unref?.();
  return { enqueue, drain, status, registerRoutes, stop: () => clearInterval(timer) };
}

module.exports = { createMemoryOutboxService };
