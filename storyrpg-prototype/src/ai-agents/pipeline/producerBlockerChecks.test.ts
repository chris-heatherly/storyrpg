import { describe, expect, it } from 'vitest';
import {
  PRODUCER_BLOCKER_OWNERSHIP,
  postLlmMetadataHygiene,
  validateChoiceProducerOutput,
  validateEncounterProducerOutput,
  validateSceneProducerOutput,
} from './producerBlockerChecks';

describe('producer blocker ownership', () => {
  it('detects unsafe prose at the producing field with a bounded owner route', () => {
    const findings = validateEncounterProducerOutput('s1-2', {
      description: 'You face this pressure: get through the locked door.',
      sourceSynopsis: 'You face this pressure: author-only text is not shippable.',
    });
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ownerPhase: 'encounter',
        repairSurface: 'encounter-field',
        fieldPath: 'encounter.description',
        type: 'unsafe_fallback_prose',
      }),
    ]));
    expect(findings.some((finding) => finding.fieldPath.includes('sourceSynopsis'))).toBe(false);
    const route = PRODUCER_BLOCKER_OWNERSHIP.find((entry) =>
      entry.type === findings[0].type && entry.ownerPhase === findings[0].ownerPhase);
    expect(route?.handler).toContain('EncounterArchitect');
    expect(route?.retryBudget).toBe(1);
  });

  it('runs metadata hygiene after LLM output and clears the inspected path', () => {
    const scene = {
      location: 'archive',
      beats: [{
        coveragePlan: {
          relationshipBlocking: 'Track the visible consequence of the treatment beat.',
          visualContinuity: {
            mode: 'preserve_scene_axis',
            reason: 'SequenceDirector: preserve the authored synopsis.',
          },
        },
      }],
    };
    expect(validateSceneProducerOutput('s1-1', structuredClone(scene))).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'unsafe_metadata' })]),
    );
    const changed = postLlmMetadataHygiene(scene, 'archive');
    expect(changed).toEqual(['producer.beats[0].coveragePlan']);
    expect(JSON.stringify(scene)).not.toMatch(/Track the visible|SequenceDirector/i);
    expect(validateSceneProducerOutput('s1-1', scene)).toHaveLength(0);
  });

  it('blocks malformed relationship consequences immediately after choice production', () => {
    const findings = validateChoiceProducerOutput('s1-3', {
      choices: [{
        id: 'join',
        text: 'Take the empty chair.',
        consequences: [{ type: 'relationship', npcId: 'dusk-club', flag: 'friends', value: true }],
      }],
    });
    expect(findings).toEqual([
      expect.objectContaining({
        ownerPhase: 'choice',
        repairSurface: 'choice-consequences',
        type: 'malformed_relationship_consequence',
        fieldPath: 'choiceSet.choices[0].consequences[0]',
      }),
    ]);
  });
});
