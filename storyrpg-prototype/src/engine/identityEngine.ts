/**
 * Identity Engine
 *
 * Aggregates player choices into identity dimensions that evolve over time.
 * This creates a "player personality profile" that:
 * - Emerges naturally from gameplay choices
 * - Unlocks identity-gated dialogue and story options
 * - Lets NPCs react to WHO the player is becoming, not just what they did
 *
 * Tint flags (from dilemma choices) and tags (from expression/relationship choices)
 * are the primary inputs. The engine maps them to identity dimension shifts.
 */

import { IdentityProfile, DEFAULT_IDENTITY_PROFILE, Consequence } from '../types';

/**
 * Mapping from tint flag names to identity dimension shifts.
 * When a tint flag is set, the corresponding dimension shifts.
 */
const TINT_TO_IDENTITY: Record<string, Partial<IdentityProfile>> = {
  // Moral compass tints
  'tint:mercy': { mercy_justice: -15 },
  'tint:justice': { mercy_justice: 15 },
  'tint:forgiveness': { mercy_justice: -10 },
  'tint:punishment': { mercy_justice: 10 },
  'tint:compassion': { mercy_justice: -10, heart_head: -10 },
  'tint:vengeance': { mercy_justice: 15, heart_head: 5 },

  // Idealism vs pragmatism
  'tint:idealism': { idealism_pragmatism: -15 },
  'tint:pragmatism': { idealism_pragmatism: 15 },
  'tint:sacrifice': { idealism_pragmatism: -10 },
  'tint:survival': { idealism_pragmatism: 10 },
  'tint:honor': { idealism_pragmatism: -10, honest_deceptive: -5 },
  'tint:expedience': { idealism_pragmatism: 10, honest_deceptive: 5 },

  // Social style tints
  'tint:caution': { cautious_bold: -15 },
  'tint:boldness': { cautious_bold: 15 },
  'tint:patience': { cautious_bold: -10 },
  'tint:aggression': { cautious_bold: 15 },
  'tint:diplomacy': { cautious_bold: -5, loner_leader: 5 },
  'tint:force': { cautious_bold: 10, heart_head: 5 },

  // Leadership tints
  'tint:independence': { loner_leader: -15 },
  'tint:leadership': { loner_leader: 15 },
  'tint:teamwork': { loner_leader: 10 },
  'tint:solitude': { loner_leader: -10 },

  // Approach tints
  'tint:emotion': { heart_head: -15 },
  'tint:logic': { heart_head: 15 },
  'tint:intuition': { heart_head: -10 },
  'tint:calculation': { heart_head: 10 },

  // Honesty tints
  'tint:honesty': { honest_deceptive: -15 },
  'tint:deception': { honest_deceptive: 15 },
  'tint:truth': { honest_deceptive: -10 },
  'tint:manipulation': { honest_deceptive: 10 },
};

/**
 * Apply identity shifts from a set of consequences.
 * Called after each choice is made.
 */
export function applyIdentityShifts(
  currentProfile: IdentityProfile,
  consequences: Consequence[]
): IdentityProfile {
  const updated = { ...currentProfile };

  for (const consequence of consequences) {
    if (consequence.type === 'setFlag' && consequence.flag && consequence.flag.startsWith('tint:') && consequence.value) {
      const shifts = TINT_TO_IDENTITY[consequence.flag];
      if (shifts) {
        for (const [dimension, shift] of Object.entries(shifts)) {
          const key = dimension as keyof IdentityProfile;
          updated[key] = clamp(updated[key] + (shift as number), -100, 100);
        }
      }
    }

    // Tags also contribute to identity (smaller shifts)
    if (consequence.type === 'addTag') {
      const tagShifts = inferIdentityFromTag((consequence as { tag?: unknown }).tag);
      if (tagShifts) {
        for (const [dimension, shift] of Object.entries(tagShifts)) {
          const key = dimension as keyof IdentityProfile;
          updated[key] = clamp(updated[key] + (shift as number), -100, 100);
        }
      }
    }
  }

  return updated;
}

/**
 * Infer identity shifts from tag names using keyword matching.
 * Tags are smaller identity signals than tints.
 */
function inferIdentityFromTag(tag: unknown): Partial<IdentityProfile> | null {
  if (typeof tag !== 'string') return null;
  const normalizedTag = tag.trim();
  if (!normalizedTag) return null;
  const lower = normalizedTag.toLowerCase();

  // Keyword-based inference (5-point shifts — subtler than tints)
  if (lower.includes('brave') || lower.includes('bold') || lower.includes('reckless')) {
    return { cautious_bold: 5 };
  }
  if (lower.includes('careful') || lower.includes('cautious') || lower.includes('prudent')) {
    return { cautious_bold: -5 };
  }
  if (lower.includes('kind') || lower.includes('gentle') || lower.includes('compassionate')) {
    return { mercy_justice: -5, heart_head: -5 };
  }
  if (lower.includes('stern') || lower.includes('harsh') || lower.includes('ruthless')) {
    return { mercy_justice: 5, heart_head: 5 };
  }
  if (lower.includes('honest') || lower.includes('truthful')) {
    return { honest_deceptive: -5 };
  }
  if (lower.includes('liar') || lower.includes('deceit') || lower.includes('cunning')) {
    return { honest_deceptive: 5 };
  }
  if (lower.includes('leader') || lower.includes('inspire') || lower.includes('rally')) {
    return { loner_leader: 5 };
  }
  if (lower.includes('lone') || lower.includes('solo') || lower.includes('independent')) {
    return { loner_leader: -5 };
  }

  return null;
}

/**
 * Get the dominant identity traits (those furthest from neutral).
 * Returns trait names like "merciful", "bold leader", "pragmatic loner", etc.
 */
export function getDominantTraits(profile: IdentityProfile): string[] {
  const THRESHOLD = 25; // Must be at least this far from center
  const traits: string[] = [];

  if (profile.mercy_justice <= -THRESHOLD) traits.push('merciful');
  if (profile.mercy_justice >= THRESHOLD) traits.push('just');

  if (profile.idealism_pragmatism <= -THRESHOLD) traits.push('idealist');
  if (profile.idealism_pragmatism >= THRESHOLD) traits.push('pragmatist');

  if (profile.cautious_bold <= -THRESHOLD) traits.push('cautious');
  if (profile.cautious_bold >= THRESHOLD) traits.push('bold');

  if (profile.loner_leader <= -THRESHOLD) traits.push('lone wolf');
  if (profile.loner_leader >= THRESHOLD) traits.push('natural leader');

  if (profile.heart_head <= -THRESHOLD) traits.push('heart-driven');
  if (profile.heart_head >= THRESHOLD) traits.push('analytical');

  if (profile.honest_deceptive <= -THRESHOLD) traits.push('forthright');
  if (profile.honest_deceptive >= THRESHOLD) traits.push('cunning');

  return traits;
}

/**
 * Check if a player's identity profile meets a condition.
 * Used for identity-gated choices.
 *
 * Example: identityMeetsCondition(profile, 'mercy_justice', '<', -20)
 * → true if the player is more merciful than -20
 */
export function identityMeetsCondition(
  profile: IdentityProfile,
  dimension: keyof IdentityProfile,
  operator: '<' | '>' | '<=' | '>=' | '==' | '!=',
  threshold: number
): boolean {
  const value = profile[dimension];
  switch (operator) {
    case '<': return value < threshold;
    case '>': return value > threshold;
    case '<=': return value <= threshold;
    case '>=': return value >= threshold;
    case '==': return value === threshold;
    case '!=': return value !== threshold;
  }
}

/**
 * Create a fresh identity profile.
 */
export function createIdentityProfile(): IdentityProfile {
  return { ...DEFAULT_IDENTITY_PROFILE };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
