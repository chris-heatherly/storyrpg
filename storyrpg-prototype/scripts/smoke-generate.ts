import 'dotenv/config';
import fs from 'node:fs';
import { loadConfig } from '../src/ai-agents/config';
import { parseDocument } from '../src/ai-agents/utils/documentParser';
import { runStoryAnalysis, runStoryGeneration } from '../src/ai-agents/services/storyGenerationService';

/**
 * WS2 — the generation half of the watched live smoke run. Generates EPISODE 1 ONLY of the
 * bite-me treatment with the Phase 0/1 gates enabled, story-only (no images), so the recurring
 * failure surfaces are exercised against a real LLM as cheaply as possible. Point smoke:check
 * at the printed RUN DIR afterward.
 *
 * Provider/model + gates come from the environment (set on the command line so they win over
 * .env, which dotenv does not override):
 *   EXPO_PUBLIC_LLM_PROVIDER=gemini EXPO_PUBLIC_LLM_MODEL=gemini-2.5-pro \
 *   GATE_RESIDUE_CONSUME=1 GATE_COLD_OPEN_REALIZATION=1 GATE_ENCOUNTER_SKILL_REBALANCE=1 \
 *   npx ts-node --transpile-only scripts/smoke-generate.ts /tmp/bite-me-treatment.md
 */

async function main(): Promise<void> {
  const docPath = process.argv[2] || '/tmp/bite-me-treatment.md';
  const treatment = fs.readFileSync(docPath, 'utf8');
  const config = loadConfig();
  // Story-only: skip image/video generation for the smoke run.
  config.generation = { ...(config.generation ?? {}), assetGenerationMode: 'story-only' } as typeof config.generation;
  if (config.imageGen) config.imageGen = { ...config.imageGen, enabled: false };
  if (config.videoGen) config.videoGen = { ...config.videoGen, enabled: false } as typeof config.videoGen;

  const planner = config.agents?.storyArchitect;
  console.log(`[smoke] provider=${planner?.provider} model=${planner?.model} assets=story-only`);
  console.log(`[smoke] gates: RESIDUE_CONSUME=${process.env.GATE_RESIDUE_CONSUME} COLD_OPEN=${process.env.GATE_COLD_OPEN_REALIZATION} SKILL_REBALANCE=${process.env.GATE_ENCOUNTER_SKILL_REBALANCE} ENCOUNTER_POV=${process.env.GATE_ENCOUNTER_POV ?? '(default ON)'}`);

  const parsed = parseDocument(treatment, 'bite-me-treatment.md');
  if (!parsed.success || !parsed.brief) {
    console.error('[smoke] parseDocument failed:', parsed.error);
    process.exit(1);
  }
  const brief = parsed.brief;
  console.log(`[smoke] parsed brief: "${brief.story?.title}" — analyzing source…`);

  const onEvent = (e: { type?: string; phase?: string; agent?: string; message?: string }): void => {
    if (e.type === 'error' || e.type === 'warning' || e.type === 'phase_start' || e.type === 'step_start' || e.type === 'phase_complete') {
      console.log(`  [${e.type}] ${e.phase ?? ''} ${e.agent ?? ''} ${(e.message ?? '').slice(0, 100)}`.replace(/\s+/g, ' ').trim());
    }
  };

  const analysis = await runStoryAnalysis({
    config,
    sourceText: treatment,
    title: brief.story?.title ?? 'Bite Me',
    onEvent,
  });
  console.log(`[smoke] analysis done — generating EPISODE 1 only…`);

  const { result } = await runStoryGeneration({
    config,
    brief,
    sourceAnalysis: analysis.sourceAnalysis,
    episodeRange: { start: 1, end: 1 },
    onEvent,
  });

  console.log('\n[smoke] ✅ generation complete');
  console.log('RUN DIR:', (result as { outputDirectory?: string }).outputDirectory);
}

main().catch((err) => {
  console.error('\n[smoke] ✗ generation FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
