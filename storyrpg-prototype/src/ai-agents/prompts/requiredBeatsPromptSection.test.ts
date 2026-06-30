import { describe, expect, it } from 'vitest';

import { buildColdOpenProfileSection, buildRequiredBeatsSection } from './requiredBeatsPromptSection';

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
    expect(out).toContain('depict each, in order');
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

  it('frames coldopen beats as focused Story Circle hooks instead of ensemble checklists', () => {
    const out = buildRequiredBeatsSection({
      requiredBeats: [
        { id: 'rb1', sourceTurn: 's', mustDepict: 'The protagonist is cornered at the station desk.', tier: 'coldopen' },
      ],
    });

    expect(out).toContain('fulfill the Story Circle cold-open profile');
    expect(out).toContain('limit active cast');
    expect(out).not.toContain('every named character');
  });
});

describe('buildColdOpenProfileSection', () => {
  it('renders punchy single-scene cold-open guidance from the compiled profile', () => {
    const out = buildColdOpenProfileSection({
      coldOpenProfile: {
        id: 'cold-open:1:s1-1',
        episodeNumber: 1,
        sceneId: 's1-1',
        mode: 'sharp_disruption',
        archetype: 'in_media_res',
        storyCircleBeats: ['you', 'need'],
        storyCircleFulfillment: {
          beats: ['you', 'need'],
          combinedBeats: ['you', 'need'],
          baseline: 'The protagonist survives by staying unseen.',
          need: 'The protagonist needs to ask for help.',
          collision: 'The unseen protagonist is forced to ask for help while exposed.',
          sourceContractIds: ['episode-circle-ep1-you', 'episode-circle-ep1-need'],
        },
        centralTurn: 'The desk clerk names the protagonist aloud.',
        microConflict: 'The protagonist wants anonymity, but the clerk makes them visible.',
        openQuestion: 'How will the protagonist escape public exposure?',
        activeCastLimit: 2,
        beatBudget: { min: 6, recommended: 8, max: 10 },
        exitHook: 'End on a charged line.',
        sourceContractIds: ['episode-circle-ep1-you', 'episode-circle-ep1-need'],
        selectedConcepts: [{
          source: 'storyCircle',
          id: 'episode-circle-ep1-you',
          role: 'story_circle',
          text: 'The protagonist survives by staying unseen.',
        }],
        conflictResolutions: ['Combined Story Circle you + need into one immediate cold-open collision instead of separate checklist beats.'],
      },
    });

    expect(out).toContain('COLD OPEN CONTRACT');
    expect(out).toContain('you + need combined');
    expect(out).toContain('one central collision');
    expect(out).toContain('Active cast target: 2');
    expect(out).toContain('End on a charged line.');
  });
});
