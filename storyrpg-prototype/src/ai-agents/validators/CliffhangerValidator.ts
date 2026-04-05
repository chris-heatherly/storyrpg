/**
 * Cliffhanger Validator
 * 
 * Specialized validator for ensuring episode cliffhangers meet quality standards.
 * Used during episode generation to validate and improve cliffhanger implementation.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from '../agents/BaseAgent';
import { Episode, Scene, Beat, CliffhangerType, EpisodePlan } from '../../types';

// ========================================
// TYPES
// ========================================

export interface CliffhangerAnalysis {
  hasCliffhanger: boolean;
  quality: 'excellent' | 'good' | 'weak' | 'missing';
  type: CliffhangerType | 'none';
  score: number; // 0-100
  
  // What makes it work (or not)
  strengths: string[];
  weaknesses: string[];
  
  // The actual content
  finalBeatText: string;
  unresolvedTension: string;
  emotionalHook: string;
  
  // Recommendations
  suggestions: string[];
}

export interface CliffhangerValidationInput {
  episode: Episode;
  episodePlan: EpisodePlan;
  isFinale: boolean;
}

export interface CliffhangerImprovement {
  originalText: string;
  improvedText: string;
  cliffhangerType: CliffhangerType;
  explanation: string;
}

// ========================================
// CLIFFHANGER VALIDATOR
// ========================================

export class CliffhangerValidator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('CliffhangerValidator', config);
  }

  /**
   * Analyze cliffhanger quality without LLM (fast, heuristic-based)
   */
  quickAnalyze(episode: Episode, plan: EpisodePlan): CliffhangerAnalysis {
    if (!episode) {
      throw new Error('CliffhangerValidator.quickAnalyze: episode is null or undefined');
    }

    if (!plan) {
      throw new Error('CliffhangerValidator.quickAnalyze: plan is null or undefined');
    }

    if (!episode.scenes || !Array.isArray(episode.scenes)) {
      throw new Error('CliffhangerValidator.quickAnalyze: episode.scenes is null, undefined, or not an array');
    }

    const lastScene = episode.scenes[episode.scenes.length - 1];
    const lastBeat = lastScene?.beats?.[lastScene.beats.length - 1];
    
    if (!lastBeat) {
      return {
        hasCliffhanger: false,
        quality: 'missing',
        type: 'none',
        score: 0,
        strengths: [],
        weaknesses: ['No final beat found'],
        finalBeatText: '',
        unresolvedTension: '',
        emotionalHook: '',
        suggestions: ['Add a final beat with unresolved tension'],
      };
    }
    
    const text = lastBeat.text;
    const analysis = this.analyzeTextForCliffhanger(text, plan);
    
    return analysis;
  }

  /**
   * Full LLM-based analysis for deeper quality check
   */
  async execute(input: CliffhangerValidationInput): Promise<AgentResponse<CliffhangerAnalysis>> {
    if (!input) {
      throw new Error('CliffhangerValidator.execute: input is null or undefined');
    }

    if (!input.episode) {
      throw new Error('CliffhangerValidator.execute: input.episode is null or undefined');
    }

    if (!input.episodePlan) {
      throw new Error('CliffhangerValidator.execute: input.episodePlan is null or undefined');
    }

    if (!input.episode.scenes || !Array.isArray(input.episode.scenes)) {
      throw new Error('CliffhangerValidator.execute: input.episode.scenes is null, undefined, or not an array');
    }

    const startTime = Date.now();
    
    try {
      // First do quick analysis
      const quickResult = this.quickAnalyze(input.episode, input.episodePlan);
      
      // If clearly missing or excellent, no need for LLM
      if (quickResult.quality === 'missing' || quickResult.score >= 90) {
        return {
          success: true,
          data: quickResult,
          metadata: { duration: Date.now() - startTime, usedLLM: false },
        };
      }
      
      // Use LLM for deeper analysis
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(input);
      
      const response = await this.callLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);
      
      const analysis = this.parseAnalysis(response, input);
      
      return {
        success: true,
        data: analysis,
        metadata: { duration: Date.now() - startTime, usedLLM: true },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Fall back to quick analysis
      const quickResult = this.quickAnalyze(input.episode, input.episodePlan);
      
      return {
        success: true,
        data: quickResult,
        metadata: { 
          duration: Date.now() - startTime, 
          usedLLM: false,
          fallbackReason: errorMessage,
        },
      };
    }
  }

  /**
   * Generate an improved cliffhanger for weak endings
   */
  async improveCliffhanger(
    episode: Episode,
    plan: EpisodePlan,
    analysis: CliffhangerAnalysis
  ): Promise<AgentResponse<CliffhangerImprovement>> {
    const startTime = Date.now();
    
    try {
      const lastScene = episode.scenes[episode.scenes.length - 1];
      const lastBeat = lastScene?.beats[lastScene.beats.length - 1];
      
      if (!lastBeat) {
        return {
          success: false,
          error: 'No final beat to improve',
        };
      }
      
      const systemPrompt = `You are an expert at writing compelling cliffhangers for serialized fiction.

A good cliffhanger:
1. Creates UNRESOLVED TENSION that demands continuation
2. Raises a QUESTION that the audience needs answered
3. Provides an EMOTIONAL HOOK (fear, shock, curiosity, dread)
4. Connects to the story's stakes and characters
5. Feels EARNED by the episode's events, not arbitrary

Cliffhanger types:
- REVELATION: A shocking truth is revealed ("She was the killer all along")
- DANGER: Imminent threat with outcome unclear ("The timer hit zero as—")
- DECISION: Critical choice left hanging ("Join us, or die with them")
- BETRAYAL: Trust broken, consequences unknown
- ARRIVAL: Someone/something appears with unclear implications
- DEPARTURE: Someone leaves/is taken with unresolved impact
- MYSTERY: New question that demands answers
- REVERSAL: Situation inverts, everything changes

Your task: Rewrite the final beat to create a compelling "${plan.cliffhangerType}" cliffhanger.`;

      const userPrompt = `## Episode Context
Episode ${plan.episodeNumber}: "${plan.title}"
Logline: ${plan.logline}

## Planned Cliffhanger
Type: ${plan.cliffhangerType}
Hook: ${plan.cliffhangerHook}
Setup: ${plan.cliffhangerSetup || 'Not specified'}

## Current Final Beat
${lastBeat.text}

## Analysis of Current Ending
Quality: ${analysis.quality}
Weaknesses: ${analysis.weaknesses.join(', ')}

## Your Task
Rewrite the final beat to deliver a compelling "${plan.cliffhangerType}" cliffhanger that:
1. Implements the planned hook: "${plan.cliffhangerHook}"
2. Creates unresolved tension
3. Makes the reader NEED to continue

Return JSON:
{
  "improvedText": "The rewritten final beat text...",
  "explanation": "Why this version is more effective"
}`;

      const response = await this.callLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);
      
      const parsed = this.parseJSON(response);
      
      return {
        success: true,
        data: {
          originalText: lastBeat.text,
          improvedText: parsed.improvedText || lastBeat.text,
          cliffhangerType: plan.cliffhangerType,
          explanation: parsed.explanation || 'Rewritten to create stronger tension',
        },
        metadata: { duration: Date.now() - startTime },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { duration: Date.now() - startTime },
      };
    }
  }

  // ========================================
  // PRIVATE METHODS
  // ========================================

  private analyzeTextForCliffhanger(text: string, plan: EpisodePlan): CliffhangerAnalysis {
    const lowerText = text.toLowerCase();
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    let score = 50; // Base score
    
    // Check for tension indicators
    const tensionIndicators = {
      unfinished: ['...', '—', 'but before', 'just as', 'and then'],
      questions: ['?', 'who could', 'what was', 'why would', 'how could'],
      danger: ['danger', 'threat', 'attack', 'scream', 'explosion', 'blood', 'weapon'],
      revelation: ['realized', 'truth', 'discovered', 'revealed', 'secret', 'actually'],
      emotion: ['heart stopped', 'eyes widened', 'couldn\'t believe', 'frozen', 'shock'],
      arrival: ['appeared', 'arrived', 'entered', 'door opened', 'figure', 'silhouette'],
      betrayal: ['betrayed', 'lied', 'deceived', 'trust', 'never told'],
    };
    
    // Score based on indicators
    for (const [category, indicators] of Object.entries(tensionIndicators)) {
      const found = indicators.filter(ind => lowerText.includes(ind));
      if (found.length > 0) {
        score += 10;
        strengths.push(`Contains ${category} elements: ${found.join(', ')}`);
      }
    }
    
    // Check for resolution (bad for cliffhangers)
    const resolutionIndicators = [
      'finally', 'at last', 'everything was', 'they lived', 'it was over',
      'peace', 'smiled', 'laughed together', 'happily'
    ];
    const hasResolution = resolutionIndicators.some(ind => lowerText.includes(ind));
    if (hasResolution) {
      score -= 30;
      weaknesses.push('Ending feels resolved rather than open');
    }
    
    // Check for emotional impact
    const emotionalWords = ['heart', 'breath', 'blood', 'scream', 'whisper', 'tremble'];
    const emotionalCount = emotionalWords.filter(w => lowerText.includes(w)).length;
    if (emotionalCount >= 2) {
      score += 10;
      strengths.push('Strong emotional language');
    } else if (emotionalCount === 0) {
      score -= 10;
      weaknesses.push('Lacks emotional intensity');
    }
    
    // Check text ends with tension
    const endsWithTension = text.trim().endsWith('...') || 
                           text.trim().endsWith('—') || 
                           text.trim().endsWith('?');
    if (endsWithTension) {
      score += 15;
      strengths.push('Ends with unfinished/questioning punctuation');
    }
    
    // Check length (too short = weak, too long = diluted)
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 20) {
      weaknesses.push('Final beat is very short');
    } else if (wordCount > 150) {
      score -= 5;
      weaknesses.push('Final beat may dilute tension with length');
    }
    
    // Detect cliffhanger type
    let detectedType: CliffhangerType = 'mystery';
    if (lowerText.includes('revealed') || lowerText.includes('truth') || lowerText.includes('actually')) {
      detectedType = 'revelation';
    } else if (lowerText.includes('danger') || lowerText.includes('attack') || lowerText.includes('threat')) {
      detectedType = 'danger';
    } else if (lowerText.includes('betray') || lowerText.includes('lied') || lowerText.includes('deceiv')) {
      detectedType = 'betrayal';
    } else if (lowerText.includes('appeared') || lowerText.includes('arrived') || lowerText.includes('door')) {
      detectedType = 'arrival';
    } else if (lowerText.includes('left') || lowerText.includes('gone') || lowerText.includes('departed')) {
      detectedType = 'departure';
    } else if (lowerText.includes('choose') || lowerText.includes('decision') || lowerText.includes('must')) {
      detectedType = 'decision';
    }
    
    // Check if detected type matches planned type
    if (detectedType === plan.cliffhangerType) {
      score += 10;
      strengths.push(`Matches planned cliffhanger type: ${plan.cliffhangerType}`);
    } else {
      weaknesses.push(`Planned "${plan.cliffhangerType}" but detected "${detectedType}"`);
    }
    
    // Determine quality
    score = Math.max(0, Math.min(100, score));
    let quality: CliffhangerAnalysis['quality'];
    if (score >= 80) quality = 'excellent';
    else if (score >= 60) quality = 'good';
    else if (score >= 30) quality = 'weak';
    else quality = 'missing';
    
    // Generate suggestions
    const suggestions: string[] = [];
    if (hasResolution) {
      suggestions.push('Remove resolution language and end on an unresolved note');
    }
    if (!endsWithTension) {
      suggestions.push('End with trailing punctuation (...) or a question');
    }
    if (emotionalCount < 2) {
      suggestions.push('Add more visceral emotional language');
    }
    if (detectedType !== plan.cliffhangerType) {
      suggestions.push(`Revise to emphasize "${plan.cliffhangerType}" elements`);
    }
    
    return {
      hasCliffhanger: score >= 40,
      quality,
      type: detectedType,
      score,
      strengths,
      weaknesses,
      finalBeatText: text,
      unresolvedTension: this.extractUnresolvedTension(text),
      emotionalHook: this.extractEmotionalHook(text),
      suggestions,
    };
  }

  private extractUnresolvedTension(text: string): string {
    // Try to identify the unresolved element
    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    const lastSentence = sentences[sentences.length - 1]?.trim() || '';
    return lastSentence;
  }

  private extractEmotionalHook(text: string): string {
    // Look for emotional language
    const emotionalPhrases = text.match(
      /(heart|breath|eyes|blood|scream|whisper|tremble|frozen|shock|fear|horror|joy|tears)[^.!?]*/gi
    );
    return emotionalPhrases?.join('; ') || 'None detected';
  }

  private buildSystemPrompt(): string {
    return `You are an expert at analyzing cliffhangers in serialized fiction.

A compelling cliffhanger creates:
1. UNRESOLVED TENSION that demands continuation
2. A QUESTION that needs answering
3. An EMOTIONAL HOOK (fear, shock, curiosity)
4. Connection to stakes and characters

Cliffhanger types and what makes them work:
- REVELATION: Must be genuinely surprising AND connected to prior events
- DANGER: Must feel immediate and the outcome genuinely uncertain
- DECISION: Must present a real dilemma with no easy answer
- BETRAYAL: Must subvert established trust in a believable way
- ARRIVAL: Must have unclear but significant implications
- DEPARTURE: Must leave important things unsaid/undone
- MYSTERY: Must pose a question that's both intriguing and relevant
- REVERSAL: Must invert assumptions in a way that changes everything

Analyze the cliffhanger quality and provide specific, actionable feedback.`;
  }

  private buildUserPrompt(input: CliffhangerValidationInput): string {
    const lastScene = input.episode.scenes[input.episode.scenes.length - 1];
    const lastBeat = lastScene?.beats[lastScene.beats.length - 1];
    
    return `## Episode Context
Episode ${input.episodePlan.episodeNumber}: "${input.episodePlan.title}"
Is Finale: ${input.isFinale}

## Planned Cliffhanger
Type: ${input.episodePlan.cliffhangerType}
Hook: ${input.episodePlan.cliffhangerHook}

## Final Scene and Beat
Scene: ${lastScene?.name || 'Unknown'}
Final Beat Text:
"${lastBeat?.text || 'No text'}"

## Analyze This Cliffhanger
Return JSON with:
{
  "hasCliffhanger": boolean,
  "quality": "excellent" | "good" | "weak" | "missing",
  "type": detected cliffhanger type,
  "score": 0-100,
  "strengths": ["what works"],
  "weaknesses": ["what doesn't work"],
  "unresolvedTension": "what's left hanging",
  "emotionalHook": "what emotion it creates",
  "suggestions": ["how to improve"]
}`;
  }

  private parseAnalysis(response: string, input: CliffhangerValidationInput): CliffhangerAnalysis {
    try {
      const parsed = this.parseJSON(response);
      
      const lastScene = input.episode.scenes[input.episode.scenes.length - 1];
      const lastBeat = lastScene?.beats[lastScene.beats.length - 1];
      
      return {
        hasCliffhanger: parsed.hasCliffhanger ?? false,
        quality: parsed.quality || 'weak',
        type: parsed.type || 'none',
        score: parsed.score || 50,
        strengths: parsed.strengths || [],
        weaknesses: parsed.weaknesses || [],
        finalBeatText: lastBeat?.text || '',
        unresolvedTension: parsed.unresolvedTension || '',
        emotionalHook: parsed.emotionalHook || '',
        suggestions: parsed.suggestions || [],
      };
    } catch {
      // Fall back to quick analysis
      return this.quickAnalyze(input.episode, input.episodePlan);
    }
  }

  private parseJSON(response: string): any {
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    return JSON.parse(cleaned.trim());
  }
}

export default CliffhangerValidator;
