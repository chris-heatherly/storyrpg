import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/ai-agents/config';
import { parseDocument } from '../src/ai-agents/utils/documentParser';

const PROXY = process.env.EXPO_PUBLIC_PROXY_URL || 'http://localhost:3001';
const TREATMENT = process.argv[2] || path.resolve(__dirname, '../../treatments/Bite_Me_StoryRPG_Lite_Treatment.md');

type WorkerJob = {
  id: string;
  status: string;
  currentPhase?: string;
  progress?: number;
  error?: string;
  resultPath?: string;
};

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function startJob(body: Record<string, unknown>): Promise<string> {
  const resp = await fetch(`${PROXY}/worker-jobs/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`worker start failed (${resp.status}): ${await resp.text()}`);
  }
  const data = await resp.json() as { jobId: string };
  if (!data.jobId) throw new Error('worker start missing jobId');
  return data.jobId;
}

async function getJob(jobId: string): Promise<(WorkerJob & { result?: Record<string, unknown> }) | null> {
  const resp = await fetch(`${PROXY}/worker-jobs/${jobId}`);
  if (!resp.ok) return null;
  return await resp.json() as WorkerJob & { result?: Record<string, unknown> };
}

async function waitForJob(jobId: string, label: string): Promise<Record<string, unknown>> {
  let lastPhase = '';
  while (true) {
    const job = await getJob(jobId);
    if (!job) throw new Error(`${label}: job ${jobId} not found`);
    const phase = job.currentPhase || job.status;
    if (phase !== lastPhase) {
      log(`${label}: ${phase} (${job.progress ?? 0}%)`);
      lastPhase = phase;
    }
    if (job.status === 'completed') {
      if (job.result && typeof job.result === 'object') {
        return job.result;
      }
      throw new Error(`${label}: completed but proxy result cache is empty (retry soon or check /worker-jobs/${jobId})`);
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(`${label}: ${job.status} — ${job.error || '(no error message)'}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

function buildConfig() {
  const config = loadConfig();
  config.generation = { ...(config.generation ?? {}), assetGenerationMode: 'story-only' };
  if (config.imageGen) config.imageGen.enabled = false;
  if (config.videoGen) config.videoGen.enabled = false;
  if (config.qualityCouncil) config.qualityCouncil.enabled = false;
  if (config.narration) config.narration.enabled = false;
  return config;
}

async function main(): Promise<void> {
  const treatment = fs.readFileSync(TREATMENT, 'utf8');
  const parsed = parseDocument(treatment, path.basename(TREATMENT));
  if (!parsed.success || !parsed.brief) {
    throw new Error(parsed.error || 'parseDocument failed');
  }
  const config = buildConfig();
  const architect = config.agents?.storyArchitect;
  log(`config provider=${architect?.provider} model=${architect?.model} assets=story-only council=off`);

  // Analysis results are expensive (~10 min of LLM calls) and deterministic
  // inputs to generation — persist them on disk so a failed generation attempt
  // can be retried without re-running analysis (the proxy's in-memory job
  // result cache is purged too aggressively to rely on).
  const analysisCachePath = path.resolve(__dirname, '../generated-stories/.analysis-cache/bite-me-ep1.json');
  const resumeAnalysisJobId = process.env.SKIP_ANALYSIS_JOB_ID?.trim();
  let analysisResult: Record<string, unknown>;
  if (resumeAnalysisJobId) {
    log(`reusing completed analysis job: ${resumeAnalysisJobId}`);
    const job = await getJob(resumeAnalysisJobId);
    if (!job || job.status !== 'completed' || !job.result) {
      throw new Error(`analysis job ${resumeAnalysisJobId} not completed with cached result`);
    }
    analysisResult = job.result;
  } else if (process.env.REUSE_ANALYSIS === '1' && fs.existsSync(analysisCachePath)) {
    log(`reusing analysis result from disk: ${analysisCachePath}`);
    analysisResult = JSON.parse(fs.readFileSync(analysisCachePath, 'utf8')) as Record<string, unknown>;
  } else {
    const analysisJobId = await startJob({
      mode: 'analysis',
      storyTitle: 'Bite Me',
      idempotencyKey: `analysis:bite-me:${Date.now()}`,
      payload: {
        config,
        analysisInput: {
          sourceText: treatment,
          title: parsed.brief.story?.title || 'Bite Me',
          preferences: { targetScenesPerEpisode: 6, pacing: 'moderate' as const },
        },
      },
    });
    log(`analysis job started: ${analysisJobId}`);
    analysisResult = await waitForJob(analysisJobId, 'analysis');
    if (analysisResult.success) {
      fs.mkdirSync(path.dirname(analysisCachePath), { recursive: true });
      fs.writeFileSync(analysisCachePath, JSON.stringify(analysisResult));
      log(`analysis result cached to disk: ${analysisCachePath} (retry with REUSE_ANALYSIS=1)`);
    }
  }

  if (!analysisResult.success) {
    throw new Error(`analysis failed: ${String(analysisResult.error || 'unknown')}`);
  }
  const seasonPlan = analysisResult.seasonPlan as Record<string, unknown> | undefined;
  if (!seasonPlan) {
    throw new Error(`analysis missing seasonPlan: ${String(analysisResult.seasonPlanError || 'unknown')}`);
  }

  const brief = { ...parsed.brief, seasonPlan };
  const generationJobId = await startJob({
    mode: 'generation',
    storyTitle: 'Bite Me',
    episodeCount: 1,
    idempotencyKey: `generation:bite-me:ep1:${Date.now()}`,
    payload: {
      config,
      generationInput: {
        brief,
        sourceAnalysis: analysisResult.sourceAnalysis,
        episodeRange: { start: 1, end: 1 },
      },
    },
  });
  log(`generation job started: ${generationJobId}`);

  const genResult = await waitForJob(generationJobId, 'generation');
  if (!genResult.success) {
    throw new Error(`generation failed: ${String(genResult.error || 'unknown')}`);
  }
  const outputDirectory = (genResult as { outputDirectory?: string }).outputDirectory;
  log(`✅ Bite Me EP1 complete`);
  log(`RUN DIR: ${outputDirectory || '(see worker result)'}`);
}

main().catch((err) => {
  console.error(`\n[run] ✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
