import {
  PlayerState,
  PlayerAttributes,
  ResolutionResult,
  ResolutionTier,
} from '../types';

/**
 * Fiction-First Resolution Engine
 *
 * This system resolves stat checks without showing players any numbers.
 * Instead, outcomes are expressed purely through narrative.
 *
 * Three tiers of outcomes:
 * - Success: Clear victory, player achieves their goal
 * - Complicated: Partial success with a cost or twist
 * - Failure: Interesting failure that moves story forward
 */

interface StatCheckParams {
  attribute?: keyof PlayerAttributes;
  skill?: string;
  difficulty: number; // 1-100 scale
}

/**
 * Performs a fiction-first resolution check.
 * The result includes the tier and a narrative description,
 * but no visible numbers.
 */
export function resolveStatCheck(
  player: PlayerState,
  check: StatCheckParams
): ResolutionResult {
  // Calculate the player's effective stat
  let playerStat = 50; // Base

  if (check.attribute) {
    playerStat = player.attributes[check.attribute];
  }

  if (check.skill) {
    const skillBonus = player.skills[check.skill] ?? 0;
    playerStat = Math.min(100, playerStat + skillBonus);
  }

  // Add some randomness (hidden from player)
  const roll = Math.random() * 100;

  // Calculate target based on difficulty and player stat
  // Higher stat = lower target needed
  const statModifier = (playerStat - 50) * 0.5; // -25 to +25 modifier
  const target = check.difficulty - statModifier;

  // Determine tier
  const margin = target - roll;
  let tier: ResolutionTier;

  if (roll <= target - 20) {
    // Clear success (beat target by 20+)
    tier = 'success';
  } else if (roll <= target + 10) {
    // Complicated success (within 10 of target)
    tier = 'complicated';
  } else {
    // Failure
    tier = 'failure';
  }

  return {
    tier,
    roll,
    target,
    margin,
    narrativeText: generateNarrativeText(tier, check),
  };
}

/**
 * Generates narrative text to describe the result.
 * This is the "fiction-first" part - players only see this text,
 * never the underlying numbers.
 */
function generateNarrativeText(
  tier: ResolutionTier,
  check: StatCheckParams
): string {
  // These are generic fallbacks. In practice, each choice would have
  // custom narrative text for each tier defined in the story content.

  const attribute = check.attribute ?? 'skill';

  switch (tier) {
    case 'success':
      return getSuccessNarrative(attribute);
    case 'complicated':
      return getComplicatedNarrative(attribute);
    case 'failure':
      return getFailureNarrative(attribute);
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

function getFailureNarrative(attribute: string): string {
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

/**
 * Utility to calculate success chance (for internal use only, never shown to players)
 */
export function calculateSuccessChance(
  player: PlayerState,
  check: StatCheckParams
): number {
  let playerStat = 50;

  if (check.attribute) {
    playerStat = player.attributes[check.attribute];
  }

  if (check.skill) {
    const skillBonus = player.skills[check.skill] ?? 0;
    playerStat = Math.min(100, playerStat + skillBonus);
  }

  const statModifier = (playerStat - 50) * 0.5;
  const effectiveTarget = check.difficulty - statModifier;

  // Chance to get at least complicated success
  return Math.max(0, Math.min(100, 100 - (effectiveTarget - 10)));
}

/**
 * Compute outcome tier weights for encounter choices, factoring in player stats.
 *
 * If the choice has a primarySkill that maps to a player attribute or skill,
 * the weights shift: higher skill → more success, lower → more failure.
 * The shift is subtle (fiction-first) — the player never sees numbers.
 *
 * Returns { success, complicated, failure } that sum to 1.0.
 */
export function computeEncounterWeights(
  player: PlayerState,
  primarySkill?: string,
  effectiveStatBonus: number = 0
): { success: number; complicated: number; failure: number } {
  // Base weights when player has no particular advantage
  const BASE_SUCCESS = 0.40;
  const BASE_COMPLICATED = 0.35;
  const BASE_FAILURE = 0.25;

  if (!primarySkill && effectiveStatBonus === 0) {
    return { success: BASE_SUCCESS, complicated: BASE_COMPLICATED, failure: BASE_FAILURE };
  }

  // Look up the skill as an attribute first, then as a skill bonus
  const attributeNames = ['charm', 'wit', 'courage', 'empathy', 'resolve', 'resourcefulness'];
  let playerStat = 50; // Neutral baseline

  if (primarySkill) {
    const normalizedSkill = primarySkill.toLowerCase().trim();

    if (attributeNames.includes(normalizedSkill)) {
      playerStat = player.attributes[normalizedSkill as keyof PlayerAttributes] ?? 50;
    } else {
      // Check skills map
      const skillValue = player.skills[normalizedSkill] ?? player.skills[primarySkill] ?? 0;
      playerStat = Math.min(100, 50 + skillValue);
    }
  }

  // Apply stat bonus from pre-encounter state payoff (capped to prevent trivialisation)
  playerStat = Math.min(100, playerStat + effectiveStatBonus);

  // Compute modifier: -0.15 to +0.15 based on stat (50 = neutral)
  const modifier = ((playerStat - 50) / 50) * 0.15;

  // Shift weights: higher stat → more success, less failure
  let success = Math.max(0.10, Math.min(0.65, BASE_SUCCESS + modifier));
  let failure = Math.max(0.05, Math.min(0.50, BASE_FAILURE - modifier));
  let complicated = 1.0 - success - failure;

  // Safety clamp
  if (complicated < 0.10) {
    complicated = 0.10;
    const excess = success + failure + complicated - 1.0;
    success -= excess / 2;
    failure -= excess / 2;
  }

  return { success, complicated, failure };
}
