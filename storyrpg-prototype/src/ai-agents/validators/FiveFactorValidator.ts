/**
 * Five-Factor Validator
 *
 * Ensures non-flavor choices affect at least one of the five factors:
 * 1. OUTCOME: Changes what happens
 * 2. PROCESS: Changes how it happens
 * 3. INFORMATION: Changes what is learned
 * 4. RELATIONSHIP: Changes character bonds
 * 5. IDENTITY: Changes who the protagonist is becoming
 *
 * Blocking error if branching/dilemma choice changes 0 factors.
 */

import { AgentConfig } from '../config';
import { FiveFactorImpact } from '../../types';
import { isWebRuntime } from '../../utils/runtimeEnv';
import {
  ValidationIssue,
  FiveFactorValidationResult,
  FiveFactorInput,
  ValidationConfig,
} from '../../types/validation';

// API URL handling for web proxy
const ANTHROPIC_API_URL = isWebRuntime()
  ? 'http://localhost:3001/v1/messages'
  : 'https://api.anthropic.com/v1/messages';

interface FiveFactorAnalysisResponse {
  outcome: { affected: boolean; explanation: string };
  process: { affected: boolean; explanation: string };
  information: { affected: boolean; explanation: string };
  relationship: { affected: boolean; explanation: string };
  identity: { affected: boolean; explanation: string };
  overallAssessment: string;
  suggestions: string[];
}

export class FiveFactorValidator {
  private config: ValidationConfig['rules']['fiveFactor'];
  private agentConfig: AgentConfig;

  constructor(
    agentConfig: AgentConfig,
    config?: Partial<ValidationConfig['rules']['fiveFactor']>
  ) {
    this.agentConfig = agentConfig;
    this.config = {
      enabled: true,
      level: 'error',
      ...config,
    };
  }

  /**
   * Analyze factor impact from consequences (heuristic)
   */
  analyzeConsequencesHeuristic(consequences: FiveFactorInput['consequences']): FiveFactorImpact {
    const impact: FiveFactorImpact = {
      outcome: false,
      process: false,
      information: false,
      relationship: false,
      identity: false,
    };

    for (const consequence of consequences) {
      switch (consequence.type) {
        case 'setFlag':
        case 'changeScore':
        case 'setScore':
          // Flags and scores typically affect outcome or information
          impact.outcome = true;
          break;

        case 'relationship':
          impact.relationship = true;
          break;

        case 'addTag':
        case 'removeTag':
          // Tags often relate to identity
          impact.identity = true;
          break;

        case 'addItem':
        case 'removeItem':
          // Items affect outcome (what you can do)
          impact.outcome = true;
          break;

        case 'attribute':
        case 'skill':
          // Attribute/skill changes affect process and identity
          impact.process = true;
          impact.identity = true;
          break;
      }
    }

    return impact;
  }

  /**
   * Count how many factors are affected
   */
  countFactors(impact: FiveFactorImpact): number {
    return Object.values(impact).filter(Boolean).length;
  }

  /**
   * Get list of affected factor names
   */
  getAffectedFactors(impact: FiveFactorImpact): string[] {
    const factors: string[] = [];
    if (impact.outcome) factors.push('OUTCOME');
    if (impact.process) factors.push('PROCESS');
    if (impact.information) factors.push('INFORMATION');
    if (impact.relationship) factors.push('RELATIONSHIP');
    if (impact.identity) factors.push('IDENTITY');
    return factors;
  }

  /**
   * Validate a single choice's five-factor impact
   */
  async validate(input: FiveFactorInput): Promise<FiveFactorValidationResult> {
    const issues: ValidationIssue[] = [];

    // Expression choices are exempt from five-factor requirements
    if (input.choiceType === 'expression') {
      return {
        passed: true,
        impact: {
          outcome: false,
          process: false,
          information: false,
          relationship: false,
          identity: false,
        },
        factorCount: 0,
        issues: [],
      };
    }

    // First do heuristic analysis based on consequences
    let impact = this.analyzeConsequencesHeuristic(input.consequences);
    let factorCount = this.countFactors(impact);

    // If heuristic finds factors, we're likely good
    if (factorCount >= 1) {
      // Add suggestions for richness if only 1 factor
      if (factorCount === 1) {
        const affected = this.getAffectedFactors(impact);
        issues.push({
          category: 'five_factor',
          level: 'suggestion',
          message: `Choice only affects ${affected[0]} factor`,
          location: { choiceId: input.choiceId },
          suggestion: 'Consider adding impact to additional factors for richer gameplay',
        });
      }

      return {
        passed: true,
        impact,
        factorCount,
        issues,
      };
    }

    // If no factors found by heuristic, use LLM for deeper analysis
    if (this.agentConfig.apiKey) {
      try {
        const analysis = await this.analyzeFiveFactorsWithLLM(input);

        impact = {
          outcome: analysis.outcome.affected,
          process: analysis.process.affected,
          information: analysis.information.affected,
          relationship: analysis.relationship.affected,
          identity: analysis.identity.affected,
        };
        factorCount = this.countFactors(impact);

        // Add suggestions from LLM
        for (const suggestion of analysis.suggestions) {
          issues.push({
            category: 'five_factor',
            level: 'suggestion',
            message: suggestion,
            location: { choiceId: input.choiceId },
          });
        }
      } catch (error) {
        console.warn('[FiveFactorValidator] LLM analysis failed:', error);
        // Continue with heuristic result
      }
    }

    // Check if validation passes — dilemma choices must affect at least 1 factor
    if (factorCount === 0 && input.choiceType === 'dilemma') {
      issues.push({
        category: 'five_factor',
        level: 'error',
        message: `DILEMMA choice has no meaningful impact on any of the five factors`,
        location: { choiceId: input.choiceId },
        suggestion: 'Add consequences that change OUTCOME, PROCESS, INFORMATION, RELATIONSHIP, or IDENTITY',
      });

      return {
        passed: false,
        impact,
        factorCount,
        issues,
      };
    }

    // Richness suggestions
    if (factorCount === 1) {
      const affected = this.getAffectedFactors(impact);
      issues.push({
        category: 'five_factor',
        level: 'suggestion',
        message: `Choice only affects ${affected[0]} factor`,
        location: { choiceId: input.choiceId },
        suggestion: 'Consider adding impact to additional factors for richer gameplay',
      });
    }

    return {
      passed: true,
      impact,
      factorCount,
      issues,
    };
  }

  /**
   * Analyze five factors using LLM
   */
  private async analyzeFiveFactorsWithLLM(input: FiveFactorInput): Promise<FiveFactorAnalysisResponse> {
    const prompt = this.buildAnalysisPrompt(input);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.agentConfig.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.agentConfig.model,
        max_tokens: 1024,
        temperature: 0.3,
        system: this.buildSystemPrompt(),
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Five-factor analysis API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.content[0].text;

    return this.parseAnalysisResponse(content);
  }

  /**
   * Build system prompt for five-factor analysis
   */
  private buildSystemPrompt(): string {
    return `You are an expert interactive fiction analyst evaluating choice impact across five factors.

## Five-Factor Test

Every meaningful choice should affect at least one of these factors:

1. **OUTCOME**: Does this choice change WHAT happens in the story?
   - Different scenes, events, or endings
   - Changed character fates
   - Different story beats

2. **PROCESS**: Does this choice change HOW things happen?
   - Different approaches to problems
   - Changed difficulty or method
   - Alternative paths to same goal

3. **INFORMATION**: Does this choice change what the player LEARNS?
   - Revealed secrets or lore
   - Character backstory
   - World information

4. **RELATIONSHIP**: Does this choice change character BONDS?
   - Trust, affection, respect, fear with NPCs
   - Alliance formations
   - Betrayals or loyalty

5. **IDENTITY**: Does this choice change WHO the protagonist is becoming?
   - Character development
   - Moral alignment
   - Personality expression

Analyze each factor and determine if the choice meaningfully affects it.
Always respond with valid JSON.`;
  }

  /**
   * Build analysis prompt
   */
  private buildAnalysisPrompt(input: FiveFactorInput): string {
    const consequenceSummary = input.consequences.length > 0
      ? input.consequences.map(c => `- ${c.type}: ${JSON.stringify(c)}`).join('\n')
      : '(no explicit consequences)';

    return `Analyze the five-factor impact for this ${input.choiceType} choice:

**Choice Text**: "${input.choiceText}"

**Explicit Consequences**:
${consequenceSummary}

**Context**: ${input.context}

For each factor, determine if this choice meaningfully affects it.
A choice can have implicit impact even without explicit consequences.

Respond with JSON:
{
  "outcome": { "affected": true/false, "explanation": "<why>" },
  "process": { "affected": true/false, "explanation": "<why>" },
  "information": { "affected": true/false, "explanation": "<why>" },
  "relationship": { "affected": true/false, "explanation": "<why>" },
  "identity": { "affected": true/false, "explanation": "<why>" },
  "overallAssessment": "<summary>",
  "suggestions": ["<how to increase impact>"]
}`;
  }

  /**
   * Parse LLM analysis response
   */
  private parseAnalysisResponse(content: string): FiveFactorAnalysisResponse {
    // Clean markdown if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }

    const parsed = JSON.parse(cleaned.trim());

    // Normalize response
    const normalizeFactorResult = (factor: unknown): { affected: boolean; explanation: string } => {
      if (typeof factor === 'object' && factor !== null) {
        return {
          affected: Boolean((factor as Record<string, unknown>).affected),
          explanation: String((factor as Record<string, unknown>).explanation || ''),
        };
      }
      return { affected: false, explanation: '' };
    };

    return {
      outcome: normalizeFactorResult(parsed.outcome),
      process: normalizeFactorResult(parsed.process),
      information: normalizeFactorResult(parsed.information),
      relationship: normalizeFactorResult(parsed.relationship),
      identity: normalizeFactorResult(parsed.identity),
      overallAssessment: String(parsed.overallAssessment || ''),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
    };
  }

  /**
   * Batch validate multiple choices
   */
  async validateBatch(inputs: FiveFactorInput[]): Promise<{
    results: Map<string, FiveFactorValidationResult>;
    averageFactorCount: number;
    passedCount: number;
    totalCount: number;
  }> {
    const results = new Map<string, FiveFactorValidationResult>();
    let totalFactors = 0;
    let passedCount = 0;

    for (const input of inputs) {
      const result = await this.validate(input);
      results.set(input.choiceId, result);
      totalFactors += result.factorCount;
      if (result.passed) passedCount++;
    }

    return {
      results,
      averageFactorCount: inputs.length > 0 ? totalFactors / inputs.length : 0,
      passedCount,
      totalCount: inputs.length,
    };
  }
}
