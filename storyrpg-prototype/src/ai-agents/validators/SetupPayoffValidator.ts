/**
 * SetupPayoffValidator
 *
 * Verifies that every thread in a ThreadLedger has matching plant and
 * payoff beats in the generated scene content. Threads planted but never
 * paid off are Chekhov's-gun violations; threads paid off but never
 * planted are deus-ex-machina violations.
 */

import {
  BaseValidator,
  ValidationResult,
  ValidationIssue,
} from './BaseValidator';
import { NarrativeThread, ThreadLedger } from '../../types';
import { SceneContent } from '../agents/SceneWriter';

export interface SetupPayoffInput {
  ledger: ThreadLedger;
  sceneContents: SceneContent[];
  /** Current episode number (for expectedPaidOffByEpisode enforcement). */
  currentEpisode?: number;
}

export interface SetupPayoffMetrics {
  totalThreads: number;
  planted: number;
  paidOff: number;
  dangling: number;
  unplanted: number;
}

export interface SetupPayoffResult extends ValidationResult {
  metrics: SetupPayoffMetrics;
  threads: NarrativeThread[];
}

export class SetupPayoffValidator extends BaseValidator {
  constructor() {
    super('SetupPayoffValidator');
  }

  validate(input: SetupPayoffInput): SetupPayoffResult {
    const issues: ValidationIssue[] = [];
    const metrics: SetupPayoffMetrics = {
      totalThreads: 0,
      planted: 0,
      paidOff: 0,
      dangling: 0,
      unplanted: 0,
    };

    const allBeats = new Map<
      string,
      { sceneId: string; plantsThreadId?: string; paysOffThreadId?: string }
    >();
    for (const sc of input.sceneContents) {
      for (const beat of sc.beats) {
        const anyBeat = beat as unknown as {
          id: string;
          plantsThreadId?: string;
          paysOffThreadId?: string;
        };
        allBeats.set(anyBeat.id, {
          sceneId: sc.sceneId,
          plantsThreadId: anyBeat.plantsThreadId,
          paysOffThreadId: anyBeat.paysOffThreadId,
        });
      }
    }

    const observedPlants = new Map<string, Array<{ sceneId: string; beatId: string }>>();
    const observedPayoffs = new Map<string, Array<{ sceneId: string; beatId: string }>>();
    for (const [beatId, info] of allBeats.entries()) {
      if (info.plantsThreadId) {
        const arr = observedPlants.get(info.plantsThreadId) || [];
        arr.push({ sceneId: info.sceneId, beatId });
        observedPlants.set(info.plantsThreadId, arr);
      }
      if (info.paysOffThreadId) {
        const arr = observedPayoffs.get(info.paysOffThreadId) || [];
        arr.push({ sceneId: info.sceneId, beatId });
        observedPayoffs.set(info.paysOffThreadId, arr);
      }
    }

    const threads: NarrativeThread[] = (input.ledger.threads || []).map(original => {
      const thread = { ...original };
      metrics.totalThreads++;
      const plants = [
        ...(thread.plants || []),
        ...(observedPlants.get(thread.id) || []).filter(
          obs => !(thread.plants || []).some(p => p.beatId === obs.beatId),
        ),
      ];
      const payoffs = [
        ...(thread.payoffs || []),
        ...(observedPayoffs.get(thread.id) || []).filter(
          obs => !(thread.payoffs || []).some(p => p.beatId === obs.beatId),
        ),
      ];
      thread.plants = plants;
      thread.payoffs = payoffs;

      const hasPlant = plants.length > 0;
      const hasPayoff = payoffs.length > 0;
      const dueThisEpisode =
        input.currentEpisode !== undefined &&
        thread.expectedPaidOffByEpisode !== undefined &&
        input.currentEpisode >= thread.expectedPaidOffByEpisode;

      if (!hasPlant && hasPayoff) {
        thread.status = 'unplanted';
        metrics.unplanted++;
        issues.push({
          severity: thread.priority === 'major' ? 'error' : 'warning',
          message: `Thread "${thread.label}" is paid off but was never planted (deus ex machina)`,
          suggestion: `Add a plant beat for thread \`${thread.id}\` earlier in the story.`,
        });
      } else if (hasPlant && !hasPayoff && dueThisEpisode) {
        thread.status = 'dangling';
        metrics.dangling++;
        issues.push({
          severity: thread.priority === 'major' ? 'error' : 'warning',
          message: `Thread "${thread.label}" was planted but never paid off by the scheduled episode (${thread.expectedPaidOffByEpisode})`,
          suggestion: `Add a payoff beat for thread \`${thread.id}\`, or revise expectedPaidOffByEpisode.`,
        });
      } else if (hasPlant && hasPayoff) {
        thread.status = 'paid_off';
        metrics.paidOff++;
      } else if (hasPlant) {
        thread.status = 'planted';
        metrics.planted++;
      } else {
        thread.status = thread.status ?? 'planned';
      }

      return thread;
    });

    // E5: thread-hygiene pre-pass — too many live threads overloads the reader's
    // working memory, and near-duplicate threads (same kind + near-identical label)
    // are usually an accidental split that should be merged. Advisory only.
    this.checkThreadHygiene(threads, issues);

    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const score = Math.max(
      0,
      100 - errors * 20 - warnings * 8,
    );
    const valid = errors === 0;

    return {
      valid,
      score,
      issues,
      suggestions: issues.map(i => i.suggestion).filter((s): s is string => Boolean(s)),
      metrics,
      threads,
    };
  }

  /** Max simultaneously-open (unpaid) threads before the reader is overloaded. */
  private static readonly MAX_OPEN_THREADS = 7;

  /**
   * E5: warn when too many threads are open at once, and when two threads look like
   * an accidental duplicate (same kind + near-identical normalized label). Advisory.
   */
  private checkThreadHygiene(threads: NarrativeThread[], issues: ValidationIssue[]): void {
    const open = threads.filter(t => t.status !== 'paid_off');
    if (open.length > SetupPayoffValidator.MAX_OPEN_THREADS) {
      issues.push({
        severity: 'warning',
        message: `${open.length} open narrative threads exceed the cap of ${SetupPayoffValidator.MAX_OPEN_THREADS} — the reader can't track this many at once.`,
        suggestion: 'Merge near-duplicate threads, pay some off, or demote minor ones.',
      });
    }

    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const seen: Array<{ id: string; kind: string; label: string }> = [];
    for (const t of threads) {
      const label = norm(t.label);
      if (!label) continue;
      const dup = seen.find(s => s.kind === t.kind && this.labelsAreNearDuplicate(s.label, label));
      if (dup) {
        issues.push({
          severity: 'warning',
          message: `Threads "${dup.id}" and "${t.id}" look like duplicates (same kind, near-identical label).`,
          suggestion: `Merge thread \`${t.id}\` into \`${dup.id}\` (or differentiate their labels).`,
        });
      } else {
        seen.push({ id: t.id, kind: t.kind, label });
      }
    }
  }

  /** Near-duplicate if identical, or one label's token set contains the other's. */
  private labelsAreNearDuplicate(a: string, b: string): boolean {
    if (a === b) return true;
    const ta = new Set(a.split(' ').filter(Boolean));
    const tb = new Set(b.split(' ').filter(Boolean));
    if (ta.size === 0 || tb.size === 0) return false;
    const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
    let overlap = 0;
    for (const tok of small) if (large.has(tok)) overlap++;
    return overlap / small.size >= 0.8;
  }
}
