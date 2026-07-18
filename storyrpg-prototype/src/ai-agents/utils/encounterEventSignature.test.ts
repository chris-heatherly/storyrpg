import { describe, expect, it } from 'vitest';
import { buildEncounterEventSignature, compareEncounterEventSignatures } from './encounterEventSignature';

describe('encounterEventSignature', () => {
  it('does not treat a corner booth as a pressure action', () => {
    const signature = buildEncounterEventSignature([
      'Mika leads you to a corner booth where the group trades stories under dim bar lights.',
    ]);

    expect(signature.pressureActions.has('pinned')).toBe(false);
  });

  it('still treats active cornering as pressure', () => {
    const signature = buildEncounterEventSignature([
      'The attacker corners Mara beside the locked gate before she can reach the street.',
    ]);

    expect(signature.pressureActions.has('pinned')).toBe(true);
  });

  it('does not treat social fight metaphors as high-pressure events', () => {
    const signature = buildEncounterEventSignature([
      'Mika hands over the key card and says the shoes will help you start the real fight inside the club.',
    ]);

    expect(signature.pressureActions.has('confront')).toBe(false);
  });

  it('does not treat emotional escape phrasing as a physical escape event', () => {
    const signature = buildEncounterEventSignature([
      'A laugh escapes you, the first real one all day. You lean into the frame and joke with Sadie.',
    ]);

    expect(signature.pressureActions.has('escape')).toBe(false);
  });

  it('does not treat escaping weather as a physical escape event', () => {
    const signature = buildEncounterEventSignature([
      'You duck into the bookshop to escape the dusk chill and find Stela sorting river stones.',
    ]);

    expect(signature.pressureActions.has('escape')).toBe(false);
  });

  it('does not treat a social club phrase as the club location', () => {
    const signature = buildEncounterEventSignature([
      'Mika grins from the armchair. "Welcome to the weird girls club, baby."',
    ]);

    expect(signature.locations.has('club')).toBe(false);
  });

  it('does not treat a friend-group Dusk Club toast as the club location', () => {
    const signature = buildEncounterEventSignature([
      'Mika drapes an arm over your shoulders. "We are christening our club. The Dusk Club. Very exclusive."',
    ]);

    expect(signature.locations.has('club')).toBe(false);
  });

  it('does not treat ordinary corners as pinning pressure', () => {
    const bookshop = buildEncounterEventSignature([
      'Stela sits tucked into a corner with a cup of tea and smiles.',
    ]);
    const street = buildEncounterEventSignature([
      'As you round the corner onto your street, the courtyard doors come into view.',
    ]);

    expect(bookshop.pressureActions.has('pinned')).toBe(false);
    expect(street.pressureActions.has('pinned')).toBe(false);
  });

  it('does not treat hand-holding as an attack', () => {
    const signature = buildEncounterEventSignature([
      "Stela's hand closes over yours, her thumb pressing the smooth stone into your palm.",
    ]);

    expect(signature.pressureActions.has('attack')).toBe(false);
  });

  it('treats ghosted assault language as aftermath rather than a new staged attack', () => {
    const signature = buildEncounterEventSignature([
      'You can still feel the ghost of a freezing grip around your throat as Victor guides you away from the park.',
    ]);

    expect(signature.isReferenceOnly).toBe(true);
  });

  it('does not treat ordinary doors as apartment locations for event matching', () => {
    const signature = buildEncounterEventSignature([
      'The bell over the door of Lumina Books chimes as Stela presses rose quartz into your hand.',
    ]);

    expect(signature.locations.has('bookshop')).toBe(true);
    expect(signature.locations.has('apartment')).toBe(false);
  });

  it('does not treat a rooftop bar or service corner as Vâlcescu Club or pinning', () => {
    const signature = buildEncounterEventSignature([
      'You, Mika, and Stela have claimed a corner of the rooftop bar, cocktails sweating on the low table.',
    ]);

    expect(signature.locations.has('rooftop')).toBe(true);
    expect(signature.locations.has('club')).toBe(false);
    expect(signature.pressureActions.has('pinned')).toBe(false);
  });

  it('does not treat warmth gone from someone eyes as a vanish event', () => {
    const signature = buildEncounterEventSignature([
      'Stela accepts it with a sigh, the warmth gone from her eyes.',
    ]);

    expect(signature.resolutionActions.has('vanish')).toBe(false);
  });

  it('does not treat an incidental waiter vanishing as a disappearance event', () => {
    const signature = buildEncounterEventSignature([
      'A waiter appears and vanishes, leaving a trio of champagne flutes in his wake.',
    ]);

    expect(signature.resolutionActions.has('vanish')).toBe(false);
  });

  it('does not treat champagne bubbles vanishing on your tongue as a disappearance event', () => {
    const signature = buildEncounterEventSignature([
      'The last of the champagne bubbles vanish on your tongue, leaving only warmth.',
    ]);

    expect(signature.resolutionActions.has('vanish')).toBe(false);
  });

  it('still treats a named character vanishing as a resolution event', () => {
    const signature = buildEncounterEventSignature([
      'You turn back, but Radu has vanished into the crowd.',
    ]);

    expect(signature.resolutionActions.has('vanish')).toBe(true);
  });

  it('does not treat a toast to "the ones who get away" as a physical escape event', () => {
    const signature = buildEncounterEventSignature([
      'She raises her own glass. "To the ones smart enough to get away. To us."',
    ]);

    expect(signature.pressureActions.has('escape')).toBe(false);
  });

  it('still treats getting away from a pursuer as a physical escape event', () => {
    const signature = buildEncounterEventSignature([
      'You get away from the attacker just as the gate slams shut.',
    ]);

    expect(signature.pressureActions.has('escape')).toBe(true);
  });

  it('does not treat a mention of reading taste as the bookshop location', () => {
    const signature = buildEncounterEventSignature([
      'Stela vetted your taste in books. Now it\'s my turn.',
    ]);

    expect(signature.locations.has('bookshop')).toBe(false);
  });

  it('still treats the shop\'s proper name as the bookshop location', () => {
    const signature = buildEncounterEventSignature([
      'The bell over the door of Lumina Books chimes as you step inside.',
    ]);

    expect(signature.locations.has('bookshop')).toBe(true);
  });

  it('does not match two directly-sequential rooftop beats as a duplicate high-pressure event (r118 s1-4/s1-5)', () => {
    const duskClub = buildEncounterEventSignature([
      'The three become friends and form the Dusk Club.',
      'The elevator doors part with a whisper, trading conditioned air for the crisp bite of the Bucharest night. Up here, on the Valescu rooftop, the world is sharp edges.',
      'A waiter appears and vanishes, leaving a trio of champagne flutes in his wake. Mika hadn\'t even looked at him. "Stela vouches for your library. But I\'m more interested in your little black book."',
      'Mika orders a round of champagne. "Stela vetted your taste in books. Now it\'s my turn."',
      'She raises her own glass. "To the ones smart enough to get away. To us."',
      'Mika\'s eyes glitter. "A club for women who own the night. We\'ll be the Dusk Club." The champagne flutes touch in the cool night air.',
    ]);
    const rooftopBar = buildEncounterEventSignature([
      'At a rooftop bar she catches the attention of a man in a charcoal suit.',
      'The last of the champagne bubbles vanish on your tongue, leaving only warmth.',
      'Mika follows your gaze across the rooftop. "The man in the charcoal suit has been staring for ten minutes."',
      'Pinned between the two stares, you feel a chill cut through the warm night. Stela sets her empty flute down. "Kylie. We\'re going." A walk toward Cismigiu Gardens suddenly seems right.',
    ]);

    expect(compareEncounterEventSignatures(duskClub, rooftopBar).matched).toBe(false);
  });

  it('does not match Bite Me setup scenes as duplicate park attacks', () => {
    const coldOpen = buildEncounterEventSignature([
      'Kylie arrives in Bucharest',
      'The fourth-floor walk-up smells of dust and lemon wax.',
      'A laugh escapes you, the first real one all day.',
      'Everything finds a place, and the apartment starts to feel less like a temporary stop.',
    ]);
    const bookshop = buildEncounterEventSignature([
      'At a Lipscani bookshop, Stela presses a chunk of rose quartz into Kylie\'s hand.',
      'The next evening, the bell over the door of Lumina Books chimes your arrival.',
      'Stela accepts it with a sigh, the warmth gone from her eyes.',
    ]);
    const rooftop = buildEncounterEventSignature([
      'Night three in Bucharest, and the sunset bleeds magenta over the city.',
      'You, Mika, and Stela have claimed a corner of the rooftop bar.',
      'A man in a charcoal suit stands near the edge, watching the sky.',
    ]);
    const attack = buildEncounterEventSignature([
      'Cișmigiu at 1am: fog, a shadow, a scream, and Victor rescuing you from the attack.',
      'The fog in Cișmigiu Gardens swallows the streetlights. A shadow detaches from the treeline, moving impossibly fast.',
    ]);

    expect(compareEncounterEventSignatures(coldOpen, attack).matched).toBe(false);
    expect(compareEncounterEventSignatures(bookshop, rooftop).matched).toBe(false);
    expect(compareEncounterEventSignatures(bookshop, attack).matched).toBe(false);
    expect(compareEncounterEventSignatures(rooftop, attack).matched).toBe(false);
  });
});
