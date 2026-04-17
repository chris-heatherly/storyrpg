/**
 * Incremental Validators
 * 
 * Lightweight validators for per-scene/per-choice validation during content generation.
 * These run during Phase 4 (Content Generation) to catch issues early and trigger
 * regeneration when needed, rather than waiting until end-of-pipeline QA.
 * 
 * Validators included:
 * - IncrementalVoiceValidator: Checks character voice consistency per scene
 * - IncrementalStakesValidator: Checks choice quality and false choices
 * - IncrementalSensitivityChecker: Flags content rating concerns
 * - IncrementalContinuityChecker: Catches undefined flags/scores
 * - IncrementalValidationRunner: Orchestrates all validators per scene
 */

import { BaseValidator, ValidationIssue, IssueSeverity } from './BaseValidator';
import { SceneContent, GeneratedBeat } from '../agents/SceneWriter';
import { ChoiceSet, GeneratedChoice } from '../agents/ChoiceAuthor';
import { VoiceProfile } from '../agents/CharacterDesigner';
import { EncounterStructure } from '../agents/EncounterArchitect';
import { getEncounterBeats } from '../utils/encounterImageCoverage';

// ============================================
// TYPES AND INTERFACES
// ============================================

export interface IncrementalVoiceIssue {
  beatId: string;
  characterId: string;
  characterName: string;
  issue: string;
  severity: 'error' | 'warning';
  suggestion?: string;
}

export interface IncrementalVoiceResult {
  passed: boolean;
  score: number; // 0-100
  issues: IncrementalVoiceIssue[];
  shouldRegenerate: boolean;
  checkedDialogueCount: number;
}

export interface IncrementalStakesIssue {
  choiceId: string;
  issue: string;
  severity: 'error' | 'warning';
  suggestion?: string;
}

export interface IncrementalStakesResult {
  passed: boolean;
  score: number;
  issues: IncrementalStakesIssue[];
  shouldRegenerate: boolean;
  hasFalseChoices: boolean;
}

export interface SensitivityFlag {
  category: 'violence' | 'language' | 'sexual' | 'substance' | 'discrimination' | 'trauma';
  severity: 'mild' | 'moderate' | 'strong';
  location: { beatId: string; sceneId?: string };
  excerpt: string;
  context?: string;
}

export interface IncrementalSensitivityResult {
  passed: boolean;
  flags: SensitivityFlag[];
  ratingImplication?: 'E' | 'T' | 'M' | 'AO';
  highestSeverity: 'none' | 'mild' | 'moderate' | 'strong';
}

export interface ContinuityIssue {
  type: 'undefined_flag' | 'undefined_score' | 'impossible_state' | 'missing_prerequisite' | 'forward_reference';
  detail: string;
  severity: 'error' | 'warning';
  location?: string;
}

export interface IncrementalContinuityResult {
  passed: boolean;
  issues: ContinuityIssue[];
  trackedFlags: string[];
  trackedScores: string[];
}

export interface EncounterValidationIssue {
  type: 'missing_beats' | 'missing_choices' | 'invalid_skill' | 'missing_outcome' | 'invalid_partial_victory' | 'missing_relationship_payoff';
  detail: string;
  severity: 'error' | 'warning';
}

export interface IncrementalEncounterResult {
  passed: boolean;
  issues: EncounterValidationIssue[];
  beatCount: number;
  hasVictoryPath: boolean;
  hasPartialVictoryPath: boolean;
  hasDefeatPath: boolean;
}

export interface IncrementalValidationConfig {
  voiceValidation: boolean;
  stakesValidation: boolean;
  sensitivityCheck: boolean;
  continuityCheck: boolean;
  encounterValidation: boolean;
  voiceRegenerationThreshold: number;
  stakesRegenerationThreshold: number;
  maxRegenerationAttempts: number;
  targetRating: 'E' | 'T' | 'M';
}

export const DEFAULT_INCREMENTAL_CONFIG: IncrementalValidationConfig = {
  voiceValidation: true,
  stakesValidation: true,
  sensitivityCheck: true,
  continuityCheck: true,
  encounterValidation: true,
  voiceRegenerationThreshold: 50,
  stakesRegenerationThreshold: 60,
  maxRegenerationAttempts: 2,
  targetRating: 'T',
};

export interface CharacterVoiceProfile {
  id: string;
  name: string;
  voiceProfile: VoiceProfile;
}

export interface SceneValidationResult {
  sceneId: string;
  sceneName: string;
  voice?: IncrementalVoiceResult;
  stakes?: IncrementalStakesResult;
  sensitivity?: IncrementalSensitivityResult;
  continuity?: IncrementalContinuityResult;
  encounter?: IncrementalEncounterResult;
  overallPassed: boolean;
  regenerationRequested: 'scene' | 'choices' | 'encounter' | 'none';
  validationTimeMs: number;
}

// ============================================
// INCREMENTAL VOICE VALIDATOR
// ============================================

export class IncrementalVoiceValidator extends BaseValidator {
  private regenerationThreshold: number;

  constructor(regenerationThreshold = 50) {
    super('IncrementalVoiceValidator');
    this.regenerationThreshold = regenerationThreshold;
  }

  /**
   * Quick voice check for a single scene's content.
   * Uses heuristics for fast validation without LLM calls.
   */
  validateScene(
    sceneContent: SceneContent,
    characterProfiles: CharacterVoiceProfile[]
  ): IncrementalVoiceResult {
    const issues: IncrementalVoiceIssue[] = [];
    let checkedDialogueCount = 0;

    for (const beat of sceneContent.beats) {
      if (!beat.speaker) continue;
      checkedDialogueCount++;

      const profile = characterProfiles.find(
        p => p.id === beat.speaker || p.name === beat.speaker
      );
      if (!profile) continue;

      const voiceIssues = this.checkVoiceConsistency(beat, profile);
      issues.push(...voiceIssues);
    }

    // Calculate score based on issues vs dialogue count
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const issueWeight = errorCount * 25 + warningCount * 10;
    const score = Math.max(0, 100 - (issueWeight / Math.max(1, checkedDialogueCount)) * 10);

    return {
      passed: score >= this.regenerationThreshold,
      score: Math.round(score),
      issues,
      shouldRegenerate: score < this.regenerationThreshold && errorCount > 0,
      checkedDialogueCount,
    };
  }

  private checkVoiceConsistency(
    beat: GeneratedBeat,
    profile: CharacterVoiceProfile
  ): IncrementalVoiceIssue[] {
    const issues: IncrementalVoiceIssue[] = [];
    const text = beat.text;
    const voice = profile.voiceProfile;

    // Check vocabulary level
    const avgWordLength = this.calculateAvgWordLength(text);
    const vocabMismatch = this.checkVocabularyMismatch(avgWordLength, voice.vocabulary);
    if (vocabMismatch) {
      issues.push({
        beatId: beat.id,
        characterId: profile.id,
        characterName: profile.name,
        issue: vocabMismatch,
        severity: 'warning',
        suggestion: `Adjust vocabulary to match ${profile.name}'s ${voice.vocabulary} speech pattern`,
      });
    }

    // Check formality level
    const formalityIssue = this.checkFormalityMismatch(text, voice.formality);
    if (formalityIssue) {
      issues.push({
        beatId: beat.id,
        characterId: profile.id,
        characterName: profile.name,
        issue: formalityIssue,
        severity: 'warning',
        suggestion: `Adjust formality to match ${profile.name}'s ${voice.formality} style`,
      });
    }

    // Check sentence length pattern
    const sentenceLengthIssue = this.checkSentenceLengthMismatch(text, voice.sentenceLength);
    if (sentenceLengthIssue) {
      issues.push({
        beatId: beat.id,
        characterId: profile.id,
        characterName: profile.name,
        issue: sentenceLengthIssue,
        severity: 'warning',
        suggestion: `${profile.name} typically speaks in ${voice.sentenceLength} sentences`,
      });
    }

    // Check for avoided words
    const avoidedWordsFound = this.findAvoidedWords(text, voice.avoidedWords);
    if (avoidedWordsFound.length > 0) {
      issues.push({
        beatId: beat.id,
        characterId: profile.id,
        characterName: profile.name,
        issue: `${profile.name} uses words they would avoid: "${avoidedWordsFound.join('", "')}"`,
        severity: 'error',
        suggestion: `Remove or replace: ${avoidedWordsFound.join(', ')}`,
      });
    }

    return issues;
  }

  private calculateAvgWordLength(text: string): number {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return 0;
    return words.reduce((sum, w) => sum + w.replace(/[^\w]/g, '').length, 0) / words.length;
  }

  private checkVocabularyMismatch(
    avgWordLength: number,
    vocabulary: VoiceProfile['vocabulary']
  ): string | null {
    switch (vocabulary) {
      case 'simple':
        if (avgWordLength > 6.5) {
          return `Vocabulary too complex for simple speaker (avg word length: ${avgWordLength.toFixed(1)})`;
        }
        break;
      case 'street':
        if (avgWordLength > 6) {
          return `Vocabulary too formal for street speaker (avg word length: ${avgWordLength.toFixed(1)})`;
        }
        break;
      case 'technical':
      case 'educated':
        if (avgWordLength < 4) {
          return `Vocabulary too simple for ${vocabulary} speaker (avg word length: ${avgWordLength.toFixed(1)})`;
        }
        break;
      case 'poetic':
        // Poetic can vary widely, harder to validate
        break;
    }
    return null;
  }

  private checkFormalityMismatch(text: string, formality: VoiceProfile['formality']): string | null {
    const hasContractions = /\b(don't|won't|can't|didn't|isn't|aren't|wasn't|weren't|couldn't|wouldn't|shouldn't|I'm|you're|we're|they're|it's|that's|what's|here's|there's|let's)\b/i.test(text);
    const hasSlang = /\b(gonna|wanna|gotta|kinda|sorta|yeah|nah|yep|nope|dunno|lemme|gimme)\b/i.test(text);
    const hasFormalPhrases = /\b(therefore|furthermore|however|nevertheless|consequently|indeed|perhaps|certainly|absolutely)\b/i.test(text);

    switch (formality) {
      case 'formal':
        if (hasContractions && text.length > 50) {
          return 'Formal speaker uses contractions in extended dialogue';
        }
        if (hasSlang) {
          return 'Formal speaker uses slang';
        }
        break;
      case 'casual':
        if (hasFormalPhrases && !hasContractions && text.length > 100) {
          return 'Casual speaker sounds too formal (no contractions, formal phrases)';
        }
        break;
    }
    return null;
  }

  private checkSentenceLengthMismatch(
    text: string,
    sentenceLength: VoiceProfile['sentenceLength']
  ): string | null {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length === 0) return null;

    const avgSentenceLength = sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length;

    switch (sentenceLength) {
      case 'terse':
        if (avgSentenceLength > 12) {
          return `Terse speaker has long sentences (avg ${avgSentenceLength.toFixed(1)} words)`;
        }
        break;
      case 'verbose':
        if (avgSentenceLength < 8 && sentences.length > 1) {
          return `Verbose speaker has short sentences (avg ${avgSentenceLength.toFixed(1)} words)`;
        }
        break;
    }
    return null;
  }

  private findAvoidedWords(text: string, avoidedWords: string[]): string[] {
    const found: string[] = [];
    const lowerText = text.toLowerCase();

    for (const word of avoidedWords) {
      const pattern = new RegExp(`\\b${word.toLowerCase()}\\b`);
      if (pattern.test(lowerText)) {
        found.push(word);
      }
    }

    return found;
  }
}

// ============================================
// INCREMENTAL STAKES VALIDATOR
// ============================================

export class IncrementalStakesValidator extends BaseValidator {
  private regenerationThreshold: number;

  constructor(regenerationThreshold = 60) {
    super('IncrementalStakesValidator');
    this.regenerationThreshold = regenerationThreshold;
  }

  /**
   * Quick stakes check for a single choice set.
   * Detects false choices, obvious answers, and weak stakes.
   */
  validateChoiceSet(choiceSet: ChoiceSet): IncrementalStakesResult {
    const issues: IncrementalStakesIssue[] = [];
    let hasFalseChoices = false;

    // Check minimum choice count
    if (choiceSet.choices.length < 2) {
      issues.push({
        choiceId: choiceSet.beatId,
        issue: 'Less than 2 choices - not a real choice',
        severity: 'error',
        suggestion: 'Add at least one more meaningful option',
      });
    }

    // Check for false choices (all lead to same scene)
    const nextScenes = new Set(
      choiceSet.choices.map(c => c.nextSceneId).filter(Boolean)
    );
    if (nextScenes.size === 1 && choiceSet.choices.length > 1) {
      issues.push({
        choiceId: choiceSet.beatId,
        issue: 'All choices lead to the same scene - potential false choice',
        severity: 'warning',
        suggestion: 'Ensure choices have different narrative consequences even if they converge',
      });
    }

    // Check for identical consequences
    const consequenceSigs = choiceSet.choices.map(c =>
      JSON.stringify((c.consequences || []).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
    );
    const uniqueConsequences = new Set(consequenceSigs);
    if (uniqueConsequences.size === 1 && choiceSet.choices.length > 1 && consequenceSigs[0] !== '[]') {
      issues.push({
        choiceId: choiceSet.beatId,
        issue: 'All choices have identical consequences - false choice detected',
        severity: 'error',
        suggestion: 'Give each choice distinct consequences',
      });
      hasFalseChoices = true;
    }

    // Check if choices with no consequences AND same destination
    const noConsequencesSameDestination = choiceSet.choices.every(
      c => (!c.consequences || c.consequences.length === 0)
    ) && nextScenes.size <= 1;
    if (noConsequencesSameDestination && choiceSet.choices.length > 1) {
      issues.push({
        choiceId: choiceSet.beatId,
        issue: 'Choices have no consequences and same destination - completely false choice',
        severity: 'error',
        suggestion: 'Add consequences or different destinations to make choices meaningful',
      });
      hasFalseChoices = true;
    }

    // Check stakes triangle
    const stakes = choiceSet.overallStakes;
    if (stakes) {
      const stakesPresent = [
        stakes.want && stakes.want.trim().length > 0,
        stakes.cost && stakes.cost.trim().length > 0,
        stakes.identity && stakes.identity.trim().length > 0,
      ].filter(Boolean).length;

      if (stakesPresent < 2) {
        issues.push({
          choiceId: choiceSet.beatId,
          issue: `Weak stakes triangle: only ${stakesPresent}/3 elements defined`,
          severity: 'warning',
          suggestion: 'Define clear Want, Cost, and Identity stakes for this choice',
        });
      }
    }

    // Check for very short choice text
    for (const choice of choiceSet.choices) {
      if (choice.text.length < 10) {
        issues.push({
          choiceId: choice.id,
          issue: `Choice text too short: "${choice.text}" (${choice.text.length} chars)`,
          severity: 'warning',
          suggestion: 'Expand choice text to be more descriptive and engaging',
        });
      }

      // Check for duplicate choice text
      const duplicates = choiceSet.choices.filter(
        c => c.id !== choice.id && c.text.toLowerCase() === choice.text.toLowerCase()
      );
      if (duplicates.length > 0) {
        issues.push({
          choiceId: choice.id,
          issue: `Duplicate choice text: "${choice.text}"`,
          severity: 'error',
          suggestion: 'Each choice must have unique text',
        });
      }
    }

    // Check for "obvious right answer" patterns
    const obviousPatterns = this.detectObviousAnswer(choiceSet);
    if (obviousPatterns) {
      issues.push({
        choiceId: choiceSet.beatId,
        issue: obviousPatterns,
        severity: 'warning',
        suggestion: 'Rebalance choices so no option is obviously "correct"',
      });
    }

    // Calculate score
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const score = Math.max(0, 100 - (errorCount * 30) - (warningCount * 10));

    return {
      passed: score >= this.regenerationThreshold,
      score,
      issues,
      shouldRegenerate: errorCount > 0,
      hasFalseChoices,
    };
  }

  private detectObviousAnswer(choiceSet: ChoiceSet): string | null {
    // Check if one choice has dramatically more positive consequences
    const positivePatterns = ['gain', 'receive', 'reward', 'bonus', 'increase', 'improve'];
    const negativePatterns = ['lose', 'penalty', 'damage', 'decrease', 'harm', 'risk'];

    const choiceScores = choiceSet.choices.map(choice => {
      const text = choice.text.toLowerCase();
      const consequenceText = JSON.stringify(choice.consequences || []).toLowerCase();
      const combined = text + ' ' + consequenceText;

      let score = 0;
      positivePatterns.forEach(p => { if (combined.includes(p)) score++; });
      negativePatterns.forEach(p => { if (combined.includes(p)) score--; });
      return score;
    });

    const maxScore = Math.max(...choiceScores);
    const minScore = Math.min(...choiceScores);

    if (maxScore - minScore >= 3 && choiceScores.filter(s => s === maxScore).length === 1) {
      return 'One choice appears obviously better than others (positive language imbalance)';
    }

    return null;
  }
}

// ============================================
// INCREMENTAL SENSITIVITY CHECKER
// ============================================

export class IncrementalSensitivityChecker extends BaseValidator {
  private targetRating: 'E' | 'T' | 'M';

  // Keyword patterns for quick detection
  private readonly patterns = {
    violence: {
      mild: /\b(hit|punch|kick|fight|struggle|shove|push|slap|bruise)\b/gi,
      moderate: /\b(blood|wound|stab|slash|beat|batter|bleed|cut|injure|break)\b/gi,
      strong: /\b(gore|mutilate|dismember|torture|execute|massacre|maim|eviscerate|decapitate)\b/gi,
    },
    language: {
      mild: /\b(damn|hell|crap|ass|butt)\b/gi,
      moderate: /\b(bastard|bitch|shit|piss)\b/gi,
      strong: /\b(fuck|cock|cunt|motherfuck)/gi,
    },
    substance: {
      mild: /\b(drink|drunk|beer|wine|alcohol|tipsy|buzz)\b/gi,
      moderate: /\b(drugs|high|stoned|wasted|pills|joint|smoke)\b/gi,
      strong: /\b(heroin|cocaine|meth|overdose|needle|inject|snort)\b/gi,
    },
    sexual: {
      mild: /\b(kiss|embrace|attracted|romantic|flirt)\b/gi,
      moderate: /\b(sensual|passion|desire|intimate|seductive|undress)\b/gi,
      strong: /\b(explicit|erotic|orgasm|naked|nude|genitals)\b/gi,
    },
    trauma: {
      mild: /\b(worried|scared|afraid|anxious|nightmare)\b/gi,
      moderate: /\b(panic|terror|flashback|trigger|trauma|abuse)\b/gi,
      strong: /\b(suicide|self-harm|assault|rape|molest)\b/gi,
    },
  };

  constructor(targetRating: 'E' | 'T' | 'M' = 'T') {
    super('IncrementalSensitivityChecker');
    this.targetRating = targetRating;
  }

  /**
   * Quick content scan for a single scene.
   * Flags potential rating issues early.
   */
  checkScene(sceneContent: SceneContent): IncrementalSensitivityResult {
    const flags: SensitivityFlag[] = [];
    let highestSeverity: 'none' | 'mild' | 'moderate' | 'strong' = 'none';

    for (const beat of sceneContent.beats) {
      const text = beat.text;

      // Check each category
      for (const [category, severityPatterns] of Object.entries(this.patterns)) {
        for (const [severity, pattern] of Object.entries(severityPatterns)) {
          const matches = text.match(pattern);
          if (matches && matches.length > 0) {
            // Avoid flagging the same word multiple times
            const uniqueMatches = [...new Set(matches.map(m => m.toLowerCase()))];
            
            for (const match of uniqueMatches) {
              flags.push({
                category: category as SensitivityFlag['category'],
                severity: severity as SensitivityFlag['severity'],
                location: { beatId: beat.id, sceneId: sceneContent.sceneId },
                excerpt: match,
                context: this.extractContext(text, match),
              });
            }

            // Track highest severity
            if (severity === 'strong') highestSeverity = 'strong';
            else if (severity === 'moderate' && highestSeverity !== 'strong') highestSeverity = 'moderate';
            else if (severity === 'mild' && highestSeverity === 'none') highestSeverity = 'mild';
          }
        }
      }
    }

    // Determine rating implication
    let ratingImplication: IncrementalSensitivityResult['ratingImplication'];
    if (highestSeverity === 'strong') ratingImplication = 'M';
    else if (highestSeverity === 'moderate') ratingImplication = 'T';
    else ratingImplication = 'E';

    // Check if it exceeds target
    const ratingOrder = { 'E': 0, 'T': 1, 'M': 2, 'AO': 3 };
    const passed = ratingOrder[ratingImplication] <= ratingOrder[this.targetRating];

    return {
      passed,
      flags,
      ratingImplication: passed ? undefined : ratingImplication,
      highestSeverity,
    };
  }

  private extractContext(text: string, match: string): string {
    const index = text.toLowerCase().indexOf(match.toLowerCase());
    if (index === -1) return '';

    const start = Math.max(0, index - 30);
    const end = Math.min(text.length, index + match.length + 30);
    let context = text.substring(start, end);

    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';

    return context;
  }
}

// ============================================
// INCREMENTAL CONTINUITY CHECKER
// ============================================

export class IncrementalContinuityChecker extends BaseValidator {
  private knownFlags: Set<string>;
  private knownScores: Set<string>;
  private setFlags: Set<string>;
  private modifiedScores: Set<string>;

  // Relationship tracking: initial baselines and accumulated positive deltas.
  // For each npcId+dimension we track the initial value and the sum of all
  // observed positive changes from prior-scene consequences.  This lets us
  // compute an upper-bound "max achievable" value to catch unreachable
  // relationship conditions.
  private relationshipBaselines: Map<string, number>; // "npcId:dimension" -> initial value
  private relationshipMaxGains: Map<string, number>;  // "npcId:dimension" -> sum of positive changes

  constructor(
    knownFlags: string[] = [],
    knownScores: string[] = []
  ) {
    super('IncrementalContinuityChecker');
    this.knownFlags = new Set(knownFlags);
    this.knownScores = new Set(knownScores);
    this.setFlags = new Set();
    this.modifiedScores = new Set();
    this.relationshipBaselines = new Map();
    this.relationshipMaxGains = new Map();
  }

  /**
   * Set the initial relationship baselines from story NPC definitions.
   * Call once at pipeline init before any scenes are processed.
   */
  setRelationshipBaselines(
    npcs: Array<{ id: string; initialRelationship?: Partial<Record<string, number>> }>
  ): void {
    for (const npc of npcs) {
      for (const dim of ['trust', 'affection', 'respect', 'fear'] as const) {
        const key = `${npc.id}:${dim}`;
        this.relationshipBaselines.set(key, npc.initialRelationship?.[dim] ?? 0);
      }
    }
  }

  /**
   * Track a relationship change from a scene consequence.
   * Only positive changes are accumulated (we compute an optimistic upper bound).
   */
  trackRelationshipChange(npcId: string, dimension: string, change: number): void {
    const key = `${npcId}:${dimension}`;
    if (change > 0) {
      this.relationshipMaxGains.set(key, (this.relationshipMaxGains.get(key) ?? 0) + change);
    }
  }

  /**
   * Compute the maximum value a relationship dimension could have reached
   * given initial baselines + all observed positive changes from prior scenes.
   */
  getRelationshipUpperBound(npcId: string, dimension: string): number {
    const key = `${npcId}:${dimension}`;
    const base = this.relationshipBaselines.get(key) ?? 0;
    const gains = this.relationshipMaxGains.get(key) ?? 0;
    return base + gains;
  }

  /**
   * Check whether a comparison against the upper bound is always false.
   */
  private isComparisonUnreachable(upperBound: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case '>':  return upperBound <= threshold;
      case '>=': return upperBound < threshold;
      case '==': return upperBound < threshold; // if upper bound can't reach it, == can never be true
      case '!=': return false; // always satisfiable since 0 != almost anything
      case '<':  return false; // initial value is ≤ upperBound, so < is usually met when upperBound is low
      case '<=': return false;
      default:   return false;
    }
  }

  /**
   * Track that a flag has been set (call after processing consequences)
   */
  trackFlagSet(flagName: string): void {
    this.setFlags.add(flagName);
  }

  /**
   * Track that a score has been modified
   */
  trackScoreModified(scoreName: string): void {
    this.modifiedScores.add(scoreName);
  }

  /**
   * Add a flag to the known set (for dynamically discovered flags)
   */
  addKnownFlag(flagName: string): void {
    this.knownFlags.add(flagName);
  }

  /**
   * Add a score to the known set
   */
  addKnownScore(scoreName: string): void {
    this.knownScores.add(scoreName);
  }

  /**
   * Check a scene's content for continuity issues.
   * Focuses on state references that don't exist.
   */
  checkScene(
    sceneContent: SceneContent,
    choiceSet?: ChoiceSet
  ): IncrementalContinuityResult {
    const issues: ContinuityIssue[] = [];

    // Check choice consequences reference valid flags/scores
    if (choiceSet) {
      for (const choice of choiceSet.choices) {
        if (choice.consequences) {
          for (const consequence of choice.consequences) {
            if (consequence.type === 'setFlag') {
              const flagName = (consequence as { flag: string }).flag;
              this.setFlags.add(flagName);
            }

            if ((consequence.type as string) === 'modifyScore' || consequence.type === 'changeScore' || consequence.type === 'setScore') {
              const scoreName = (consequence as { score: string }).score;
              if (!this.knownScores.has(scoreName)) {
                issues.push({
                  type: 'undefined_score',
                  detail: `Choice "${choice.text.substring(0, 30)}..." modifies undefined score: ${scoreName}`,
                  severity: 'warning',
                  location: `choice:${choice.id}`,
                });
              }
              this.modifiedScores.add(scoreName);
            }
          }
        }

        // Check conditions (plural, ConditionExpression object) reference valid flags
        const conditions = (choice as any).conditions ?? (choice as any).condition;
        if (conditions) {
          if (typeof conditions === 'string') {
            this.checkConditionString(conditions, issues, `choice:${choice.id}`);
          } else {
            this.checkConditionExpression(conditions, issues, `choice:${choice.id}`);
          }
        }
      }
    }

    // Check beat conditions
    for (const beat of sceneContent.beats) {
      if (beat.onShow) {
        for (const consequence of beat.onShow) {
          if (consequence.type === 'setFlag') {
            const flagName = (consequence as { flag: string }).flag;
            this.setFlags.add(flagName);
          }
        }
      }
    }

    const allTrackedFlags = [...this.knownFlags, ...this.setFlags];
    const allTrackedScores = [...this.knownScores, ...this.modifiedScores];

    return {
      passed: !issues.some(i => i.severity === 'error'),
      issues,
      trackedFlags: allTrackedFlags,
      trackedScores: allTrackedScores,
    };
  }

  /**
   * Walk a typed ConditionExpression tree and report flag/score issues.
   * Handles: flag, score, and/or/not compounds, and legacy string/object forms.
   */
  checkConditionExpression(
    expr: unknown,
    issues: ContinuityIssue[],
    location: string
  ): void {
    if (!expr || typeof expr !== 'object') {
      if (typeof expr === 'string') {
        this.checkConditionString(expr, issues, location);
      }
      return;
    }

    const obj = expr as Record<string, unknown>;
    const type = obj.type as string | undefined;

    switch (type) {
      case 'flag': {
        const flagName = obj.flag as string;
        if (flagName && !this.knownFlags.has(flagName) && !this.setFlags.has(flagName)) {
          issues.push({
            type: 'forward_reference',
            detail: `Flag condition references "${flagName}" which has not been set by any prior scene`,
            severity: 'error',
            location,
          });
        }
        break;
      }
      case 'score': {
        const scoreName = obj.score as string;
        if (scoreName && !this.knownScores.has(scoreName) && !this.modifiedScores.has(scoreName)) {
          issues.push({
            type: 'undefined_score',
            detail: `Condition references undefined score: ${scoreName}`,
            severity: 'warning',
            location,
          });
        }
        break;
      }
      case 'and':
      case 'or': {
        const children = obj.conditions;
        if (Array.isArray(children)) {
          for (const child of children) {
            this.checkConditionExpression(child, issues, location);
          }
        }
        break;
      }
      case 'not': {
        if (obj.condition) {
          this.checkConditionExpression(obj.condition, issues, location);
        }
        break;
      }
      case 'relationship': {
        const npcId = obj.npcId as string;
        const dimension = obj.dimension as string;
        const operator = obj.operator as string;
        const value = obj.value as number;
        if (npcId && dimension && operator && typeof value === 'number') {
          const upperBound = this.getRelationshipUpperBound(npcId, dimension);
          const unreachable = this.isComparisonUnreachable(upperBound, operator, value);
          if (unreachable) {
            issues.push({
              type: 'forward_reference',
              detail: `Relationship condition "${npcId}.${dimension} ${operator} ${value}" is unreachable (max achievable: ${upperBound})`,
              severity: 'error',
              location,
            });
          }
        }
        break;
      }
      // attribute, skill, tag, item, identity — no chronology check needed.
      default: {
        // Legacy: single-key boolean object like { some_flag: true }
        if (!type) {
          const keys = Object.keys(obj);
          if (keys.length === 1 && typeof obj[keys[0]] === 'boolean') {
            const flagName = keys[0];
            if (!this.knownFlags.has(flagName) && !this.setFlags.has(flagName)) {
              issues.push({
                type: 'forward_reference',
                detail: `Flag condition references "${flagName}" which has not been set by any prior scene`,
                severity: 'error',
                location,
              });
            }
          }
        }
        break;
      }
    }
  }

  /**
   * Validate encounter choice conditions against the current flag state.
   * Walks all beats and their nested outcome trees to check conditions and statBonus.
   */
  checkEncounterChoiceConditions(
    encounter: EncounterStructure
  ): ContinuityIssue[] {
    const issues: ContinuityIssue[] = [];
    this.walkEncounterChoices(encounter.beats, issues, encounter.sceneId);
    return issues;
  }

  private walkEncounterChoices(
    beats: EncounterStructure['beats'],
    issues: ContinuityIssue[],
    sceneId: string
  ): void {
    for (const beat of beats) {
      if (!beat.choices) continue;
      for (const choice of beat.choices) {
        const loc = `encounter:${sceneId}:${beat.id}:${choice.id}`;

        if (choice.conditions) {
          this.checkConditionExpression(choice.conditions, issues, loc);
        }
        if (choice.statBonus?.condition) {
          this.checkConditionExpression(choice.statBonus.condition, issues, `${loc}:statBonus`);
        }

        // Recurse into outcome nextSituation trees
        if (choice.outcomes) {
          for (const tier of ['success', 'complicated', 'failure'] as const) {
            const outcome = choice.outcomes[tier];
            if (outcome?.consequences) {
              for (const c of outcome.consequences) {
                if ((c as any).type === 'setFlag') {
                  // Don't track here — encounter flags need separate tracking
                  // in the pipeline after all conditions are checked.
                }
              }
            }
            if (outcome?.nextSituation?.choices) {
              this.walkEmbeddedChoices(outcome.nextSituation.choices, issues, sceneId, beat.id);
            }
          }
        }
      }
    }
  }

  private walkEmbeddedChoices(
    choices: Array<{ id: string; conditions?: object; statBonus?: { condition: object }; outcomes?: Record<string, any> }>,
    issues: ContinuityIssue[],
    sceneId: string,
    parentBeatId: string
  ): void {
    for (const choice of choices) {
      const loc = `encounter:${sceneId}:${parentBeatId}:${choice.id}`;

      if (choice.conditions) {
        this.checkConditionExpression(choice.conditions, issues, loc);
      }
      if (choice.statBonus?.condition) {
        this.checkConditionExpression(choice.statBonus.condition, issues, `${loc}:statBonus`);
      }

      // Continue recursing into nested outcome trees
      if (choice.outcomes) {
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes[tier];
          if (outcome?.nextSituation?.choices) {
            this.walkEmbeddedChoices(outcome.nextSituation.choices, issues, sceneId, parentBeatId);
          }
        }
      }
    }
  }

  private checkConditionString(condition: string, issues: ContinuityIssue[], location: string): void {
    const flagMatches = condition.match(/flags\.(\w+)|flags\[['"](\w+)['"]\]/g);
    if (flagMatches) {
      for (const match of flagMatches) {
        const flagName = match.replace(/flags\./, '').replace(/flags\[['"]/, '').replace(/['"]\]/, '');
        if (!this.knownFlags.has(flagName) && !this.setFlags.has(flagName)) {
          issues.push({
            type: 'undefined_flag',
            detail: `Condition references undefined flag: ${flagName}`,
            severity: 'error',
            location,
          });
        }
      }
    }

    const scoreMatches = condition.match(/scores\.(\w+)|scores\[['"](\w+)['"]\]/g);
    if (scoreMatches) {
      for (const match of scoreMatches) {
        const scoreName = match.replace(/scores\./, '').replace(/scores\[['"]/, '').replace(/['"]\]/, '');
        if (!this.knownScores.has(scoreName)) {
          issues.push({
            type: 'undefined_score',
            detail: `Condition references undefined score: ${scoreName}`,
            severity: 'warning',
            location,
          });
        }
      }
    }
  }

  /**
   * Return a snapshot of flags that have been set by prior scenes' consequences.
   */
  getSetFlags(): ReadonlySet<string> {
    return this.setFlags;
  }

  /**
   * Reset tracking state (use between episodes)
   */
  reset(): void {
    this.setFlags.clear();
    this.modifiedScores.clear();
    this.relationshipMaxGains.clear();
  }
}

// ============================================
// INCREMENTAL ENCOUNTER VALIDATOR
// ============================================

export class IncrementalEncounterValidator extends BaseValidator {
  private validSkills: Set<string>;

  constructor(validSkills: string[] = []) {
    super('IncrementalEncounterValidator');
    this.validSkills = new Set(validSkills);
  }

  /**
   * Validate an encounter structure for basic requirements.
   */
  validateEncounter(encounter: EncounterStructure): IncrementalEncounterResult {
    const issues: EncounterValidationIssue[] = [];
    const relationshipHeavyEncounterTypes = new Set(['social', 'romantic', 'dramatic', 'negotiation']);
    let hasRelationshipPayoff = false;
    let hasRelationshipConsequence = false;

    const conditionUsesRelationship = (condition: any): boolean => {
      if (!condition || typeof condition !== 'object') return false;
      return condition.type === 'relationship';
    };

    const encounterBeats = getEncounterBeats(encounter as any);

    // Check beat count
    if (encounterBeats.length === 0) {
      issues.push({
        type: 'missing_beats',
        detail: 'Encounter has no beats defined',
        severity: 'error',
      });
    } else if (encounterBeats.length < 2) {
      issues.push({
        type: 'missing_beats',
        detail: `Encounter has only ${encounterBeats.length} beat(s) - minimum 2 recommended`,
        severity: 'warning',
      });
    }

    // Check each beat has choices
    let hasVictoryPath = false;
    let hasDefeatPath = false;
    let hasPartialVictoryPath = false;

    const visitChoices = (choices: any[] | undefined, path: string) => {
      for (const choice of choices || []) {
        if (this.validSkills.size > 0 && choice.primarySkill && !this.validSkills.has(choice.primarySkill)) {
          issues.push({
            type: 'invalid_skill',
            detail: `Choice "${choice.text}" uses undefined skill: ${choice.primarySkill}`,
            severity: 'warning',
          });
        }

        if (!choice.outcomes) {
          issues.push({
            type: 'missing_outcome',
            detail: `Choice "${choice.text}" at ${path} has no outcomes defined`,
            severity: 'error',
          });
          continue;
        }

        if (conditionUsesRelationship(choice.conditions) || conditionUsesRelationship(choice.statBonus?.condition)) {
          hasRelationshipPayoff = true;
        }
        if ((choice.consequences || []).some((con: any) => con?.type === 'relationship')) {
          hasRelationshipConsequence = true;
        }

        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes[tier];
          if (!outcome) {
            issues.push({
              type: 'missing_outcome',
              detail: `Choice "${choice.text}" at ${path} is missing the ${tier} outcome`,
              severity: 'error',
            });
            continue;
          }

          if (outcome.encounterOutcome === 'victory' || outcome.nextBeatId?.includes('victory')) {
            hasVictoryPath = true;
          }
          if (outcome.encounterOutcome === 'defeat' || outcome.nextBeatId?.includes('defeat')) {
            hasDefeatPath = true;
          }
          if (outcome.encounterOutcome === 'partialVictory') {
            hasPartialVictoryPath = true;
            const cost = outcome.cost || encounter.partialVictoryCost || encounter.storylets?.partialVictory?.cost;
            const visualCost = outcome.visualContract?.visibleCost
              || encounter.storylets?.partialVictory?.beats?.find(beat => beat.visualContract?.visibleCost)?.visualContract?.visibleCost;
            const hasAftermathPath = Boolean(encounter.storylets?.partialVictory?.beats?.length || encounter.storylets?.partialVictory?.nextSceneId);
            if (!cost?.visibleComplication || !cost?.immediateEffect) {
              issues.push({
                type: 'invalid_partial_victory',
                detail: `Partial victory at ${path}/${choice.id}/${tier} is missing structured cost data`,
                severity: 'error',
              });
            }
            if (!visualCost) {
              issues.push({
                type: 'invalid_partial_victory',
                detail: `Partial victory at ${path}/${choice.id}/${tier} does not expose the cost in its visual contract`,
                severity: 'error',
              });
            }
            if (!hasAftermathPath) {
              issues.push({
                type: 'invalid_partial_victory',
                detail: `Partial victory at ${path}/${choice.id}/${tier} has no partialVictory aftermath path or navigation`,
                severity: 'error',
              });
            }
          }

          if ((outcome.consequences || []).some((con: any) => con?.type === 'relationship')) {
            hasRelationshipConsequence = true;
          }

          if (outcome.nextSituation) {
            if (!outcome.nextSituation.choices || outcome.nextSituation.choices.length === 0) {
              issues.push({
                type: 'missing_choices',
                detail: `Outcome ${tier} for "${choice.text}" at ${path} has a nextSituation with no choices`,
                severity: 'warning',
              });
            } else {
              visitChoices(outcome.nextSituation.choices, `${path} -> ${choice.id}:${tier}`);
            }
          } else if (!outcome.isTerminal && !outcome.nextBeatId) {
            issues.push({
              type: 'missing_outcome',
              detail: `Outcome ${tier} for "${choice.text}" at ${path} has neither nextSituation, nextBeatId, nor terminal ending`,
              severity: 'warning',
            });
          }
        }
      }
    };

    for (const beat of encounterBeats) {
      if (((beat as { setupTextVariants?: Array<{ condition?: unknown }> }).setupTextVariants || []).some((variant: { condition?: unknown }) => conditionUsesRelationship(variant?.condition))) {
        hasRelationshipPayoff = true;
      }
      if (!beat.choices || beat.choices.length === 0) {
        issues.push({
          type: 'missing_choices',
          detail: `Beat "${beat.id}" has no choices`,
          severity: 'error',
        });
        continue;
      }
      visitChoices(beat.choices, beat.id);
    }

    // Check storylets exist if referenced
    if (encounter.storylets) {
      const storyletIds = Object.keys(encounter.storylets);
      if (storyletIds.length === 0) {
        issues.push({
          type: 'missing_outcome',
          detail: 'Encounter has empty storylets object',
          severity: 'warning',
        });
      }
    }

    if (
      relationshipHeavyEncounterTypes.has(encounter.encounterType)
      && encounter.npcStates?.length
      && !hasRelationshipPayoff
      && !hasRelationshipConsequence
    ) {
      issues.push({
        type: 'missing_relationship_payoff',
        detail: `Encounter "${encounter.sceneId}" is ${encounter.encounterType} and tracks NPC state, but it never spends relationship state through conditions, setup variants, stat bonuses, or relationship consequences`,
        severity: 'warning',
      });
    }

    return {
      passed: !issues.some(i => i.severity === 'error'),
      issues,
      beatCount: encounterBeats.length,
      hasVictoryPath: hasVictoryPath || hasPartialVictoryPath,
      hasPartialVictoryPath,
      hasDefeatPath,
    };
  }
}

// ============================================
// COMBINED INCREMENTAL VALIDATION RUNNER
// ============================================

export class IncrementalValidationRunner {
  private voiceValidator: IncrementalVoiceValidator;
  private stakesValidator: IncrementalStakesValidator;
  private sensitivityChecker: IncrementalSensitivityChecker;
  private continuityChecker: IncrementalContinuityChecker;
  private encounterValidator: IncrementalEncounterValidator;
  private config: IncrementalValidationConfig;

  constructor(
    knownFlags: string[],
    knownScores: string[],
    validSkills: string[] = [],
    config: Partial<IncrementalValidationConfig> = {}
  ) {
    this.config = { ...DEFAULT_INCREMENTAL_CONFIG, ...config };

    this.voiceValidator = new IncrementalVoiceValidator(
      this.config.voiceRegenerationThreshold
    );
    this.stakesValidator = new IncrementalStakesValidator(
      this.config.stakesRegenerationThreshold
    );
    this.sensitivityChecker = new IncrementalSensitivityChecker(
      this.config.targetRating
    );
    this.continuityChecker = new IncrementalContinuityChecker(
      knownFlags,
      knownScores
    );
    this.encounterValidator = new IncrementalEncounterValidator(validSkills);
  }

  /**
   * Run all enabled incremental validations for a scene.
   */
  async validateScene(
    sceneContent: SceneContent,
    choiceSet: ChoiceSet | undefined,
    characterProfiles: CharacterVoiceProfile[],
    encounter?: EncounterStructure
  ): Promise<SceneValidationResult> {
    const startTime = Date.now();

    const results: SceneValidationResult = {
      sceneId: sceneContent.sceneId,
      sceneName: sceneContent.sceneName,
      overallPassed: true,
      regenerationRequested: 'none',
      validationTimeMs: 0,
    };

    // Voice validation
    if (this.config.voiceValidation) {
      results.voice = this.voiceValidator.validateScene(sceneContent, characterProfiles);
      if (results.voice.shouldRegenerate) {
        results.regenerationRequested = 'scene';
        results.overallPassed = false;
      } else if (!results.voice.passed) {
        results.overallPassed = false;
      }
    }

    // Stakes validation
    if (this.config.stakesValidation && choiceSet) {
      results.stakes = this.stakesValidator.validateChoiceSet(choiceSet);
      if (results.stakes.shouldRegenerate) {
        results.regenerationRequested = results.regenerationRequested === 'scene' ? 'scene' : 'choices';
        results.overallPassed = false;
      } else if (!results.stakes.passed) {
        results.overallPassed = false;
      }
    }

    // Sensitivity check
    if (this.config.sensitivityCheck) {
      results.sensitivity = this.sensitivityChecker.checkScene(sceneContent);
      if (!results.sensitivity.passed) {
        // Don't auto-regenerate for sensitivity, just flag
        results.overallPassed = false;
      }
    }

    // Continuity check
    if (this.config.continuityCheck) {
      results.continuity = this.continuityChecker.checkScene(sceneContent, choiceSet);
      if (!results.continuity.passed) {
        results.overallPassed = false;
      }
    }

    // Encounter validation
    if (this.config.encounterValidation && encounter) {
      results.encounter = this.encounterValidator.validateEncounter(encounter);
      if (!results.encounter.passed) {
        results.regenerationRequested = results.regenerationRequested === 'none' ? 'encounter' : results.regenerationRequested;
        results.overallPassed = false;
      }
    }

    results.validationTimeMs = Date.now() - startTime;
    return results;
  }

  /**
   * Validate just voice for a scene (used during regeneration loop)
   */
  validateVoice(
    sceneContent: SceneContent,
    characterProfiles: CharacterVoiceProfile[]
  ): IncrementalVoiceResult {
    return this.voiceValidator.validateScene(sceneContent, characterProfiles);
  }

  /**
   * Validate just stakes for a choice set (used during regeneration loop)
   */
  validateStakes(choiceSet: ChoiceSet): IncrementalStakesResult {
    return this.stakesValidator.validateChoiceSet(choiceSet);
  }

  /**
   * Track flag set for continuity checking
   */
  trackFlagSet(flagName: string): void {
    this.continuityChecker.trackFlagSet(flagName);
  }

  /**
   * Track score modified for continuity checking
   */
  trackScoreModified(scoreName: string): void {
    this.continuityChecker.trackScoreModified(scoreName);
  }

  /**
   * Track a relationship change for reachability checking
   */
  trackRelationshipChange(npcId: string, dimension: string, change: number): void {
    this.continuityChecker.trackRelationshipChange(npcId, dimension, change);
  }

  /**
   * Set initial relationship baselines from story NPC definitions
   */
  setRelationshipBaselines(
    npcs: Array<{ id: string; initialRelationship?: Partial<Record<string, number>> }>
  ): void {
    this.continuityChecker.setRelationshipBaselines(npcs);
  }

  /**
   * Get the upper-bound achievable value for a relationship dimension
   */
  getRelationshipUpperBound(npcId: string, dimension: string): number {
    return this.continuityChecker.getRelationshipUpperBound(npcId, dimension);
  }

  /**
   * Add a known flag (discovered during generation)
   */
  addKnownFlag(flagName: string): void {
    this.continuityChecker.addKnownFlag(flagName);
  }

  /**
   * Add a known score
   */
  addKnownScore(scoreName: string): void {
    this.continuityChecker.addKnownScore(scoreName);
  }

  /**
   * Return flags that have been set by prior scenes' consequences.
   */
  getSetFlags(): ReadonlySet<string> {
    return this.continuityChecker.getSetFlags();
  }

  /**
   * Validate encounter choice conditions against the current flag chronology.
   */
  checkEncounterChoiceConditions(encounter: EncounterStructure): ContinuityIssue[] {
    return this.continuityChecker.checkEncounterChoiceConditions(encounter);
  }

  /**
   * Reset continuity tracking (between episodes)
   */
  resetContinuityTracking(): void {
    this.continuityChecker.reset();
  }

  /**
   * Get the current configuration
   */
  getConfig(): IncrementalValidationConfig {
    return { ...this.config };
  }

  /**
   * Get direct access to validators for individual use
   */
  get validators() {
    return {
      voice: this.voiceValidator,
      stakes: this.stakesValidator,
      sensitivity: this.sensitivityChecker,
      continuity: this.continuityChecker,
      encounter: this.encounterValidator,
    };
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Format validation results for logging/display
 */
export function formatValidationResult(result: SceneValidationResult): string {
  const lines: string[] = [];
  lines.push(`Scene: ${result.sceneId} (${result.sceneName})`);
  lines.push(`Overall: ${result.overallPassed ? 'PASSED' : 'FAILED'}`);
  lines.push(`Regeneration: ${result.regenerationRequested}`);
  lines.push(`Time: ${result.validationTimeMs}ms`);

  if (result.voice) {
    lines.push(`  Voice: ${result.voice.score}/100 (${result.voice.issues.length} issues)`);
  }
  if (result.stakes) {
    lines.push(`  Stakes: ${result.stakes.score}/100 (${result.stakes.issues.length} issues, false choices: ${result.stakes.hasFalseChoices})`);
  }
  if (result.sensitivity) {
    lines.push(`  Sensitivity: ${result.sensitivity.passed ? 'OK' : 'FLAGGED'} (${result.sensitivity.flags.length} flags, highest: ${result.sensitivity.highestSeverity})`);
  }
  if (result.continuity) {
    lines.push(`  Continuity: ${result.continuity.passed ? 'OK' : 'ISSUES'} (${result.continuity.issues.length} issues)`);
  }
  if (result.encounter) {
    lines.push(`  Encounter: ${result.encounter.passed ? 'OK' : 'ISSUES'} (${result.encounter.beatCount} beats)`);
  }

  return lines.join('\n');
}

/**
 * Aggregate multiple scene validation results
 */
export function aggregateValidationResults(
  results: SceneValidationResult[]
): {
  totalScenes: number;
  passedScenes: number;
  failedScenes: number;
  regenerationRequests: { scene: number; choices: number; encounter: number };
  totalIssues: { voice: number; stakes: number; sensitivity: number; continuity: number; encounter: number };
  averageValidationTime: number;
} {
  const regenerationRequests = { scene: 0, choices: 0, encounter: 0 };
  const totalIssues = { voice: 0, stakes: 0, sensitivity: 0, continuity: 0, encounter: 0 };

  for (const result of results) {
    if (result.regenerationRequested === 'scene') regenerationRequests.scene++;
    if (result.regenerationRequested === 'choices') regenerationRequests.choices++;
    if (result.regenerationRequested === 'encounter') regenerationRequests.encounter++;

    if (result.voice) totalIssues.voice += result.voice.issues.length;
    if (result.stakes) totalIssues.stakes += result.stakes.issues.length;
    if (result.sensitivity) totalIssues.sensitivity += result.sensitivity.flags.length;
    if (result.continuity) totalIssues.continuity += result.continuity.issues.length;
    if (result.encounter) totalIssues.encounter += result.encounter.issues.length;
  }

  return {
    totalScenes: results.length,
    passedScenes: results.filter(r => r.overallPassed).length,
    failedScenes: results.filter(r => !r.overallPassed).length,
    regenerationRequests,
    totalIssues,
    averageValidationTime: results.length > 0
      ? results.reduce((sum, r) => sum + r.validationTimeMs, 0) / results.length
      : 0,
  };
}
