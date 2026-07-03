import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { deriveStoryCircleQualityScore } from './qualityScoring';

function syntheticStory(beatText = 'You open the door.'): any {
  return {
    id: 'synthetic',
    title: 'Synthetic',
    metadata: { version: '1', createdAt: '', updatedAt: '' },
    initialState: {},
    episodes: [{
      id: 'ep1',
      number: 1,
      title: 'Episode',
      synopsis: '',
      startingSceneId: 's1',
      scenes: [{
        id: 's1',
        startingBeatId: 'b1',
        beats: [{ id: 'b1', text: beatText }],
      }],
    }],
  };
}

describe('qualityScoring caps and eligibility', () => {
  it('caps planning-register leakage below the 90 target and marks the run ineligible', () => {
    const result = deriveStoryCircleQualityScore({
      finalStory: {
        id: 'synthetic',
        title: 'Synthetic',
        metadata: { version: '1', createdAt: '', updatedAt: '' },
        initialState: {},
        episodes: [{
          id: 'ep1',
          number: 1,
          title: 'Episode',
          synopsis: '',
          startingSceneId: 's1',
          scenes: [{
            id: 's1',
            startingBeatId: 'b1',
            beats: [{ id: 'b1', text: 'You open the door.' }],
          }],
        }],
      } as any,
      finalStoryContractReport: {
        passed: false,
        blockingIssues: [{
          type: 'planning_register_prose',
          validator: 'PlanningRegisterLeakValidator',
          message: 'Planning-register instruction leaked into story content.',
          severity: 'error',
        }],
        warnings: [],
      } as any,
    }, { now: new Date('2026-01-01T00:00:00Z') });

    expect(result.score).toBeLessThan(90);
    expect(result.basis.qualityEligibility.eligibleFor90).toBe(false);
    expect(result.basis.caps.some((cap) => cap.id === 'planning_register_leak' && cap.maxScore === 69)).toBe(true);
  });

  it('dedupes identical final-contract and sidecar findings before scoring domains', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'storyrpg-quality-'));
    const message = 'Choice "c1" sets unplanned consequential flag "kept_the_card".';
    writeFileSync(join(outputDir, 'episode-1-incremental-contract.json'), JSON.stringify({
      warnings: [{
        type: 'planned_residue_debt',
        validator: 'ResidueObligationValidator',
        message,
      }],
    }));

    try {
      const result = deriveStoryCircleQualityScore({
        finalStory: {
          id: 'synthetic',
          title: 'Synthetic',
          metadata: { version: '1', createdAt: '', updatedAt: '' },
          initialState: {},
          episodes: [{
            id: 'ep1',
            number: 1,
            title: 'Episode',
            synopsis: '',
            startingSceneId: 's1',
            scenes: [{
              id: 's1',
              startingBeatId: 'b1',
              beats: [{ id: 'b1', text: 'You open the door.' }],
            }],
          }],
        } as any,
        finalStoryContractReport: {
          passed: true,
          blockingIssues: [],
          warnings: [{
            type: 'planned_residue_debt',
            validator: 'ResidueObligationValidator',
            message,
            severity: 'warning',
          }],
        } as any,
      }, { outputDir, now: new Date('2026-01-01T00:00:00Z') });

      const branching = result.basis.domains.find((domain) => domain.id === 'branching_consequence_memory');
      expect(branching?.findings.filter((finding) => finding.message === message)).toHaveLength(1);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('qualityScoring v4: graded judge intake', () => {
  it('activates prose_craft only when the judge graded it, and uses grades as concept bases', () => {
    const withoutJudge = deriveStoryCircleQualityScore({ finalStory: syntheticStory() }, { now: new Date('2026-01-01T00:00:00Z') });
    const proseCraftInactive = withoutJudge.basis.domains.find((domain) => domain.id === 'prose_craft');
    expect(proseCraftInactive?.active).toBe(false);

    const withJudge = deriveStoryCircleQualityScore({
      finalStory: syntheticStory(),
      qaReport: {
        proseCraft: {
          overallScore: 52,
          conceptScores: [
            { conceptId: 'sentence_craft', score: 55, evidence: 'flat verbs' },
            { conceptId: 'filler_density', score: 48, evidence: 'padding in s1' },
          ],
          issues: [],
          sampledSceneIds: ['s1'],
          recommendations: [],
        },
      } as any,
    }, { now: new Date('2026-01-01T00:00:00Z') });

    const proseCraft = withJudge.basis.domains.find((domain) => domain.id === 'prose_craft');
    expect(proseCraft?.active).toBe(true);
    expect(proseCraft?.concepts.find((c) => c.id === 'sentence_craft')?.score).toBe(55);
    expect(proseCraft?.concepts.find((c) => c.id === 'filler_density')?.score).toBe(48);
    // Ungraded judge-only concepts must not contribute a free 100.
    expect(proseCraft?.score).toBeLessThanOrEqual(55);
    expect(withJudge.basis.rawScore).toBeLessThan(withoutJudge.basis.rawScore);
  });

  it('routes responsiveness grades to branching and character domains', () => {
    const result = deriveStoryCircleQualityScore({
      finalStory: syntheticStory(),
      qaReport: {
        responsiveness: {
          overallScore: 45,
          conceptScores: [
            { conceptId: 'choice_reflected_in_prose', score: 60, evidence: 'half the probes diverge' },
            { conceptId: 'npc_reacts_to_player_choice', score: 30, evidence: 'NPCs greet identically' },
          ],
          probeVerdicts: [],
          issues: [],
          recommendations: [],
        },
      } as any,
    }, { now: new Date('2026-01-01T00:00:00Z') });

    const branching = result.basis.domains.find((domain) => domain.id === 'branching_consequence_memory');
    const character = result.basis.domains.find((domain) => domain.id === 'character_npc_relationship_quality');
    expect(branching?.concepts.find((c) => c.id === 'choice_reflected_in_prose')?.score).toBe(60);
    expect(character?.concepts.find((c) => c.id === 'npc_reacts_to_player_choice')?.score).toBe(30);
    expect(character?.score).toBeLessThan(100);
  });
});

describe('qualityScoring v4: routing and severity', () => {
  it('routes tagged validators by registry, not by incidental keywords', () => {
    const result = deriveStoryCircleQualityScore({
      finalStory: syntheticStory(),
      finalStoryContractReport: {
        passed: true,
        blockingIssues: [],
        warnings: [{
          type: 'weak_choice',
          validator: 'ChoiceImpactValidator',
          message: 'Choice inside the encounter scene has no concrete impact.',
          severity: 'warning',
        }],
      } as any,
    }, { now: new Date('2026-01-01T00:00:00Z') });

    const choiceAgency = result.basis.domains.find((domain) => domain.id === 'choice_agency');
    const encounters = result.basis.domains.find((domain) => domain.id === 'encounters');
    expect(choiceAgency?.findings.some((finding) => finding.message.includes('no concrete impact'))).toBe(true);
    expect(encounters?.findings.some((finding) => finding.message.includes('no concrete impact'))).toBe(false);
  });

  it('honors Quality Council error severity instead of demoting it', () => {
    const result = deriveStoryCircleQualityScore({
      finalStory: syntheticStory(),
      qualityCouncilReport: {
        enabled: true,
        checkpoints: [{
          checkpoint: 'final',
          status: 'findings',
          findings: [{
            severity: 'error',
            category: 'choice-agency',
            confidence: 'high',
            validatorMapping: 'StakesTriangleValidator',
            evidence: ['Both options resolve identically.'],
          }],
        }],
      } as any,
    }, { now: new Date('2026-01-01T00:00:00Z') });

    const choiceAgency = result.basis.domains.find((domain) => domain.id === 'choice_agency');
    const councilFinding = choiceAgency?.findings.find((finding) => finding.source === 'quality-council');
    expect(councilFinding?.severity).toBe('error');
  });

  it('counts unmapped findings individually instead of collapsing them', () => {
    const result = deriveStoryCircleQualityScore({
      finalStory: syntheticStory(),
      finalStoryContractReport: {
        passed: true,
        blockingIssues: [],
        warnings: [
          { type: 'x', validator: 'ZzUnknownValidator', message: 'first oddity zz1', severity: 'warning' },
          { type: 'x', validator: 'ZzUnknownValidator', message: 'second oddity zz2', severity: 'warning' },
        ],
      } as any,
    }, { now: new Date('2026-01-01T00:00:00Z') });

    expect(result.basis.unmappedFindings).toHaveLength(2);
    const sceneDomain = result.basis.domains.find((domain) => domain.id === 'scene_coherence_prose_continuity');
    const routed = sceneDomain?.findings.filter((finding) => finding.message.includes('oddity'));
    expect(routed).toHaveLength(2);
  });
});

describe('qualityScoring v4: leakage calibration', () => {
  it('treats two single-occurrence patterns as leakage but not repeated/central', () => {
    const result = deriveStoryCircleQualityScore({
      finalStory: syntheticStory('A stat check waits ahead. The lock needs DC 15 to open.'),
    }, { now: new Date('2026-01-01T00:00:00Z') });

    expect(result.basis.caps.some((cap) => cap.id === 'player_facing_mechanics_leakage')).toBe(true);
    expect(result.basis.caps.some((cap) => cap.id === 'repeated_or_central_leakage')).toBe(false);
  });

  it('treats a recurring pattern as repeated/central leakage', () => {
    const result = deriveStoryCircleQualityScore({
      finalStory: syntheticStory('A stat check here. Another stat check there.'),
    }, { now: new Date('2026-01-01T00:00:00Z') });

    expect(result.basis.caps.some((cap) => cap.id === 'repeated_or_central_leakage')).toBe(true);
  });
});
