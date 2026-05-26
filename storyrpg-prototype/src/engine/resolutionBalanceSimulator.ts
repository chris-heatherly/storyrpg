import type { Choice, PlayerState, Story } from '../types';
import { calculateOutcomeChances, normalizeStatCheck } from './resolutionEngine';
import { SKILL_DEFINITIONS } from '../constants/pipeline';

export type BalanceProfileName =
  | 'neutral'
  | 'focusedSocial'
  | 'focusedPhysical'
  | 'cleverInvestigator'
  | 'undertrained'
  | 'lateBalanced';

export interface ExtractedStatCheck {
  storyId?: string;
  episodeId?: string;
  episodeNumber?: number;
  sceneId: string;
  beatId: string;
  choiceId: string;
  choiceText: string;
  choice: Choice;
}

export interface BalanceSimulationReport {
  storyId?: string;
  checks: number;
  passiveInsights: number;
  preparedModifiers: number;
  branchesWithoutResidue: number;
  overusedSkills: Array<{ skill: string; share: number }>;
  underusedAttributes: string[];
  profileOutcomes: Record<BalanceProfileName, { success: number; complicated: number; failure: number }>;
  highRiskChecks: Array<{ id: string; sceneId: string; difficulty: number; neutralFailure: number }>;
  weakBuildImpactChecks: Array<{ id: string; sceneId: string; successDelta: number }>;
}

export function extractStatChecks(story: Story): ExtractedStatCheck[] {
  const checks: ExtractedStatCheck[] = [];
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      for (const beat of scene.beats ?? []) {
        for (const choice of beat.choices ?? []) {
          if (!choice.statCheck) continue;
          checks.push({
            storyId: story.id,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: scene.id,
            beatId: beat.id,
            choiceId: choice.id,
            choiceText: choice.text,
            choice,
          });
        }
      }
    }
  }
  return checks;
}

export function simulateStoryBalance(story: Story): BalanceSimulationReport {
  const checks = extractStatChecks(story);
  const profiles = buildStandardProfiles();
  const profileTotals = Object.fromEntries(
    Object.keys(profiles).map((name) => [name, { success: 0, complicated: 0, failure: 0 }])
  ) as BalanceSimulationReport['profileOutcomes'];
  const skillWeight: Record<string, number> = {};
  const attrWeight: Record<string, number> = {
    charm: 0,
    wit: 0,
    courage: 0,
    empathy: 0,
    resolve: 0,
    resourcefulness: 0,
  };
  let totalWeight = 0;
  const highRiskChecks: BalanceSimulationReport['highRiskChecks'] = [];
  const weakBuildImpactChecks: BalanceSimulationReport['weakBuildImpactChecks'] = [];

  for (const check of checks) {
    const normalized = normalizeStatCheck(check.choice.statCheck!);
    for (const [skill, weight] of Object.entries(normalized.skillWeights)) {
      const key = skill.toLowerCase();
      skillWeight[key] = (skillWeight[key] ?? 0) + weight;
      totalWeight += weight;
      const def = SKILL_DEFINITIONS[key];
      if (def) {
        for (const [attr, attrShare] of Object.entries(def.attributeWeights)) {
          attrWeight[attr] = (attrWeight[attr] ?? 0) + weight * (attrShare ?? 0);
        }
      }
    }

    for (const [name, player] of Object.entries(profiles) as Array<[BalanceProfileName, PlayerState]>) {
      const chances = calculateOutcomeChances(player, normalized);
      profileTotals[name].success += chances.success;
      profileTotals[name].complicated += chances.complicated;
      profileTotals[name].failure += chances.failure;
    }

    const neutral = calculateOutcomeChances(profiles.neutral, normalized);
    const focused = calculateOutcomeChances(focusedProfileFor(normalized.skillWeights), normalized);
    if (neutral.failure > 0.35 && normalized.difficulty <= 70) {
      highRiskChecks.push({
        id: check.choiceId,
        sceneId: check.sceneId,
        difficulty: normalized.difficulty,
        neutralFailure: neutral.failure,
      });
    }
    if (focused.success - neutral.success < 0.08) {
      weakBuildImpactChecks.push({
        id: check.choiceId,
        sceneId: check.sceneId,
        successDelta: focused.success - neutral.success,
      });
    }
  }

  for (const totals of Object.values(profileTotals)) {
    if (checks.length === 0) continue;
    totals.success /= checks.length;
    totals.complicated /= checks.length;
    totals.failure /= checks.length;
  }

  const passiveInsights = story.episodes.flatMap((episode) => episode.scenes)
    .flatMap((scene) => scene.beats)
    .reduce((sum, beat) => sum + (beat.skillInsights?.length ?? 0), 0);
  const preparedModifiers = checks.reduce((sum, check) => sum + (check.choice.statCheck?.modifiers?.length ?? 0), 0);
  const branchesWithoutResidue = countBranchesWithoutResidue(story);
  const overusedSkills = Object.entries(skillWeight)
    .map(([skill, weight]) => ({ skill, share: totalWeight > 0 ? weight / totalWeight : 0 }))
    .filter((entry) => entry.share > 0.30)
    .sort((a, b) => b.share - a.share);
  const underusedAttributes = Object.entries(attrWeight)
    .filter(([, weight]) => totalWeight > 0 && weight / totalWeight < 0.08)
    .map(([attr]) => attr);

  return {
    storyId: story.id,
    checks: checks.length,
    passiveInsights,
    preparedModifiers,
    branchesWithoutResidue,
    overusedSkills,
    underusedAttributes,
    profileOutcomes: profileTotals,
    highRiskChecks,
    weakBuildImpactChecks,
  };
}

export function buildStandardProfiles(): Record<BalanceProfileName, PlayerState> {
  return {
    neutral: createProfile(50, {}),
    undertrained: createProfile(45, {}),
    lateBalanced: createProfile(65, {
      athletics: 60,
      stealth: 60,
      perception: 60,
      persuasion: 60,
      intimidation: 60,
      deception: 60,
      investigation: 60,
      survival: 60,
    }),
    focusedSocial: createProfile(55, { persuasion: 75, deception: 70, intimidation: 60 }, { charm: 75, empathy: 70, wit: 65 }),
    focusedPhysical: createProfile(55, { athletics: 75, survival: 70, intimidation: 65 }, { courage: 75, resolve: 70, resourcefulness: 65 }),
    cleverInvestigator: createProfile(55, { investigation: 75, perception: 75, stealth: 65 }, { wit: 75, resourcefulness: 70, empathy: 65 }),
  };
}

function focusedProfileFor(skillWeights: Record<string, number>): PlayerState {
  const topSkills = Object.entries(skillWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([skill]) => skill);
  return createProfile(65, Object.fromEntries(topSkills.map((skill) => [skill, 70])));
}

function createProfile(base: number, skills: Record<string, number>, attributes: Partial<PlayerState['attributes']> = {}): PlayerState {
  return {
    characterName: 'Balance Profile',
    characterPronouns: 'they/them',
    attributes: {
      charm: base,
      wit: base,
      courage: base,
      empathy: base,
      resolve: base,
      resourcefulness: base,
      ...attributes,
    },
    skills,
    relationships: {},
    flags: {},
    scores: {},
    tags: new Set(),
    identityProfile: { mercy_justice: 0, idealism_pragmatism: 0, cautious_bold: 0, loner_leader: 0, heart_head: 0, honest_deceptive: 0 },
    pendingConsequences: [],
    inventory: [],
    currentStoryId: null,
    currentEpisodeId: null,
    currentSceneId: null,
    completedEpisodes: [],
    visitLog: [],
    episodeCompletions: [],
  };
}

function countBranchesWithoutResidue(story: Story): number {
  let count = 0;
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      for (const beat of scene.beats ?? []) {
        for (const choice of beat.choices ?? []) {
          if (!choice.nextSceneId) continue;
          if (hasResidue(choice)) continue;
          count++;
        }
      }
    }
  }
  return count;
}

function hasResidue(choice: Choice): boolean {
  return Boolean(
    choice.tintFlag
      || choice.memorableMoment
      || choice.failureResidue
      || (choice.consequences?.length ?? 0) > 0
      || (choice.delayedConsequences?.length ?? 0) > 0
      || (choice.residueHints?.length ?? 0) > 0
      || (choice.statCheck?.modifiers?.length ?? 0) > 0
  );
}
