/**
 * Syncs worker job state into the generation jobs mirror.
 * Used so the UI can see worker progress via the /generation-jobs API.
 */

function createSyncGenerationMirrorFromWorker(deps) {
  const { loadCheckpoints, loadJobs, saveJobs } = deps;

  function getResumeSourceId(job) {
    return job?.resumeFromJobId
      || job?.resumeContext?.resumeFromJobId
      || job?.checkpoint?.resumeContext?.resumeFromJobId;
  }

  function getProjectId(job, jobs) {
    if (job?.projectId) return job.projectId;
    const byId = new Map(jobs.map((candidate) => [candidate.id, candidate]));
    const seen = new Set([job?.id].filter(Boolean));
    let cursor = job;

    while (cursor) {
      const sourceId = getResumeSourceId(cursor);
      if (!sourceId || seen.has(sourceId)) break;
      seen.add(sourceId);
      const source = byId.get(sourceId);
      if (!source) return sourceId;
      if (source.projectId) return source.projectId;
      cursor = source;
    }

    return cursor?.id || job?.id;
  }

  return function syncGenerationMirrorFromWorker(workerJob) {
    if (workerJob.mode !== 'generation' && workerJob.mode !== 'image-generation') return;
    const workerCheckpoint = loadCheckpoints().find((c) => c.jobId === workerJob.id);
    const jobs = loadJobs();
    const idx = jobs.findIndex((j) => j.id === workerJob.id);
    const resumeFromJobId = getResumeSourceId(workerJob) || workerCheckpoint?.resumeContext?.resumeFromJobId;
    const projectId = getProjectId({ ...workerJob, resumeFromJobId }, jobs);
    const mapped = {
      id: workerJob.id,
      projectId,
      resumeFromJobId,
      storyTitle: workerJob.storyTitle || 'Untitled Story',
      startedAt: workerJob.startedAt || workerJob.createdAt,
      updatedAt: workerJob.updatedAt || new Date().toISOString(),
      status: workerJob.status,
      currentPhase: workerJob.currentPhase || 'initialization',
      progress: workerJob.progress || 0,
      episodeCount: workerJob.episodeCount || 1,
      currentEpisode: workerJob.currentEpisode || 1,
      error: workerJob.error,
      outputDir: workerCheckpoint?.resumeContext?.outputDirectory
        || workerCheckpoint?.outputs?.output_directory?.outputDirectory
        || workerJob.resumeContext?.outputDirectory,
      events: (workerJob.timeline || []).slice(-30).map((e) => ({
        type: e.eventType || 'debug',
        phase: e.phase,
        agent: e.agent,
        message: e.message || e.type || 'event',
        timestamp: e.timestamp || new Date().toISOString(),
        telemetry: e.telemetry,
      })),
      etaSeconds: typeof workerJob.etaSeconds === 'number' ? workerJob.etaSeconds : undefined,
      phaseProgress: typeof workerJob.phaseProgress === 'number' ? workerJob.phaseProgress : undefined,
      currentItem: typeof workerJob.currentItem === 'number' ? workerJob.currentItem : undefined,
      totalItems: typeof workerJob.totalItems === 'number' ? workerJob.totalItems : undefined,
      subphaseLabel: typeof workerJob.subphaseLabel === 'string' ? workerJob.subphaseLabel : undefined,
      checkpoint: {
        isResumable: workerJob.status === 'failed' || workerJob.status === 'cancelled',
        resumeHint: workerJob.error ? `Failed: ${workerJob.error}` : undefined,
        failureContext: workerJob.failureContext || workerCheckpoint?.failureContext,
        resumeContext: workerCheckpoint?.resumeContext,
        outputs: workerCheckpoint?.outputs,
      },
    };
    if (idx >= 0) jobs[idx] = { ...jobs[idx], ...mapped };
    else jobs.unshift(mapped);
    if (jobs.length > 50) jobs.length = 50;
    saveJobs(jobs);
  };
}

module.exports = {
  createSyncGenerationMirrorFromWorker,
};
