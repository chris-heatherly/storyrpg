import { describe, expect, it } from 'vitest';
import { EncounterArchitect, TEMPLATE_SIGNATURES, type EncounterArchitectInput } from './EncounterArchitect';

const config = { provider: 'anthropic' as const, model: 'm', apiKey: 'k', maxTokens: 1024, temperature: 0.1 };

const input: EncounterArchitectInput = {
  sceneId: 'scene-3', sceneName: 'Encounter', sceneDescription: 'A confrontation.', sceneMood: 'tense',
  plannedEncounterId: 'enc-1',
  storyContext: { title: 'T', genre: 'Drama', tone: 'Intense' },
  encounterType: 'dramatic', encounterStyle: 'dramatic',
  encounterDescription: 'Survive.', encounterStakes: 'Everything.',
  encounterRequiredNpcIds: ['eros'], encounterRelevantSkills: ['persuasion'],
  encounterBeatPlan: ['Open', 'Escalate', 'Resolve'], difficulty: 'hard',
  protagonistInfo: { name: 'Alex', pronouns: 'they/them' },
  npcsInvolved: [{ id: 'eros', name: 'Eros', pronouns: 'he/him', role: 'enemy', description: 'A foe.' }],
  availableSkills: [{ name: 'persuasion', attribute: 'social', description: 'Talk.' }],
  targetBeatCount: 4,
};

/**
 * Guards the single-source-of-truth invariant: every TEMPLATE_SIGNATURE must
 * actually appear in the deterministic fallback / default storylet prose. If the
 * fallback prose is reworded without updating TEMPLATE_SIGNATURES, this fails —
 * which is the point (the EncounterQualityValidator would otherwise stop
 * detecting the reworded boilerplate).
 */
describe('TEMPLATE_SIGNATURES stay in sync with the fallback prose', () => {
  it('every signature appears in the deterministic fallback or default storylets', () => {
    const architect = new EncounterArchitect(config) as any;
    const fallback = architect.buildDeterministicFallback(input);
    const storylets = architect.buildDefaultStorylets(input);
    const haystack = JSON.stringify(fallback) + '\n' + JSON.stringify(storylets);

    const missing = TEMPLATE_SIGNATURES.filter((sig) => !haystack.includes(sig));
    expect(missing, `Signatures not found in fallback prose (update TEMPLATE_SIGNATURES or the fallback): ${missing.join(' | ')}`).toEqual([]);
  });
});
