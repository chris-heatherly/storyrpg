import { describe, expect, it } from 'vitest';

import { buildRequiredBeatsSection } from './requiredBeatsPromptSection';

describe('buildRequiredBeatsSection', () => {
  it('returns empty string when there are no required beats and no signature moment (non-treatment run)', () => {
    expect(buildRequiredBeatsSection(undefined)).toBe('');
    expect(buildRequiredBeatsSection({})).toBe('');
    expect(buildRequiredBeatsSection({ requiredBeats: [] })).toBe('');
    expect(buildRequiredBeatsSection({ requiredBeats: [], signatureMoment: '   ' })).toBe('');
  });

  it('drops beats whose mustDepict is empty/whitespace', () => {
    const out = buildRequiredBeatsSection({
      requiredBeats: [
        { id: 'rb1', sourceTurn: 't', mustDepict: '   ', tier: 'authored' },
      ],
    });
    expect(out).toBe('');
  });

  it('renders an ordered numbered checklist with tier framing', () => {
    const out = buildRequiredBeatsSection({
      requiredBeats: [
        { id: 'rb1', sourceTurn: 'turn A', mustDepict: 'Darian assaults the battlement.', tier: 'authored' },
        { id: 'rb2', sourceTurn: 'turn B', mustDepict: 'Lysandra names him Aethavyr.', tier: 'authored' },
        { id: 'rb3', sourceTurn: 'tissue', mustDepict: 'Travel from gate to wall.', tier: 'connective' },
      ],
    });

    expect(out).toContain('REQUIRED BEATS — depict each, in order');
    // Ordered numbering preserved.
    expect(out).toContain('1. [authored] Darian assaults the battlement.');
    expect(out).toContain('2. [authored] Lysandra names him Aethavyr.');
    expect(out).toContain('3. [connective] Travel from gate to wall.');
    // Beat 1 appears before beat 2 in the rendered text.
    expect(out.indexOf('Darian assaults')).toBeLessThan(out.indexOf('Lysandra names him'));
    // Tier framing present.
    expect(out).toContain('must occur, in order');
    expect(out).toContain('you may freely author this connective tissue');
  });

  it('renders the signature moment with a never-inverted guard', () => {
    const out = buildRequiredBeatsSection({
      signatureMoment: 'The archive floor reveals their joined blood.',
      requiredBeats: [
        { id: 'rb1', sourceTurn: 's', mustDepict: 'Show the joined-blood floor.', tier: 'signature' },
      ],
    });

    expect(out).toContain('Signature moment (MUST be depicted, never inverted):');
    expect(out).toContain('The archive floor reveals their joined blood.');
    expect(out).toContain('1. [signature] Show the joined-blood floor.');
    expect(out).toContain('never invert, soften, or omit it');
  });

  it('marks the list as authoring-only guidance (fiction-first: never leaked into prose)', () => {
    const out = buildRequiredBeatsSection({
      requiredBeats: [
        { id: 'rb1', sourceTurn: 's', mustDepict: 'A staged beat.', tier: 'authored' },
      ],
    });
    expect(out.toLowerCase().replace(/\s+/g, ' ')).toContain('never expose this list');
  });
});
