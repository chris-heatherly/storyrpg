import { describe, expect, it } from 'vitest';
import { assignInfoRevealsToScenes, type RevealAssignableScene, type RevealAssignableEntry } from './infoRevealAssignment';

const scenes: RevealAssignableScene[] = [
  { id: 's1', narrativeFunction: 'Open the episode; establish the marketplace.' },
  { id: 's2', narrativeRole: 'turn', narrativeFunction: 'The confrontation that turns the episode.' },
  { id: 's3', narrativeFunction: 'A quiet steward conversation about the missing ledger.', setsUp: ['the steward keeps the route book'] },
];

describe('assignInfoRevealsToScenes', () => {
  it('assigns a reveal to the scene whose content overlaps the fact (steward → s3)', () => {
    const entries: RevealAssignableEntry[] = [
      { id: 'info-A', label: 'The steward is the informant', description: 'The steward leaked the route ledger.', plannedRevealEpisode: 2 },
    ];
    const out = assignInfoRevealsToScenes(scenes, entries, 2);
    expect(out.get('s3')).toEqual(['info-A']);
    expect(out.get('s1')).toBeUndefined();
  });

  it('only assigns entries whose reveal episode matches', () => {
    const entries: RevealAssignableEntry[] = [
      { id: 'info-A', label: 'x', description: 'y', plannedRevealEpisode: 3 }, // different episode
      { id: 'info-B', label: 'z', description: 'w', plannedPayoffEpisode: 2 }, // payoff fallback
    ];
    const out = assignInfoRevealsToScenes(scenes, entries, 2);
    expect([...out.values()].flat()).toEqual(['info-B']);
  });

  it('prefers a reveal/turn-flavored scene when there is no content overlap', () => {
    const entries: RevealAssignableEntry[] = [
      { id: 'info-C', label: 'unrelated secret', description: 'nothing matches', plannedRevealEpisode: 2 },
    ];
    const out = assignInfoRevealsToScenes(scenes, entries, 2);
    // s2 has narrativeRole 'turn' → reveal-role bonus beats the later-position tiebreak on s3
    expect(out.get('s2')).toEqual(['info-C']);
  });

  it('skips arc-reframe summary entries and is a no-op without entries/scenes', () => {
    const entries: RevealAssignableEntry[] = [
      { id: 'info-arc-1-reframe', label: 'Arc 1 reframe', plannedRevealEpisode: 2 },
    ];
    expect(assignInfoRevealsToScenes(scenes, entries, 2).size).toBe(0);
    expect(assignInfoRevealsToScenes(scenes, undefined, 2).size).toBe(0);
    expect(assignInfoRevealsToScenes([], entries, 2).size).toBe(0);
  });

  it('is deterministic — same inputs give the same assignment', () => {
    const entries: RevealAssignableEntry[] = [
      { id: 'info-A', label: 'steward route', description: 'route ledger', plannedRevealEpisode: 2 },
    ];
    const a = assignInfoRevealsToScenes(scenes, entries, 2);
    const b = assignInfoRevealsToScenes(scenes, entries, 2);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});
