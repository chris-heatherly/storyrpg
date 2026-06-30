#!/usr/bin/env ts-node

import fs from 'node:fs';
import path from 'node:path';
import { atomizeTreatmentText } from '../src/ai-agents/utils/treatmentEventAtomizer';
import { EmptyPlayableSceneValidator } from '../src/ai-agents/validators/EmptyPlayableSceneValidator';
import { PlanningRegisterLeakValidator } from '../src/ai-agents/validators/PlanningRegisterLeakValidator';
import { TreatmentAtomCoverageValidator } from '../src/ai-agents/validators/TreatmentAtomCoverageValidator';
import type { GeneratedEpisodeAuditIssue, GeneratedEpisodeAuditReport, Story } from '../src/types';

interface Args {
  treatment?: string;
  storyDir?: string;
  episode?: number;
  stdout?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--treatment') args.treatment = argv[++i];
    else if (arg === '--story-dir') args.storyDir = argv[++i];
    else if (arg === '--episode') args.episode = Number(argv[++i]);
    else if (arg === '--stdout') args.stdout = true;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.treatment || !args.storyDir || !args.episode) {
    throw new Error('Usage: audit-generated-episode-vs-treatment --treatment <file> --story-dir <dir> --episode <n> [--stdout]');
  }
  const treatmentText = fs.readFileSync(args.treatment, 'utf8');
  const episodeTreatmentText = extractEpisodeTreatmentText(treatmentText, args.episode);
  const story = readStory(args.storyDir);
  const storyEpisode = {
    ...story,
    episodes: (story.episodes || []).filter((episode) => (episode.number ?? Number(String(episode.id || '').match(/\d+/)?.[0])) === args.episode),
  } as Story;
  const atoms = atomizeTreatmentText({
    episodeNumber: args.episode,
    text: episodeTreatmentText,
    sourceSection: `episode-${args.episode}`,
  });

  const coverage = new TreatmentAtomCoverageValidator().validate({ story: storyEpisode, atoms });
  const emptyScenes = new EmptyPlayableSceneValidator().validate({ story: storyEpisode });
  const leakage = new PlanningRegisterLeakValidator().validate({ story: storyEpisode });
  const qualityEligibility = readQualityEligibility(args.storyDir);
  const councilIntegrity = readCouncilIntegrity(args.storyDir);
  const falseMeaningfulChoiceIds = findFalseMeaningfulChoices(storyEpisode);

  const blockingIssues: GeneratedEpisodeAuditIssue[] = [
    ...coverage.blockingIssues.map((issue): GeneratedEpisodeAuditIssue => ({
      id: `${issue.type}:${issue.atomId}`,
      severity: 'blocking',
      category: issue.type === 'atom_out_of_order' || issue.type === 'duplicate_atom_realization' ? 'chronology' : 'eventCoverage',
      message: issue.message,
      atomId: issue.atomId,
      sceneId: issue.sceneId,
      location: issue.path,
    })),
    ...emptyScenes.findings.map((finding): GeneratedEpisodeAuditIssue => ({
      id: `${finding.type}:${finding.sceneId}`,
      severity: 'blocking',
      category: 'sceneShape',
      message: finding.message,
      sceneId: finding.sceneId,
      location: finding.path,
    })),
    ...leakage.findings.map((finding, index): GeneratedEpisodeAuditIssue => ({
      id: `leakage:${index + 1}`,
      severity: 'blocking',
      category: 'leakage',
      message: `Planning/fallback prose leaked into generated content (${finding.pattern}).`,
      sceneId: finding.sceneId,
      beatId: finding.beatId,
      location: finding.path,
    })),
    ...falseMeaningfulChoiceIds.map((choiceId): GeneratedEpisodeAuditIssue => ({
      id: `false-choice:${choiceId}`,
      severity: 'blocking',
      category: 'choiceAgency',
      message: `Choice "${choiceId}" is framed as meaningful but has no concrete route, consequence, outcome, information, relationship, resource, identity, or callback residue.`,
    })),
    ...councilIntegrity.parserErrorCheckpoints.map((checkpoint): GeneratedEpisodeAuditIssue => ({
      id: `council-parser:${checkpoint}`,
      severity: 'blocking',
      category: 'councilIntegrity',
      message: `Quality Council checkpoint "${checkpoint}" has parser diagnostics that make acceptance unsafe.`,
    })),
    ...qualityEligibility.blockingReasons.map((reason, index): GeneratedEpisodeAuditIssue => ({
      id: `quality-cap:${index + 1}`,
      severity: 'blocking',
      category: 'qualityEligibility',
      message: reason,
    })),
  ];
  const warnings: GeneratedEpisodeAuditIssue[] = [
    ...councilIntegrity.providerErrorCheckpoints.map((failure, index): GeneratedEpisodeAuditIssue => ({
      id: `council-provider:${failure.checkpoint}:${index + 1}`,
      severity: 'warning',
      category: 'councilIntegrity',
      message: `Quality Council checkpoint "${failure.checkpoint}" provider call failed${failure.fusionUsed ? ' for optional Fusion review' : ''}: ${failure.error}`,
    })),
  ];

  const duplicateAtomIds = coverage.ownership
    .filter((item) => item.chronologyStatus === 'duplicate')
    .map((item) => item.atomId);
  const outOfOrderAtomIds = coverage.ownership
    .filter((item) => item.chronologyStatus === 'out_of_order')
    .map((item) => item.atomId);
  const missingAtomIds = coverage.ownership
    .filter((item) => item.realizationStatus === 'missing')
    .map((item) => item.atomId);

  const report: GeneratedEpisodeAuditReport = {
    passed: blockingIssues.length === 0,
    blockingIssues,
    warnings,
    eventCoverage: {
      atoms,
      ownership: coverage.ownership,
      missingAtomIds,
    },
    sceneShape: {
      emptySceneIds: emptyScenes.emptySceneIds,
      emptyEncounterSceneIds: emptyScenes.emptyEncounterSceneIds,
    },
    leakage: {
      findings: leakage.findings.map((finding) => ({
        pattern: finding.pattern,
        path: finding.path,
        excerpt: finding.excerpt,
        sceneId: finding.sceneId,
        beatId: finding.beatId,
      })),
    },
    choiceAgency: { falseMeaningfulChoiceIds },
    chronology: { duplicateAtomIds, outOfOrderAtomIds },
    councilIntegrity,
    qualityEligibility,
  };

  const json = JSON.stringify(report, null, 2);
  if (args.stdout) {
    console.log(json);
  } else {
    fs.writeFileSync(path.join(args.storyDir, 'generated-episode-audit.json'), `${json}\n`);
    console.log(`Wrote ${path.join(args.storyDir, 'generated-episode-audit.json')}`);
  }
  if (!report.passed) process.exitCode = 1;
}

function extractEpisodeTreatmentText(text: string, episodeNumber: number): string {
  const pattern = new RegExp(`(^|\\n)#{1,4}\\s*Episode\\s+${episodeNumber}\\b[\\s\\S]*?(?=\\n#{1,4}\\s*Episode\\s+${episodeNumber + 1}\\b|\\n#{1,4}\\s*Episode\\s+\\d+\\b|$)`, 'i');
  return text.match(pattern)?.[0] || text;
}

function readStory(storyDir: string): Story {
  const candidates = [
    'story.json',
    '08-final-story.json',
    'final-story.json',
    'partial-story.json',
  ].map((file) => path.join(storyDir, file));
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error(`No story JSON found in ${storyDir}. Tried: ${candidates.map(path.basename).join(', ')}`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Story;
}

function readJsonFiles(storyDir: string): unknown[] {
  return fs.readdirSync(storyDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.join(storyDir, file))
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return undefined;
      }
    })
    .filter((value) => value !== undefined);
}

function readQualityEligibility(storyDir: string): GeneratedEpisodeAuditReport['qualityEligibility'] {
  for (const json of readJsonFiles(storyDir)) {
    const eligibility = findObjectKey(json, 'qualityEligibility') as GeneratedEpisodeAuditReport['qualityEligibility'] | undefined;
    if (eligibility?.eligibleFor90 !== undefined) return eligibility;
    const caps = findObjectKey(json, 'capsApplied') || findObjectKey(json, 'caps');
    if (Array.isArray(caps) && caps.length > 0) {
      return {
        eligibleFor90: false,
        blockingReasons: caps.filter((cap) => Number(cap.maxScore) < 90).map((cap) => String(cap.reason || cap.id || 'Quality cap remains.')),
        capsApplied: caps.map((cap) => ({ id: String(cap.id), maxScore: Number(cap.maxScore), reason: String(cap.reason || '') })),
      };
    }
  }
  return { eligibleFor90: true, blockingReasons: [], capsApplied: [] };
}

function readCouncilIntegrity(storyDir: string): GeneratedEpisodeAuditReport['councilIntegrity'] {
  const parserErrorCheckpoints = new Set<string>();
  const providerErrorCheckpoints: Array<{ checkpoint: string; error: string; fusionUsed?: boolean }> = [];
  let unresolvedConcreteFindingCount = 0;
  for (const json of readJsonFiles(storyDir)) {
    const checkpoints = findObjectKey(json, 'checkpoints');
    if (!Array.isArray(checkpoints)) continue;
    for (const checkpoint of checkpoints) {
      if (checkpoint?.parseStatus === 'raw_findings_dropped' || checkpoint?.parseStatus === 'error') {
        parserErrorCheckpoints.add(String(checkpoint.checkpoint || 'unknown'));
      }
      if (checkpoint?.status === 'error' && !checkpoint?.parseStatus) {
        providerErrorCheckpoints.push({
          checkpoint: String(checkpoint.checkpoint || 'unknown'),
          error: String(checkpoint.error || checkpoint.summary || 'Provider call failed.'),
          fusionUsed: Boolean(checkpoint.fusionUsed),
        });
      }
      unresolvedConcreteFindingCount += (checkpoint?.findings || []).filter((finding: any) =>
        finding?.severity === 'error' && finding?.confidence === 'high' && finding?.repairRoute !== 'none',
      ).length;
    }
  }
  return {
    parserErrorCheckpoints: Array.from(parserErrorCheckpoints),
    providerErrorCheckpoints,
    unresolvedConcreteFindingCount,
  };
}

function findFalseMeaningfulChoices(story: Story): string[] {
  const ids: string[] = [];
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      for (const beat of scene.beats || []) {
        for (const choice of beat.choices || []) {
          const choiceRecord = choice as any;
          const framedMeaningful = choiceRecord.choiceType && choiceRecord.choiceType !== 'expression';
          const hasConcreteImpact = Boolean(
            choiceRecord.nextSceneId
              || choiceRecord.statCheck
              || choiceRecord.outcomeTexts
              || choiceRecord.reactionText
              || choiceRecord.callbackHookId
              || choiceRecord.feedbackCue
              || (Array.isArray(choiceRecord.residueHints) && choiceRecord.residueHints.length > 0)
              || (Array.isArray(choice.consequences) && choice.consequences.length > 0),
          );
          if (framedMeaningful && !hasConcreteImpact) ids.push(choice.id);
        }
      }
    }
  }
  return ids;
}

function findObjectKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key)) return (value as Record<string, unknown>)[key];
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findObjectKey(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findObjectKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

main();
