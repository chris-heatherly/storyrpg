import { describe, expect, it } from 'vitest';
import { missingMomentTokens, momentDepicted, requiredMomentFromMessage } from './realizationScoring';

const SIGNATURE =
  'Two anchors, light then dark — the rooftop bar at sunset on night three where the Dusk Club locks into place and Kylie catches both men watching her; then Cișmigiu at 1am, eight seconds of fog, a shadow, a scream, and a rescue.';

describe('requiredMomentFromMessage', () => {
  it('extracts the quoted moment from a RequiredBeatRealization finding', () => {
    const msg = `Authored required beat is missing from the final prose of episode 2 scene "s2-1": "Three terrible dates fail in a row — fed straight into the blog.". The authored turn must be dramatized on-page, not dropped or truncated.`;
    expect(requiredMomentFromMessage(msg)).toBe('Three terrible dates fail in a row — fed straight into the blog.');
  });

  it('extracts the quoted moment from a SignatureDevicePresence finding (inner quotes survive)', () => {
    const msg = `Signature device is missing from the final prose of episode 1 scene "treatment-enc-1-1": "${SIGNATURE}". The staged signature moment must be depicted, not summarized away.`;
    expect(requiredMomentFromMessage(msg)).toBe(SIGNATURE);
  });

  it('returns undefined for non-realization messages', () => {
    expect(requiredMomentFromMessage('Witness npc id "None" is invalid.')).toBeUndefined();
    expect(requiredMomentFromMessage(undefined)).toBeUndefined();
  });
});

describe('momentDepicted (mirror of the validators’ presence check)', () => {
  it('fails the bite-me-g13 post-repair prose (one anchor dramatized, one missing)', () => {
    const prose =
      'You adjust borrowed silk as the rooftop blushes at sunset. The Dusk Club locks into place around the friends on night three; Kylie lifts her glass. Streetlamp gold still warms her steps at the gate.';
    expect(momentDepicted('SignatureDevicePresenceValidator', SIGNATURE, prose)).toBe(false);
  });

  it('passes once BOTH anchors are on-page', () => {
    const prose =
      'The rooftop bar blushes at sunset on night three; the Dusk Club locks into place and Kylie catches both men watching her across the rail. Hours later, Cișmigiu at 1am: eight seconds of fog, a shadow, a scream — and a rescue that leaves her shaking.';
    expect(momentDepicted('SignatureDevicePresenceValidator', SIGNATURE, prose)).toBe(true);
  });

  it('counts inflected forms via the shared-stem rule', () => {
    expect(momentDepicted('RequiredBeatRealizationValidator', 'she leaps to rescue the child', 'leaping down, she rescues the children')).toBe(true);
  });

  it('treats an empty/unextractable moment as depicted', () => {
    expect(momentDepicted('RequiredBeatRealizationValidator', '', 'anything')).toBe(true);
  });
});

describe('missingMomentTokens', () => {
  it('names exactly the content words the prose still lacks', () => {
    const missing = missingMomentTokens(
      'SignatureDevicePresenceValidator',
      SIGNATURE,
      'The rooftop bar at sunset; the Dusk Club locks into place and Kylie catches both men watching her on night three.',
    );
    expect(missing).toContain('cismigiu'); // normalized (diacritics stripped)
    expect(missing).toContain('scream');
    expect(missing).toContain('rescue');
    expect(missing).not.toContain('rooftop');
    expect(missing).not.toContain('sunset');
  });

  it('respects per-validator stopwords (‘signature’ is a stopword only for the signature validator)', () => {
    const moment = 'the signature gesture happens';
    expect(missingMomentTokens('SignatureDevicePresenceValidator', moment, '')).not.toContain('signature');
    expect(missingMomentTokens('RequiredBeatRealizationValidator', moment, '')).toContain('signature');
  });
});
