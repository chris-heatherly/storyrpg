import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Story } from '../../types';
import { decodeStory } from '../codec/storyCodec';
import { rebalanceSeasonSkillCoverage } from './seasonSkillRebalance';
import { SkillCoverageValidator } from '../validators/SkillCoverageValidator';

/** Build a story whose stat checks are heavily concentrated on one skill. */
function perceptionHeavyStory(): Story {
  const mkChoice = (id: string, skill: string, choiceType: string) => ({
    id, text: id, choiceType,
    statCheck: { skillWeights: { [skill]: 1.0 }, difficulty: 50 },
  });
  // 10 strategic perception checks + 2 others → 3/8 skills, perception ~83%.
  const choices = [
    ...Array.from({ length: 10 }, (_, i) => mkChoice(`c-per-${i}`, 'perception', 'strategic')),
    mkChoice('c-pers', 'persuasion', 'relationship'),
    mkChoice('c-inv', 'investigation', 'strategic'),
  ];
  return {
    id: 's', episodes: [{
      id: 'ep-1', number: 1, scenes: [{
        id: 's1', beats: [{ id: 'b1', choices }],
      }],
    }],
  } as unknown as Story;
}

/** Flatten choices for the SkillCoverageValidator. */
function flatten(story: Story) {
  const out: any[] = [];
  const walk = (n: unknown, ep: number) => {
    if (Array.isArray(n)) return n.forEach((x) => walk(x, ep));
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o.statCheck && (o as any).text) out.push({ ...(o as any), episodeNumber: ep });
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, ep);
  };
  (story.episodes || []).forEach((e: any, i) => walk(e, e.number ?? i + 1));
  return out;
}

describe('rebalanceSeasonSkillCoverage', () => {
  it('lifts a single-skill-dominated season to ≥6/8 coverage and <30% dominance', () => {
    const story = perceptionHeavyStory();
    const r = rebalanceSeasonSkillCoverage(story);
    expect(r.reassignments).toBeGreaterThan(0);
    expect(r.after.coveredSkills).toBeGreaterThanOrEqual(6);
    expect(r.after.dominantShare).toBeLessThanOrEqual(0.3);
    // The validator (the gate's source of truth) should now be clean.
    const result = new SkillCoverageValidator().validate({ choices: flatten(story) });
    expect(result.metrics.coveredSkills).toBeGreaterThanOrEqual(6);
    expect(result.metrics.dominantSkillShare).toBeLessThanOrEqual(0.3);
  });

  it('is a no-op on an already-balanced season', () => {
    const skills = ['perception', 'investigation', 'persuasion', 'survival', 'athletics', 'stealth'];
    const choices = skills.map((s, i) => ({
      id: `c${i}`, text: `c${i}`, choiceType: 'strategic',
      statCheck: { skillWeights: { [s]: 1.0 }, difficulty: 50 },
    }));
    const story = { id: 's', episodes: [{ id: 'e1', number: 1, scenes: [{ id: 's1', beats: [{ id: 'b1', choices }] }] }] } as unknown as Story;
    const r = rebalanceSeasonSkillCoverage(story);
    expect(r.reassignments).toBe(0);
  });

  it('clears the real Bite Me G10 imbalance (4/8, perception 45%)', () => {
    const p = join(__dirname, '../../../generated-stories/bite-me-g10_2026-06-09T04-07-00/story.json');
    if (!existsSync(p)) return; // run artifact may be pruned; skip rather than fail CI
    const story = decodeStory(JSON.parse(readFileSync(p, 'utf8'))).story;
    const r = rebalanceSeasonSkillCoverage(story);
    expect(r.after.coveredSkills).toBeGreaterThanOrEqual(6);
    expect(r.after.dominantShare).toBeLessThanOrEqual(0.3);
    const result = new SkillCoverageValidator().validate({ choices: flatten(story) });
    // No "only N/8 skills" or ">30%" warnings should remain.
    expect(result.metrics.coveredSkills).toBeGreaterThanOrEqual(6);
    expect(result.metrics.dominantSkillShare).toBeLessThanOrEqual(0.3);
  });
});
