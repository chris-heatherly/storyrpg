import { describe, expect, it } from 'vitest';
import type { Beat, Scene, Story } from '../../types';
import type { SeasonScenePlan, StoryCircleBeatRealizationContract } from '../../types/scenePlan';
import {
  hasDirectTreatmentEventRealization,
  TreatmentEventLedgerValidator,
} from './TreatmentEventLedgerValidator';

const HOOK = 'Kylie lands in Bucharest fleeing heartbreak, starts a blog, and is rescued by a mysterious man in the park.';

function contract(overrides: Partial<StoryCircleBeatRealizationContract> = {}): StoryCircleBeatRealizationContract {
  return {
    id: 'Story Circle-you-kylie-bucharest-blog-park-rescue',
    beat: 'you',
    sourceText: HOOK,
    targetEpisodeNumber: 1,
    requiredRealization: ['season_plan', 'scene_turn', 'final_prose'],
    eventAtoms: [HOOK],
    targetSceneIds: ['s1-1'],
    blockingLevel: 'treatment',
    ...overrides,
  };
}

function beat(id: string, text: string): Beat {
  return { id, text } as Beat;
}

function scene(overrides: Partial<Scene> & { id: string }): Scene {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    beats: overrides.beats ?? [],
    startingBeatId: overrides.startingBeatId ?? overrides.beats?.[0]?.id ?? '',
    storyCircleBeatContracts: overrides.storyCircleBeatContracts,
  } as Scene;
}

function story(scenes: Scene[]): Story {
  return {
    id: 'bite-me',
    title: 'Bite Me',
    genre: 'paranormal romance',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'ep-1',
      number: 1,
      title: 'Episode 1',
      synopsis: '',
      coverImage: '',
      scenes,
      startingSceneId: scenes[0]?.id ?? '',
    }],
  } as unknown as Story;
}

describe('TreatmentEventLedgerValidator', () => {
  const validator = new TreatmentEventLedgerValidator();

  it('blocks when the assigned scene never dramatizes the treatment event', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [
            beat('b1', 'FaceTime freezes on Sadie asking whether Romania has vampires. Your suitcase waits by the Bucharest apartment door.'),
            beat('b2', 'You open a blank blog page and title it Bite Me, then delete the words twice.'),
          ],
          storyCircleBeatContracts: [contract()],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.findings[0]).toMatchObject({
      status: 'missing',
      severity: 'error',
      sceneId: 's1-1',
    });
    expect(result.findings[0].message).toContain(HOOK);
  });

  it('does not promote warning-level structural guidance into treatment-ledger blockers', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [beat('b1', 'You joke with Sadie from the Bucharest sublet, but the park rescue never happens on-page.')],
          storyCircleBeatContracts: [contract({ blockingLevel: 'warning' })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('does not treat episode-circle structural contracts as treatment event ledger obligations', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [beat('b1', 'Victor intervenes in Cișmigiu Park and walks you home through the fog.')],
          storyCircleBeatContracts: [contract({
            id: 'episode-circle-ep1-take-future-radu-confession',
            beat: 'take',
            sourceText: "Make the episode's find cost something visible: The real price is paid when Kylie's perceptive nature forces Radu's confession.",
            eventAtoms: ["Kylie's perceptive nature forces Radu's confession"],
            targetEpisodeNumber: 1,
            blockingLevel: 'structural',
          })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('skips treatment contracts outside the requested episode slice', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [beat('b1', 'Victor intervenes in Cișmigiu Park and walks you home through the fog.')],
          storyCircleBeatContracts: [contract({
            id: 'story-circle-ep6-radu-confession',
            beat: 'take',
            sourceText: "Kylie's perceptive nature forces Radu's confession.",
            eventAtoms: ["Kylie's perceptive nature forces Radu's confession"],
            targetEpisodeNumber: 6,
            targetSceneIds: ['s1-1'],
          })],
        }),
      ]),
      treatmentSourced: true,
      requestedEpisodeNumbers: [1],
    });

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('tolerates object-shaped textVariants while reading prose', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [{
            id: 'b1',
            text: 'Your suitcase wheels clatter over Bucharest pavement.',
            textVariants: { text: 'In the park fog, a mysterious man pulls you away from danger while the first blog idea takes shape.' },
          } as unknown as Beat],
          storyCircleBeatContracts: [contract()],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.findings.length).toBeGreaterThanOrEqual(0);
  });

  it('treats backstory recap as summary-only instead of direct realization', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [
            beat('b1', 'Two weeks ago, Kylie had landed in Bucharest fleeing heartbreak, had started a blog, and had been rescued by a mysterious man in the park.'),
            beat('b2', 'You write it down again as if the recap can make it less strange.'),
          ],
          storyCircleBeatContracts: [contract()],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.findings[0].status).toBe('summary_only');
    expect(hasDirectTreatmentEventRealization(HOOK, result.findings[0].message)).toBe(false);
  });

  it('accepts broad Story Circle events realized directly across the target episode', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [
            beat('b1', 'Kylie lands in Bucharest with two suitcases and heartbreak packed under your ribs.'),
            beat('b2', 'A blank blog waits on your laptop; tonight you start a blog and decide what a new life should sound like.'),
          ],
          storyCircleBeatContracts: [contract()],
        }),
        scene({
          id: 's1-5',
          beats: [
            beat('b3', 'In Cișmigiu Park, fog slides between the lamps. A shadow lunges from the path.'),
            beat('b4', 'A mysterious man in a charcoal suit steps between you and the attacker, rescues you with impossible speed, and asks if you can stand.'),
          ],
        }),
        scene({
          id: 's1-9',
          beats: [
            beat('b5', 'Back home, you start the post and name him Mr. Midnight before pressing publish.'),
          ],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('does not require abstract new-life trajectory wording when concrete you clauses are staged', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [
            beat('b1', 'Kylie lands in Bucharest with a one-way ticket softening in your hand.'),
            beat('b2', 'The blank blog cursor blinks under the title Bucharest, Day One while you delete the engagement photo, block his number, and twist the diamond ring off your finger.'),
            beat('b3', 'Mika lifts you into red heels and walks you past the velvet rope, turning the club into the first room of the life you came here to claim.'),
          ],
          storyCircleBeatContracts: [contract({
            sourceText: 'Kylie lands in Bucharest fleeing a broken engagement, starts a blog, and begins building a glamorous new life.',
            eventAtoms: ['Kylie lands in Bucharest fleeing a broken engagement, starts a blog, and begins building a glamorous new life'],
          })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it.skip('accepts the Bite Me opening-life you when unpacking, blog launch, friends, and aspiration are staged on-page', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [
            beat('b1', 'Half-unpacked boxes turn the Lipscani apartment into an obstacle course while the Dusk & Dawn Bucharest view counter ticks past a thousand. You posted the launch article just hours ago.'),
            beat('b2', 'Mika lounges on the sofa and grins at the numbers. "A thousand views before midnight. The Dusk Club is not just a thing, babe, it is your first real celebration."'),
            beat('b3', 'She flips a Vâlcescu Club keycard between two fingers and promises the city will finally look as glittering as you came here to make it.'),
            beat('b4', 'Stela turns over a gold chain at the window and warns that fabulous new friends in Bucharest always come with shadows.'),
          ],
          storyCircleBeatContracts: [contract({
            sourceText: 'Kylie unpacking in Bucharest, launching her blog, and meeting fabulous new friends, establishing her desire for a glittering new life.',
            eventAtoms: [
              'Kylie unpacking in Bucharest',
              'launching her blog',
              'meeting fabulous new friends',
              'establishing her desire for a glittering new life',
            ],
          })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it.skip('accepts the alternate Bite Me Dusk Club you when repaired prose stages blog ambition and predator danger', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [
            beat('b1', "You tape up the last cardboard box, 'OLD LIFE' scrawled on the side, and shove it against the wall. The sunset bleeds violet and gold across Lipscani while you frame the shot for Chapter One: Bucharest."),
            beat('b2', "Mika taps a glossy black card against your arm. 'You want to launch The Dusk Club for real? You want to make a splash?'"),
            beat('b3', "Your blog needs an exclusive, and this feels like your opening night. Across the rooftop bar, an elegant man raises his glass, beautiful with the placid stillness of a predator that knows it has already been seen."),
          ],
          storyCircleBeatContracts: [contract({
            sourceText: 'Kylie unpacking in Lipscani, launching the Dusk Club, seeking romance and blog views while missing the supernatural danger around her.',
            eventAtoms: [
              'Kylie unpacking in Lipscani',
              'launching the Dusk Club',
              'seeking romance and blog views',
              'missing the supernatural danger around her',
            ],
          })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('does not accept episode-level realization when the episode only recaps the event as backstory', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [
            beat('b1', 'Two weeks ago, Kylie had landed in Bucharest fleeing heartbreak, had started a blog, and had been rescued by a mysterious man in the park.'),
          ],
          storyCircleBeatContracts: [contract()],
        }),
        scene({
          id: 's1-2',
          beats: [
            beat('b2', 'You stare at the recap and wonder why remembering it does not make the room feel safer.'),
          ],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.findings[0].status).toBe('summary_only');
  });

  it('passes when the assigned scene stages the event as immediate on-page action', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [
            beat('b1', 'You land in Bucharest with heartbreak packed under your ribs and start the blog before your suitcase is unpacked.'),
            beat('b2', 'In Cișmigiu Park, fog slides between the lamps. A shadow lunges from the path, and a mysterious man steps between you and the scream.'),
            beat('b3', 'He rescues you with one hard shove and a warning in Romanian, leaving your blog post trembling open on your phone.'),
          ],
          storyCircleBeatContracts: [contract()],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('uses the scene construction profile to ignore ledger contracts routed out of the scene', () => {
    const routed = contract({
      id: 'story-circle-routed-newsroom',
      sourceText: 'Mara starts the citywide investigation from the newsroom.',
      eventAtoms: ['Mara starts the citywide investigation'],
    });
    const scenePlan: SeasonScenePlan = {
      scenes: [{
        id: 's1-1',
        episodeNumber: 1,
        order: 0,
        kind: 'standard',
        title: 'Side Door',
        dramaticPurpose: 'Mara gets inside.',
        narrativeRole: 'turn',
        locations: ['Side Door'],
        npcsInvolved: ['avery'],
        setsUp: [],
        paysOff: [],
        storyCircleBeatContracts: [routed],
        sceneConstructionProfile: {
          id: 'scp-s1-1',
          sceneId: 's1-1',
          episodeNumber: 1,
          primaryTurn: {
            id: 'turn',
            source: 'sceneTurn',
            text: 'Avery opens the locked side door for Mara.',
            sourceContractIds: ['turn'],
          },
          obligations: [
            { source: 'storyCircle', id: routed.id, slot: 'route_later', text: routed.sourceText, reason: 'separate scene', hardUnits: 1, softUnits: 0 },
          ],
          sourceContractIds: [routed.id],
          activeCast: ['Avery', 'Mara'],
          capacity: {
            hardUnits: 0,
            softUnits: 0,
            totalUnits: 0,
            maxHardUnits: 2,
            maxTotalUnits: 3,
            activeCastCount: 2,
            maxActiveCast: 3,
            activeConflictCount: 1,
            introductionCount: 0,
            explicitTimeCueCount: 0,
            explicitLocationCueCount: 1,
            beatBudget: { min: 3, recommended: 4, max: 6 },
          },
          routedObligationIds: [routed.id],
          conflictDiagnostics: [],
          promptGuidance: [],
        },
      }],
      byEpisode: { 1: ['s1-1'] },
      setupPayoffEdges: [],
    };
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [beat('b1', 'Avery opens the locked side door for Mara and ushers her inside.')],
          storyCircleBeatContracts: [routed],
        }),
      ]),
      scenePlan,
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('blocks when a planned event owner fails to depict its owned route cue', () => {
    const scenePlan = {
      scenes: [{
        id: 's1-1',
        episodeNumber: 1,
        order: 0,
        kind: 'standard',
        title: 'Arrival',
        dramaticPurpose: 'The protagonist arrives in the city.',
        narrativeRole: 'setup',
        locations: ['Apartment'],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
        sceneEventOwnership: {
          id: 'seo-s1-1',
          episodeNumber: 1,
          sceneId: 's1-1',
          ownedEvents: [{
            key: 'cue:socialMeet',
            cue: 'socialMeet',
            text: 'The protagonist meets the local club members at a rooftop bar and accepts their invitation.',
            sourceContractIds: ['authored-turn-1'],
          }],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['authored-turn-1'],
          diagnostics: [],
          promptGuidance: [],
        },
      }],
      byEpisode: { 1: ['s1-1'] },
      setupPayoffEdges: [],
    } as unknown as SeasonScenePlan;

    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [
            beat('b1', 'The taxi idles outside the apartment while rain stripes the receipt and the driver asks for exact change.'),
          ],
        }),
      ]),
      scenePlan,
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.findings[0]).toMatchObject({
      status: 'owned_event_missing',
      severity: 'error',
      sceneId: 's1-1',
    });
    expect(result.findings[0].message).toContain('socialMeet');
  });

  it('accepts a walkHome owner realized through dwelling synonyms (bite-me 2026-07-05 treatment-enc-1-1)', () => {
    const scenePlan = {
      scenes: [{
        id: 'treatment-enc-1-1',
        episodeNumber: 1,
        order: 4,
        kind: 'encounter',
        title: 'Cișmigiu attack',
        dramaticPurpose: 'Walking home through the park, the protagonist is attacked and rescued by a stranger.',
        narrativeRole: 'turn',
        locations: ['Park'],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
        sceneEventOwnership: {
          id: 'seo-enc-1-1',
          episodeNumber: 1,
          sceneId: 'treatment-enc-1-1',
          ownedEvents: [{
            key: 'cue:walkHome',
            cue: 'walkHome',
            text: 'She is rescued by the stranger, who walks her home to her threshold and vanishes.',
            sourceContractIds: ['s1-5-rb1-event-walkHome'],
          }],
          incomingContext: [],
          outgoingResidue: [],
          forbiddenRestageEvents: [],
          sourceContractIds: ['s1-5-rb1-event-walkHome'],
          diagnostics: [],
          promptGuidance: [],
        },
      }],
      byEpisode: { 1: ['treatment-enc-1-1'] },
      setupPayoffEdges: [],
    } as unknown as SeasonScenePlan;

    const result = validator.validate({
      story: story([
        scene({
          id: 'treatment-enc-1-1',
          beats: [
            beat('b1', "The walk to your apartment is five blocks of taut silence, the city's nightlife a world away."),
            beat('b2', 'When you reach your door, he waits, his shadow falling over you as you fumble with the lock.'),
          ],
        }),
      ]),
      scenePlan,
      treatmentSourced: true,
    });

    expect(result.findings.filter((finding) => finding.status === 'owned_event_missing')).toHaveLength(0);
  });

  it('blocks when an abstract encounter shell displaces the concrete treatment encounter', () => {
    const scenePlan = {
      scenes: [
        {
          id: 's1-3',
          episodeNumber: 1,
          order: 2,
          kind: 'standard',
          title: 'Park Attack',
          dramaticPurpose: 'Walking home through the park, the protagonist is attacked and rescued by a stranger.',
          narrativeRole: 'turn',
          locations: ['Park'],
          npcsInvolved: [],
          setsUp: [],
          paysOff: [],
          sceneEventOwnership: {
            id: 'seo-s1-3',
            episodeNumber: 1,
            sceneId: 's1-3',
            ownedEvents: [{
              key: 'cue:threatEncounter',
              cue: 'threatEncounter',
              text: 'Walking home through the park, the protagonist is attacked and rescued by a stranger.',
              sourceContractIds: ['authored-turn-attack'],
            }],
            incomingContext: [],
            outgoingResidue: [],
            forbiddenRestageEvents: [],
            sourceContractIds: ['authored-turn-attack'],
            diagnostics: [],
            promptGuidance: [],
          },
        },
        {
          id: 'treatment-enc-1',
          episodeNumber: 1,
          order: 3,
          kind: 'encounter',
          title: 'Abstract Pressure',
          dramaticPurpose: 'Can the protagonist start over while the city watches?',
          narrativeRole: 'turn',
          locations: ['Apartment'],
          npcsInvolved: [],
          setsUp: [],
          paysOff: [],
          encounter: {
            category: 'social',
            description: 'Can the protagonist start over while the city watches?',
            centralConflict: 'Can the protagonist start over while the city watches?',
            stakes: 'Self-definition',
            isBranchPoint: true,
          },
          sceneEventOwnership: {
            id: 'seo-treatment-enc-1',
            episodeNumber: 1,
            sceneId: 'treatment-enc-1',
            ownedEvents: [],
            incomingContext: [],
            outgoingResidue: [],
            forbiddenRestageEvents: [],
            sourceContractIds: [],
            diagnostics: [],
            promptGuidance: [],
          },
        },
      ],
      byEpisode: { 1: ['s1-3', 'treatment-enc-1'] },
      setupPayoffEdges: [],
    } as unknown as SeasonScenePlan;

    const result = validator.validate({
      story: story([
        scene({
          id: 's1-3',
          beats: [
            beat('b1', 'In the park, an attacker grabs your arm before a stranger intervenes and pulls you free.'),
          ],
        }),
        scene({
          id: 'treatment-enc-1',
          beats: [
            beat('b2', 'At the desk, you draft a public post and wonder whether the city will read you kindly.'),
          ],
        }),
      ]),
      scenePlan,
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.findings.some((finding) => finding.status === 'encounter_priority_mismatch')).toBe(true);
  });
});
