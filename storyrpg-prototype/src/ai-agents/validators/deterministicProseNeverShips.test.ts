/**
 * Registry-completeness guard for the "LLMs write, deterministic systems
 * enforce" principle.
 *
 * Deterministic code is allowed to place run-survival PLACEHOLDERS in
 * reader-facing fields, but every such string MUST be registered in
 * `constants/syntheticFallbackProse.ts` (or, for choice outcome tiers,
 * `constants/choiceTextFallbacks.ts`) so the final contract detects it,
 * blocks, and routes an LLM rewrite. This test regenerates the output of the
 * known deterministic producers and asserts the enforcement rail catches all
 * of it — if someone adds a new deterministic sentence to these producers
 * without registering it, this fails.
 */
import { describe, expect, it } from 'vitest';
import type { Scene, Story } from '../../types';
import { convertEncounterStructureToEncounter } from '../converters/encounterConverter';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { SceneBlueprint } from '../agents/StoryArchitect';
import type { GeneratedBeat } from '../agents/SceneWriter';
import { createFallbackChoiceSet, BEAT_PROSE_NEEDS_REAUTHOR_PLACEHOLDER } from '../pipeline/readerTextFallbacks';
import { SYNTHETIC_FALLBACK_PROSE_PATTERNS } from '../constants/syntheticFallbackProse';
import { isFallbackOutcomeText } from '../constants/choiceTextFallbacks';
import { RouteContinuityValidator } from './RouteContinuityValidator';
import { OutcomeTextQualityValidator } from './OutcomeTextQualityValidator';
import { scanEncounterFallbackProse } from './EncounterQualityValidator';
import { GateRepairRouter } from '../remediation/gateRepairRouter';

function isRegistered(text: string | undefined): boolean {
  if (!text) return false;
  return SYNTHETIC_FALLBACK_PROSE_PATTERNS.some((entry) => entry.pattern.test(text));
}

function blueprint(overrides: Partial<SceneBlueprint> = {}): SceneBlueprint {
  return {
    id: 'scene-1',
    name: 'Warehouse Standoff',
    description: 'A standoff in the riverside warehouse.',
    leadsTo: ['scene-2'],
    beats: [],
    ...overrides,
  } as unknown as SceneBlueprint;
}

/**
 * The most degenerate structure the converter accepts: no storylets, no
 * stakes, and a choice with no authored outcomes — every reader-facing field
 * the converter writes comes from its deterministic fallbacks.
 */
function degenerateStructure(): EncounterStructure {
  return {
    sceneId: 'scene-1',
    description: 'The forklift idles between you and the exit as the standoff begins.',
    encounterType: 'social',
    startingBeatId: 'beat-1',
    beats: [
      {
        id: 'beat-1',
        phase: 'setup',
        name: 'Opening',
        setupText: 'The forklift idles between you and the exit.',
        choices: [
          { id: 'choice-1', text: 'Step into the light.', approach: 'bold', primarySkill: 'courage', outcomes: {} },
        ],
      },
    ],
  } as unknown as EncounterStructure;
}

function makeStory(scene: Scene): Story {
  return {
    id: 'deterministic-prose-test',
    title: 'Deterministic Prose Test',
    genre: 'thriller',
    synopsis: 'A test story.',
    coverImage: '',
    author: 'Test',
    tags: [],
    initialState: { attributes: {}, skills: {}, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'episode-1',
      number: 1,
      title: 'Episode 1',
      synopsis: 'Test episode.',
      coverImage: '',
      startingSceneId: scene.id,
      scenes: [scene],
    }],
  } as unknown as Story;
}

describe('deterministic prose never ships unregistered', () => {
  describe('encounterConverter fallbacks are registered', () => {
    const encounter = convertEncounterStructureToEncounter(degenerateStructure(), blueprint());

    it('registers the phase success/failure outcome stubs', () => {
      expect(isRegistered(encounter.phases[0].onSuccess?.outcomeText)).toBe(true);
      expect(isRegistered(encounter.phases[0].onFailure?.outcomeText)).toBe(true);
    });

    it('registers the per-choice outcome narrativeText stubs', () => {
      const choice = encounter.phases[0].beats[0].choices?.[0] as {
        outcomes: Record<'success' | 'complicated' | 'failure', { narrativeText?: string }>;
      };
      expect(isRegistered(choice.outcomes.success.narrativeText)).toBe(true);
      expect(isRegistered(choice.outcomes.complicated.narrativeText)).toBe(true);
      expect(isRegistered(choice.outcomes.failure.narrativeText)).toBe(true);
    });

    it('registers the storylet-less outcomeText templates', () => {
      expect(isRegistered(encounter.outcomes.victory?.outcomeText)).toBe(true);
      expect(isRegistered(encounter.outcomes.partialVictory?.outcomeText)).toBe(true);
      expect(isRegistered(encounter.outcomes.partialVictory?.complication)).toBe(true);
      expect(isRegistered(encounter.outcomes.defeat?.outcomeText)).toBe(true);
    });

    it('registers the generic stakes fallbacks', () => {
      expect(isRegistered(encounter.stakes.victory)).toBe(true);
      expect(isRegistered(encounter.stakes.defeat)).toBe(true);
    });

    it('registers the escape outcome and cost templates (literal check)', () => {
      // These branches need partially-authored storylets to fire; assert the
      // producer literals directly so a reworded fallback cannot drift out of
      // the registry unnoticed.
      expect(isRegistered('The protagonist gets clear, but the fear follows close behind.')).toBe(true);
      expect(isRegistered('The win leaves something unsettled that follows the protagonist forward.')).toBe(true);
      expect(isRegistered('Relief arrives with a complication still attached.')).toBe(true);
    });
  });

  describe('deterministic fallback choice set is detectable', () => {
    const choiceBeat: GeneratedBeat = { id: 'beat-choice', text: 'What do you do?' } as GeneratedBeat;
    const choiceSet = createFallbackChoiceSet(blueprint(), choiceBeat);

    it('registers the generic option labels', () => {
      expect(choiceSet.choices.length).toBeGreaterThan(0);
      for (const choice of choiceSet.choices) {
        expect(isRegistered(choice.text), `unregistered fallback option label: "${choice.text}"`).toBe(true);
      }
    });

    it('registers the reaction-text template', () => {
      for (const choice of choiceSet.choices) {
        expect(isRegistered(choice.reactionText), `unregistered reaction text: "${choice.reactionText}"`).toBe(true);
      }
    });

    it('routes the outcome tiers to the ChoiceAuthor stub re-author', () => {
      for (const choice of choiceSet.choices) {
        expect(isFallbackOutcomeText(choice.outcomeTexts?.success)).toBe(true);
        expect(isFallbackOutcomeText(choice.outcomeTexts?.partial)).toBe(true);
        expect(isFallbackOutcomeText(choice.outcomeTexts?.failure)).toBe(true);
      }
    });

    it('registers the generic stakes fallbacks', () => {
      expect(isRegistered(choiceSet.overallStakes.want)).toBe(true);
      expect(isRegistered(choiceSet.overallStakes.cost)).toBe(true);
      expect(isRegistered(choiceSet.overallStakes.identity)).toBe(true);
    });
  });

  describe('generation-time acceptance catches converter fallbacks (no season-end abort)', () => {
    it('scanEncounterFallbackProse flags a trial-converted degenerate structure', () => {
      const converted = convertEncounterStructureToEncounter(degenerateStructure(), blueprint());
      const hits = scanEncounterFallbackProse(converted);
      expect(hits.length).toBeGreaterThan(0);
    });

    it('scanEncounterFallbackProse stays quiet on a fully-authored encounter shape', () => {
      const authored = {
        phases: [{
          beats: [{
            setupText: 'The forklift idles between you and the exit.',
            choices: [{
              text: 'Step into the light.',
              outcomes: {
                success: { narrativeText: 'The foreman waves you through without a second glance.' },
                complicated: { narrativeText: 'He lets you pass, but pockets your visitor badge as the price.' },
                failure: { narrativeText: 'He blocks the doorway and reaches for the radio on his belt.' },
              },
            }],
          }],
          onSuccess: { outcomeText: 'You slip out into the loading yard with the manifest inside your jacket.' },
          onFailure: { outcomeText: 'Security walks you back to the office, and the manifest stays behind.' },
        }],
        stakes: { victory: 'You walk out with the manifest.', defeat: 'You are escorted out empty-handed.' },
        outcomes: {
          victory: { outcomeText: 'You slip out into the loading yard with the manifest inside your jacket.' },
          defeat: { outcomeText: 'Security walks you back to the office, and the manifest stays behind.' },
        },
      };
      expect(scanEncounterFallbackProse(authored)).toHaveLength(0);
    });
  });

  describe('assembly beat-prose placeholder is registered', () => {
    it('registers the beat re-author placeholder used when planning register survives sanitize', () => {
      expect(isRegistered(BEAT_PROSE_NEEDS_REAUTHOR_PLACEHOLDER)).toBe(true);
    });
  });

  describe('the enforcement rail blocks and routes to LLM rewrite', () => {
    it('RouteContinuityValidator raises blocking unsafe_fallback_prose for converter fallbacks', () => {
      const encounter = convertEncounterStructureToEncounter(degenerateStructure(), blueprint());
      const scene = {
        id: 'scene-1',
        name: 'Warehouse Standoff',
        startingBeatId: 'beat-1',
        beats: [{ id: 'beat-1', text: 'The forklift idles between you and the exit.', choices: [] }],
        encounter,
      } as unknown as Scene;

      const result = new RouteContinuityValidator().validate({ story: makeStory(scene) });
      const fallbackIssues = result.issues.filter((issue) => issue.type === 'unsafe_fallback_prose');

      expect(fallbackIssues.length).toBeGreaterThan(0);
      expect(fallbackIssues.every((issue) => issue.severity === 'error')).toBe(true);
    });

    it('OutcomeTextQualityValidator flags the fallback choice-set outcome tiers as stubs', () => {
      const choiceBeat: GeneratedBeat = { id: 'beat-choice', text: 'What do you do?' } as GeneratedBeat;
      const choiceSet = createFallbackChoiceSet(blueprint(), choiceBeat);
      const scene = {
        id: 'scene-1',
        name: 'Warehouse Standoff',
        startingBeatId: 'beat-choice',
        beats: [{ id: 'beat-choice', text: 'What do you do?', choices: choiceSet.choices }],
      } as unknown as Scene;

      const result = new OutcomeTextQualityValidator().validate({ story: makeStory(scene) });
      const stubErrors = result.issues.filter(
        (issue) => issue.severity === 'error' && /fallback stub|never authored/i.test(issue.message),
      );
      expect(stubErrors.length).toBeGreaterThan(0);
    });

    it('routes unsafe_fallback_prose findings to the same-scene LLM prose rewrite', () => {
      const router = new GateRepairRouter();
      const route = router.routeIssue({
        type: 'unsafe_fallback_prose',
        validator: 'RouteContinuityValidator',
        sceneId: 'scene-1',
        message: 'Unsafe fallback/planning prose survived in scene:scene-1.readerFacing[0]: "The pressure eases, and the protagonist carries the moment forward."',
      });
      expect(route.kind).toBe('same_scene_retry');
    });

    it('does not flag authored prose', () => {
      const scene = {
        id: 'scene-1',
        name: 'Warehouse Standoff',
        startingBeatId: 'beat-1',
        beats: [{
          id: 'beat-1',
          text: 'You wedge the crowbar under the container seal and lean until the metal shrieks.',
          choices: [{
            id: 'c1',
            text: 'Pocket the manifest before the guard rounds the corner.',
            reactionText: 'The paper crackles against your ribs as footsteps close in.',
            outcomeTexts: {
              success: 'The manifest slides into your jacket a breath before the flashlight sweeps past.',
              partial: 'You get the manifest, but the torn corner stays behind on the floor.',
              failure: 'The guard\'s light pins your hand inside the container.',
            },
          }],
        }],
      } as unknown as Scene;

      const routeResult = new RouteContinuityValidator().validate({ story: makeStory(scene) });
      expect(routeResult.issues.filter((issue) => issue.type === 'unsafe_fallback_prose')).toHaveLength(0);

      const otqResult = new OutcomeTextQualityValidator().validate({ story: makeStory(scene) });
      expect(otqResult.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
    });
  });
});
