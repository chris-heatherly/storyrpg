/**
 * Story Asset Walker — Tier 1 QA
 *
 * Recursively walks a generated Story JSON and HTTP-checks every image URL.
 * Designed to run in-pipeline (after assembly) or standalone via CLI.
 */

import type {
  Story,
  Episode,
  Scene,
  Beat,
  Encounter,
  EncounterPhase,
  EncounterBeat,
  EncounterChoice,
  EncounterChoiceOutcome,
  EmbeddedEncounterChoice,
  GeneratedStorylet,
  StoryletBeat,
} from '../../types';
import { mediaRefAsString } from '../../assets/assetRef';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImageSlotKind =
  | 'story-cover'
  | 'episode-cover'
  | 'scene-background'
  | 'beat-image'
  | 'beat-panel'
  | 'beat-outcome-seq'
  | 'encounter-phase'
  | 'encounter-beat-setup'
  | 'encounter-beat-escalation'
  | 'encounter-outcome-image'
  | 'encounter-situation-image'
  | 'storylet-beat-image'
  | 'npc-portrait';

export interface ImageRef {
  url: string;
  kind: ImageSlotKind;
  location: string;
}

export type CheckStatus = 'ok' | 'missing' | 'broken' | 'unreachable';

export interface ImageCheckResult extends ImageRef {
  status: CheckStatus;
  httpStatus?: number;
  error?: string;
}

export interface AssetWalkReport {
  totalImages: number;
  verified: number;
  missing: number;
  broken: number;
  unreachable: number;
  results: ImageCheckResult[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Collection — walk the Story tree and gather every image URL
// ---------------------------------------------------------------------------

export function collectImageRefs(story: Story): ImageRef[] {
  const refs: ImageRef[] = [];

  const push = (url: string | undefined | null, kind: ImageSlotKind, location: string) => {
    if (!url) return;
    refs.push({ url, kind, location });
  };

  push(mediaRefAsString(story.coverImage), 'story-cover', `story:${story.id}`);

  for (const npc of story.npcs || []) {
    push(mediaRefAsString(npc.portrait), 'npc-portrait', `npc:${npc.id}`);
  }

  for (const episode of story.episodes || []) {
    const epLoc = `episode:${episode.id}`;
    push(mediaRefAsString(episode.coverImage), 'episode-cover', epLoc);

    for (const scene of episode.scenes || []) {
      const scLoc = `${epLoc}::scene:${scene.id}`;
      push(mediaRefAsString(scene.backgroundImage), 'scene-background', scLoc);

      collectBeatImages(scene.beats, scLoc, refs);

      if (scene.encounter) {
        collectEncounterImages(scene.encounter, scLoc, refs);
      }
    }
  }

  return refs;
}

function collectBeatImages(beats: Beat[] | undefined, parentLoc: string, refs: ImageRef[]) {
  for (const beat of beats || []) {
    const bLoc = `${parentLoc}::beat:${beat.id}`;
    const beatImageStr = mediaRefAsString(beat.image);
    if (beatImageStr) refs.push({ url: beatImageStr, kind: 'beat-image', location: bLoc });

    for (const [idx, panelUrl] of (beat.panelImages || []).entries()) {
      const panelStr = mediaRefAsString(panelUrl);
      if (panelStr) refs.push({ url: panelStr, kind: 'beat-panel', location: `${bLoc}::panel[${idx}]` });
    }

    if (beat.outcomeSequences) {
      for (const [tier, urls] of Object.entries(beat.outcomeSequences)) {
        for (const [idx, url] of (urls || []).entries()) {
          if (url) refs.push({ url, kind: 'beat-outcome-seq', location: `${bLoc}::outcomeSeq:${tier}[${idx}]` });
        }
      }
    }
  }
}

function collectEncounterImages(encounter: Encounter, parentLoc: string, refs: ImageRef[]) {
  const encLoc = `${parentLoc}::encounter:${encounter.id}`;

  for (const phase of encounter.phases || []) {
    const phLoc = `${encLoc}::phase:${phase.id}`;
    if (phase.situationImage) refs.push({ url: phase.situationImage, kind: 'encounter-phase', location: phLoc });

    for (const beat of phase.beats || []) {
      if ('setupText' in beat) {
        collectEncounterBeatImages(beat as EncounterBeat, phLoc, refs);
      } else {
        collectBeatImages([beat as Beat], phLoc, refs);
      }
    }
  }

  if (encounter.storylets) {
    for (const [outcomeName, storylet] of Object.entries(encounter.storylets)) {
      if (storylet) collectStoryletImages(storylet, `${encLoc}::storylet:${outcomeName}`, refs);
    }
  }
}

function collectEncounterBeatImages(beat: EncounterBeat, parentLoc: string, refs: ImageRef[]) {
  const bLoc = `${parentLoc}::encounterBeat:${beat.id}`;
  if (beat.situationImage) refs.push({ url: beat.situationImage, kind: 'encounter-beat-setup', location: bLoc });
  if (beat.escalationImage) refs.push({ url: beat.escalationImage, kind: 'encounter-beat-escalation', location: `${bLoc}::escalation` });

  for (const choice of beat.choices || []) {
    collectChoiceOutcomeImages(choice, bLoc, refs);
  }
}

function collectChoiceOutcomeImages(
  choice: EncounterChoice | EmbeddedEncounterChoice,
  parentLoc: string,
  refs: ImageRef[],
) {
  const cLoc = `${parentLoc}::choice:${choice.id}`;
  const tiers: Array<'success' | 'complicated' | 'failure'> = ['success', 'complicated', 'failure'];

  for (const tier of tiers) {
    const outcome: EncounterChoiceOutcome | undefined = choice.outcomes?.[tier];
    if (!outcome) continue;

    const oLoc = `${cLoc}::${tier}`;
    if (outcome.outcomeImage) refs.push({ url: outcome.outcomeImage, kind: 'encounter-outcome-image', location: oLoc });

    if (outcome.nextSituation) {
      const nsLoc = `${oLoc}::nextSituation`;
      if (outcome.nextSituation.situationImage) {
        refs.push({ url: outcome.nextSituation.situationImage, kind: 'encounter-situation-image', location: nsLoc });
      }
      for (const embedded of outcome.nextSituation.choices || []) {
        collectChoiceOutcomeImages(embedded, nsLoc, refs);
      }
    }
  }
}

function collectStoryletImages(storylet: GeneratedStorylet, parentLoc: string, refs: ImageRef[]) {
  for (const beat of storylet.beats || []) {
    if (beat.image) refs.push({ url: beat.image, kind: 'storylet-beat-image', location: `${parentLoc}::beat:${beat.id}` });
  }
}

// ---------------------------------------------------------------------------
// HTTP verification
// ---------------------------------------------------------------------------

async function checkUrl(url: string, timeoutMs: number): Promise<{ status: CheckStatus; httpStatus?: number; error?: string }> {
  if (url === 'MISSING' || url === 'NONE') {
    return { status: 'missing' };
  }

  if (url.startsWith('data:')) {
    return { status: 'ok' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) return { status: 'ok', httpStatus: res.status };
    return { status: 'broken', httpStatus: res.status };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { status: 'unreachable', error: 'timeout' };
    }
    return { status: 'unreachable', error: err?.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AssetWalkOptions {
  /** Max time per HTTP HEAD request (default 5000ms) */
  httpTimeoutMs?: number;
  /** Max concurrent HTTP requests (default 20) */
  concurrency?: number;
  /** Skip HTTP checks — just collect and flag MISSING/NONE values */
  skipHttpCheck?: boolean;
}

export async function walkStoryAssets(
  story: Story,
  options: AssetWalkOptions = {},
): Promise<AssetWalkReport> {
  const start = Date.now();
  const {
    httpTimeoutMs = 5000,
    concurrency = 20,
    skipHttpCheck = false,
  } = options;

  const refs = collectImageRefs(story);
  const results: ImageCheckResult[] = [];

  if (skipHttpCheck) {
    for (const ref of refs) {
      const isMissing = ref.url === 'MISSING' || ref.url === 'NONE';
      results.push({ ...ref, status: isMissing ? 'missing' : 'ok' });
    }
  } else {
    // Throttled parallel HTTP checks
    let idx = 0;
    const run = async () => {
      while (idx < refs.length) {
        const current = idx++;
        const ref = refs[current];
        const check = await checkUrl(ref.url, httpTimeoutMs);
        results.push({ ...ref, ...check });
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, refs.length) }, () => run());
    await Promise.all(workers);
  }

  const verified = results.filter(r => r.status === 'ok').length;
  const missing = results.filter(r => r.status === 'missing').length;
  const broken = results.filter(r => r.status === 'broken').length;
  const unreachable = results.filter(r => r.status === 'unreachable').length;

  return {
    totalImages: results.length,
    verified,
    missing,
    broken,
    unreachable,
    results,
    durationMs: Date.now() - start,
  };
}

/**
 * Convenience: load a story JSON file from disk and validate all assets.
 * Works in Node only (uses fs).
 */
export async function walkStoryAssetsFromFile(
  jsonPath: string,
  options?: AssetWalkOptions,
): Promise<AssetWalkReport> {
  const fs = await import('fs');
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const story: Story = JSON.parse(raw);
  return walkStoryAssets(story, options);
}

// ---------------------------------------------------------------------------
// Pretty-print helper (for CLI / pipeline logging)
// ---------------------------------------------------------------------------

export function formatAssetWalkReport(report: AssetWalkReport): string {
  const lines: string[] = [
    `Asset Walk: ${report.totalImages} image refs found`,
    `  ✓ verified: ${report.verified}`,
    `  ✗ missing:  ${report.missing}`,
    `  ✗ broken:   ${report.broken}`,
    `  ✗ unreachable: ${report.unreachable}`,
    `  Duration: ${report.durationMs}ms`,
  ];

  const failures = report.results.filter(r => r.status !== 'ok');
  if (failures.length > 0) {
    lines.push('', 'Failures:');
    for (const f of failures) {
      const detail = f.httpStatus ? `HTTP ${f.httpStatus}` : f.error || f.status;
      lines.push(`  [${f.status}] ${f.location}`);
      lines.push(`           ${f.url}`);
      lines.push(`           ${detail}`);
    }
  }

  return lines.join('\n');
}
