import {
  PlayerState,
  PlayerAttributes,
  ResolutionResult,
  ResolutionTier,
} from '../types';
import { SKILL_DEFINITIONS, ATTRIBUTE_TO_SKILL } from '../constants/pipeline';

/**
 * Fiction-First Resolution Engine — Geometric Overlap Model
 *
 * Every challenge defines a shape in skill-space (skillWeights).
 * The player has their own shape (effective stats per skill, bounded by attributes).
 * Success = how much the shapes overlap. Randomness = the "bouncing ball."
 *
 * Three tiers of outcomes:
 * - Success: Clear victory, player achieves their goal
 * - Complicated: Partial success with a cost or twist
 * - Failure: Interesting failure that moves story forward
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatCheckParams {
  skillWeights?: Record<string, number>;
  difficulty: number;
  attribute?: keyof PlayerAttributes;
  skill?: string;
  retryableAfterChange?: boolean;
}

interface NormalizedCheck {
  skillWeights: Record<string, number>;
  difficulty: number;
}

// ---------------------------------------------------------------------------
// ResolutionTracker — session-scoped fairness guardrails
// ---------------------------------------------------------------------------

export class ResolutionTracker {
  private consecutiveFailures = 0;

  recordOutcome(tier: ResolutionTier): void {
    if (tier === 'failure') {
      this.consecutiveFailures++;
    } else {
      this.consecutiveFailures = 0;
    }
  }

  getStreakBonus(): number {
    if (this.consecutiveFailures >= 3) return 25;
    if (this.consecutiveFailures >= 2) return 15;
    return 0;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  reset(): void {
    this.consecutiveFailures = 0;
  }
}

// ---------------------------------------------------------------------------
// normalizeStatCheck — legacy format conversion
// ---------------------------------------------------------------------------

export function normalizeStatCheck(check: StatCheckParams): NormalizedCheck {
  if (check.skillWeights && Object.keys(check.skillWeights).length > 0) {
    return { skillWeights: check.skillWeights, difficulty: check.difficulty };
  }

  if (check.skill) {
    return { skillWeights: { [check.skill]: 1.0 }, difficulty: check.difficulty };
  }

  if (check.attribute) {
    const canonicalSkill = ATTRIBUTE_TO_SKILL[check.attribute] ?? 'survival';
    return { skillWeights: { [canonicalSkill]: 1.0 }, difficulty: check.difficulty };
  }

  return { skillWeights: { survival: 1.0 }, difficulty: check.difficulty };
}

// ---------------------------------------------------------------------------
// computeEffectiveStat — per-skill stat bounded by attribute ceiling
// ---------------------------------------------------------------------------

export function computeEffectiveStat(player: PlayerState, skillName: string): number {
  const def = SKILL_DEFINITIONS[skillName.toLowerCase()];
  if (!def) {
    return Math.min(100, 50 + (player.skills[skillName] ?? 0));
  }

  const ceiling = Object.entries(def.attributeWeights)
    .reduce((sum, [attr, w]) => sum + (player.attributes[attr as keyof PlayerAttributes] ?? 50) * (w ?? 0), 0);

  const trained = player.skills[skillName] ?? Math.round(ceiling * 0.7);
  return Math.min(trained, ceiling);
}

/**
 * Compute the attribute ceiling for a skill (without clamping to trained level).
 * Used to determine whether a skill is training-bounded vs ceiling-bounded.
 */
export function computeSkillCeiling(player: PlayerState, skillName: string): number {
  const def = SKILL_DEFINITIONS[skillName.toLowerCase()];
  if (!def) return 100;
  return Object.entries(def.attributeWeights)
    .reduce((sum, [attr, w]) => sum + (player.attributes[attr as keyof PlayerAttributes] ?? 50) * (w ?? 0), 0);
}

// ---------------------------------------------------------------------------
// computeOverlap — the geometric overlap (weighted coverage score)
// ---------------------------------------------------------------------------

export function computeOverlap(player: PlayerState, skillWeights: Record<string, number>): number {
  let coverage = 0;
  for (const [skill, weight] of Object.entries(skillWeights)) {
    coverage += computeEffectiveStat(player, skill) * weight;
  }
  return coverage;
}

// ---------------------------------------------------------------------------
// findWeakestContributor — for failure narrative feedback
// ---------------------------------------------------------------------------

function findWeakestContributor(
  player: PlayerState,
  skillWeights: Record<string, number>
): { skill: string; effective: number; ceiling: number } | undefined {
  let weakest: { skill: string; effective: number; ceiling: number } | undefined;
  let lowestEffective = Infinity;

  for (const [skill] of Object.entries(skillWeights)) {
    const effective = computeEffectiveStat(player, skill);
    if (effective < lowestEffective) {
      lowestEffective = effective;
      weakest = {
        skill,
        effective,
        ceiling: computeSkillCeiling(player, skill),
      };
    }
  }
  return weakest;
}

// ---------------------------------------------------------------------------
// getDominantAttribute — for narrative flavor
// ---------------------------------------------------------------------------

function getDominantAttribute(skillWeights: Record<string, number>): string {
  const attrAccum: Record<string, number> = {};

  for (const [skill, skillWeight] of Object.entries(skillWeights)) {
    const def = SKILL_DEFINITIONS[skill.toLowerCase()];
    if (!def) continue;
    for (const [attr, attrWeight] of Object.entries(def.attributeWeights)) {
      attrAccum[attr] = (attrAccum[attr] ?? 0) + skillWeight * (attrWeight ?? 0);
    }
  }

  let best = 'skill';
  let bestVal = 0;
  for (const [attr, val] of Object.entries(attrAccum)) {
    if (val > bestVal) { bestVal = val; best = attr; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// resolveStatCheck — the bouncing ball
// ---------------------------------------------------------------------------

export function resolveStatCheck(
  player: PlayerState,
  check: StatCheckParams,
  tracker?: ResolutionTracker
): ResolutionResult {
  const normalized = normalizeStatCheck(check);
  const coverage = computeOverlap(player, normalized.skillWeights);

  const statModifier = (coverage - 50) * 0.5;
  let target = normalized.difficulty - statModifier;

  // Fairness: streak compensation
  if (tracker) {
    target -= tracker.getStreakBonus();
  }

  const roll = Math.random() * 100;
  const margin = target - roll;
  let tier: ResolutionTier;

  if (roll <= target - 20) {
    tier = 'success';
  } else if (roll <= target + 10) {
    tier = 'complicated';
  } else {
    tier = 'failure';
  }

  // Fairness: high-confidence clamping
  const successChance = Math.max(0, Math.min(100, 100 - (target - 10)));
  if (successChance > 80 && tier === 'failure') {
    tier = 'complicated';
  }

  if (tracker) {
    tracker.recordOutcome(tier);
  }

  const weakestContributor = tier === 'failure'
    ? findWeakestContributor(player, normalized.skillWeights)
    : undefined;

  return {
    tier,
    roll,
    target,
    margin,
    narrativeText: generateNarrativeText(tier, normalized, weakestContributor),
    weakestContributor,
  };
}

// ---------------------------------------------------------------------------
// calculateSuccessChance — internal utility (never shown to players)
// ---------------------------------------------------------------------------

export function calculateSuccessChance(
  player: PlayerState,
  check: StatCheckParams
): number {
  const normalized = normalizeStatCheck(check);
  const coverage = computeOverlap(player, normalized.skillWeights);

  const statModifier = (coverage - 50) * 0.5;
  const effectiveTarget = normalized.difficulty - statModifier;

  return Math.max(0, Math.min(100, 100 - (effectiveTarget - 10)));
}

// ---------------------------------------------------------------------------
// computeEncounterWeights — encounter tier weights using effective stat
// ---------------------------------------------------------------------------

export function computeEncounterWeights(
  player: PlayerState,
  primarySkill?: string,
  effectiveStatBonus: number = 0
): { success: number; complicated: number; failure: number } {
  const BASE_SUCCESS = 0.40;
  const BASE_COMPLICATED = 0.35;
  const BASE_FAILURE = 0.25;

  if (!primarySkill && effectiveStatBonus === 0) {
    return { success: BASE_SUCCESS, complicated: BASE_COMPLICATED, failure: BASE_FAILURE };
  }

  let playerStat = 50;

  if (primarySkill) {
    playerStat = computeEffectiveStat(player, primarySkill);
  }

  playerStat = Math.min(100, playerStat + effectiveStatBonus);

  const modifier = ((playerStat - 50) / 50) * 0.15;

  let success = Math.max(0.10, Math.min(0.65, BASE_SUCCESS + modifier));
  let failure = Math.max(0.05, Math.min(0.50, BASE_FAILURE - modifier));
  let complicated = 1.0 - success - failure;

  if (complicated < 0.10) {
    complicated = 0.10;
    const excess = success + failure + complicated - 1.0;
    success -= excess / 2;
    failure -= excess / 2;
  }

  return { success, complicated, failure };
}

// ---------------------------------------------------------------------------
// applyUseBasedGrowth — skill growth from attempting checks
// ---------------------------------------------------------------------------

export function applyUseBasedGrowth(
  player: PlayerState,
  skillWeights: Record<string, number>,
  tier: ResolutionTier
): void {
  const tierMultiplier = tier === 'success' ? 2 : tier === 'complicated' ? 1.5 : 1;
  for (const [skill, weight] of Object.entries(skillWeights)) {
    const growth = Math.round(weight * tierMultiplier);
    if (growth > 0) {
      player.skills[skill] = (player.skills[skill] ?? 0) + growth;
    }
  }
}

// ---------------------------------------------------------------------------
// Narrative text generation — flavor from dominant attribute
// ---------------------------------------------------------------------------

function generateNarrativeText(
  tier: ResolutionTier,
  check: NormalizedCheck,
  weakest?: { skill: string; effective: number; ceiling: number }
): string {
  const attribute = getDominantAttribute(check.skillWeights);

  switch (tier) {
    case 'success':
      return getSuccessNarrative(attribute);
    case 'complicated':
      return getComplicatedNarrative(attribute);
    case 'failure':
      return getFailureNarrative(attribute, weakest);
  }
}

function getSuccessNarrative(attribute: string): string {
  const narratives: Record<string, string[]> = {
    charm: [
      'Your words flow effortlessly, winning them over completely.',
      'They hang on your every word, utterly convinced.',
      'Your natural magnetism makes this almost too easy.',
    ],
    wit: [
      'The solution comes to you in a flash of inspiration.',
      'Your quick thinking saves the day.',
      'You see the answer before anyone else even understands the question.',
    ],
    courage: [
      'You face the challenge head-on without hesitation.',
      'Your bravery inspires those around you.',
      'Fear has no hold over you in this moment.',
    ],
    empathy: [
      'You understand exactly what they need to hear.',
      'Your compassion bridges the gap between you.',
      'They feel truly seen and understood.',
    ],
    resolve: [
      'Your determination proves unshakeable.',
      'Nothing can break your focus.',
      'You endure what others cannot.',
    ],
    resourcefulness: [
      'You find the perfect solution with what you have.',
      'Your improvisation works better than any plan could.',
      'Somehow, you make it work.',
    ],
    skill: [
      'Everything comes together perfectly.',
      'Your expertise shows in every action.',
      'You handle the situation with practiced ease.',
    ],
  };

  const options = narratives[attribute] ?? narratives.skill;
  return options[Math.floor(Math.random() * options.length)];
}

function getComplicatedNarrative(attribute: string): string {
  const narratives: Record<string, string[]> = {
    charm: [
      "You're convincing, but they want something in return.",
      "They agree, though not without some suspicion.",
      "Your words work, but you've made a promise you'll need to keep.",
    ],
    wit: [
      "You find a solution, but it's not without cost.",
      "Your plan works, mostly. There are... complications.",
      "You figure it out, though time is now against you.",
    ],
    courage: [
      "You push through, but not without taking some hits.",
      "Your bravery wins the day, though you'll feel this tomorrow.",
      "You stand firm, but the effort leaves you shaken.",
    ],
    empathy: [
      "You connect with them, but they share something troubling.",
      "They open up, perhaps more than you wanted.",
      "Your understanding helps, but now you carry their burden too.",
    ],
    resolve: [
      "You endure, but something has to give.",
      "Your will holds, though cracks are showing.",
      "You push through, but the cost is written on your face.",
    ],
    resourcefulness: [
      "You make it work, but you've used up your options.",
      "Your improvisation succeeds with an unexpected side effect.",
      "It works, but you've drawn unwanted attention.",
    ],
    skill: [
      "You succeed, but not without complication.",
      "The outcome is mixed - partially what you hoped.",
      "It works, though not quite as planned.",
    ],
  };

  const options = narratives[attribute] ?? narratives.skill;
  return options[Math.floor(Math.random() * options.length)];
}

function getFailureNarrative(
  attribute: string,
  weakest?: { skill: string; effective: number; ceiling: number }
): string {
  if (weakest) {
    const isCeilingBounded = weakest.effective >= weakest.ceiling;
    if (isCeilingBounded) {
      return getCeilingBoundedFailure(attribute);
    }
    return getTrainingBoundedFailure(attribute);
  }

  return getGenericFailureNarrative(attribute);
}

function getTrainingBoundedFailure(attribute: string): string {
  const narratives: Record<string, string[]> = {
    charm: [
      "You've got the instincts for it, but the words won't come smoothly. More practice would help.",
      "The approach was right, but your delivery faltered. You need more experience with this.",
    ],
    wit: [
      "You can feel the answer hovering just out of reach. With more practice, you'd have it.",
      "Your mind races but can't quite connect the dots. Training would sharpen this.",
    ],
    courage: [
      "You know what needs to be done, but your body won't cooperate. More preparation is needed.",
      "The spirit is willing, but the technique isn't there yet.",
    ],
    empathy: [
      "You sense what they're feeling but can't quite find the right response. Practice would help.",
      "Your heart is in the right place, but you stumble over the approach.",
    ],
    resolve: [
      "You try to hold firm, but you haven't built the endurance for this. Not yet.",
      "Your determination is there, but the foundation isn't strong enough.",
    ],
    resourcefulness: [
      "You see possibilities but can't quite pull them together. More hands-on experience would help.",
      "The tools are there, but your technique needs work.",
    ],
    skill: [
      "You've got the instincts for it, but you haven't practiced enough.",
      "With more training, this would have gone differently.",
    ],
  };
  const options = narratives[attribute] ?? narratives.skill;
  return options[Math.floor(Math.random() * options.length)];
}

function getCeilingBoundedFailure(attribute: string): string {
  const narratives: Record<string, string[]> = {
    charm: [
      "Your technique is sound, but something deeper holds you back. A fundamental shift is needed.",
      "You do everything right, yet it's not enough. The limitation isn't in your approach.",
    ],
    wit: [
      "You've mastered the method, but hit a wall only deeper understanding can break through.",
      "Your training has taken you as far as it can. Something more fundamental needs to change.",
    ],
    courage: [
      "Your skill is there, but an inner barrier holds you back. This needs more than practice.",
      "Technique alone won't solve this. Something deeper needs to grow.",
    ],
    empathy: [
      "You know the right moves, but true connection requires something practice can't teach.",
      "The approach is correct, but something fundamental is limiting you.",
    ],
    resolve: [
      "Your technique is sound, but something deeper holds you back.",
      "You've plateaued. Breaking through requires growth from within.",
    ],
    resourcefulness: [
      "You've exhausted what technique alone can do. A deeper shift is needed.",
      "Practice has taken you as far as it can. The next step requires inner growth.",
    ],
    skill: [
      "Your technique is sound, but something deeper holds you back.",
      "You've hit a ceiling that only fundamental growth can break through.",
    ],
  };
  const options = narratives[attribute] ?? narratives.skill;
  return options[Math.floor(Math.random() * options.length)];
}

function getGenericFailureNarrative(attribute: string): string {
  const narratives: Record<string, string[]> = {
    charm: [
      "Your words fall flat, met with cold disinterest.",
      "They see right through your attempt at persuasion.",
      "Something in your approach puts them off entirely.",
    ],
    wit: [
      "The answer eludes you, slipping away like smoke.",
      "Your mind races but finds no purchase.",
      "This puzzle proves beyond your current understanding.",
    ],
    courage: [
      "Fear grips you at the crucial moment.",
      "Your nerve fails when it matters most.",
      "The challenge proves more daunting than you anticipated.",
    ],
    empathy: [
      "You misread the situation entirely.",
      "Your attempt at connection only pushes them further away.",
      "You realize too late that you've said the wrong thing.",
    ],
    resolve: [
      "Your will crumbles under the pressure.",
      "The weight of it all proves too much to bear.",
      "Something breaks inside, and you can't push through.",
    ],
    resourcefulness: [
      "Nothing you try seems to work.",
      "Your options run out faster than expected.",
      "The tools you have simply aren't enough.",
    ],
    skill: [
      "Despite your best efforts, things don't go as planned.",
      "The situation slips beyond your control.",
      "Sometimes, even your best isn't enough.",
    ],
  };

  const options = narratives[attribute] ?? narratives.skill;
  return options[Math.floor(Math.random() * options.length)];
}
