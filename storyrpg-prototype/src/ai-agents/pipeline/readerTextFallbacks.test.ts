import { describe, expect, it } from 'vitest';
import type { SceneBlueprint } from '../agents/StoryArchitect';
import type { SceneContent } from '../agents/SceneWriter';
import {
  BEAT_PROSE_NEEDS_REAUTHOR_PLACEHOLDER,
  beatTextMatchesBlueprintPlanning,
  isPlanningRegisterProse,
  isUnsafeReaderFallbackCandidate,
  sanitizeSceneContentForReader,
  stripBeatProseForReader,
} from './readerTextFallbacks';

const S1_2_B4_PROSE =
  'She smiles, a slight, knowing curve of her lips, "I am Stela. For a writer, Bucharest is a city of secrets, You just need to know where to look. My friend Mika would take you to Valescu Club, The people there. they are from very old families, ".';

const TREATMENT_SENTENCE =
  'She explores the streets of Bucharest and wanders into a bookshop owned by Stela who befriends her and introduces Kylie to the secret nightlife world of Valescu Club and her other friend Mika.';

describe('readerTextFallbacks beat prose sanitization', () => {
  it('preserves LLM beat prose longer than 240 characters', () => {
    expect(S1_2_B4_PROSE.length).toBeGreaterThan(240);
    expect(isUnsafeReaderFallbackCandidate(S1_2_B4_PROSE)).toBe(true);
    expect(isPlanningRegisterProse(S1_2_B4_PROSE)).toBe(false);
    expect(stripBeatProseForReader(S1_2_B4_PROSE)).toBe(S1_2_B4_PROSE);
  });

  it('does not replace long beat prose with blueprint description during assembly sanitize', () => {
    const blueprint = {
      id: 's1-2',
      description: TREATMENT_SENTENCE,
      dramaticQuestion: TREATMENT_SENTENCE,
    } as SceneBlueprint;
    const content: SceneContent = {
      sceneId: 's1-2',
      beats: [{ id: 's1-2-b4', text: S1_2_B4_PROSE }],
    } as SceneContent;

    sanitizeSceneContentForReader(blueprint, content);
    expect(content.beats[0].text).toBe(S1_2_B4_PROSE);
    expect(content.beats[0].text).not.toContain('She explores the streets of Bucharest');
  });

  it('routes agent planning-register beat prose to the registered re-author placeholder', () => {
    expect(stripBeatProseForReader('pressure: forward the social beat in this scene')).toBe(
      BEAT_PROSE_NEEDS_REAUTHOR_PLACEHOLDER,
    );
  });

  it('does not rewrite treatment-summary prose that is not planning register', () => {
    expect(stripBeatProseForReader(TREATMENT_SENTENCE)).toBe(TREATMENT_SENTENCE);
  });

  it('detects verbatim blueprint planning leaks', () => {
    const blueprint = {
      id: 's1-2',
      description: TREATMENT_SENTENCE,
      requiredBeats: [{ id: 's1-2-rb1', mustDepict: TREATMENT_SENTENCE, tier: 'authored' }],
    } as SceneBlueprint;
    expect(beatTextMatchesBlueprintPlanning(TREATMENT_SENTENCE, blueprint)).toBe(TREATMENT_SENTENCE);
    expect(beatTextMatchesBlueprintPlanning(S1_2_B4_PROSE, blueprint)).toBeUndefined();
  });
});
