/**
 * Bite Me EP1 worker launcher (text-only).
 *
 * LLM policy: Gemini-only analysis and generation, text-only, Quality Council off.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_GEMINI_SETTINGS,
  DEFAULT_MIDJOURNEY_SETTINGS,
  DEFAULT_OPENAI_SETTINGS,
  DEFAULT_VIDEO_SETTINGS,
  type PipelineConfig,
} from '../src/ai-agents/config';
import {
  buildGeneratorPipelineConfig,
  prepareAnalysisJob,
  prepareGenerationJob,
  submitWorkerJob,
  type GeneratorPipelineConfigInput,
} from '../src/ai-agents/launch';
import type { WorkerJobStartRequest } from '../src/ai-agents/server/workerPayload';
import { DEFAULT_GENERATION_SETTINGS } from '../src/config/generatorRuntimeSettings';
import type { SourceMaterialAnalysis } from '../src/types/sourceAnalysis';
import type { SeasonPlan } from '../src/types/seasonPlan';
import { parseDocument } from '../src/ai-agents/utils/documentParser';
import { readAnalysisCache, writeAnalysisCache, type AnalysisCacheIdentity } from './analysisCache';

const PROXY = process.env.EXPO_PUBLIC_PROXY_URL || 'http://localhost:3001';
const TREATMENT = process.argv[2] || path.resolve(__dirname, '../../treatments/Bite_Me_StoryRPG_Lite_Treatment.md');
const ANALYSIS_OPTIONS = { targetScenesPerEpisode: 6, pacing: 'moderate' as const };
const GENERATED_STORIES_DIR = path.resolve(__dirname, '../generated-stories');

/**
 * Bite Me Ep1 canary numbering:
 * N = count(existing generated-stories/storyrpg-lite-treatment*) + 1
 * (override with BITE_ME_RUN_NUMBER). Human id: bite-me-ep1-rN.
 * Folder slug becomes storyrpg-lite-treatment-rN_<timestamp>.
 */
function countPriorLiteTreatmentRuns(): number {
  if (!fs.existsSync(GENERATED_STORIES_DIR)) return 0;
  return fs.readdirSync(GENERATED_STORIES_DIR).filter((name) =>
    name === 'storyrpg-lite-treatment' || name.startsWith('storyrpg-lite-treatment_') || name.startsWith('storyrpg-lite-treatment-r'),
  ).length;
}

function resolveBiteMeRunNumber(): number {
  const raw = process.env.BITE_ME_RUN_NUMBER?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) throw new Error(`BITE_ME_RUN_NUMBER must be a positive integer, got: ${raw}`);
    return n;
  }
  return countPriorLiteTreatmentRuns() + 1;
}

function persistRunIdFiles(runNumber: number, outputDirectory?: string, jobId?: string): void {
  const humanId = `bite-me-ep1-r${runNumber}`;
  const body = [
    `runNumber=r${runNumber}`,
    `humanId=${humanId}`,
    `scheme=chronological count of generated-stories/storyrpg-lite-treatment* (+1); override via BITE_ME_RUN_NUMBER`,
    `jobId=${jobId || ''}`,
    `outputDirectory=${outputDirectory || ''}`,
    `createdAt=${new Date().toISOString()}`,
    '',
  ].join('\n');
  const notePath = path.join(GENERATED_STORIES_DIR, 'bite-me-ep1-run-numbering.txt');
  fs.mkdirSync(GENERATED_STORIES_DIR, { recursive: true });
  fs.writeFileSync(notePath, `${body}\nPrior unnumbered runs used storyrpg-lite-treatment_<timestamp> only.\n`, 'utf8');
  if (outputDirectory) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'RUN_ID.txt'), body, 'utf8');
  }
}

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

async function startJob(body: WorkerJobStartRequest): Promise<string> {
  return (await submitWorkerJob(body, { proxyUrl: PROXY })).jobId;
}

async function getJob(jobId: string): Promise<WorkerJob | null> {
  const resp = await fetch(`${PROXY}/worker-jobs/${jobId}`);
  if (!resp.ok) return null;
  return await resp.json() as WorkerJob;
}

async function getJobResult(jobId: string): Promise<Record<string, unknown>> {
  const resp = await fetch(`${PROXY}/worker-jobs/${jobId}/result`);
  if (!resp.ok) throw new Error(`worker result unavailable (${resp.status}): ${await resp.text()}`);
  return await resp.json() as Record<string, unknown>;
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
      return getJobResult(jobId);
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(`${label}: ${job.status} — ${job.error || '(no error message)'}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

function buildConfig(): PipelineConfig {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
  const forcedModel = process.env.STORY_LLM_MODEL?.trim();
  const taskModelOverrides: GeneratorPipelineConfigInput['taskModelOverrides'] = forcedModel
    ? Object.fromEntries(['architect', 'scene', 'choice', 'qa', 'image', 'video'].map((task) => [
        task,
        { provider: 'gemini', model: forcedModel },
      ])) as GeneratorPipelineConfigInput['taskModelOverrides']
    : undefined;
  const config = buildGeneratorPipelineConfig({
    llmProvider: 'gemini',
    llmModel: forcedModel || 'gemini-3.1-pro-preview',
    modelFamily: 'gemini',
    taskModelOverrides,
    imageLlmProvider: 'gemini',
    imageLlmModel: 'gemini-2.5-flash',
    videoLlmProvider: 'gemini',
    videoLlmModel: 'gemini-2.5-flash',
    memoryLlmProvider: 'gemini',
    memoryLlmModel: 'gemini-2.5-pro',
    apiKey: '',
    openaiApiKey: '',
    openRouterApiKey: '',
    geminiApiKey: geminiKey,
    elevenLabsApiKey: '',
    atlasCloudApiKey: '',
    atlasCloudModel: '',
    midapiToken: '',
    imageProvider: 'nano-banana',
    imageStrategy: 'all-beats',
    panelMode: 'single',
    artStyle: '',
    geminiSettings: { ...DEFAULT_GEMINI_SETTINGS },
    midjourneySettings: { ...DEFAULT_MIDJOURNEY_SETTINGS },
    openaiSettings: { ...DEFAULT_OPENAI_SETTINGS },
    generationSettings: {
      ...DEFAULT_GENERATION_SETTINGS,
      generateImages: false,
      qualityCouncilEnabled: false,
    },
    generationMode: 'advisory',
    narrationSettings: {
      enabled: false,
      provider: 'elevenlabs',
      autoPlay: false,
      preGenerateAudio: false,
      voiceId: '',
      voiceCastingEnabled: true,
      performanceTagsEnabled: false,
      highlightMode: 'word',
    },
    videoSettings: { ...DEFAULT_VIDEO_SETTINGS, enabled: false },
  }, undefined, 'gemini-only');
  config.generation = { ...(config.generation ?? {}), assetGenerationMode: 'story-only' };
  return config;
}

async function runAnalysisJob(
  config: PipelineConfig,
  treatment: string,
  briefTitle: string,
  analysisCachePath: string,
): Promise<Record<string, unknown>> {
  const analysisJobId = await startJob(prepareAnalysisJob({
    config,
    sourceText: treatment,
    title: briefTitle,
    preferences: ANALYSIS_OPTIONS,
    providerPolicy: 'gemini-only',
    runId: String(Date.now()),
  }));
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

  // Keep a content-addressed analysis cache so a generation retry does not need
  // to repeat an otherwise unchanged analysis phase.
  const analysisCachePath = path.resolve(__dirname, '../generated-stories/.analysis-cache/bite-me-ep1.json');
  const resumeAnalysisJobId = process.env.SKIP_ANALYSIS_JOB_ID?.trim();
  const briefTitle = parsed.brief.story?.title || 'Bite Me';
  let analysisResult: Record<string, unknown>;
  if (resumeAnalysisJobId) {
    log(`reusing completed analysis job: ${resumeAnalysisJobId}`);
    const job = await getJob(resumeAnalysisJobId);
    if (!job || job.status !== 'completed') throw new Error(`analysis job ${resumeAnalysisJobId} is not completed`);
    analysisResult = await getJobResult(resumeAnalysisJobId);
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
  } else analysisResult = await runAnalysisJob(primaryConfig, treatment, briefTitle, analysisCachePath);

  if (!analysisResult.success) {
    throw new Error(`analysis failed: ${String(analysisResult.error || 'unknown')}`);
  }
  const seasonPlan = analysisResult.seasonPlan as SeasonPlan | undefined;
  if (!seasonPlan) {
    throw new Error(`analysis missing seasonPlan: ${String(analysisResult.seasonPlanError || 'unknown')}`);
  }

  const runNumber = resolveBiteMeRunNumber();
  const runLabel = `r${runNumber}`;
  const humanRunId = `bite-me-ep1-${runLabel}`;
  const baseTitle = String(parsed.brief.story?.title || 'StoryRPG Lite Treatment');
  // Suffix the brief title so createOutputDirectory yields storyrpg-lite-treatment-rN_<ts>.
  const labeledTitle = process.env.STORY_ID_SUFFIX?.trim()
    ? `${baseTitle} ${process.env.STORY_ID_SUFFIX.trim()}`
    : `${baseTitle} ${runLabel}`;
  const brief = {
    ...parsed.brief,
    seasonPlan,
    story: { ...parsed.brief.story, title: labeledTitle },
  };
  log(`run numbering: ${humanRunId} (BITE_ME_RUN_NUMBER=${runNumber}; folder slug from title="${labeledTitle}")`);
  persistRunIdFiles(runNumber);

  // Generation uses the same locked Gemini-only policy as analysis.
  const prepared = prepareGenerationJob({
    config: primaryConfig,
    draftBrief: brief,
    sourceAnalysis: analysisResult.sourceAnalysis as SourceMaterialAnalysis,
    seasonPlan,
    requestedEpisodes: [1],
    providerPolicy: 'gemini-only',
    runId: `${runLabel}:${Date.now()}`,
  });
  const generationJobId = await startJob({
    ...prepared.request,
    storyTitle: humanRunId,
  });
  log(`generation job started: ${generationJobId} (${humanRunId})`);

  const findLabeledOutputDir = (): string | undefined => {
    if (!fs.existsSync(GENERATED_STORIES_DIR)) return undefined;
    const prefix = `storyrpg-lite-treatment-${runLabel}_`;
    const matches = fs.readdirSync(GENERATED_STORIES_DIR)
      .filter((name) => name.startsWith(prefix))
      .sort();
    const last = matches[matches.length - 1];
    return last ? path.join(GENERATED_STORIES_DIR, last) : undefined;
  };

  try {
    const genResult = await waitForJob(generationJobId, 'generation');
    if (!genResult.success) {
      const failedOut = (genResult as { outputDirectory?: string }).outputDirectory || findLabeledOutputDir();
      persistRunIdFiles(runNumber, failedOut, generationJobId);
      throw new Error(`generation failed: ${String(genResult.error || 'unknown')}`);
    }
    const outputDirectory = (genResult as { outputDirectory?: string }).outputDirectory || findLabeledOutputDir();
    persistRunIdFiles(runNumber, outputDirectory, generationJobId);
    log(`✅ Bite Me EP1 complete (${humanRunId})`);
    log(`RUN DIR: ${outputDirectory || '(see worker result)'}`);
  } catch (err) {
    persistRunIdFiles(runNumber, findLabeledOutputDir(), generationJobId);
    throw err;
  }
}

main().catch((err) => {
  console.error(`\n[run] ✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
