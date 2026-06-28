import { describe, expect, it } from 'vitest';
import { NarrativeFailureModeValidator } from './NarrativeFailureModeValidator';
import type { SceneContent } from '../agents/SceneWriter';
import type { Story } from '../../types/story';
import type { FailureModeAuditContract } from '../../types/scenePlan';

describe('NarrativeFailureModeValidator', () => {
  it('flags external rescue at the ending as convenient coincidence', () => {
    const result = new NarrativeFailureModeValidator().validate({
      sceneContents: [
        scene('s1', ['Mara reaches the tower with no way through the locked gate.']),
        scene('s2', ['The guards arrive just in time and solve the siege while Mara watches from the stairs.']),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'convenient_coincidence')).toBe(true);
  });

  it('accepts a protagonist-caused ending even when help is present', () => {
    const result = new NarrativeFailureModeValidator().validate({
      sceneContents: [
        scene('s1', ['Mara studies the smuggler map and earns the crew chief\'s trust.']),
        scene('s2', ['Mara uses the map she earned, chooses to reveal the route, and the allies arrive because of her plan.']),
      ],
    });

    expect(result.issues.some((issue) => issue.code === 'convenient_coincidence')).toBe(false);
  });

  it('flags repeated obvious clue phrasing as a telegraphed twist', () => {
    const result = new NarrativeFailureModeValidator().validate({
      sceneContents: [
        scene('s1', ['Something is off about the captain, though no one says why.']),
        scene('s2', ['Something is off in the way the captain hides the ledger.']),
        scene('s3', ['Something is off again when the captain asks about the vault.']),
      ],
    });

    expect(result.issues.some((issue) => issue.code === 'telegraphed_twist')).toBe(true);
  });

  it('accepts subtle twist setup with varied alternate interpretations', () => {
    const result = new NarrativeFailureModeValidator().validate({
      sceneContents: [
        scene('s1', ['The captain forgets a toast, which could be grief or calculation.']),
        scene('s2', ['A ledger page is missing after the storm scatters half the archive.']),
        scene('s3', ['The vault guard salutes the captain a beat too late.']),
      ],
    });

    expect(result.issues.some((issue) => issue.code === 'telegraphed_twist')).toBe(false);
  });

  it('flags repeated toast/click choreography as a prose-style failure', () => {
    const result = new NarrativeFailureModeValidator().validate({
      sceneContents: [
        scene('s1', ['Mika raises her glass. "To the Dusk Club."']),
        scene('s2', ['Stela touches the quartz at her throat. "To the Dusk Club."']),
        scene('s3', ['Your glass clicked against theirs, the sound thin in the open air.']),
      ],
    });

    expect(result.issues.some((issue) => issue.code === 'repetitive_toast_motif')).toBe(true);
  });

  it('flags live-action past tense without a past-event marker', () => {
    const result = new NarrativeFailureModeValidator().validate({
      sceneContents: [
        scene('s1', ["Your glass clicked against theirs. Just as you took a sip, you felt it. He didn't blink."]),
      ],
    });

    expect(result.issues.some((issue) => issue.code === 'tense_drift')).toBe(true);
  });

  it('allows past tense for explicit memory or backstory', () => {
    const result = new NarrativeFailureModeValidator().validate({
      sceneContents: [
        scene('s1', ['Years ago, you felt the same cold pressure outside your grandmother’s door.']),
      ],
    });

    expect(result.issues.some((issue) => issue.code === 'tense_drift')).toBe(false);
  });

  it('does not flag present-tense narration because quoted dialogue mentions what you saw', () => {
    const result = new NarrativeFailureModeValidator().validate({
      sceneContents: [
        scene('s1', ['He takes your hand. His skin is cool. He lifts it to his lips. "What you saw tonight is best forgotten," he says.']),
      ],
    });

    expect(result.issues.some((issue) => issue.code === 'tense_drift')).toBe(false);
  });

  it('maps information-ledger mystery overflow to mystery box collapse', () => {
    const result = new NarrativeFailureModeValidator().validate({
      baseIssues: [{
        severity: 'error',
        message: 'Season has 4 mystery/box-question entries; hard cap is 3.',
        location: 'season.informationLedger',
        source: 'information_ledger',
      }],
    });

    expect(result.issues[0]?.code).toBe('mystery_box_collapse');
  });

  it('maps theme-pressure failures to theme drift', () => {
    const result = new NarrativeFailureModeValidator().validate({
      baseIssues: [{
        severity: 'error',
        message: 'Episode does not press on the theme question through protagonist-visible choice.',
        location: 'episode.themePressure',
        source: 'theme_pressure',
      }],
    });

    expect(result.issues[0]?.code).toBe('theme_drift');
  });

  it('fails authored failure-mode audit contracts that are never realized', () => {
    const result = new NarrativeFailureModeValidator().validate({
      failureModeAuditContracts: [failureContract({
        contractKind: 'agency_claim',
        sourceText: 'The climax is avoided as passive because Mara chooses to burn the ledger using the clue she planted.',
      })],
      story: storyWithScene('s1', 'The guards arrive out of nowhere and open the gate while Mara watches.'),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.source === 'failure_mode_audit_contract')).toBe(true);
    expect(result.metrics.authoredContractIssues).toBe(1);
  });

  it('passes authored failure-mode audit contracts when the mitigation is staged on-page', () => {
    const result = new NarrativeFailureModeValidator().validate({
      failureModeAuditContracts: [failureContract({
        contractKind: 'agency_claim',
        sourceText: 'The climax is avoided as passive because Mara chooses to burn the ledger using the clue she planted.',
      })],
      story: storyWithScene('s1', 'Mara chooses to burn the ledger, uses the clue she planted, and the rescue arrives because of her preparation.'),
    });

    expect(result.issues.filter((issue) => issue.source === 'failure_mode_audit_contract')).toEqual([]);
  });
});

function scene(sceneId: string, texts: string[]): SceneContent {
  return {
    sceneId,
    sceneName: sceneId,
    beats: texts.map((text, index) => ({ id: `${sceneId}-b${index + 1}`, text })),
    startingBeatId: `${sceneId}-b1`,
    moodProgression: [],
    charactersInvolved: [],
    keyMoments: [],
    continuityNotes: [],
  };
}

function failureContract(overrides: Partial<FailureModeAuditContract>): FailureModeAuditContract {
  return {
    id: 'failure-mode-passive-protagonist-agency',
    source: 'treatment',
    code: 'passive_protagonist',
    label: 'Passive protagonist',
    status: 'watch_item',
    sourceText: 'The climax is avoided as passive because Mara uses the map she earned to open the gate herself.',
    contractKind: 'agency_claim',
    requiredRealization: ['choice', 'scene_turn', 'ending_route', 'mechanic_pressure', 'final_prose'],
    targetEpisodeNumbers: [1],
    targetSceneIds: ['s1'],
    linkedContractIds: [],
    blockingLevel: 'treatment',
    ...overrides,
  };
}

function storyWithScene(sceneId: string, text: string): Story {
  return {
    episodes: [{
      number: 1,
      id: 'ep1',
      title: 'Episode 1',
      scenes: [{
        id: sceneId,
        name: 'Gate',
        beats: [{ id: `${sceneId}-b1`, text }],
      }],
    }],
  } as unknown as Story;
}
