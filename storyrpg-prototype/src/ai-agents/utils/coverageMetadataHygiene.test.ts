import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COVERAGE_RELATIONSHIP_BLOCKING,
  DEFAULT_VISUAL_CONTINUITY_REASON,
  defaultVisualThreadForLocation,
  isUnsafeCoverageMetadataText,
  sanitizeCoveragePlanMetadata,
  sanitizeSequenceIntentMetadata,
} from './coverageMetadataHygiene';

describe('coverageMetadataHygiene', () => {
  it('flags Track-the-visible and SequenceDirector preserve scaffolds', () => {
    expect(isUnsafeCoverageMetadataText(
      'Track the visible consequence of She wanders into a bookshop owned by Stela who befriends her and….',
    )).toBe(true);
    expect(isUnsafeCoverageMetadataText(
      'SequenceDirector: preserve Track the visible consequence of She wanders into a bookshop.',
    )).toBe(true);
    expect(isUnsafeCoverageMetadataText('The ring controls the frame between them.')).toBe(false);
  });

  it('builds a location-based visual thread without treatment titles', () => {
    expect(defaultVisualThreadForLocation('Lumina Books')).toMatch(/Lumina Books/);
    expect(defaultVisualThreadForLocation('Lumina Books')).not.toMatch(/Track the visible consequence/i);
    expect(defaultVisualThreadForLocation(undefined)).toMatch(/hand positions|distance/i);
  });

  it('sanitizes coveragePlan relationshipBlocking and continuity reason', () => {
    const plan = sanitizeCoveragePlanMetadata({
      relationshipBlocking: 'Track the visible consequence of She wanders into a bookshop.',
      visualContinuity: {
        preserveFromBeatId: 'b0',
        reason: 'SequenceDirector: preserve Track the visible consequence of She wanders into a bookshop.',
      },
    });

    expect(plan.relationshipBlocking).toBe(DEFAULT_COVERAGE_RELATIONSHIP_BLOCKING);
    expect(plan.visualContinuity?.reason).toBe(DEFAULT_VISUAL_CONTINUITY_REASON);
  });

  it('sanitizes sequenceIntent visualThread scaffolds', () => {
    const intent = sanitizeSequenceIntentMetadata({
      visualThread: 'Track the visible consequence of She wanders into a bookshop owned by Stela who befriends her and….',
    }, 'Lumina Books');

    expect(intent.visualThread).toBe(defaultVisualThreadForLocation('Lumina Books'));
  });
});
