/**
 * One-time resume-context reconstruction (2026-07-16): the private proxy
 * stores were lost while run 03-12-37's artifacts sat complete. Rebuilds
 * <runDir>/checkpoints/resume-context.json from the run's own artifacts +
 * generator settings so the new run-dir resume fallback can serve it.
 *
 *   TS_NODE_PROJECT=tsconfig.worker.json npx ts-node --transpile-only \
 *     -r tsconfig-paths/register scripts/reconstruct-resume-context.ts <runDir> <jobId>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildPipelineConfig } from '../src/ai-agents/config/buildPipelineConfig';

function stableConfigJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableConfigJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableConfigJson(record[key])}`).join(',')}}`;
}

async function main() {
  const runDir = process.argv[2] ?? 'generated-stories/bite-me_2026-07-16T03-12-37/';
  const jobId = process.argv[3] ?? 'worker-1784175024762-23oxyivo';
  const expectedHash = process.argv[4] ?? 'dca8bd6a472ae766567a6a59bfbc73cc0b1b59141a27f21149b14f9d39837651';

  const brief = JSON.parse(fs.readFileSync(path.join(runDir, '00-input-brief.json'), 'utf8'));
  const settings = JSON.parse(fs.readFileSync('.generator-settings.json', 'utf8'));
  const publicJobs = JSON.parse(fs.readFileSync('.generation-jobs.json', 'utf8'));
  const jobRow = (Array.isArray(publicJobs) ? publicJobs : publicJobs.jobs ?? [])
    .find((row: { id?: string }) => row.id === jobId);
  if (!jobRow) throw new Error(`job ${jobId} not found in .generation-jobs.json`);

  const config = buildPipelineConfig({
    llmProvider: settings.llmProvider,
    llmModel: settings.llmModel,
    imageLlmProvider: settings.imageLlmProvider,
    imageLlmModel: settings.imageLlmModel,
    videoLlmProvider: settings.videoLlmProvider,
    videoLlmModel: settings.videoLlmModel,
    apiKey: '',
    geminiApiKey: '',
    openaiApiKey: '',
    openRouterApiKey: '',
    elevenLabsApiKey: '',
    atlasCloudApiKey: '',
    midapiToken: '',
    atlasCloudModel: '',
    artStyle: '',
    imageStrategy: 'per-scene',
    panelMode: 'single',
    imageProvider: 'nano-banana',
    generationSettings: { ...settings.generationSettings, generateImages: false },
    generationMode: settings.generationMode ?? 'standard',
    narrationSettings: settings.narrationSettings ?? { enabled: false },
    videoSettings: { ...(settings.videoSettings ?? {}), enabled: false },
    taskAssignments: undefined,
  } as never, {} as never);
  (config as { generation?: Record<string, unknown> }).generation = {
    ...((config as { generation?: Record<string, unknown> }).generation || {}),
    assetGenerationMode: 'story-only',
  };

  const rebuiltHash = crypto.createHash('sha256').update(stableConfigJson({ mode: 'generation', config })).digest('hex');
  console.log('rebuilt config hash:', rebuiltHash.slice(0, 12), '| expected:', expectedHash.slice(0, 12), rebuiltHash === expectedHash ? '(EXACT MATCH)' : '(differs — resume proceeds without prior-hash pin; worker preflight re-validates)');

  const checkpoint = {
    ...(jobRow.checkpoint ?? {}),
    jobId,
    outputs: { output_directory: { outputDirectory: jobRow.outputDir ?? runDir } },
    resumeContext: {
      ...((jobRow.checkpoint ?? {}).resumeContext ?? {}),
      // No jobConfigHash on purpose: a reconstructed config must not 409 on a
      // hash it cannot reproduce; the worker's provider preflight re-validates.
      jobConfigHash: undefined,
      previousJobConfigHash: undefined,
    },
  };
  const requestPayload = {
    config,
    generationInput: {
      brief,
      sourceAnalysis: brief?.multiEpisode?.sourceAnalysis,
      episodeRange: { specific: [1] },
    },
    outputDirectory: 'generated-stories',
  };
  const outFile = path.join(runDir, 'checkpoints', 'resume-context.json');
  fs.writeFileSync(outFile, JSON.stringify({
    savedAt: new Date().toISOString(),
    jobId,
    reconstructed: true,
    requestPayload,
    checkpoint,
  }, null, 2));
  console.log('wrote', outFile);
}
main().catch((error) => { console.error(error); process.exit(1); });
