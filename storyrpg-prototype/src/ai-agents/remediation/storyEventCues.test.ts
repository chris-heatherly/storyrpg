import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BITE_ME_LEXICON, resetStoryLexiconFromEnv, setStoryLexicon } from '../config/storyLexicon';
import { detectPrimaryStoryEventCues, detectRealizedStoryEventCues, detectStoryEventCues } from './storyEventCues';

beforeEach(() => setStoryLexicon(BITE_ME_LEXICON));
afterEach(() => resetStoryLexiconFromEnv({}));

describe('detectStoryEventCues', () => {
  it('does not treat a social group name alone as a venue-door event', () => {
    const cues = detectStoryEventCues('The new circle gathers over bitter drinks and jokes about new beginnings.');

    expect(cues.has('venueDoor')).toBe(false);
  });

  it('detects generic social group formation as a social scene cue', () => {
    const cues = detectStoryEventCues('The traveler forms a new circle with two strangers over bitter drinks.');

    expect(cues.has('socialMeet')).toBe(true);
    expect(cues.has('venueDoor')).toBe(false);
  });

  it('does not treat a message about a public post as an object handoff', () => {
    const cues = detectStoryEventCues('A friend texts to say the late-night post is powerful.');

    expect(cues.has('objectHandoff')).toBe(false);
  });

  it('still detects explicit side-entrance and protective-object events', () => {
    expect(detectStoryEventCues('At the private club, a host presses a side-entrance key card into your palm.').has('venueDoor')).toBe(true);
    expect(detectStoryEventCues('Inside the bookshop, a clerk presses a quartz crystal into your hand.').has('objectHandoff')).toBe(true);
  });

  it('keeps draft and future-viral intent separate from public blog aftermath', () => {
    expect(detectStoryEventCues('The rescue is the kind of story that could go viral.').has('blogAftermath')).toBe(false);
    expect(detectStoryEventCues("Introduce the reader's first meeting with the protagonist.").has('blogAftermath')).toBe(false);
    expect(detectStoryEventCues('At 4am, the cursor blinks on a blank page before you publish the anonymous post.').has('blogAftermath')).toBe(false);
    expect(detectStoryEventCues('By evening, the anonymous post has gone viral and the views counter keeps climbing.').has('blogAftermath')).toBe(true);
  });

  it('detects late-night writing across compact and punctuated a.m. spellings', () => {
    expect(detectStoryEventCues('At 4am, the narrator writes the anonymous post.').has('lateNightWriting')).toBe(true);
    expect(detectStoryEventCues('At 4 a.m., the narrator chooses a codename and publishes.').has('lateNightWriting')).toBe(true);
    expect(detectStoryEventCues('At 4 a.m., the narrator chooses a codename and publishes.').has('blogAftermath')).toBe(false);
  });

  it('recognizes a published viral result inside a compound writing scene', () => {
    expect(detectStoryEventCues('At 4am you publish the post. Hours later, the post is viral and the city is reading.').has('blogAftermath')).toBe(true);
  });

  it('detects generic public writing launches as writing cues', () => {
    const cues = detectStoryEventCues('The narrator starts a public account under a codename.');

    expect(cues.has('lateNightWriting')).toBe(true);
    expect(cues.has('blogAftermath')).toBe(false);
  });

  it('does not treat phrasal "start over" near a blog reference as a publication launch (bite-me 2026-07-07 s1-7)', () => {
    const cues = detectStoryEventCues(
      'Can Kylie start over, feel wanted, and write under her own name in a city that is already watching her',
    );

    expect(cues.has('lateNightWriting')).toBe(false);
  });

  it('requires the writing action to act on the writing object, not merely co-occur', () => {
    const distant = detectStoryEventCues(
      'She writes to her mother about the weather, the food, and the loneliness. Weeks later, long after the letters stop, a stranger mentions that an old city blog once covered the same streets.',
    );
    expect(distant.has('lateNightWriting')).toBe(false);

    const acting = detectStoryEventCues('She drafts the post twice before dawn.');
    expect(acting.has('lateNightWriting')).toBe(true);
  });

  it('does not treat writing as an identity posture as a late-night writing event', () => {
    const cues = detectStoryEventCues('The protagonist uses their writing to watch others rather than participate.');

    expect(cues.has('lateNightWriting')).toBe(false);
  });

  it('does not treat a blog or writing as a defensive identity posture as a writing-event owner', () => {
    const cues = detectPrimaryStoryEventCues(
      'The protagonist arrives as a wounded observer, hiding behind a codenamed blog and using writing to curate life from a safe distance.',
    );

    expect(cues.has('lateNightWriting')).toBe(false);
  });

  it('detects inflected attack and rescue wording as a threat encounter', () => {
    const cues = detectStoryEventCues('Walking home through the park, the protagonist is attacked and rescued by a stranger.');

    expect(cues.has('threatEncounter')).toBe(true);
  });

  it('does not treat generic threshold, hands, stranger, danger, or post wording as event cues', () => {
    const cues = detectStoryEventCues('At the threshold, your hands shake while a stranger mentions danger in a post.');

    expect(cues.has('arrival')).toBe(false);
    expect(cues.has('objectHandoff')).toBe(false);
    expect(cues.has('socialMeet')).toBe(false);
    expect(cues.has('threatEncounter')).toBe(false);
    expect(cues.has('lateNightWriting')).toBe(false);
  });

  it('distinguishes travel arrival from messages or memories arriving', () => {
    expect(detectStoryEventCues('The protagonist arrives in the port city with two bags and an old address.').has('arrival')).toBe(true);
    expect(detectStoryEventCues('A private message arrives while the memory of the rescuer stays sharp.').has('arrival')).toBe(false);
  });

  it('does not promote online invitations or rescue recaps to primary route events', () => {
    const invitation = detectPrimaryStoryEventCues('A profile request arrives for the online night club attached to the public post.');
    expect(invitation.has('venueDoor')).toBe(false);

    const recap = detectPrimaryStoryEventCues('The essay turns the rescue story into proof that the city is watching.');
    expect(recap.has('threatEncounter')).toBe(false);

    const live = detectPrimaryStoryEventCues('In the alley, rough hands grab your coat before a stranger rescues you.');
    expect(live.has('threatEncounter')).toBe(true);
  });

  it('does not treat writing ABOUT an attack as owning the threat encounter (bite-me 2026-07-04 scene-4)', () => {
    const framing = detectPrimaryStoryEventCues(
      'How do you frame your blog post about Mr. Midnight and the attack?',
    );
    expect(framing.has('threatEncounter')).toBe(false);

    const describing = detectPrimaryStoryEventCues(
      'Kylie writes her Dating After Dusk post and must describe the terrifying attack without naming her rescuer.',
    );
    expect(describing.has('threatEncounter')).toBe(false);
  });

  it('still detects a freshly staged attack even when writing words are nearby', () => {
    const staged = detectPrimaryStoryEventCues(
      'As she drafts the post, the attacker returns and grabs her wrist before she can scream.',
    );
    expect(staged.has('threatEncounter')).toBe(true);
  });

  it('does not treat a still grip on an object as a live threat', () => {
    const social = detectPrimaryStoryEventCues('At the reception, a stranger holds a glass with a grip of absolute stillness.');
    expect(social.has('threatEncounter')).toBe(false);

    const attack = detectPrimaryStoryEventCues('In the corridor, the attacker closes a bruising grip around your arm.');
    expect(attack.has('threatEncounter')).toBe(true);
  });

  it('detects the antagonist first-contact cue in each of the bite-me 2026-07-03 restagings', () => {
    const blogComment = detectPrimaryStoryEventCues(
      "A new user, 'V.V.', has left a simple, chilling message: 'I look forward to reading more.'",
    );
    expect(blogComment.has('antagonistContact')).toBe(true);

    const privateDm = detectPrimaryStoryEventCues(
      "A single notification, separate from the public feed. A direct message from a private account: V.V. The text is brief. 'An impressive memory, writer.'",
    );
    expect(privateDm.has('antagonistContact')).toBe(true);

    const formalComment = detectPrimaryStoryEventCues(
      "It's one name in particular, a formal account with a single, chilling comment: 'Intriguing.' V. Velescu.",
    );
    expect(formalComment.has('antagonistContact')).toBe(true);
  });

  it('does not fire antagonist contact for a message from a known friend', () => {
    const friendly = detectPrimaryStoryEventCues(
      "A text from Mika flashes across the screen: 'OMG. EVERYONE is reading this. We're famous.'",
    );
    expect(friendly.has('antagonistContact')).toBe(false);
  });
});

describe('detectRealizedStoryEventCues', () => {
  it('accepts dwelling-synonym prose as a realized walk home (bite-me 2026-07-05 treatment-enc-1-1)', () => {
    const prose = [
      "The walk to your apartment is five blocks of taut silence, the city's nightlife a world away.",
      'When you reach your door, he waits, his shadow falling over you as you fumble with the lock.',
      'Once inside, you lean against the door until your breathing slows.',
    ].join(' ');

    expect(detectRealizedStoryEventCues(prose).has('walkHome')).toBe(true);
    // Ownership assignment stays conservative: the strict detector must NOT fire here.
    expect(detectPrimaryStoryEventCues(prose).has('walkHome')).toBe(false);
  });

  it('still detects a literal escorted walk home', () => {
    const prose = 'He walks her home through the empty streets and vanishes at the corner.';
    expect(detectRealizedStoryEventCues(prose).has('walkHome')).toBe(true);
  });

  it('does not treat a determiner "walk home" recounting as a realized staging', () => {
    const prose = 'She keeps replaying the attack, the rescue, and the walk home in her head while she drafts the post.';
    expect(detectRealizedStoryEventCues(prose).has('walkHome')).toBe(false);
  });

  it('does not treat unrelated door or threshold mentions as a walk home', () => {
    const prose = 'At the threshold of the club, your hands shake while a stranger mentions danger.';
    expect(detectRealizedStoryEventCues(prose).has('walkHome')).toBe(false);
  });

  it('accepts a dramatized viral spike alongside writing-register memory framing (bite-me 2026-07-15 s1-blog-aftermath)', () => {
    // The duplicate-event repair reframes the owned writing event as memory,
    // adding writing tokens to the OWNING aftermath scene; the spike itself is
    // dialogue + counts, never the planning phrase "goes viral".
    const prose = [
      "The apartment is steeped in dusk, a world away from the 4 a.m. fever that saw you turn the night into words. Your first post.",
      'The readership number jumps past one hundred. Then five hundred. Then it breaks a thousand.',
      '"Viral, baby! You\'re the talk of the town!"',
      "The 'Publish' button clicks, a sound of defiance.",
    ].join(' ');
    expect(detectRealizedStoryEventCues(prose).has('blogAftermath')).toBe(true);
    // Ownership assignment stays conservative: the strict detector must NOT fire here.
    expect(detectPrimaryStoryEventCues(prose).has('blogAftermath')).toBe(false);
  });

  it('does not treat a pure writing scene as realized blog aftermath', () => {
    const prose = 'At 4 a.m. the cursor blinks on a blank page. You write, delete, and write again before the publish button tempts you.';
    expect(detectRealizedStoryEventCues(prose).has('blogAftermath')).toBe(false);
  });

  it('does not treat hedged-future viral talk as realized blog aftermath', () => {
    const prose = 'Mika grins: this post could go viral, and the readership might explode by morning.';
    expect(detectRealizedStoryEventCues(prose).has('blogAftermath')).toBe(false);
  });
});
