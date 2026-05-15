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
}
