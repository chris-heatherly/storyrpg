import { describe, expect, it } from 'vitest';
import type { NarrativeAnchorContract } from '../../types/narrativeContract';
import { auditAnchorCastOrder } from './anchorCastOrderPreflight';

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
