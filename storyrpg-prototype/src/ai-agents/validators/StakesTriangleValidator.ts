/**
 * Stakes Triangle Validator
 *
 * LLM-based validator that evaluates stakes quality:
 * - WANT: How clear is the desire/goal?
 * - COST: How meaningful is the risk/tradeoff?
 * - IDENTITY: How revealing is the choice about character?
 *
 * Blocking errors for branching/dilemma choices missing any stake component.
 */

import { AgentConfig } from '../config';
import { isWebRuntime } from '../../utils/runtimeEnv';
import {
  ValidationIssue,
  StakesQualityScore,
  StakesValidationResult,
  StakesTriangleInput,
  ValidationConfig,
} from '../../types/validation';
import { STAKES_TRIANGLE } from '../prompts/storytellingPrinciples';

// API URL handling for web proxy
const ANTHROPIC_API_URL = isWebRuntime()
  ? 'http://localhost:3001/v1/messages'
  : 'https://api.anthropic.com/v1/messages';

interface StakesAnalysisResponse {
  wantScore: number;
  wantAnalysis: string;
  costScore: number;
  costAnalysis: string;
  identityScore: number;
  identityAnalysis: string;
  overallAssessment: string;
  suggestions: string[];
}

export class StakesTriangleValidator {
  private config: ValidationConfig['rules']['stakesTriangle'];
  private agentConfig: AgentConfig;

  constructor(
    agentConfig: AgentConfig,
    config?: Partial<ValidationConfig['rules']['stakesTriangle']>
  ) {
    this.agentConfig = agentConfig;
    this.config = {
      enabled: true,
      level: 'error',
      threshold: 60, // Minimum score to pass
      ...config,
    };
  }

  /**
   * Validate stakes for a single choice using LLM analysis
   */
  async validate(input: StakesTriangleInput): Promise<StakesValidationResult> {
    const issues: ValidationIssue[] = [];

    // For expression choices, stakes are optional
    if (input.choiceType === 'expression') {
      return {
        passed: true,
        score: { want: 100, cost: 100, identity: 100, overall: 100 },
        issues: [],
      };
    }

    // Check if stakes are provided at all
    const hasWant = input.want && input.want.trim().length > 0;
    const hasCost = input.cost && input.cost.trim().length > 0;
    const hasIdentity = input.identity && input.identity.trim().length > 0;

    // For dilemma or high-stakes choices, all three are required
    // (The caller passes choiceType; branching is checked separately via hasBranching)
    if (input.choiceType === 'dilemma') {
      if (!hasWant || !hasCost || !hasIdentity) {
        const missing: string[] = [];
        if (!hasWant) missing.push('WANT');
        if (!hasCost) missing.push('COST');
        if (!hasIdentity) missing.push('IDENTITY');

        issues.push({
          category: 'stakes_triangle',
          level: 'error',
          message: `${input.choiceType.toUpperCase()} choice is missing stakes: ${missing.join(', ')}`,
          location: { choiceId: input.choiceId },
          suggestion: `Add ${missing.join(' and ')} to complete the Stakes Triangle`,
        });

        return {
          passed: false,
          score: {
            want: hasWant ? 50 : 0,
            cost: hasCost ? 50 : 0,
            identity: hasIdentity ? 50 : 0,
            overall: 0,
          },
          issues,
        };
      }
    }

    // If no LLM config, do basic structural check only
    if (!this.agentConfig.apiKey) {
      const basicScore = this.calculateBasicScore(input);
      return {
        passed: basicScore.overall >= (this.config.threshold || 60),
        score: basicScore,
        issues,
      };
    }

    // Use LLM for quality analysis
    try {
      const analysis = await this.analyzeStakesWithLLM(input);
      const score: StakesQualityScore = {
        want: analysis.wantScore,
        cost: analysis.costScore,
        identity: analysis.identityScore,
        overall: Math.round((analysis.wantScore + analysis.costScore + analysis.identityScore) / 3),
      };

      const threshold = this.config.threshold || 60;

      // Check individual component scores
      if (score.want < threshold) {
        issues.push({
          category: 'stakes_triangle',
          level: score.want < 40 ? 'error' : 'warning',
          message: `WANT score (${score.want}) below threshold: ${analysis.wantAnalysis}`,
          location: { choiceId: input.choiceId },
          suggestion: analysis.suggestions.find(s => s.toLowerCase().includes('want')) || 'Clarify what the player is trying to achieve',
        });
      }

      if (score.cost < threshold) {
        issues.push({
          category: 'stakes_triangle',
          level: score.cost < 40 ? 'error' : 'warning',
          message: `COST score (${score.cost}) below threshold: ${analysis.costAnalysis}`,
          location: { choiceId: input.choiceId },
          suggestion: analysis.suggestions.find(s => s.toLowerCase().includes('cost')) || 'Make the tradeoff more meaningful',
        });
      }

      if (score.identity < threshold) {
        issues.push({
          category: 'stakes_triangle',
          level: score.identity < 40 ? 'error' : 'warning',
          message: `IDENTITY score (${score.identity}) below threshold: ${analysis.identityAnalysis}`,
          location: { choiceId: input.choiceId },
          suggestion: analysis.suggestions.find(s => s.toLowerCase().includes('identity')) || 'Show what this choice reveals about the character',
        });
      }

      // Excellence suggestions for good but improvable scores
      if (score.overall >= threshold && score.overall < 80) {
        for (const suggestion of analysis.suggestions) {
          issues.push({
            category: 'stakes_triangle',
            level: 'suggestion',
            message: `Improvement opportunity: ${suggestion}`,
            location: { choiceId: input.choiceId },
          });
        }
      }

      const hasBlockingIssues = issues.some(i => i.level === 'error');
      const passed = !hasBlockingIssues && score.overall >= threshold;

      return { passed, score, issues };
    } catch (error) {
      // Fallback to basic scoring on LLM error
      console.warn('[StakesTriangleValidator] LLM analysis failed, using basic scoring:', error);
      const basicScore = this.calculateBasicScore(input);
      return {
        passed: basicScore.overall >= (this.config.threshold || 60),
        score: basicScore,
        issues,
      };
    }
  }

  /**
   * Calculate basic score without LLM (fallback)
   */
  private calculateBasicScore(input: StakesTriangleInput): StakesQualityScore {
    const scoreComponent = (text: string | undefined): number => {
      if (!text || text.trim().length === 0) return 0;
      const length = text.trim().length;
      if (length < 10) return 30;
      if (length < 30) return 60;
      if (length < 100) return 80;
      return 90;
    };

    const want = scoreComponent(input.want);
    const cost = scoreComponent(input.cost);
    const identity = scoreComponent(input.identity);
    const overall = Math.round((want + cost + identity) / 3);

    return { want, cost, identity, overall };
  }

  /**
   * Analyze stakes quality using LLM
   */
  private async analyzeStakesWithLLM(input: StakesTriangleInput): Promise<StakesAnalysisResponse> {
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
        temperature: 0.3, // Lower temperature for consistent analysis
        system: this.buildSystemPrompt(),
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Stakes analysis API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.content[0].text;

    return this.parseAnalysisResponse(content);
  }

  /**
   * Build system prompt for stakes analysis
   */
  private buildSystemPrompt(): string {
    return `You are an expert interactive fiction analyst evaluating choice stakes quality.

${STAKES_TRIANGLE}

Evaluate each component of the Stakes Triangle on a scale of 0-100:
- 0-30: Missing or extremely weak
- 31-60: Present but unclear or generic
- 61-80: Good, specific, engaging
- 81-100: Excellent, memorable, perfectly crafted

Always respond with valid JSON matching the required schema.`;
  }

  /**
   * Build analysis prompt
   */
  private buildAnalysisPrompt(input: StakesTriangleInput): string {
    return `Analyze the stakes quality for this ${input.choiceType} choice:

**Choice Text**: "${input.choiceText}"

**Stated Stakes**:
- WANT: ${input.want || '(not provided)'}
- COST: ${input.cost || '(not provided)'}
- IDENTITY: ${input.identity || '(not provided)'}

**Context**: ${input.context}

Respond with JSON:
{
  "wantScore": <0-100>,
  "wantAnalysis": "<brief analysis of the WANT component>",
  "costScore": <0-100>,
  "costAnalysis": "<brief analysis of the COST component>",
  "identityScore": <0-100>,
  "identityAnalysis": "<brief analysis of the IDENTITY component>",
  "overallAssessment": "<1-2 sentence overall assessment>",
  "suggestions": ["<improvement suggestion 1>", "<improvement suggestion 2>"]
}`;
  }

  /**
   * Parse LLM analysis response
   */
  private parseAnalysisResponse(content: string): StakesAnalysisResponse {
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

    // Validate and normalize scores
    return {
      wantScore: Math.max(0, Math.min(100, Number(parsed.wantScore) || 0)),
      wantAnalysis: String(parsed.wantAnalysis || ''),
      costScore: Math.max(0, Math.min(100, Number(parsed.costScore) || 0)),
      costAnalysis: String(parsed.costAnalysis || ''),
      identityScore: Math.max(0, Math.min(100, Number(parsed.identityScore) || 0)),
      identityAnalysis: String(parsed.identityAnalysis || ''),
      overallAssessment: String(parsed.overallAssessment || ''),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
    };
  }

  /**
   * Batch validate multiple choices
   */
  async validateBatch(inputs: StakesTriangleInput[]): Promise<{
    results: Map<string, StakesValidationResult>;
    averageScore: number;
    passedCount: number;
    totalCount: number;
  }> {
    const results = new Map<string, StakesValidationResult>();
    let totalScore = 0;
    let passedCount = 0;

    for (const input of inputs) {
      const result = await this.validate(input);
      results.set(input.choiceId, result);
      totalScore += result.score.overall;
      if (result.passed) passedCount++;
    }

    return {
      results,
      averageScore: inputs.length > 0 ? Math.round(totalScore / inputs.length) : 0,
      passedCount,
      totalCount: inputs.length,
    };
  }
}
