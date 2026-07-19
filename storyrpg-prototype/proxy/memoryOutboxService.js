const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_ATTEMPTS = 8;
const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

const SUPPORTED_LLM_PROVIDERS = new Set(['anthropic', 'openai', 'gemini', 'mistral', 'ollama', 'bedrock']);

function createMemoryOutboxService({ memoryRoot, lifecycle, baseUrl, apiKey, token, llmApiKeys = {} }) {
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
  let activeLlmTargetKey = null;

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

  function recoverInterruptedProcessing() {
    let recovered = 0;
    for (const file of fs.readdirSync(processingDir).filter((entry) => entry.endsWith('.json')).sort()) {
      const source = path.join(processingDir, file);
      const destination = path.join(pendingDir, file);
      try {
        const entry = JSON.parse(fs.readFileSync(source, 'utf8'));
        entry.recoveredAt = new Date().toISOString();
        delete entry.nextAttemptAt;
        atomicWrite(destination, entry);
        fs.rmSync(source, { force: true });
        recovered += 1;
      } catch (error) {
        console.warn('[CogneeOutbox] processing recovery failed:', error?.message || error);
      }
    }
    return recovered;
  }

  function enqueue(record) {
    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const entry = { schemaVersion: 1, id, createdAt: new Date().toISOString(), attempts: 0, record };
    atomicWrite(path.join(pendingDir, `${id}.json`), entry);
    void drain();
    return { id, queued: true };
  }

  function isRetryable(error) {
    return /\b(408|409|423|429|500|502|503|504)\b|fetch failed|timeout|abort|lock|econn|enotfound|network/i.test(String(error?.message || error));
  }

  function retryDelayMs(attempts) {
    return Math.min(INITIAL_RETRY_DELAY_MS * (2 ** Math.max(0, attempts - 1)), MAX_RETRY_DELAY_MS);
  }

  async function configureLlmForRecord(record) {
    const target = record.cogneeLlmTarget;
    if (!target) return;
    if (!SUPPORTED_LLM_PROVIDERS.has(target.provider) || !target.model) {
      throw new Error(`Unsupported Cognee LLM target: ${target.provider || 'unknown'}/${target.model || 'unknown'}`);
    }
    // LiteLLM interprets an unprefixed gemini-* model as Vertex AI in this
    // Cognee image. The generator uses an API-key Gemini route, which needs
    // the explicit provider prefix (and must match pipelineMemory.ts).
    const model = target.provider === 'gemini' && !target.model.includes('/')
      ? `gemini/${target.model}`
      : target.model;
    const targetKey = `${target.provider}:${model}`;
    if (activeLlmTargetKey === targetKey) return;
    const providerKey = llmApiKeys[target.provider];
    const response = await fetch(endpoint('settings'), {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({
        llm: {
          provider: target.provider,
          model,
          ...(providerKey ? { apiKey: providerKey } : {}),
        },
      }),
    });
    if (!response.ok) throw new Error(`Cognee LLM settings failed: ${response.status} ${await response.text()}`);
    activeLlmTargetKey = targetKey;
  }

  async function addRecord(record) {
    await configureLlmForRecord(record);
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
        let queuedEntry;
        try {
          queuedEntry = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
          const nextAttemptAt = Date.parse(queuedEntry.nextAttemptAt || '');
          if (Number.isFinite(nextAttemptAt) && nextAttemptAt > Date.now()) continue;
        } catch {
          // Let the existing processing path surface malformed records in the
          // normal dead-letter handling below.
        }
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
          const retryable = isRetryable(error);
          if (retryable && entry.attempts < MAX_ATTEMPTS) {
            entry.nextAttemptAt = new Date(Date.now() + retryDelayMs(entry.attempts)).toISOString();
          } else {
            delete entry.nextAttemptAt;
          }
          const destination = !retryable || entry.attempts >= MAX_ATTEMPTS
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
    const entries = (dir) => fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
    const count = (dir) => entries(dir).length;
    const oldestPendingAgeMs = (() => {
      const pending = entries(pendingDir);
      if (!pending.length) return null;
      const oldest = pending.reduce((min, file) => {
        const createdAt = Date.parse(JSON.parse(fs.readFileSync(path.join(pendingDir, file), 'utf8')).createdAt);
        return Number.isFinite(createdAt) ? Math.min(min, createdAt) : min;
      }, Date.now());
      return Math.max(0, Date.now() - oldest);
    })();
    return {
      pending: count(pendingDir),
      processing: count(processingDir),
      completed: count(completedDir),
      deadLetter: count(deadLetterDir),
      dirtyDatasets: loadDirtyDatasets().size,
      oldestPendingAgeMs,
      draining,
      activeStoryWorkers: lifecycle.activeWorkers.size,
    };
  }

  function retryDeadLetters() {
    if (lifecycle.activeWorkers.size > 0) return { ...status(), requeued: 0 };
    let requeued = 0;
    for (const file of fs.readdirSync(deadLetterDir).filter((entry) => entry.endsWith('.json')).sort()) {
      const source = path.join(deadLetterDir, file);
      const destination = path.join(pendingDir, file);
      try {
        const entry = JSON.parse(fs.readFileSync(source, 'utf8'));
        entry.attempts = 0;
        entry.requeuedAt = new Date().toISOString();
        delete entry.nextAttemptAt;
        atomicWrite(destination, entry);
        fs.rmSync(source, { force: true });
        requeued += 1;
      } catch (error) {
        console.warn('[CogneeOutbox] dead-letter replay preparation failed:', error?.message || error);
      }
    }
    void drain();
    return { ...status(), requeued };
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
    app.post('/internal/memory/outbox/retry-dead-letter', (req, res) => {
      if (!authorize(req, res)) return;
      res.json(retryDeadLetters());
    });
  }

  recoverInterruptedProcessing();
  const timer = setInterval(() => { void drain(); }, 2_000);
  timer.unref?.();
  return { enqueue, drain, status, retryDeadLetters, registerRoutes, stop: () => clearInterval(timer) };
}

module.exports = { createMemoryOutboxService };
