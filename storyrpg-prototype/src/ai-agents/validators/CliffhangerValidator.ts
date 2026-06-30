/**
 * Cliffhanger Validator
 * 
 * Specialized validator for ensuring episode cliffhangers meet quality standards.
 * Used during episode generation to validate and improve cliffhanger implementation.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from '../agents/BaseAgent';
import { Episode, Scene, Beat, CliffhangerType, EpisodePlan } from '../../types';
import type { CliffhangerPlan } from '../../types/seasonPlan';
import type { StoryCircleBeat } from '../../types/sourceAnalysis';

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
  cliffhangerPlan?: CliffhangerPlan;
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
  quickAnalyze(episode: Episode, plan: EpisodePlan | CliffhangerPlan): CliffhangerAnalysis {
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
    const lastBeat = this.selectFinalCliffhangerBeat(lastScene);
    
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
      const quickResult = this.quickAnalyze(input.episode, input.cliffhangerPlan || input.episodePlan);
      
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
      const quickResult = this.quickAnalyze(input.episode, input.cliffhangerPlan || input.episodePlan);
      
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
    plan: EpisodePlan | CliffhangerPlan,
    analysis: CliffhangerAnalysis
  ): Promise<AgentResponse<CliffhangerImprovement>> {
    const startTime = Date.now();
    
    try {
      const lastScene = episode.scenes[episode.scenes.length - 1];
      const lastBeat = this.selectFinalCliffhangerBeat(lastScene);
      
      if (!lastBeat) {
        return {
          success: false,
          error: 'No final beat to improve',
        };
      }
      
      const planDetails = this.getPlanDetails(plan);
      const systemPrompt = `You are an expert at writing compelling cliffhangers for serialized interactive fiction.

A good cliffhanger:
1. Resolves or acknowledges the episode's immediate conflict enough to feel authored
2. Opens a sharper next-episode pressure or question
3. Provides a specific emotional hook (shock, heartbreak, dread, temptation, awe)
4. Connects to the story's stakes and characters
5. Feels earned by setup from the episode, not arbitrary

Cliffhanger types:
- REVELATION: A shocking truth is revealed ("She was the killer all along")
- DANGER: Imminent threat with outcome unclear ("The timer hit zero as—")
- DECISION: Critical choice left hanging ("Join us, or die with them")
- BETRAYAL: Trust broken, consequences unknown
- ARRIVAL: Someone/something appears with unclear implications
- DEPARTURE: Someone leaves/is taken with unresolved impact
- MYSTERY: New question that demands answers
- REFRAME: A prior assumption changes meaning
- LOSS: A relationship, resource, safety, or belief is visibly taken away

Your task: Rewrite the final beat to create a compelling "${planDetails.type}" ${planDetails.intensity} cliffhanger.`;

      const userPrompt = `## Episode Context
${planDetails.title ? `Episode: "${planDetails.title}"` : 'Episode ending'}
${planDetails.logline ? `Logline: ${planDetails.logline}` : ''}

## Planned Cliffhanger
Type: ${planDetails.type}
Intensity: ${planDetails.intensity}
Story Circle launch beat: ${planDetails.storyCircleLaunchBeat || 'not specified'}
Hook: ${planDetails.hook}
Setup: ${planDetails.setup || 'Not specified'}
Resolved episode tension: ${planDetails.resolvedEpisodeTension || 'Not specified'}
New open question: ${planDetails.newOpenQuestion || 'Not specified'}
Emotional charge: ${planDetails.emotionalCharge || 'Not specified'}
Next episode pressure: ${planDetails.nextEpisodePressure || 'Not specified'}

## Current Final Beat
${lastBeat.text}

## Analysis of Current Ending
Quality: ${analysis.quality}
Weaknesses: ${analysis.weaknesses.join(', ')}

## Your Task
Rewrite the final beat to deliver a compelling "${planDetails.type}" cliffhanger that:
1. Acknowledges the resolved/changed episode tension
2. Implements the planned hook: "${planDetails.hook}"
3. Makes the reader NEED to continue
4. Keeps the visual moment concrete for illustration

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
          cliffhangerType: planDetails.type,
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

  private selectFinalCliffhangerBeat(scene: Scene | undefined): Beat | undefined {
    const beats = scene?.beats || [];
    if (beats.length === 0) return undefined;

    const hasText = (beat: Beat): boolean => Boolean((beat.text || '').trim());
    const isChoicePayoffBridge = (beat: Beat): boolean => {
      const data = beat as Beat & { isChoiceBridge?: boolean; sourceChoiceId?: string };
      const isIntentionalCoda = /cliffhanger-coda$/i.test(data.id || '');
      return Boolean((data.sourceChoiceId || data.isChoiceBridge) && !isIntentionalCoda);
    };

    return [...beats].reverse().find((beat) => hasText(beat) && !isChoicePayoffBridge(beat))
      || [...beats].reverse().find(hasText)
      || beats[beats.length - 1];
  }

  private analyzeTextForCliffhanger(text: string, plan: EpisodePlan | CliffhangerPlan): CliffhangerAnalysis {
    const planDetails = this.getPlanDetails(plan);
    const lowerText = text.toLowerCase();
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    let score = 35;
    
    const indicators: Record<string, string[]> = {
      resolved: ['but', 'after', 'finally', 'at last', 'won', 'survived', 'escaped', 'settled', 'ended', 'changed'],
      nextPressure: ['tomorrow', 'next', 'before dawn', 'waiting', 'coming', 'until', 'would have to', 'must', 'could not go back'],
      specificity: ['letter', 'name', 'blood', 'door', 'hand', 'voice', 'face', 'key', 'mark', 'message', 'shadow'],
      emotion: ['heart', 'breath', 'throat', 'hands', 'tremble', 'frozen', 'shock', 'dread', 'tears', 'ache', 'fear'],
      setup: ['same', 'earlier', 'again', 'recognized', 'remembered', 'the mark', 'the letter', 'the promise', 'the name'],
      revelation: ['realized', 'truth', 'discovered', 'revealed', 'secret', 'actually', 'was never'],
      danger: ['danger', 'threat', 'attack', 'scream', 'explosion', 'blood', 'weapon', 'hunted'],
      arrival: ['appeared', 'arrived', 'entered', 'door opened', 'figure', 'silhouette', 'stepped inside'],
      betrayal: ['betrayed', 'lied', 'deceived', 'trust', 'never told', 'sold you out'],
      decision: ['choose', 'decision', 'must decide', 'offer', 'join', 'refuse'],
      reframe: ['not what', 'never been', 'all along', 'meant something else', 'wrong about'],
      loss: ['gone', 'lost', 'dead', 'taken', 'empty', 'missing', 'ruined'],
    };

    for (const [category, words] of Object.entries(indicators)) {
      const found = words.filter(ind => lowerText.includes(ind));
      if (found.length > 0) {
        score += category === 'specificity' || category === 'emotion' ? 12 : 8;
        strengths.push(`Contains ${category} elements: ${found.join(', ')}`);
      }
    }

    if (planDetails.hook && this.hasMeaningfulOverlap(lowerText, planDetails.hook)) {
      score += 15;
      strengths.push('Final beat overlaps with the planned hook');
    } else if (planDetails.hook) {
      score -= 15;
      weaknesses.push('Final beat does not clearly deliver the planned hook');
    }

    if (planDetails.newOpenQuestion && this.hasMeaningfulOverlap(lowerText, planDetails.newOpenQuestion)) {
      score += 10;
      strengths.push('Opens the planned next question');
    }

    if (planDetails.resolvedEpisodeTension && this.hasMeaningfulOverlap(lowerText, planDetails.resolvedEpisodeTension)) {
      score += 8;
      strengths.push('Acknowledges the episode tension before opening the hook');
    }
    
    const overResolvedIndicators = [
      'everything was over', 'nothing else mattered', 'peace at last', 'happily',
      'no more danger', 'finally safe', 'the end'
    ];
    const hasOverResolution = overResolvedIndicators.some(ind => lowerText.includes(ind));
    if (hasOverResolution) {
      score -= 30;
      weaknesses.push('Ending feels fully resolved rather than serialized');
    }
    
    const cheapPunctuationOnly = /(\.\.\.|—|\?)\s*$/.test(text.trim())
      && !indicators.specificity.some(w => lowerText.includes(w))
      && !indicators.emotion.some(w => lowerText.includes(w));
    if (cheapPunctuationOnly) {
      score -= 15;
      weaknesses.push('Relies on cliffhanger punctuation without concrete story pressure');
    }
    
    // Check length (too short = weak, too long = diluted)
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 20) {
      score -= 10;
      weaknesses.push('Final beat is very short');
    } else if (wordCount > 150) {
      score -= 5;
      weaknesses.push('Final beat may dilute tension with length');
    }
    
    // Detect cliffhanger type
    let detectedType = this.detectType(lowerText);
    
    if (this.typeMatchesPlan(detectedType, planDetails.type, planDetails.storyCircleLaunchBeat)) {
      score += 12;
      strengths.push(`Matches planned cliffhanger type/Story Circle beat: ${planDetails.type}`);
    } else {
      score -= 8;
      weaknesses.push(`Planned "${planDetails.type}" but detected "${detectedType}"`);
    }

    if (planDetails.intensity === 'high') {
      const highIntensityTypes: CliffhangerType[] = ['shock', 'emotional_hook', 'betrayal', 'reframe', 'revelation', 'loss', 'danger'];
      if (highIntensityTypes.includes(detectedType)) {
        score += 8;
        strengths.push('High-intensity ending uses an appropriately sharp hook type');
      } else {
        score -= 12;
        weaknesses.push('High-intensity episode needs shock, emotional rupture, betrayal, reframe, revelation, loss, or danger');
      }
    }

    // Determine quality
    score = Math.max(0, Math.min(100, score));
    let quality: CliffhangerAnalysis['quality'];
    if (score >= 80) quality = 'excellent';
    else if (score >= 62) quality = 'good';
    else if (score >= 35) quality = 'weak';
    else quality = 'missing';
    
    const suggestions: string[] = [];
    if (hasOverResolution) {
      suggestions.push('Keep the immediate consequence, but remove full-closure language');
    }
    if (cheapPunctuationOnly) {
      suggestions.push('Replace punctuation-only suspense with a concrete object, arrival, revelation, or emotional rupture');
    }
    if (planDetails.hook && !this.hasMeaningfulOverlap(lowerText, planDetails.hook)) {
      suggestions.push(`Deliver the planned hook: ${planDetails.hook}`);
    }
    if (planDetails.intensity === 'high') {
      suggestions.push('Use a high-intensity shock/emotional/reveal beat tied to the episode setup');
    }
    
    return {
      hasCliffhanger: score >= 45,
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

  private detectType(lowerText: string): CliffhangerType {
    if (lowerText.includes('revealed') || lowerText.includes('truth') || lowerText.includes('actually')) {
      return 'revelation';
    }
    if (lowerText.includes('all along') || lowerText.includes('not what') || lowerText.includes('wrong about')) return 'reframe';
    if (lowerText.includes('betray') || lowerText.includes('lied') || lowerText.includes('deceiv') || lowerText.includes('sold you out')) return 'betrayal';
    if (lowerText.includes('gone') || lowerText.includes('lost') || lowerText.includes('dead') || lowerText.includes('taken')) return 'loss';
    if (lowerText.includes('danger') || lowerText.includes('attack') || lowerText.includes('threat') || lowerText.includes('weapon')) return 'danger';
    if (lowerText.includes('appeared') || lowerText.includes('arrived') || lowerText.includes('door opened') || lowerText.includes('stepped inside')) return 'arrival';
    if (lowerText.includes('left') || lowerText.includes('departed')) return 'departure';
    if (lowerText.includes('choose') || lowerText.includes('decision') || lowerText.includes('must')) return 'decision';
    if (lowerText.includes('heart') || lowerText.includes('tears') || lowerText.includes('throat') || lowerText.includes('tremble')) return 'emotional_hook';
    if (lowerText.includes('shock') || lowerText.includes('froze') || lowerText.includes('could not breathe')) return 'shock';
    return 'mystery';
  }

  private typeMatchesPlan(detected: CliffhangerType, planned: CliffhangerType, beat?: StoryCircleBeat): boolean {
    if (detected === planned) return true;
    if (planned === 'shock' && ['revelation', 'reframe', 'betrayal', 'loss', 'danger'].includes(detected)) return true;
    if (planned === 'emotional_hook' && ['betrayal', 'loss', 'decision', 'transformation'].includes(detected)) return true;
    if (beat === 'find' && ['reframe', 'revelation', 'shock'].includes(detected)) return true;
    if (beat === 'take' && ['emotional_hook', 'loss', 'betrayal', 'danger'].includes(detected)) return true;
    return false;
  }

  private hasMeaningfulOverlap(textLower: string, phrase: string): boolean {
    const tokens = phrase
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 4 && !['episode', 'pressure', 'question', 'conflict', 'tension'].includes(token));
    if (tokens.length === 0) return false;
    return tokens.slice(0, 12).some(token => textLower.includes(token));
  }

  private getPlanDetails(plan: EpisodePlan | CliffhangerPlan): {
    type: CliffhangerType;
    intensity?: string;
    hook: string;
    setup?: string;
    title?: string;
    logline?: string;
    resolvedEpisodeTension?: string;
    newOpenQuestion?: string;
    emotionalCharge?: string;
    nextEpisodePressure?: string;
    storyCircleLaunchBeat?: StoryCircleBeat;
  } {
    if ('hook' in plan && 'newOpenQuestion' in plan) {
      return {
        type: plan.type,
        intensity: plan.intensity,
        hook: plan.hook,
        setup: plan.setup,
        resolvedEpisodeTension: plan.resolvedEpisodeTension,
        newOpenQuestion: plan.newOpenQuestion,
        emotionalCharge: plan.emotionalCharge,
        nextEpisodePressure: plan.nextEpisodePressure,
        storyCircleLaunchBeat: plan.storyCircleLaunchBeat,
      };
    }
    return {
      type: plan.cliffhangerType,
      intensity: 'medium',
      hook: plan.cliffhangerHook,
      setup: plan.cliffhangerSetup,
      title: plan.title,
      logline: plan.logline,
      resolvedEpisodeTension: plan.mustAccomplish?.join('; '),
      newOpenQuestion: plan.nextEpisodeSetup?.join('; '),
      emotionalCharge: 'curiosity, tension, or dread',
      nextEpisodePressure: plan.nextEpisodeSetup?.join('; '),
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

  protected getAgentSpecificPrompt(): string {
    return this.buildCliffhangerPrompt();
  }

  private buildCliffhangerPrompt(): string {
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
    
    const plan = input.cliffhangerPlan || input.episodePlan;
    const details = this.getPlanDetails(plan);
    return `## Episode Context
Episode ${input.episodePlan.episodeNumber}: "${input.episodePlan.title}"
Is Finale: ${input.isFinale}

## Planned Cliffhanger
Type: ${details.type}
Intensity: ${details.intensity || 'medium'}
Story Circle launch beat: ${details.storyCircleLaunchBeat || 'not specified'}
Hook: ${details.hook}
Setup: ${details.setup || 'Not specified'}
Resolved episode tension: ${details.resolvedEpisodeTension || 'Not specified'}
New open question: ${details.newOpenQuestion || 'Not specified'}
Emotional charge: ${details.emotionalCharge || 'Not specified'}

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
      return this.quickAnalyze(input.episode, input.cliffhangerPlan || input.episodePlan);
    }
  }

  protected parseJSON(response: string): any {
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
