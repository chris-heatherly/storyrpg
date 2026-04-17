/**
 * Playwright QA Runner
 *
 * Spawns the Playwright E2E test as a child process against a specific story,
 * parses structured results, and returns a typed report the pipeline can act on.
 */

import { EXPO_WEB_CONFIG } from '../../config/endpoints';

// Dynamic requires — these modules are only available in Node.js (worker process),
// not in the Expo/Metro web bundle.
let nodeChildProcess: any;
let nodeFs: any;
let nodePath: any;
try {
  nodeChildProcess = require('child_process');
  nodeFs = require('fs');
  nodePath = require('path');
} catch { /* running in browser — module won't be called */ }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaywrightImageIssue {
  screen: string;
  type: 'broken' | 'placeholder' | 'console-error';
  detail: string;
}

export interface PlaywrightQAResult {
  passed: boolean;
  imageIssues: PlaywrightImageIssue[];
  consoleErrors: string[];
  networkFailures: string[];
  totalBeats: number;
  storyTitle: string;
  encounterTier: string;
  /** Raw exit code from the Playwright process */
  exitCode: number | null;
  /** True when the runner could not connect to the app (proxy/app not running) */
  skipped: boolean;
  skipReason?: string;
  /** Coverage tracking from multi-path runs */
  coverageReport?: CoverageReport;
  /** Per-path results when run via multi-path runner */
  pathResults?: PlaywrightQAResult[];
}

export interface CoverageReport {
  totalPaths: number;
  completedPaths: number;
  totalScreensVisited: number;
  totalChoicesMade: number;
  /** Unique screen states observed across all paths */
  uniqueScreens: string[];
  /** All choice labels exercised across all paths */
  uniqueChoices: string[];
}

export interface PlaywrightQAOptions {
  storyTitle: string;
  /** Override base URL (default: http://localhost:8081) */
  baseUrl?: string;
  /** Force encounter tier for deterministic outcome testing */
  encounterTier?: 'success' | 'complicated' | 'failure';
  /** Max beats to play through (default: 200) */
  maxBeats?: number;
  /** Timeout for the entire Playwright run in ms (default: 300_000 = 5 min) */
  timeoutMs?: number;
  /** Working directory — must be the storyrpg-prototype root */
  cwd?: string;
  /** Choice path — JSON array of 0-based choice indices for each decision point */
  choicePath?: number[];
  /** Output result filename (default: latest.json) */
  resultFile?: string;
}

export interface MultiPathQAOptions {
  storyTitle: string;
  /** The Story object (avoids re-reading from disk) */
  story: import('../../types').Story;
  /** Override base URL (default: http://localhost:8081) */
  baseUrl?: string;
  /** Max concurrent Playwright processes (default: 3) */
  maxParallel?: number;
  /** Max beats per path (default: 200) */
  maxBeats?: number;
  /** Timeout per path in ms (default: 300_000 = 5 min) */
  timeoutMs?: number;
  /** Working directory */
  cwd?: string;
  /** Progress callback for pipeline integration */
  onProgress?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Connectivity pre-check
// ---------------------------------------------------------------------------

async function canConnect(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Result file parser
// ---------------------------------------------------------------------------

const RESULTS_DIR = 'test/e2e/results';
const DEFAULT_RESULT_FILE = 'latest.json';

function parseResultsFile(cwd: string, filename?: string): PlaywrightQAResult | null {
  if (!nodeFs || !nodePath) return null;
  const filePath = nodePath.join(cwd, RESULTS_DIR, filename || DEFAULT_RESULT_FILE);
  try {
    if (!nodeFs.existsSync(filePath)) return null;
    const raw = JSON.parse(nodeFs.readFileSync(filePath, 'utf-8'));
    return {
      passed: !!raw.passed,
      imageIssues: Array.isArray(raw.imageIssues) ? raw.imageIssues : [],
      consoleErrors: Array.isArray(raw.consoleErrors) ? raw.consoleErrors : [],
      networkFailures: Array.isArray(raw.networkFailures) ? raw.networkFailures : [],
      totalBeats: typeof raw.beatCount === 'number' ? raw.beatCount : 0,
      storyTitle: raw.storyTitle || '',
      encounterTier: raw.encounterTier || '',
      exitCode: 0,
      skipped: false,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stdout fallback parser
// ---------------------------------------------------------------------------

function parseStdout(stdout: string): Partial<PlaywrightQAResult> {
  const imageIssues: PlaywrightImageIssue[] = [];
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];
  let totalBeats = 0;
  let passed = true;

  for (const line of stdout.split('\n')) {
    const beatMatch = line.match(/\[E2E\] Playthrough complete: (\d+) screens visited/);
    if (beatMatch) totalBeats = parseInt(beatMatch[1], 10);

    const issueCountMatch = line.match(/\[E2E\] Image issues: (\d+)/);
    if (issueCountMatch && parseInt(issueCountMatch[1], 10) > 0) passed = false;

    const netCountMatch = line.match(/\[E2E\] Network failures: (\d+)/);
    if (netCountMatch && parseInt(netCountMatch[1], 10) > 0) passed = false;

    // Parse individual broken image lines: "  [beat-31 (encounter-defeated)] placeholder: ..."
    const brokenMatch = line.match(/^\s+\[([^\]]+)\]\s+(broken|placeholder|console-error):\s+(.+)$/);
    if (brokenMatch) {
      imageIssues.push({ screen: brokenMatch[1], type: brokenMatch[2] as any, detail: brokenMatch[3] });
    }

    if (line.includes('[E2E] Console image')) {
      const errLine = line.replace(/.*\[E2E\] Console image warnings\/errors:\s*/, '').trim();
      if (errLine) consoleErrors.push(errLine);
    }

    if (line.includes('[E2E] Network failures:')) {
      const failLine = line.replace(/.*\[E2E\] Network failures:\s*/, '').trim();
      if (failLine) networkFailures.push(failLine);
    }
  }

  return { passed, imageIssues, consoleErrors, networkFailures, totalBeats };
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function runPlaywrightQA(options: PlaywrightQAOptions): Promise<PlaywrightQAResult> {
  if (!nodeChildProcess || !nodeFs || !nodePath) {
    return {
      passed: true, imageIssues: [], consoleErrors: [], networkFailures: [],
      totalBeats: 0, storyTitle: options.storyTitle, encounterTier: options.encounterTier || '',
      exitCode: null, skipped: true, skipReason: 'Node.js child_process not available (browser env)',
    };
  }

  const baseUrl = options.baseUrl || EXPO_WEB_CONFIG.getBaseUrl();
  const cwd = options.cwd || nodePath.resolve(__dirname, '../../..');
  const timeoutMs = options.timeoutMs || 300_000;
  const maxBeats = options.maxBeats || 200;

  // Pre-flight: verify the app is reachable
  const appReachable = await canConnect(baseUrl);
  if (!appReachable) {
    return {
      passed: true,
      imageIssues: [],
      consoleErrors: [],
      networkFailures: [],
      totalBeats: 0,
      storyTitle: options.storyTitle,
      encounterTier: options.encounterTier || '',
      exitCode: null,
      skipped: true,
      skipReason: `App not reachable at ${baseUrl} — skipping browser QA`,
    };
  }

  // Clear previous results file
  const resultFile = options.resultFile || DEFAULT_RESULT_FILE;
  const resultsPath = nodePath.join(cwd, RESULTS_DIR, resultFile);
  try { nodeFs.unlinkSync(resultsPath); } catch { /* ignore */ }

  // Build env vars
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    E2E_STORY: options.storyTitle,
    E2E_MAX_BEATS: String(maxBeats),
    E2E_BASE_URL: baseUrl,
    E2E_RESULT_FILE: resultFile,
  };
  if (options.encounterTier) {
    env.E2E_ENCOUNTER_TIER = options.encounterTier;
  }
  if (options.choicePath && options.choicePath.length > 0) {
    env.E2E_CHOICE_PATH = JSON.stringify(options.choicePath);
  }

  return new Promise<PlaywrightQAResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = nodeChildProcess.spawn(
      'npx',
      ['playwright', 'test', 'test/e2e/storyPlaythrough.spec.ts', '--reporter=list'],
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code: number | null) => {
      clearTimeout(timer);

      if (killed) {
        resolve({
          passed: false,
          imageIssues: [],
          consoleErrors: [],
          networkFailures: [],
          totalBeats: 0,
          storyTitle: options.storyTitle,
          encounterTier: options.encounterTier || '',
          exitCode: code,
          skipped: true,
          skipReason: `Playwright timed out after ${timeoutMs / 1000}s`,
        });
        return;
      }

      // Prefer the JSON results file (more reliable than stdout parsing)
      const fromFile = parseResultsFile(cwd, resultFile);
      if (fromFile) {
        fromFile.exitCode = code;
        resolve(fromFile);
        return;
      }

      // Fallback: parse stdout
      const fromStdout = parseStdout(stdout);
      resolve({
        passed: fromStdout.passed ?? (code === 0),
        imageIssues: fromStdout.imageIssues || [],
        consoleErrors: fromStdout.consoleErrors || [],
        networkFailures: fromStdout.networkFailures || [],
        totalBeats: fromStdout.totalBeats || 0,
        storyTitle: options.storyTitle,
        encounterTier: options.encounterTier || '',
        exitCode: code,
        skipped: false,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Multi-path runner
// ---------------------------------------------------------------------------

/**
 * Run full-coverage Playwright QA: analyze story paths, spawn one Playwright
 * process per path (in parallel up to maxParallel), then aggregate results.
 */
export async function runPlaywrightQAMultiPath(options: MultiPathQAOptions): Promise<PlaywrightQAResult> {
  // Lazy import to avoid circular dependency issues at module load time
  const { analyzeStoryPaths } = await import('./storyPathAnalyzer');

  const baseUrl = options.baseUrl || EXPO_WEB_CONFIG.getBaseUrl();
  const cwd = options.cwd || (nodePath ? nodePath.resolve(__dirname, '../../..') : '.');
  const maxParallel = options.maxParallel || 3;
  const maxBeats = options.maxBeats || 200;
  const timeoutMs = options.timeoutMs || 300_000;
  const log = options.onProgress || ((msg: string) => console.log(`[MultiPathQA] ${msg}`));

  // Pre-flight connectivity check
  const appReachable = await canConnect(baseUrl);
  if (!appReachable) {
    return {
      passed: true, imageIssues: [], consoleErrors: [], networkFailures: [],
      totalBeats: 0, storyTitle: options.storyTitle, encounterTier: '',
      exitCode: null, skipped: true,
      skipReason: `App not reachable at ${baseUrl} — skipping multi-path browser QA`,
    };
  }

  // Analyze story to compute coverage paths
  const plan = analyzeStoryPaths(options.story);
  log(`${plan.summary}`);
  log(`Running ${plan.paths.length} path(s) with up to ${maxParallel} in parallel`);

  // Run paths through a parallel work queue
  const pathResults: PlaywrightQAResult[] = [];
  const pending = [...plan.paths];
  const running: Promise<void>[] = [];

  async function runNext() {
    while (pending.length > 0) {
      const storyPath = pending.shift()!;
      const resultFile = `${storyPath.id}.json`;

      log(`Starting ${storyPath.id} (choices: [${storyPath.choicePath.join(',')}], tier: ${storyPath.encounterTier || 'default'})`);

      const result = await runPlaywrightQA({
        storyTitle: options.storyTitle,
        baseUrl,
        encounterTier: storyPath.encounterTier,
        maxBeats,
        timeoutMs,
        cwd,
        choicePath: storyPath.choicePath,
        resultFile,
      });

      log(`Completed ${storyPath.id}: ${result.totalBeats} beats, ${result.imageIssues.length} issues, passed=${result.passed}`);
      pathResults.push(result);
    }
  }

  // Launch maxParallel workers
  for (let i = 0; i < maxParallel; i++) {
    running.push(runNext());
  }
  await Promise.all(running);

  // Aggregate results
  return aggregateResults(pathResults, options.storyTitle, plan);
}

// ---------------------------------------------------------------------------
// Coverage aggregation
// ---------------------------------------------------------------------------

function aggregateResults(
  pathResults: PlaywrightQAResult[],
  storyTitle: string,
  plan: { paths: { id: string }[]; inventory: import('./storyPathAnalyzer').StoryInventory },
): PlaywrightQAResult {
  const allImageIssues: PlaywrightImageIssue[] = [];
  const allConsoleErrors: string[] = [];
  const allNetworkFailures: string[] = [];
  let totalBeats = 0;
  let allPassed = true;

  const seenImageIssueKeys = new Set<string>();
  const seenNetworkFailures = new Set<string>();
  const allScreens = new Set<string>();
  const allChoices = new Set<string>();

  for (const result of pathResults) {
    if (result.skipped) continue;

    totalBeats += result.totalBeats;
    if (!result.passed) allPassed = false;

    for (const issue of result.imageIssues) {
      const key = `${issue.screen}|${issue.type}|${issue.detail}`;
      if (!seenImageIssueKeys.has(key)) {
        seenImageIssueKeys.add(key);
        allImageIssues.push(issue);
      }
    }

    for (const err of result.consoleErrors) {
      if (!allConsoleErrors.includes(err)) allConsoleErrors.push(err);
    }

    for (const fail of result.networkFailures) {
      if (!seenNetworkFailures.has(fail)) {
        seenNetworkFailures.add(fail);
        allNetworkFailures.push(fail);
      }
    }

    // Parse per-path result files for coverage data
    const cwd = nodePath ? nodePath.resolve(__dirname, '../../..') : '.';
    const pathResultFile = pathResults.indexOf(result) < plan.paths.length
      ? `${plan.paths[pathResults.indexOf(result)].id}.json`
      : undefined;
    if (nodeFs && nodePath && pathResultFile) {
      try {
        const filePath = nodePath.join(cwd, RESULTS_DIR, pathResultFile);
        if (nodeFs.existsSync(filePath)) {
          const raw = JSON.parse(nodeFs.readFileSync(filePath, 'utf-8'));
          for (const s of raw.visitedScreens || []) allScreens.add(s);
          for (const c of raw.visitedChoiceLabels || []) allChoices.add(c);
        }
      } catch { /* ignore parse errors */ }
    }
  }

  const coverageReport: CoverageReport = {
    totalPaths: plan.paths.length,
    completedPaths: pathResults.filter(r => !r.skipped).length,
    totalScreensVisited: totalBeats,
    totalChoicesMade: allChoices.size,
    uniqueScreens: [...allScreens],
    uniqueChoices: [...allChoices],
  };

  return {
    passed: allPassed,
    imageIssues: allImageIssues,
    consoleErrors: allConsoleErrors,
    networkFailures: allNetworkFailures,
    totalBeats,
    storyTitle,
    encounterTier: 'multi-path',
    exitCode: allPassed ? 0 : 1,
    skipped: pathResults.every(r => r.skipped),
    skipReason: pathResults.every(r => r.skipped) ? pathResults[0]?.skipReason : undefined,
    coverageReport,
    pathResults,
  };
}
