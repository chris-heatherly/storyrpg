import fs from 'node:fs';
import path from 'node:path';
import { simulateStoryBalance } from '../src/engine/resolutionBalanceSimulator';
import type { Story } from '../src/types';

function parseArgs(argv: string[]): { storyPath?: string; json: boolean } {
  const args = { storyPath: undefined as string | undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--story') {
      args.storyPath = argv[++i];
    } else if (arg === '--json') {
      args.json = true;
    }
  }
  return args;
}

function loadStory(storyPath: string): Story {
  const absolute = path.resolve(process.cwd(), storyPath);
  const raw = fs.readFileSync(absolute, 'utf8');
  return JSON.parse(raw) as Story;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.storyPath) {
    console.error('Usage: npm run analyze:stat-balance -- --story generated-stories/<id>/story.json [--json]');
    process.exit(1);
  }

  const story = loadStory(args.storyPath);
  const report = simulateStoryBalance(story);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Stat balance report${report.storyId ? ` for ${report.storyId}` : ''}`);
  console.log(`Checks: ${report.checks}`);
  console.log(`Passive insights: ${report.passiveInsights}`);
  console.log(`Prepared modifiers: ${report.preparedModifiers}`);
  console.log(`Branches without residue: ${report.branchesWithoutResidue}`);
  console.log('\nOutcome profile averages:');
  for (const [profile, outcomes] of Object.entries(report.profileOutcomes)) {
    console.log(`- ${profile}: success ${formatPercent(outcomes.success)}, complicated ${formatPercent(outcomes.complicated)}, failure ${formatPercent(outcomes.failure)}`);
  }

  if (report.overusedSkills.length > 0) {
    console.log('\nOverused skills:');
    for (const entry of report.overusedSkills) {
      console.log(`- ${entry.skill}: ${formatPercent(entry.share)} of stat-check weight`);
    }
  }

  if (report.underusedAttributes.length > 0) {
    console.log(`\nUnderused attributes: ${report.underusedAttributes.join(', ')}`);
  }

  if (report.highRiskChecks.length > 0) {
    console.log('\nHigh-risk checks:');
    for (const check of report.highRiskChecks.slice(0, 10)) {
      console.log(`- ${check.sceneId}/${check.id}: difficulty ${check.difficulty}, neutral failure ${formatPercent(check.neutralFailure)}`);
    }
  }

  if (report.weakBuildImpactChecks.length > 0) {
    console.log('\nWeak build-impact checks:');
    for (const check of report.weakBuildImpactChecks.slice(0, 10)) {
      console.log(`- ${check.sceneId}/${check.id}: focused success delta ${formatPercent(check.successDelta)}`);
    }
  }
}

main();
