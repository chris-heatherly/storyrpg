import { describe, expect, it } from 'vitest';
import {
  buildCompiledArcTargetsFromPlan,
  buildCompiledThreadTwistFromEsc,
  ESC_PLANT_STAGING_TAG,
  isEscPlantStagingThread,
} from './compiledEscDirectives';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { EpisodeSpineContract } from '../../types/episodeSpine';
import { CallbackLedger } from '../pipeline/callbackLedger';
import { registerThreadObligations } from '../pipeline/obligationSeeding';
import { validateObligationLedger } from '../validators/ObligationLedgerValidator';

describe('compiledEscDirectives', () => {
  it('seeds threads and twist plan from ESC obligations', () => {
    const spine: EpisodeSpineContract = {
      episodeNumber: 1,
      sourceHash: 'h',
      episodeStoryCircleBeats: ['you'],
      polarityFacets: ['voice vs glamour'],
      units: [
        {
          id: 'u1',
          order: 0,
          text: 'Meet Stela',
          kind: 'meet',
          storyCircleFacets: ['you'],
          prerequisites: [],
          sceneKind: 'standard',
          obligations: [{ id: 't1', kind: 'thread_setup', text: 'Stela friendship seed' }],
        },
        {
          id: 'u2',
          order: 1,
          text: 'Write at 4am',
          kind: 'late_night_writing',
          storyCircleFacets: ['need'],
          prerequisites: ['u1'],
          sceneKind: 'standard',
          obligations: [{ id: 'tw1', kind: 'twist_reveal', text: 'Mr Midnight identity lands' }],
        },
      ],
    };
    const blueprint = {
      episodeId: 'ep1',
      scenes: [
        { id: 's1', spineUnitId: 'u1' },
        { id: 's2', spineUnitId: 'u2' },
      ],
    } as EpisodeBlueprint;

    const seed = buildCompiledThreadTwistFromEsc(blueprint, 1, spine);
    expect(seed.threads).toHaveLength(1);
    expect(seed.threads[0].tags).toContain('esc-compiled');
    expect(seed.threads[0].tags).toContain(ESC_PLANT_STAGING_TAG);
    expect(seed.threads[0].status).toBe('paid_off');
    expect(seed.threads[0].payoffs).toHaveLength(1);
    expect(seed.threads[0].payoffs[0]?.sceneId).toBe('s1');
    expect(seed.twistPlan?.twistSceneId).toBe('s2');
    expect(seed.twistPlan?.foreshadowSceneId).toBe('s1');
    expect(seed.twistPlan?.directives).toHaveLength(2);
  });

  it('dedupes identical plant text across consequence_seed and information_reveal', () => {
    const plantText = 'Kylie arrives in Bucharest with two suitcases and her grandmother\'s address.';
    const spine: EpisodeSpineContract = {
      episodeNumber: 1,
      sourceHash: 'h',
      episodeStoryCircleBeats: ['you'],
      polarityFacets: [],
      units: [
        {
          id: 'u1',
          order: 0,
          text: plantText,
          kind: 'arrival',
          storyCircleFacets: ['you'],
          prerequisites: [],
          sceneKind: 'standard',
          obligations: [
            { id: 'consequence_seed-1-kylie-arrives', kind: 'consequence_seed', text: plantText },
            { id: 'information_reveal-1-kylie-arrives', kind: 'information_reveal', text: plantText },
            { id: 'thread_setup-3-bookshop', kind: 'thread_setup', text: 'She wanders into a bookshop owned by Stela.' },
          ],
        },
      ],
    };
    const blueprint = {
      episodeId: 'ep1',
      scenes: [{ id: 's1-1', spineUnitId: 'u1' }],
    } as EpisodeBlueprint;

    const seed = buildCompiledThreadTwistFromEsc(blueprint, 1, spine);
    expect(seed.threads).toHaveLength(2);
    expect(seed.threads.map((t) => t.id)).toEqual([
      'consequence_seed-1-kylie-arrives',
      'thread_setup-3-bookshop',
    ]);
    expect(seed.threads.every((t) => isEscPlantStagingThread(t))).toBe(true);
    expect(seed.threads.every((t) => (t.payoffs?.length ?? 0) > 0)).toBe(true);
  });

  it('registers ESC plant staging as paid on the obligation ledger (no seal debt)', () => {
    const plantText = 'Kylie arrives in Bucharest with two suitcases.';
    const spine: EpisodeSpineContract = {
      episodeNumber: 1,
      sourceHash: 'h',
      episodeStoryCircleBeats: ['you'],
      polarityFacets: [],
      units: [
        {
          id: 'u1',
          order: 0,
          text: plantText,
          kind: 'arrival',
          storyCircleFacets: ['you'],
          prerequisites: [],
          sceneKind: 'standard',
          obligations: [
            { id: 'consequence_seed-1-kylie-arrives', kind: 'consequence_seed', text: plantText },
            { id: 'information_reveal-1-kylie-arrives', kind: 'information_reveal', text: plantText },
            { id: 'thread_setup-5-testing-kylie', kind: 'thread_setup', text: 'Testing Kylie' },
          ],
        },
      ],
    };
    const blueprint = {
      episodeId: 'ep1',
      scenes: [{ id: 's1-1', spineUnitId: 'u1' }],
    } as EpisodeBlueprint;

    const seed = buildCompiledThreadTwistFromEsc(blueprint, 1, spine);
    const ledger = new CallbackLedger({ storyId: 's' });
    const result = registerThreadObligations(ledger, { threads: seed.threads }, 1);
    expect(result.threadsRegistered).toBe(2);
    expect(result.threadPayoffsCredited).toBe(2);

    const report = validateObligationLedger(ledger, {
      episodeNumber: 1,
      generatedThroughEpisode: 1,
    });
    expect(report.findings.filter((f) => f.kind === 'thread')).toHaveLength(0);
    expect(report.paid).toBe(2);
  });

  it('seeds arc targets from polarity / contracts', () => {
    const targets = buildCompiledArcTargetsFromPlan({
      episodeId: 'ep1',
      episodeNumber: 1,
      polarityFacets: ['Keep her voice'],
      contracts: [],
    });
    expect(targets?.arcPhaseHeadline).toBe('Keep her voice');
  });
});
