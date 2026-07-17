import { describe, expect, it } from 'vitest';
import type { NarrativeAnchorContract } from '../../types/narrativeContract';
import { applyCastOrderAutofix, auditAnchorCastOrder, auditFirstAppearanceCastOrder } from './anchorCastOrderPreflight';

const raduSighting: NarrativeAnchorContract = {
  id: 'anchor:1:6:radu-s-first-sighting',
  anchorName: "Radu's first sighting",
  episodeNumber: 1,
  owningSceneId: 's1-5',
  onPageAction: 'Kylie first notices a rougher man near the service door at the rooftop bar.',
  npcName: 'Radu Stoian',
  firstSighting: true,
};

describe('auditAnchorCastOrder', () => {
  it('flags an NPC cast before their anchored first sighting (run 20-44-49: Radu in s1-2)', () => {
    const findings = auditAnchorCastOrder([raduSighting], [
      { id: 's1-1', episodeNumber: 1, order: 0, npcsPresent: [] },
      { id: 's1-2', episodeNumber: 1, order: 1, npcsPresent: ['char-radu-stoian'] },
      { id: 's1-5', episodeNumber: 1, order: 2, npcsPresent: ['char-victor-valcescu', 'char-radu-stoian'] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ earlySceneId: 's1-2', owningSceneId: 's1-5', npcName: 'Radu Stoian' });
  });

  it('accepts casting in and after the owning scene', () => {
    const findings = auditAnchorCastOrder([raduSighting], [
      { id: 's1-1', episodeNumber: 1, order: 0, npcsPresent: [] },
      { id: 's1-5', episodeNumber: 1, order: 1, npcsPresent: ['char-radu-stoian'] },
      { id: 's1-6', episodeNumber: 1, order: 2, npcsInvolved: ['Radu Stoian'] },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('ignores anchors that are not first sightings and anchors without an NPC', () => {
    const findings = auditAnchorCastOrder([
      { ...raduSighting, firstSighting: undefined },
      { ...raduSighting, id: 'anchor:1:2:stela-s-protection', anchorName: "Stela's protection", npcName: undefined, firstSighting: true },
    ], [
      { id: 's1-2', episodeNumber: 1, order: 0, npcsPresent: ['char-radu-stoian'] },
      { id: 's1-5', episodeNumber: 1, order: 1, npcsPresent: [] },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not cross episode boundaries', () => {
    const findings = auditAnchorCastOrder([raduSighting], [
      { id: 's2-1', episodeNumber: 2, order: 0, npcsPresent: ['char-radu-stoian'] },
      { id: 's1-5', episodeNumber: 1, order: 0, npcsPresent: [] },
    ]);
    expect(findings).toHaveLength(0);
  });
});

describe('auditFirstAppearanceCastOrder + applyCastOrderAutofix (C1)', () => {
  const contract = (overrides: Partial<import('../../types/narrativeContract').NarrativeFirstAppearanceContract> = {}) => ({
    id: 'first-appearance:radu-stoian',
    characterId: 'char-radu-stoian',
    characterName: 'Radu Stoian',
    episodeNumber: 1,
    owningSceneId: 's1-5',
    mode: 'named_on_page' as const,
    earlierSceneIds: ['s1-1', 's1-2'],
    sourceContractIds: ['anchor:1:3:radu-first-sighting'],
    blocking: true,
    ...overrides,
  });

  it('flags a cast placement in a contract-earlier scene (deterministic, no anchor dependence)', () => {
    const findings = auditFirstAppearanceCastOrder([contract({ sourceContractIds: ['presence:radu'] })], [
      { id: 's1-1', npcsPresent: [] },
      { id: 's1-2', npcsPresent: ['char-radu-stoian'] },
      { id: 's1-5', npcsPresent: ['char-radu-stoian'] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ earlySceneId: 's1-2', anchorBacked: false });
  });

  it('ignores branch siblings not named in earlierSceneIds', () => {
    const findings = auditFirstAppearanceCastOrder([contract()], [
      { id: 's1-2', npcsPresent: [] },
      { id: 's1-4b', npcsPresent: ['char-radu-stoian'] },
      { id: 's1-5', npcsPresent: ['char-radu-stoian'] },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('autofix strips only anchor-backed placements and reports what it removed', () => {
    const scenes = [
      { id: 's1-2', npcsPresent: ['char-radu-stoian', 'char-stela-pavel'], npcsInvolved: ['char-radu-stoian'] },
      { id: 's1-5', npcsPresent: ['char-radu-stoian'] },
    ];
    const findings = auditFirstAppearanceCastOrder([contract()], scenes);
    expect(findings).toHaveLength(1);
    expect(findings[0].anchorBacked).toBe(true);

    const applied = applyCastOrderAutofix(findings, scenes);
    expect(applied).toHaveLength(1);
    expect(scenes[0].npcsPresent).toEqual(['char-stela-pavel']);
    expect(scenes[0].npcsInvolved).toEqual([]);
    // The owning scene keeps its cast.
    expect(scenes[1].npcsPresent).toEqual(['char-radu-stoian']);
  });

  it('autofix leaves same-episode presence-derived findings untouched (advisory tier)', () => {
    const scenes = [
      { id: 's1-2', npcsPresent: ['char-radu-stoian'] },
      { id: 's1-5', npcsPresent: ['char-radu-stoian'] },
    ];
    const findings = auditFirstAppearanceCastOrder([contract({ sourceContractIds: ['presence:radu'] })], scenes);
    expect(findings[0]?.crossEpisode).toBe(false);
    const applied = applyCastOrderAutofix(findings, scenes);
    expect(applied).toHaveLength(0);
    expect(scenes[0].npcsPresent).toEqual(['char-radu-stoian']);
  });

  it('the Radu class: a cast in an EARLIER EPISODE than the compiled first appearance is flagged and autofixed', () => {
    // Run 14-50-23: presence contracts put Radu's first appearance in ep2
    // (s2-3, earlierSceneIds episode-local to ep2), but the ep1 plan cast him
    // into s1-2 — invisible to earlierSceneIds alone.
    const raduEp2 = contract({
      owningSceneId: 's2-3',
      episodeNumber: 2,
      earlierSceneIds: ['s2-1', 's2-2'],
      sourceContractIds: ['presence:radu'],
    });
    const ep1Scenes = [
      { id: 's1-1', episodeNumber: 1, npcsPresent: [] as string[] },
      { id: 's1-2', episodeNumber: 1, npcsPresent: ['char-radu-stoian', 'char-stela-pavel'] },
    ];
    const findings = auditFirstAppearanceCastOrder([raduEp2], ep1Scenes);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ earlySceneId: 's1-2', crossEpisode: true, anchorBacked: false });

    const applied = applyCastOrderAutofix(findings, ep1Scenes);
    expect(applied).toHaveLength(1);
    expect(ep1Scenes[1].npcsPresent).toEqual(['char-stela-pavel']);
  });
});
