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

  it('extracts the quoted moment from a treatment plant finding', () => {
    const msg = 'Treatment plant not found on-page in episode 1 (bound to scene "s1-1"): "The rougher man at the kitchen entrance who didn\'t fit.". A cold open, recurring object, or information-ledger tell from the treatment was dropped.';
    expect(requiredMomentFromMessage(msg)).toBe("The rougher man at the kitchen entrance who didn't fit.");
  });

  it('extracts the quoted moment from a cold-open finding', () => {
    const msg = 'Cold open not found on-page in episode 1 (scene "s1-1"): "A FaceTime to her niece Sadie about vampires in Romania". The episode-opening hook was dropped.';
    expect(requiredMomentFromMessage(msg)).toBe('A FaceTime to her niece Sadie about vampires in Romania');
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

  it('does not let scattered seed ingredients satisfy the concrete treatment plant', () => {
    const prose = [
      'Mika hands you a key card to the side entrance.',
      'Morning light falls across the kitchen counter and a hand-knit blanket.',
    ].join(' ');
    expect(momentDepicted('RequiredBeatRealizationValidator', "The rougher man at the kitchen entrance who didn't fit.", prose)).toBe(false);
  });

  it('does not count a generic man near kitchens as the concrete treatment plant', () => {
    const prose =
      "Your gaze drifts to an archway flanking the kitchens and catches on a man who is a block of granite amidst silk. He isn't watching the party. He's watching the exits.";
    expect(momentDepicted('RequiredBeatRealizationValidator', "The rougher man at the kitchen entrance who didn't fit.", prose)).toBe(false);
  });

  it('passes the concrete treatment seed only when the figure and treatment sign land together', () => {
    const prose = 'The rougher man by the kitchen smells faintly of woodsmoke before turning away.';
    expect(momentDepicted('RequiredBeatRealizationValidator', "The rougher man at the kitchen entrance who didn't fit.", prose)).toBe(true);
  });

  it('passes the concrete treatment seed when the local plant spans adjacent sentences', () => {
    const prose =
      'The scent of woodsmoke leads you toward the building kitchen. Radu is pinned against the doorframe. Opposite him stands a rougher man, his heavy hand-knit sweater straining at the shoulders.';
    expect(momentDepicted('RequiredBeatRealizationValidator', "The rougher man at the kitchen entrance who didn't fit.", prose)).toBe(true);
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

  it('returns concrete seed tokens when the co-located plant is absent', () => {
    const missing = missingMomentTokens(
      'RequiredBeatRealizationValidator',
      "The rougher man at the kitchen entrance who didn't fit.",
      'A hand-knit blanket lies on the kitchen counter.',
    );
    expect(missing).toContain('kitchen');
    expect(missing).toContain('woodsmoke');
  });
});

describe('requiredMomentFromMessage — EncounterAnchorContent forms (bite-me-g18)', () => {
  it('extracts the central-conflict moment', () => {
    const msg = 'Authored encounter anchor "The hedge maze…" (Ep 3) does not depict its central conflict on-page: "The kiss is the moment her appetite outvotes her noticing.".';
    expect(requiredMomentFromMessage(msg)).toBe('The kiss is the moment her appetite outvotes her noticing.');
  });
  it('extracts the required-beat moment', () => {
    const msg = 'Authored encounter anchor "The hedge maze…" (Ep 3) does not depict required beat enc-3-1-rb1 (authored): "At Sunday breakfast Victor reframes the blog.".';
    expect(requiredMomentFromMessage(msg)).toBe('At Sunday breakfast Victor reframes the blog.');
  });
})
