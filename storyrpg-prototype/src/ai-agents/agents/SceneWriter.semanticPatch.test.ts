import { afterEach, describe, expect, it } from 'vitest';

import { BaseAgent, TruncatedLLMResponseError } from './BaseAgent';
import { SceneWriter } from './SceneWriter';

function writer(): SceneWriter {
  return new SceneWriter({
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    apiKey: 'test-key',
    maxTokens: 16384,
    temperature: 0,
  });
}

const scene = {
  sceneId: 'scene-1',
  sceneName: 'Bookshop',
  startingBeatId: 'beat-1',
  beats: [
    { id: 'beat-1', text: 'Kylie enters the bookshop from the rain.' },
    { id: 'beat-2', text: 'Stela looks up from the counter and studies Kylie.' },
    { id: 'beat-3', text: 'Mika arrives with a gust of cold air.' },
    { id: 'beat-4', text: 'Stela and Kylie exchange names beside the register.' },
    { id: 'beat-5', text: 'Mika mentions a club across town.' },
  ],
  moodProgression: [],
  charactersInvolved: [],
  keyMoments: [],
  continuityNotes: [],
} as any;

const targetAtoms = [{
  id: 'atom-friendly',
  description: 'Stela and Kylie become friendly.',
  acceptedPatterns: ['become friendly'],
  semanticCriteria: ['Stela extends personal warmth to Kylie', 'Kylie accepts the connection'],
  participantIds: ['Stela', 'Kylie'],
  semanticRole: 'relationship_change',
  kind: 'semantic',
  required: true,
}, {
  id: 'atom-club',
  description: 'Stela tells Kylie about the club.',
  acceptedPatterns: ['Stela introduces the club'],
  semanticCriteria: ['Stela is the speaker', 'Kylie learns about the club'],
  participantIds: ['Stela', 'Kylie'],
  referencedLocations: ['Valescu Club'],
  semanticRole: 'information_transfer',
  kind: 'semantic',
  required: true,
}] as any;

afterEach(() => BaseAgent.setLlmTransportOverride(null));

describe('SceneWriter semantic patch contract', () => {
  it('sends a bounded patch window with positive, preserved, and forbidden constraints', async () => {
    let prompt = '';
    BaseAgent.setLlmTransportOverride(async (request) => {
      prompt = request.messages.map((message) => typeof message.content === 'string' ? message.content : '').join('\n');
      return JSON.stringify({
        baseSceneHash: 'base-hash',
        targetTaskId: 'task-1',
        targetAtomIds: ['atom-friendly', 'atom-club'],
        operations: [{
          op: 'replace_beat_text',
          beatId: 'beat-5',
          text: 'Stela offers Kylie tea, then invites her to see Valescu Club after closing.',
        }],
        claimedEvidence: [
          { atomId: 'atom-friendly', beatIds: ['beat-5'] },
          { atomId: 'atom-club', beatIds: ['beat-5'] },
        ],
      });
    });

    const result = await writer().executeSemanticPatch({
      baseSceneHash: 'base-hash',
      scene,
      targetTaskId: 'task-1',
      targetAtomIds: ['atom-friendly', 'atom-club'],
      targetAtoms,
      preserveAtoms: [{ ...targetAtoms[0], id: 'atom-entry', description: 'Kylie entered the shop.' }],
      forbiddenAtoms: [{
        id: 'atom-friend-label', description: 'Do not label them friends yet.', acceptedPatterns: ['friend'],
        kind: 'relationship_label', required: true, polarity: 'forbidden',
      }] as any,
      concurrentFindings: ['A premature relationship label is present.'],
      repairFeedback: 'Realize both missing meanings without advancing the relationship label.',
      maxOperations: 3,
    });

    expect(result.success).toBe(true);
    expect(prompt).toContain('at most 3 operations across the same two adjacent beats');
    expect(prompt).toContain('Stela is the speaker');
    expect(prompt).toContain('Do not label them friends yet');
    expect(prompt).toContain('beat-5');
    expect(prompt).not.toContain('Kylie enters the bookshop from the rain');
  });

  it('classifies reasoning-starved truncation for the repair router', async () => {
    BaseAgent.setLlmTransportOverride(async () => {
      throw new TruncatedLLMResponseError(
        'Gemini used the response budget for thoughts.',
        'gemini',
        'MAX_TOKENS',
        2304,
        0,
        2200,
      );
    });

    const result = await writer().executeSemanticPatch({
      baseSceneHash: 'base-hash',
      scene,
      targetTaskId: 'task-1',
      targetAtomIds: ['atom-friendly'],
      targetAtoms: [targetAtoms[0]],
      preserveAtoms: [],
      forbiddenAtoms: [],
      concurrentFindings: [],
      repairFeedback: 'Show the missing relationship change.',
    });

    expect(result).toMatchObject({
      success: false,
      failure: {
        code: 'visible_output_starved',
        retryClass: 'adjust_call_budget',
        requestedMaxTokens: 2304,
        thoughtsTokens: 2200,
      },
    });
  });

  it('classifies immutable target drift for bounded structured correction', async () => {
    BaseAgent.setLlmTransportOverride(async () => JSON.stringify({
      baseSceneHash: 'base-hash',
      targetTaskId: 'task-1',
      targetAtomIds: ['atom-club'],
      operations: [{
        op: 'replace_beat_text',
        beatId: 'beat-2',
        text: 'Stela offers Kylie a chair and waits until she accepts it.',
      }],
      claimedEvidence: [{ atomId: 'atom-club', beatIds: ['beat-2'] }],
    }));

    const result = await writer().executeSemanticPatch({
      baseSceneHash: 'base-hash',
      scene,
      targetTaskId: 'task-1',
      targetAtomIds: ['atom-friendly'],
      targetAtoms: [targetAtoms[0]],
      preserveAtoms: [],
      forbiddenAtoms: [],
      concurrentFindings: [],
      repairFeedback: 'Show the missing relationship change.',
    });

    expect(result).toMatchObject({
      success: false,
      failure: {
        code: 'structured_output_invalid',
        retryClass: 'correct_structured_output',
      },
    });
  });
});
