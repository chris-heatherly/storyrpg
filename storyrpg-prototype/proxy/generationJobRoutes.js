/**
 * Client-facing generation job tracking.
 *
 *   GET    /generation-jobs              — list (stale-filtered)
 *   GET    /generation-jobs/all          — legacy alias
 *   POST   /generation-jobs/refresh      — diagnostics helper
 *   POST   /generation-jobs              — register (upsert)
 *   GET    /generation-jobs/:jobId       — fetch one
 *   PATCH  /generation-jobs/:jobId       — update / upsert
 *   POST   /generation-jobs/:jobId/cancel — cancel (delegates to worker if applicable)
 *   DELETE /generation-jobs/:jobId       — delete
 *   GET    /generation-jobs/:jobId/status — lightweight cancel-poll
 */

function registerGenerationJobRoutes(app, lifecycle) {
  const {
    loadJobs,
    saveJobs,
    normalizeStaleRunningJobs,
    loadWorkerJobs,
    upsertWorkerJob,
    syncGenerationMirrorFromWorker,
    activeWorkers,
  } = lifecycle;

  app.get('/generation-jobs', (req, res) => {
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    res.json(normalized);
  });

  app.get('/generation-jobs/all', (req, res) => {
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    res.json(normalized);
  });

  app.post('/generation-jobs/refresh', (req, res) => {
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    res.json({ success: true, changed, count: normalized.length });
  });

  app.post('/generation-jobs', (req, res) => {
    const job = req.body;
    if (!job || !job.id) {
      return res.status(400).json({ error: 'Invalid job data' });
    }

    const jobs = loadJobs();
    const existingIndex = jobs.findIndex((j) => j.id === job.id);

    if (existingIndex >= 0) {
      jobs[existingIndex] = job;
    } else {
      jobs.unshift(job);
    }

    if (jobs.length > 50) {
      jobs.length = 50;
    }

    saveJobs(jobs);
    console.log(`[Proxy] Registered generation job: ${job.id} - ${job.storyTitle}`);
    res.json({ success: true });
  });

  app.get('/generation-jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    const job = normalized.find((j) => j.id === jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  });

  app.patch('/generation-jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    const updates = req.body;

    const jobs = loadJobs();
    const jobIndex = jobs.findIndex((j) => j.id === jobId);

    if (jobIndex < 0) {
      const newJob = { id: jobId, ...updates, startedAt: updates.startedAt || new Date().toISOString() };
      jobs.unshift(newJob);
      if (jobs.length > 50) jobs.length = 50;
      saveJobs(jobs);
      console.log(`[Proxy] Upserted generation job via PATCH: ${jobId}`);
      return res.json({ success: true, upserted: true });
    }

    jobs[jobIndex] = { ...jobs[jobIndex], ...updates };
    saveJobs(jobs);
    res.json({ success: true });
  });

  app.post('/generation-jobs/:jobId/cancel', (req, res) => {
    const { jobId } = req.params;
    const workerJob = loadWorkerJobs().find((j) => j.id === jobId);
    if (workerJob) {
      upsertWorkerJob(jobId, { status: 'cancelled', error: 'Cancelled by user' });
      const active = activeWorkers.get(jobId);
      if (active?.proc && !active.proc.killed) {
        try { active.proc.kill('SIGTERM'); } catch {
          // best-effort; already-dead processes throw ESRCH
        }
      }
      const updatedWorkerJob = loadWorkerJobs().find((j) => j.id === jobId);
      if (updatedWorkerJob) {
        syncGenerationMirrorFromWorker(updatedWorkerJob);
      }
      return res.json({ success: true, jobId, delegatedTo: 'worker-jobs' });
    }

    const jobs = loadJobs();
    const jobIndex = jobs.findIndex((j) => j.id === jobId);

    if (jobIndex < 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    jobs[jobIndex].status = 'cancelled';
    jobs[jobIndex].updatedAt = new Date().toISOString();
    saveJobs(jobs);
    console.log(`[Proxy] Cancelled generation job: ${jobId}`);
    res.json({ success: true });
  });

  app.delete('/generation-jobs/:jobId', (req, res) => {
    const { jobId } = req.params;

    let jobs = loadJobs();
    const initialLength = jobs.length;
    jobs = jobs.filter((j) => j.id !== jobId);

    if (jobs.length < initialLength) {
      saveJobs(jobs);
      console.log(`[Proxy] Deleted generation job: ${jobId}`);
    }

    res.json({ success: true });
  });

  app.get('/generation-jobs/:jobId/status', (req, res) => {
    const { jobId } = req.params;
    const jobs = loadJobs();
    const { normalized, changed } = normalizeStaleRunningJobs(jobs);
    if (changed) saveJobs(normalized);
    const job = normalized.find((j) => j.id === jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ status: job.status, cancelled: job.status === 'cancelled' });
  });
}

module.exports = { registerGenerationJobRoutes };
