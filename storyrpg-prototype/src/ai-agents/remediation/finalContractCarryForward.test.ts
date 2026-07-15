import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Story } from '../../types';
import {
  applyCandidateEpisodes,
  buildRepairCandidate,
  carryForwardStoryHash,
  isDeterministicReFailure,
  parseRepairCandidate,
  remainingBlockingFingerprintSet,
  sameFingerprintSet,
  REPAIR_CARRYFORWARD_SCHEMA_VERSION,
  type FinalContractRepairCandidate,
} from './finalContractCarryForward';
import {
  finalContractRepairCandidateFilename,
  loadFinalContractRepairCandidateSync,
  saveFinalContractRepairCandidate,
} from '../utils/pipelineOutputWriter';

// pipelineOutputWriter's import chain reaches expo-file-system, which crashes
// under the node test environment (__DEV__) — same mock as its own test file.
vi.mock('expo-file-system', () => ({
  default: {},
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false })),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));

function makeStory(prose = 'She crossed the square alone.'): Story {
  return {
    id: 'bite-me',
    title: 'Bite Me',
    genre: 'urban fantasy',
    synopsis: 'test',
    coverImage: '',
    author: 'AI Generated',
    tags: [],
    initialState: { attributes: {}, skills: {}, tags: [], inventory: [] },
    npcs: [],
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        title: 'Episode 1',
        scenes: [
          {
            id: 's1-1',
            name: 'Opening',
            beats: [{ id: 'b1', type: 'narration', content: prose }],
          },
        ],
      },
    ],
  } as unknown as Story;
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    type: 'semantic_realization',
    severity: 'blocker',
    message: 'missing meaning',
    sceneId: 's1-1',
    taskId: 'task-1',
    ...overrides,
  } as never;
}

describe('finalContractCarryForward', () => {
  it('hashes the episodes projection only — recomputed top-level fields never invalidate a candidate', () => {
    const a = makeStory();
    const b = makeStory();
    (b as { coverImage: string }).coverImage = 'https://cdn/other-cover.png';
    b.outputDir = '/somewhere/else/';
    expect(carryForwardStoryHash(a)).toBe(carryForwardStoryHash(b));
    const c = makeStory('Entirely different prose after a repair.');
    expect(carryForwardStoryHash(a)).not.toBe(carryForwardStoryHash(c));
  });

  it('returns null when no candidate was consumed and no repair changed the story (nothing to carry)', () => {
    const story = makeStory();
    const candidate = buildRepairCandidate({
      story,
      report: { blockingIssues: [makeIssue()] },
      phase: 'final_story_contract',
      context: { baseStoryHash: carryForwardStoryHash(story) },
    });
    expect(candidate).toBeNull();
  });

  it('captures repaired episodes, remaining fingerprints, and per-fingerprint enforcement counts', () => {
    const base = makeStory();
    const baseStoryHash = carryForwardStoryHash(base);
    const repaired = makeStory('The rewritten beat that cleared one blocker.');
    const candidate = buildRepairCandidate({
      story: repaired,
      report: { blockingIssues: [makeIssue(), makeIssue({ taskId: 'task-2' })] },
      phase: 'final_story_contract',
      context: { baseStoryHash },
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.baseStoryHash).toBe(baseStoryHash);
    expect(candidate!.candidateStoryHash).toBe(carryForwardStoryHash(repaired));
    expect(candidate!.remainingBlockingFingerprints).toHaveLength(2);
    expect(candidate!.enforcementCount).toBe(1);
    for (const key of candidate!.remainingBlockingFingerprints) {
      expect(candidate!.fingerprintEnforcementsSeen[key]).toBe(1);
    }
  });

  it('accumulates enforcement counts across resumes and records resolved fingerprints', () => {
    const base = makeStory();
    const baseStoryHash = carryForwardStoryHash(base);
    const repaired = makeStory('Second-resume text with one more repair applied.');
    const [stubbornFp, clearedFp] = remainingBlockingFingerprintSet({
      blockingIssues: [makeIssue(), makeIssue({ taskId: 'task-2' })],
    });
    const candidate = buildRepairCandidate({
      story: repaired,
      report: { blockingIssues: [makeIssue()] },
      phase: 'final_story_contract',
      context: {
        baseStoryHash,
        consumed: {
          candidateStoryHash: 'fnv1a32:earlier',
          remainingBlockingFingerprints: [stubbornFp, clearedFp].sort(),
          enforcementCount: 2,
          fingerprintEnforcementsSeen: { [stubbornFp]: 2, [clearedFp]: 2 },
        },
      },
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.enforcementCount).toBe(3);
    expect(candidate!.remainingBlockingFingerprints).toEqual([...candidate!.remainingBlockingFingerprints].sort());
    const remainingKey = candidate!.remainingBlockingFingerprints[0];
    expect(candidate!.fingerprintEnforcementsSeen[remainingKey]).toBe(3);
    expect(candidate!.resolvedLastEnforcement).toHaveLength(1);
  });

  it('flags a deterministic re-failure only when content AND blocker set are unchanged', () => {
    const consumed = {
      candidateStoryHash: 'fnv1a32:same',
      remainingBlockingFingerprints: ['a', 'b'],
      enforcementCount: 1,
      fingerprintEnforcementsSeen: { a: 1, b: 1 },
    };
    expect(isDeterministicReFailure(
      { candidateStoryHash: 'fnv1a32:same', remainingBlockingFingerprints: ['b', 'a'] },
      consumed,
    )).toBe(true);
    expect(isDeterministicReFailure(
      { candidateStoryHash: 'fnv1a32:progressed', remainingBlockingFingerprints: ['a', 'b'] },
      consumed,
    )).toBe(false);
    expect(isDeterministicReFailure(
      { candidateStoryHash: 'fnv1a32:same', remainingBlockingFingerprints: ['a'] },
      consumed,
    )).toBe(false);
    expect(isDeterministicReFailure(
      { candidateStoryHash: 'fnv1a32:same', remainingBlockingFingerprints: ['a', 'b'] },
      undefined,
    )).toBe(false);
  });

  it('sameFingerprintSet is order-insensitive and length-strict', () => {
    expect(sameFingerprintSet(['x', 'y'], ['y', 'x'])).toBe(true);
    expect(sameFingerprintSet(['x'], ['x', 'y'])).toBe(false);
    expect(sameFingerprintSet([], [])).toBe(true);
  });

  it('applyCandidateEpisodes replaces episodes in place with a deep copy', () => {
    const story = makeStory('Watermark text.');
    const repaired = makeStory('Carried repaired text.');
    const candidate = buildRepairCandidate({
      story: repaired,
      report: { blockingIssues: [makeIssue()] },
      phase: 'final_story_contract',
      context: { baseStoryHash: carryForwardStoryHash(story) },
    })!;
    applyCandidateEpisodes(story, candidate);
    expect(carryForwardStoryHash(story)).toBe(candidate.candidateStoryHash);
    // Deep copy: mutating the consumer's story must not corrupt the candidate.
    (story.episodes![0] as { title?: string }).title = 'Mutated';
    expect((candidate.candidateEpisodes[0] as { title?: string }).title).toBe('Episode 1');
  });

  it('parseRepairCandidate degrades everything unexpected to null (absent)', () => {
    const good: FinalContractRepairCandidate = buildRepairCandidate({
      story: makeStory('Repaired.'),
      report: { blockingIssues: [makeIssue()] },
      phase: 'final_story_contract',
      context: { baseStoryHash: 'fnv1a32:base' },
    })!;
    expect(parseRepairCandidate(good, 'final_story_contract')).not.toBeNull();
    expect(parseRepairCandidate(good, 'incremental_contract_ep_1')).toBeNull();
    expect(parseRepairCandidate(null, 'final_story_contract')).toBeNull();
    expect(parseRepairCandidate('garbage', 'final_story_contract')).toBeNull();
    expect(parseRepairCandidate({ ...good, schemaVersion: 99 }, 'final_story_contract')).toBeNull();
    expect(parseRepairCandidate({ ...good, candidateEpisodes: [] }, 'final_story_contract')).toBeNull();
    expect(parseRepairCandidate({ ...good, enforcementCount: 0 }, 'final_story_contract')).toBeNull();
    expect(parseRepairCandidate({ ...good, baseStoryHash: undefined }, 'final_story_contract')).toBeNull();
  });
});

describe('repair candidate persistence (pipelineOutputWriter)', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeRunDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'storyrpg-carryforward-'));
    tempDirs.push(dir);
    return `${dir}/`;
  }

  it('round-trips a candidate through checkpoints/ keyed by phase', async () => {
    const outputDir = await makeRunDir();
    const candidate = buildRepairCandidate({
      story: makeStory('Repaired prose.'),
      report: { blockingIssues: [makeIssue()] },
      phase: 'final_story_contract',
      context: { baseStoryHash: 'fnv1a32:base' },
    })!;
    await saveFinalContractRepairCandidate(outputDir, candidate);
    const loaded = loadFinalContractRepairCandidateSync(outputDir, 'final_story_contract');
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe(REPAIR_CARRYFORWARD_SCHEMA_VERSION);
    expect(loaded!.candidateStoryHash).toBe(candidate.candidateStoryHash);
    expect(loaded!.remainingBlockingFingerprints).toEqual(candidate.remainingBlockingFingerprints);
    // A different phase must not see this candidate.
    expect(loadFinalContractRepairCandidateSync(outputDir, 'incremental_contract_ep_1')).toBeNull();
  });

  it('load degrades to null on absent files and never throws', async () => {
    const outputDir = await makeRunDir();
    expect(loadFinalContractRepairCandidateSync(outputDir, 'final_story_contract')).toBeNull();
    expect(loadFinalContractRepairCandidateSync('', 'final_story_contract')).toBeNull();
  });

  it('phase slugs sanitize into a stable checkpoint filename', () => {
    expect(finalContractRepairCandidateFilename('final_story_contract'))
      .toBe('checkpoints/final-repair-candidate-final_story_contract.json');
    expect(finalContractRepairCandidateFilename('incremental_contract_ep_1'))
      .toBe('checkpoints/final-repair-candidate-incremental_contract_ep_1.json');
    expect(finalContractRepairCandidateFilename('weird/phase name'))
      .toBe('checkpoints/final-repair-candidate-weird_phase_name.json');
  });
});
