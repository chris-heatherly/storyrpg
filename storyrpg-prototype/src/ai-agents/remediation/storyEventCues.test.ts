import { describe, expect, it } from 'vitest';
import { detectPrimaryStoryEventCues, detectStoryEventCues } from './storyEventCues';

describe('detectStoryEventCues', () => {
  it('does not treat a social group name alone as a venue-door event', () => {
    const cues = detectStoryEventCues('The new circle gathers over bitter drinks and jokes about new beginnings.');

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
    expect(detectStoryEventCues('At 4am, the cursor blinks on a blank page before you publish the anonymous post.').has('blogAftermath')).toBe(false);
    expect(detectStoryEventCues('By evening, the anonymous post has gone viral and the views counter keeps climbing.').has('blogAftermath')).toBe(true);
  });

  it('detects late-night writing across compact and punctuated a.m. spellings', () => {
    expect(detectStoryEventCues('At 4am, the narrator writes the anonymous post.').has('lateNightWriting')).toBe(true);
    expect(detectStoryEventCues('At 4 a.m., the narrator chooses a codename and publishes.').has('lateNightWriting')).toBe(true);
    expect(detectStoryEventCues('At 4 a.m., the narrator chooses a codename and publishes.').has('blogAftermath')).toBe(false);
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

  it('does not treat a still grip on an object as a live threat', () => {
    const social = detectPrimaryStoryEventCues('At the reception, a stranger holds a glass with a grip of absolute stillness.');
    expect(social.has('threatEncounter')).toBe(false);

    const attack = detectPrimaryStoryEventCues('In the corridor, the attacker closes a bruising grip around your arm.');
    expect(attack.has('threatEncounter')).toBe(true);
  });
});
