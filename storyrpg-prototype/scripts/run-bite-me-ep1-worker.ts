/**
 * Bite Me EP1 worker launcher (text-only).
 *
 * LLM policy:
 * - Primary (from .env): runs BOTH structural analysis and generation (Gemini by default).
 * - Fable is NEVER used for generation. If primary analysis fails, retry analysis once
 *   with ANALYSIS_FALLBACK_* (default anthropic/claude-fable-5), cache the result, then
 *   run generation on the primary model only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, type AgentConfig, type PipelineConfig } from '../src/ai-agents/config';
import { parseDocument } from '../src/ai-agents/utils/documentParser';
import { readAnalysisCache, writeAnalysisCache, type AnalysisCacheIdentity } from './analysisCache';

const PROXY = process.env.EXPO_PUBLIC_PROXY_URL || 'http://localhost:3001';
const TREATMENT = process.argv[2] || path.resolve(__dirname, '../../treatments/Bite_Me_StoryRPG_Lite_Treatment.md');
const ANALYSIS_OPTIONS = { targetScenesPerEpisode: 6, pacing: 'moderate' as const };

function analysisCacheIdentity(
  config: PipelineConfig,
  treatment: string,
  briefTitle: string,
): AnalysisCacheIdentity {
  // SourceMaterialAnalyzer/SeasonPlanner use the architecture-tier profile.
  const agent = config.agents?.storyArchitect;
  return {
    sourceText: treatment,
    provider: agent?.provider || 'unknown',
    model: agent?.model || 'unknown',
    options: { title: briefTitle, preferences: ANALYSIS_OPTIONS },
  };
}

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

function resolveProviderApiKey(provider: AgentConfig['provider']): string {
  if (provider === 'gemini') return process.env.GEMINI_API_KEY || '';
  if (provider === 'openai') return process.env.OPENAI_API_KEY || '';
  if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY || '';
  return process.env.ANTHROPIC_API_KEY || '';
}

/** Patch every narrative agent slot to a single provider/model (analysis fallback only). */
function applyLlmProfile(config: PipelineConfig, provider: AgentConfig['provider'], model: string): PipelineConfig {
  const apiKey = resolveProviderApiKey(provider);
  const patched: PipelineConfig = JSON.parse(JSON.stringify(config));
  for (const agent of Object.values(patched.agents)) {
    if (agent && typeof agent === 'object' && 'provider' in agent) {
      agent.provider = provider;
      agent.model = model;
      agent.apiKey = apiKey;
    }
  }
  return patched;
}

function buildConfig() {
  const config = loadConfig();
  config.generation = { ...(config.generation ?? {}), assetGenerationMode: 'story-only' };
  if (config.imageGen) config.imageGen.enabled = false;
  if (config.videoGen) config.videoGen.enabled = false;
  if (config.qualityCouncil) config.qualityCouncil.enabled = false;
  if (config.narration) config.narration.enabled = false;
  // Story runs are Gemini text-only. .env may point agents at Anthropic for
  // interactive use; override here so Ep1 jobs stay on the intended provider.
  const provider = (process.env.STORY_LLM_PROVIDER || 'gemini') as AgentConfig['provider'];
  const model = process.env.STORY_LLM_MODEL || 'gemini-2.5-pro';
  return applyLlmProfile(config, provider, model);
}

async function runAnalysisJob(
  config: PipelineConfig,
  treatment: string,
  briefTitle: string,
  analysisCachePath: string,
): Promise<Record<string, unknown>> {
  const analysisJobId = await startJob({
    mode: 'analysis',
    storyTitle: 'Bite Me',
    idempotencyKey: `analysis:bite-me:${Date.now()}`,
    payload: {
      config,
      analysisInput: {
        sourceText: treatment,
        title: briefTitle,
        preferences: ANALYSIS_OPTIONS,
      },
    },
  });
  const architect = config.agents?.storyArchitect;
  log(`analysis job started: ${analysisJobId} (provider=${architect?.provider} model=${architect?.model})`);
  const analysisResult = await waitForJob(analysisJobId, 'analysis');
  if (analysisResult.success) {
    fs.mkdirSync(path.dirname(analysisCachePath), { recursive: true });
    writeAnalysisCache(
      analysisCachePath,
      analysisCacheIdentity(config, treatment, briefTitle),
      analysisResult,
    );
    log(`analysis result cached to disk: ${analysisCachePath} (retry with REUSE_ANALYSIS=1)`);
  }
  return analysisResult;
}

async function main(): Promise<void> {
  const treatment = fs.readFileSync(TREATMENT, 'utf8');
  const parsed = parseDocument(treatment, path.basename(TREATMENT));
  if (!parsed.success || !parsed.brief) {
    throw new Error(parsed.error || 'parseDocument failed');
  }
  const primaryConfig = buildConfig();
  const architect = primaryConfig.agents?.storyArchitect;
  log(`generation LLM (primary): provider=${architect?.provider} model=${architect?.model} assets=story-only council=off`);

  // Analysis results are expensive (~10 min of LLM calls) and deterministic
  // inputs to generation — persist them on disk so a failed generation attempt
  // can be retried without re-running analysis (the proxy's in-memory job
  // result cache is purged too aggressively to rely on).
  const analysisCachePath = path.resolve(__dirname, '../generated-stories/.analysis-cache/bite-me-ep1.json');
  const resumeAnalysisJobId = process.env.SKIP_ANALYSIS_JOB_ID?.trim();
  const briefTitle = parsed.brief.story?.title || 'Bite Me';
  let analysisResult: Record<string, unknown>;
  if (resumeAnalysisJobId) {
    log(`reusing completed analysis job: ${resumeAnalysisJobId}`);
    const job = await getJob(resumeAnalysisJobId);
    if (!job || job.status !== 'completed' || !job.result) {
      throw new Error(`analysis job ${resumeAnalysisJobId} not completed with cached result`);
    }
    analysisResult = job.result;
  } else if (process.env.REUSE_ANALYSIS === '1' && fs.existsSync(analysisCachePath)) {
    const cached = readAnalysisCache<Record<string, unknown>>(
      analysisCachePath,
      analysisCacheIdentity(primaryConfig, treatment, briefTitle),
    );
    if (cached) {
      log(`reusing fingerprint-matched analysis result from disk: ${analysisCachePath}`);
      analysisResult = cached;
    } else {
      log(`analysis cache is stale or incompatible; regenerating: ${analysisCachePath}`);
      analysisResult = await runAnalysisJob(primaryConfig, treatment, briefTitle, analysisCachePath);
    }
  } else {
    try {
      analysisResult = await runAnalysisJob(primaryConfig, treatment, briefTitle, analysisCachePath);
    } catch (primaryErr) {
      const fallbackProvider = (process.env.ANALYSIS_FALLBACK_PROVIDER || 'anthropic') as AgentConfig['provider'];
      const fallbackModel = process.env.ANALYSIS_FALLBACK_MODEL || 'claude-fable-5';
      log(
        `primary analysis failed: ${primaryErr instanceof Error ? primaryErr.message : primaryErr}; `
        + `retrying structural analysis only with ${fallbackProvider}/${fallbackModel} (generation stays on primary)`,
      );
      const fallbackConfig = applyLlmProfile(primaryConfig, fallbackProvider, fallbackModel);
      analysisResult = await runAnalysisJob(fallbackConfig, treatment, briefTitle, analysisCachePath);
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
  // Generation always uses the primary LLM profile — never the Fable analysis fallback.
  const generationJobId = await startJob({
    mode: 'generation',
    storyTitle: 'Bite Me',
    episodeCount: 1,
    idempotencyKey: `generation:bite-me:ep1:${Date.now()}`,
    payload: {
      config: primaryConfig,
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
