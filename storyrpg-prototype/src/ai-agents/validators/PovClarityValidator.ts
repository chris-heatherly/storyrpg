import type { SceneContent } from '../agents/SceneWriter';

export interface PovClarityIssue {
  beatId: string;
  issue: string;
  severity: 'error' | 'warning';
  suggestion: string;
}

export interface PovClarityResult {
  passed: boolean;
  score: number;
  issues: PovClarityIssue[];
  shouldRegenerate: boolean;
  checkedBeatId?: string;
}

export interface PovClarityContext {
  protagonistName?: string;
  characterNames?: string[];
}

const PLAYER_TEMPLATE_RE = /\{\{\s*player\.(?:name|they|them|their|theirs|themselves|are|were|have)\s*\}\}/i;
const SECOND_PERSON_RE = /\b(?:you|your|yours|yourself)\b/i;

export function hasPlayerReference(text: string | undefined | null): boolean {
  if (!text) return false;
  return PLAYER_TEMPLATE_RE.test(text) || SECOND_PERSON_RE.test(text);
}

export class PovClarityValidator {
  validateScene(sceneContent: SceneContent, context: PovClarityContext = {}): PovClarityResult {
    const issues: PovClarityIssue[] = [];
    const firstBeat = (sceneContent.beats || []).find(beat => {
      const text = typeof beat.text === 'string' ? beat.text.trim() : String(beat.text || '').trim();
      return text.length > 0;
    });

    if (!firstBeat) {
      return {
        passed: false,
        score: 0,
        issues: [{
          beatId: sceneContent.startingBeatId || 'unknown',
          issue: 'Scene has no player-facing opening prose beat to anchor POV.',
          severity: 'error',
          suggestion: 'Add an opening beat that places the player character in the scene using you/your or {{player.name}}.',
        }],
        shouldRegenerate: true,
      };
    }

    const openingText = String(firstBeat.text || '');
    const variantTexts = Array.isArray(firstBeat.textVariants)
      ? firstBeat.textVariants.map((variant: { text?: unknown }) => String(variant.text || ''))
      : [];
    const textToCheck = [openingText, ...variantTexts].join('\n');

    if (!hasPlayerReference(textToCheck)) {
      issues.push({
        beatId: firstBeat.id,
        issue: 'Opening beat does not establish the player character as the POV/focal character.',
        severity: 'error',
        suggestion: 'Rewrite the first beat so it anchors the player with you/your or {{player.name}} before focusing on NPCs, setting, or exposition.',
      });
    }

    const characterNames = (context.characterNames || []).filter(Boolean);
    if (characterNames.length >= 2 && this.hasAmbiguousPronounChain(openingText, characterNames, context.protagonistName)) {
      issues.push({
        beatId: firstBeat.id,
        issue: 'Opening beat relies on pronouns while multiple characters are present, making the focal character ambiguous.',
        severity: 'warning',
        suggestion: 'Use {{player.name}} or exact NPC names in the opening beat before using pronouns.',
      });
    }

    // Beat-level POV consistency (gen-5): the original check only inspected the OPENING
    // beat, so a mid-scene payoff beat that flipped into third person ("Kylie hits
    // publish… She wakes to 84,000") in an otherwise second-person scene shipped
    // unflagged. Scan EVERY beat for third-person protagonist narration. Advisory
    // (warning) — it never forces regeneration, so it cannot destabilize a run, but it
    // surfaces the POV break in diagnostics.
    for (const beat of sceneContent.beats || []) {
      const beatText = typeof beat.text === 'string' ? beat.text : String(beat.text || '');
      if (this.isThirdPersonProtagonistNarration(beatText, context.protagonistName)) {
        issues.push({
          beatId: beat.id,
          issue: `Beat narrates the protagonist in the third person ("${context.protagonistName}… she/he…") in a second-person story — a POV break.`,
          severity: 'warning',
          suggestion: 'Rewrite the beat in second person ("you/your"); reserve third-person + pronoun for NPCs only.',
        });
      }
    }

    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const score = Math.max(0, 100 - errorCount * 70 - warningCount * 20);

    return {
      passed: errorCount === 0,
      score,
      issues,
      shouldRegenerate: errorCount > 0,
      checkedBeatId: firstBeat.id,
    };
  }

  /**
   * Scan an arbitrary set of reader-facing texts (e.g. encounter situation beats and
   * outcome storylets, which never live in `sceneContent.beats` and so escape the
   * per-scene beat scan above) for third-person protagonist narration. Returns the
   * offending snippets (deduped, trimmed to a readable length). Used by the final-story
   * pass to catch the encounter-outcome POV break (G10 Bite Me ep1/ep2 wrote whole
   * encounter sub-branches as "Kylie smiles back…" in a second-person story).
   */
  findThirdPersonProtagonistTexts(
    texts: Array<string | undefined | null>,
    protagonistName?: string,
  ): string[] {
    const hits: string[] = [];
    const seen = new Set<string>();
    for (const raw of texts) {
      const text = typeof raw === 'string' ? raw : '';
      if (!text.trim()) continue;
      if (this.isThirdPersonProtagonistNarration(text, protagonistName)) {
        const snippet = text.trim().slice(0, 160);
        if (!seen.has(snippet)) {
          seen.add(snippet);
          hits.push(snippet);
        }
      }
    }
    return hits;
  }

  /**
   * True when a beat narrates the PROTAGONIST in the third person in a second-person
   * story: the protagonist is referenced by name AND a third-person singular pronoun
   * appears, while NO second-person marker ("you/your") is present anywhere in the
   * beat. The absence of any "you" is the load-bearing signal — a beat that addresses
   * the player even once is in-register and not flagged (so an occasional stylized
   * self-naming like "You sign it: Kylie Marinescu" is safe). Heuristic + advisory.
   */
  private isThirdPersonProtagonistNarration(text: string, protagonistName?: string): boolean {
    if (!protagonistName) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    // Any second-person address means the beat is in the house POV — not a break.
    if (hasPlayerReference(trimmed)) return false;
    const names = Array.from(new Set([protagonistName, protagonistName.split(/\s+/)[0]].filter(Boolean)));
    const nameRe = new RegExp(`\\b(?:${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
    if (!nameRe.test(trimmed)) return false;
    // Protagonist named, third-person singular pronoun present, and no "you" anywhere →
    // the protagonist is being narrated in third person.
    return /\b(?:she|he|her|him|his|hers|herself|himself)\b/i.test(trimmed);
  }

  private hasAmbiguousPronounChain(text: string, characterNames: string[], protagonistName?: string): boolean {
    if (hasPlayerReference(text)) return false;

    const pronounHits = text.match(/\b(?:he|him|his|she|her|hers|they|them|their|theirs)\b/gi) || [];
    if (pronounHits.length < 2) return false;

    const lowered = text.toLowerCase();
    const hasNamedCharacter = characterNames.some(name => lowered.includes(name.toLowerCase()));
    const hasProtagonistName = protagonistName ? lowered.includes(protagonistName.toLowerCase()) : false;

    return !hasNamedCharacter && !hasProtagonistName;
  }
}
