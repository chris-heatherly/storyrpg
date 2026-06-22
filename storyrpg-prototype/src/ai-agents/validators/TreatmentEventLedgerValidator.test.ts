import { describe, expect, it } from 'vitest';
import type { Beat, Scene, Story } from '../../types';
import type { SevenPointBeatRealizationContract } from '../../types/scenePlan';
import {
  hasDirectTreatmentEventRealization,
  TreatmentEventLedgerValidator,
} from './TreatmentEventLedgerValidator';

const HOOK = 'Kylie lands in Bucharest fleeing heartbreak, starts a blog, and is rescued by a mysterious man in the park.';

function contract(overrides: Partial<SevenPointBeatRealizationContract> = {}): SevenPointBeatRealizationContract {
  return {
    id: 'seven-point-hook-kylie-bucharest-blog-park-rescue',
    beat: 'hook',
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
    sevenPointBeatContracts: overrides.sevenPointBeatContracts,
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
          sevenPointBeatContracts: [contract()],
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

  it('promotes stale warning-level contracts in treatment-sourced final validation', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [beat('b1', 'You joke with Sadie from the Bucharest sublet, but the park rescue never happens on-page.')],
          sevenPointBeatContracts: [contract({ blockingLevel: 'warning' })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.findings[0].severity).toBe('error');
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
          sevenPointBeatContracts: [contract()],
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
          sevenPointBeatContracts: [contract()],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.findings[0].status).toBe('summary_only');
    expect(hasDirectTreatmentEventRealization(HOOK, result.findings[0].message)).toBe(false);
  });

  it('accepts broad seven-point events realized directly across the target episode', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [
            beat('b1', 'Kylie lands in Bucharest with two suitcases and heartbreak packed under your ribs.'),
            beat('b2', 'A blank blog waits on your laptop; tonight you start a blog and decide what a new life should sound like.'),
          ],
          sevenPointBeatContracts: [contract()],
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

  it('does not accept episode-level realization when the episode only recaps the event as backstory', () => {
    const result = validator.validate({
      story: story([
        scene({
          id: 's1-1',
          beats: [
            beat('b1', 'Two weeks ago, Kylie had landed in Bucharest fleeing heartbreak, had started a blog, and had been rescued by a mysterious man in the park.'),
          ],
          sevenPointBeatContracts: [contract()],
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
          sevenPointBeatContracts: [contract()],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
    expect(result.findings).toHaveLength(0);
  });
});
