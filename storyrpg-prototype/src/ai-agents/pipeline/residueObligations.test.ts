import { describe, expect, it } from 'vitest';
import type { SeasonResidueObligation } from '../../types/seasonPlan';
import {
  AUTO_RESIDUE_OBLIGATION_TAG,
  applyChoiceResidueBackstop,
  implementEpisodeResidueObligations,
} from './residueObligations';
import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { SceneContent } from '../agents/SceneWriter';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';

function obligation(overrides: Partial<SeasonResidueObligation> = {}): SeasonResidueObligation {
  return {
    id: 'residue:mika_protection',
    source: 'choice_moment',
    sourceEpisodeNumber: 1,
    sourceChoiceMomentId: 'mika-choice',
    choiceAnchor: 'Accept Mika protection',
    flag: 'accepted_mikas_protection',
    conditionKey: 'accepted_mikas_protection',
    kind: 'relationship_behavior',
    payoffPolicy: 'later_scene_same_episode',
    targetEpisodeNumbers: [1],
    targetNpcIds: ['mika'],
    sourceMaterial: {
      choiceText: 'Accept Mika protection',
      feedbackEcho: 'Mika keeps half a step closer after you let her protect you.',
      reminderImmediate: 'Mika keeps half a step closer after you let her protect you.',
      reminderShortTerm: 'Mika watches the room as if your danger is now partly hers.',
      residueHints: ['Mika watches the room as if your danger is now partly hers.'],
    },
    authoringGuidance: 'Mika should behave as though protection was accepted.',
    requiredSurface: ['text_variant'],
    priority: 'major',
    ...overrides,
  };
}

function sceneContent(): SceneContent[] {
  return [
    {
      sceneId: 's1',
      sceneName: 'Choice',
      beats: [{ id: 'b1', text: 'Mika waits for your answer.', isChoicePoint: true }],
      startingBeatId: 'b1',
      moodProgression: [],
      charactersInvolved: ['mika'],
      keyMoments: [],
      continuityNotes: [],
    },
    {
      sceneId: 's2',
      sceneName: 'Aftermath',
      beats: [{ id: 'b2', text: 'The hallway narrows around you.' }],
      startingBeatId: 'b2',
      moodProgression: [],
      charactersInvolved: ['mika'],
      keyMoments: [],
      continuityNotes: [],
    },
  ] as SceneContent[];
}

function blueprint(): EpisodeBlueprint {
  return {
    episodeId: 'ep1',
    number: 1,
    title: 'Episode 1',
    synopsis: 'A choice echoes.',
    arc: { you: '', go: '', search: '', find: '', take: '', return: '', change: '' },
    themes: [],
    scenes: [
      {
        id: 's1',
        name: 'Choice',
        description: 'Mika offers protection.',
        location: 'hall',
        mood: 'tense',
        purpose: 'transition',
        dramaticQuestion: 'Will you accept help?',
        wantVsNeed: '',
        conflictEngine: '',
        npcsPresent: ['mika'],
        narrativeFunction: '',
        keyBeats: [],
        leadsTo: ['s2'],
        choicePoint: {
          type: 'relationship',
          branches: false,
          stakes: { want: '', cost: '', identity: '' },
          description: 'Answer Mika.',
          optionHints: [],
          residueObligationIds: ['residue:mika_protection'],
        },
      },
      {
        id: 's2',
        name: 'Aftermath',
        description: 'Mika stays close.',
        location: 'hall',
        mood: 'charged',
        purpose: 'transition',
        dramaticQuestion: 'What changed?',
        wantVsNeed: '',
        conflictEngine: '',
        npcsPresent: ['mika'],
        narrativeFunction: '',
        keyBeats: ['Mika stays close.'],
        leadsTo: [],
        residueObligationIds: ['residue:mika_protection'],
      },
    ],
    startingSceneId: 's1',
    bottleneckScenes: [],
    suggestedFlags: [],
    suggestedScores: [],
    suggestedTags: [],
    narrativePromises: [],
  } as unknown as EpisodeBlueprint;
}

describe('planned residue obligations', () => {
  it('backstops assigned choice points by stamping the obligation and setting the planned flag', () => {
    const choiceSet: ChoiceSet = {
      beatId: 'b1',
      sceneId: 's1',
      choiceType: 'relationship',
      choices: [{ id: 'c1', text: 'Let Mika help.', consequences: [] }],
      overallStakes: { want: '', cost: '', identity: '' },
      designNotes: '',
    };

    const result = applyChoiceResidueBackstop(choiceSet, blueprint().scenes[0], [obligation()]);

    expect(result.addedFlags).toBe(1);
    expect(choiceSet.choices[0].residueObligationIds).toEqual(['residue:mika_protection']);
    expect(choiceSet.choices[0].consequences).toContainEqual({
      type: 'setFlag',
      flag: 'accepted_mikas_protection',
      value: true,
    });
  });

  it('injects a source-derived TextVariant without replacing base beat text', () => {
    const scenes = sceneContent();
    const choiceSets: ChoiceSet[] = [
      {
        beatId: 'b1',
        sceneId: 's1',
        choiceType: 'relationship',
        choices: [{
          id: 'c1',
          text: 'Let Mika help.',
          consequences: [{ type: 'setFlag', flag: 'accepted_mikas_protection', value: true }],
          residueObligationIds: ['residue:mika_protection'],
        }],
        overallStakes: { want: '', cost: '', identity: '' },
        designNotes: '',
      },
    ];

    const metrics = implementEpisodeResidueObligations({
      episodeNumber: 1,
      sceneContents: scenes,
      choiceSets,
      blueprint: blueprint(),
      seasonResiduePlan: [obligation()],
      generatedThroughEpisode: 1,
    });

    const variant = scenes[1].beats[0].textVariants?.[0];
    expect(metrics.autoInjected).toEqual(['residue:mika_protection']);
    expect(variant?.residueObligationId).toBe('residue:mika_protection');
    expect(variant?.reminderTag).toBe(AUTO_RESIDUE_OBLIGATION_TAG);
    expect(variant?.text).toContain('The hallway narrows around you.');
    expect(variant?.text).toContain('Mika keeps half a step closer');
  });
});
