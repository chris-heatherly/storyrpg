import { describe, expect, it } from 'vitest';
import { EncounterArchitect } from './EncounterArchitect';
import type { AgentConfig } from '../config';

describe('EncounterArchitect ESC profiles', () => {
  it('injects staged_rescue guidance into the authored anchor section', () => {
    const architect = new EncounterArchitect({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
    } as AgentConfig);

    const section = (architect as any).buildAuthoredAnchorSection({
      sceneId: 'treatment-enc-1-1',
      sceneName: 'Cismigiu attack',
      sceneDescription: 'Attack and rescue',
      sceneMood: 'tense',
      encounterType: 'combat',
      encounterDescription: 'Kylie is attacked and Victor rescues her.',
      centralConflict: 'Victor must rescue Kylie from the shadow attack.',
      requiredBeats: [{
        id: 'rb1',
        mustDepict: 'Victor rescues Kylie under the willow.',
        tier: 'authored',
      }],
      encounterSpineProfile: 'staged_rescue',
      protagonistInfo: { name: 'Kylie', pronouns: 'she/her' },
      npcsInvolved: [],
      availableSkills: [],
      storyContext: { title: 'Bite Me', genre: 'romance', tone: 'dark' },
      difficulty: 'moderate',
    });

    expect(section).toContain('ENCOUNTER SPINE PROFILE: staged_rescue');
    expect(section).toMatch(/rescue.*primary success path/i);
    expect(section).toMatch(/Do NOT treat clean escape as a first-class win/i);
  });
});
