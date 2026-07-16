import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import { auditFlagConsumption } from './flagConsumptionAudit';

function storyWith(scenes: unknown[]): Story {
  return { id: 's', title: 'S', episodes: [{ id: 'ep1', number: 1, scenes }] } as unknown as Story;
}

function choiceSetting(flag: string, id = flag): unknown {
  return { id, text: `choose ${flag}`, consequences: [{ type: 'setFlag', flag, value: true }] };
}

describe('auditFlagConsumption', () => {
  it('flags a choice flag with no downstream read as never consumed', () => {
    const story = storyWith([
      { id: 's1', beats: [{ id: 'b1', choices: [choiceSetting('dad_post1_tone_warning')] }] },
      { id: 's2', beats: [{ id: 'b2', text: 'The city hums, indifferent.' }] },
    ]);
    const audit = auditFlagConsumption(story);
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]).toMatchObject({ type: 'flag_never_consumed', flag: 'dad_post1_tone_warning', sceneId: 's1' });
  });

  it('reports sibling-family asymmetry when only some paths get a reflection (run 20-44-49 founding flags)', () => {
    const story = storyWith([
      {
        id: 's1-4',
        beats: [{
          id: 'b1',
          choices: [
            choiceSetting('dusk_club_founded_on_writing'),
            choiceSetting('dusk_club_founded_on_parties'),
            choiceSetting('dusk_club_founded_on_vulnerability'),
          ],
        }],
      },
      {
        id: 's1-aftermath',
        beats: [
          { id: 'a1', text: 'base', textVariants: [{ text: 'writing version', conditions: [{ type: 'flag', flag: 'dusk_club_founded_on_writing', value: true }] }] },
          { id: 'a2', text: 'base', textVariants: [{ text: 'parties version', conditions: [{ type: 'flag', flag: 'dusk_club_founded_on_parties', value: true }] }] },
        ],
      },
    ]);
    const audit = auditFlagConsumption(story);
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]).toMatchObject({
      type: 'flag_family_asymmetric_variants',
      flag: 'dusk_club_founded_on_vulnerability',
    });
    expect(audit.findings[0].consumedSiblings).toEqual(
      expect.arrayContaining(['dusk_club_founded_on_writing', 'dusk_club_founded_on_parties']),
    );
  });

  it('accepts reads through encounter requiredFlags and choice flag conditions', () => {
    const story = storyWith([
      { id: 's1', beats: [{ id: 'b1', choices: [choiceSetting('met_the_stranger')] }] },
      { id: 's2', encounter: { beats: [{ id: 'e1', choices: [{ id: 'c1', text: 'x', requiredFlags: ['met_the_stranger'] }] }] } },
    ]);
    expect(auditFlagConsumption(story).findings).toHaveLength(0);
  });

  it('exempts documented season-scope families (tint, treatment chains, branch markers)', () => {
    const story = storyWith([
      {
        id: 's1',
        beats: [{
          id: 'b1',
          choices: [
            choiceSetting('tint:justice'),
            choiceSetting('consequence_treatment_chain_ep1_1'),
            choiceSetting('treatment_branch_s1_5'),
          ],
        }],
      },
    ]);
    expect(auditFlagConsumption(story).findings).toHaveLength(0);
  });
});
