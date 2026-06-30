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
