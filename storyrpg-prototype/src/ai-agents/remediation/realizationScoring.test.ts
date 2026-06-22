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

  it('extracts the quoted moment from a SceneTurn central-turn finding', () => {
    const moment = "Kylie's 'noticer' instinct collects unsettling splinters: Ileana crying in the powder room, a mantle photograph that seems to omit Victor, Mika's unexplained missing hour, and a guest who knows the Marinescu maiden name.";
    const msg = `Scene "s3-3" does not dramatize its central turn on-page: "${moment}".`;
    expect(requiredMomentFromMessage(msg)).toBe(moment);
  });

  it('extracts the quoted moment from a SceneTurn seven-point event finding', () => {
    const moment = 'Kylie lands in Bucharest fleeing heartbreak, starts a blog, and is rescued by a mysterious man in the park.';
    const msg = `Scene "s1-1" carries seven-point hook structurally but does not dramatize its authored beat event on-page: "${moment}".`;
    expect(requiredMomentFromMessage(msg)).toBe(moment);
  });

  it('extracts the quoted moment from a TreatmentEventLedger finding', () => {
    const moment = 'Kylie lands in Bucharest fleeing heartbreak, starts a blog, and is rescued by a mysterious man in the park.';
    const msg = `Treatment event ledger summary-only realization in scene "s1-1": must dramatize on-page, not summarize as memory/backstory: "${moment}".`;
    expect(requiredMomentFromMessage(msg)).toBe(moment);
  });

  it('extracts the quoted moment from a SceneTurn incomplete-shape finding', () => {
    const moment = 'Victor reframes the blog as bait, not confession.';
    const msg = `Scene "s3-3" mentions its central turn but does not give it a complete scene shape (before, turn, aftermath): "${moment}".`;
    expect(requiredMomentFromMessage(msg)).toBe(moment);
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

  it('credits paraphrased rose-quartz warding consent when the object transfer is on-page', () => {
    const moment = "Stela presses a piece of rose quartz into Kylie's hand at Lumina Books, quietly establishing her first warding consent.";
    const prose = [
      "Stela's hand hovers over a chipped ceramic bowl on the counter, one filled with stones like river-tumbled sweets.",
      "Her fingers close around a single pinkish stone. 'For your new apartment,' she says.",
      "She turns, closing your fingers around the quartz. Her words hang in the air, not a sales pitch but a quiet warning.",
    ].join(' ');
    expect(momentDepicted('RequiredBeatRealizationValidator', moment, prose)).toBe(true);
  });

  it('credits paraphrased protective-herb warding when the bag, brunch context, and protection meaning land', () => {
    const moment = 'Stela gifts Kylie a protective bag of herbs during brunch, continuing her quiet, consent-based warding.';
    const prose = [
      "Mika slides her phone across the polished table. 'Five hundred thousand impressions, and that's just since breakfast.'",
      "Stela's hand enters your vision, pushing a small muslin bag across the table.",
      "The scent of lavender and crushed pine cuts through the cafe's aroma. 'For the apartment,' she says. 'Against... drafts.'",
      "The word she didn't say - protection - settles between you.",
    ].join(' ');
    expect(momentDepicted('RequiredBeatRealizationValidator', moment, prose)).toBe(true);
  });

  it('does not let one half of a compound treatment list satisfy the whole authored beat', () => {
    const moment = "Kylie's 'noticer' instinct collects unsettling splinters: Ileana crying in the powder room, a mantle photograph that seems to omit Victor, Mika's unexplained missing hour, and a guest who knows the Marinescu maiden name.";
    const prose = [
      'Your eyes catch on a photograph over the marble mantle. Victor should be in the place of honor, but the center of the frame is empty.',
      "An older guest smiles. 'You have your grandmother's eyes.' He probes the Marinescu legacy you carry.",
    ].join(' ');
    expect(momentDepicted('RequiredBeatRealizationValidator', moment, prose)).toBe(false);
    const missing = missingMomentTokens('RequiredBeatRealizationValidator', moment, prose);
    expect(missing).toEqual(expect.arrayContaining(['ileana', 'crying', 'powder', 'mika', 'missing', 'hour', 'maiden', 'name']));
  });

  it('passes a compound treatment list only when each listed splinter is depicted', () => {
    const moment = "Kylie's 'noticer' instinct collects unsettling splinters: Ileana crying in the powder room, a mantle photograph that seems to omit Victor, Mika's unexplained missing hour, and a guest who knows the Marinescu maiden name.";
    const prose = [
      'In the powder room, Ileana cries silently into a towel before composing her face.',
      'A mantle photograph catches your eye because Victor has been omitted from the place of honor.',
      'Mika is gone for an unexplained missing hour, and no one will tell you where he went.',
      "An elderly guest knows your grandmother's Marinescu maiden name before you offer it.",
    ].join(' ');
    expect(momentDepicted('RequiredBeatRealizationValidator', moment, prose)).toBe(true);
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
