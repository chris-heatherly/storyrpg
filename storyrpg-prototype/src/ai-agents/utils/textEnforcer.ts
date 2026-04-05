/**
 * Text Enforcer Utility
 * Ensures text content meets length and formatting requirements
 */

export const DEFAULT_LIMITS = {
  maxSentences: 4,
  maxWords: 80,
  maxChoiceWords: 25,
  resolutionSummary: 30,
  setupTextMaxWords: 60,
  outcomeTextMaxWords: 50,
  maxDialogueWords: 40,
  maxDialogueLines: 3,
  minChoices: 2,
  maxChoices: 4,
};

// Configurable limits that can be overridden by pipeline config
export interface TextLimitsConfig {
  maxSentencesPerBeat?: number;
  maxWordsPerBeat?: number;
  maxChoiceWords?: number;
  maxDialogueWords?: number;
  maxDialogueLines?: number;
  encounterSetupMaxWords?: number;
  encounterOutcomeMaxWords?: number;
  resolutionSummaryMaxWords?: number;
  minChoices?: number;
  maxChoices?: number;
}

// Get effective limits by merging config with defaults
export function getEffectiveLimits(config?: TextLimitsConfig) {
  return {
    maxSentences: config?.maxSentencesPerBeat ?? DEFAULT_LIMITS.maxSentences,
    maxWords: config?.maxWordsPerBeat ?? DEFAULT_LIMITS.maxWords,
    maxChoiceWords: config?.maxChoiceWords ?? DEFAULT_LIMITS.maxChoiceWords,
    resolutionSummary: config?.resolutionSummaryMaxWords ?? DEFAULT_LIMITS.resolutionSummary,
    setupTextMaxWords: config?.encounterSetupMaxWords ?? DEFAULT_LIMITS.setupTextMaxWords,
    outcomeTextMaxWords: config?.encounterOutcomeMaxWords ?? DEFAULT_LIMITS.outcomeTextMaxWords,
    maxDialogueWords: config?.maxDialogueWords ?? DEFAULT_LIMITS.maxDialogueWords,
    maxDialogueLines: config?.maxDialogueLines ?? DEFAULT_LIMITS.maxDialogueLines,
    minChoices: config?.minChoices ?? DEFAULT_LIMITS.minChoices,
    maxChoices: config?.maxChoices ?? DEFAULT_LIMITS.maxChoices,
  };
}

/**
 * Count words in a string
 */
export function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Count sentences in a string
 */
export function countSentences(text: string): number {
  if (!text || !text.trim()) return 0;
  // Match sentence-ending punctuation followed by space or end of string
  const sentences = text.trim().split(/[.!?]+\s*/);
  return sentences.filter(s => s.trim().length > 0).length;
}

/**
 * Truncate text to a maximum word count
 */
export function truncateToWordLimit(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
}

/**
 * Truncate text to a maximum sentence count
 */
export function truncateToSentenceLimit(text: string, maxSentences: number): string {
  const sentences = text.trim().split(/([.!?]+\s*)/);
  let result = '';
  let count = 0;
  
  for (let i = 0; i < sentences.length; i += 2) {
    if (count >= maxSentences) break;
    result += sentences[i] + (sentences[i + 1] || '');
    count++;
  }
  
  return result.trim();
}

/**
 * Enforce choice text limits
 */
export function enforceChoiceLimits(
  text: string,
  limits: { maxWords?: number } = {}
): string {
  const maxWords = limits.maxWords || DEFAULT_LIMITS.maxChoiceWords;
  return truncateToWordLimit(text, maxWords);
}

/**
 * Enforce beat text limits
 */
export function enforceBeatLimits(
  text: string,
  limits: { maxWords?: number; maxSentences?: number } = {}
): string {
  const maxWords = limits.maxWords || DEFAULT_LIMITS.maxWords;
  const maxSentences = limits.maxSentences || DEFAULT_LIMITS.maxSentences;
  
  let result = text;
  
  // First enforce sentence limit
  if (countSentences(result) > maxSentences) {
    result = truncateToSentenceLimit(result, maxSentences);
  }
  
  // Then enforce word limit
  if (countWords(result) > maxWords) {
    result = truncateToWordLimit(result, maxWords);
  }
  
  return result;
}

/**
 * Validate text against limits and return issues
 */
export function validateTextLimits(
  text: string,
  limits: { maxWords?: number; maxSentences?: number }
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  const wordCount = countWords(text);
  const sentenceCount = countSentences(text);
  
  if (limits.maxWords && wordCount > limits.maxWords) {
    issues.push(`Text exceeds word limit: ${wordCount}/${limits.maxWords}`);
  }
  
  if (limits.maxSentences && sentenceCount > limits.maxSentences) {
    issues.push(`Text exceeds sentence limit: ${sentenceCount}/${limits.maxSentences}`);
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

// Bundle all functions for namespace export
export const textEnforcer = {
  DEFAULT_LIMITS,
  getEffectiveLimits,
  countWords,
  countSentences,
  truncateToWordLimit,
  truncateToSentenceLimit,
  enforceChoiceLimits,
  enforceBeatLimits,
  validateTextLimits,
};
