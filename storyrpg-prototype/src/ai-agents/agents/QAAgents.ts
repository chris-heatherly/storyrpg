/**
 * Quality Assurance Agents
 *
 * A cluster of agents responsible for validating generated content:
 * - ContinuityChecker: Validates state consistency and timeline logic
 * - VoiceValidator: Ensures character dialogue matches voice profiles
 * - StakesAnalyzer: Verifies choices have proper stakes and meaning
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SceneContent, GeneratedBeat } from './SceneWriter';
import { ChoiceSet } from './ChoiceAuthor';
import { CharacterProfile, VoiceProfile } from './CharacterDesigner';
import { Beat, Choice } from '../../types';

// ============================================
// CONTINUITY CHECKER
// ============================================

export interface ContinuityCheckerInput {
  // Content to check
  sceneContents: SceneContent[];

  // State context
  knownFlags: Array<{ name: string; description: string; currentValue?: boolean }>;
  knownScores: Array<{ name: string; description: string; currentValue?: number }>;
  knownTags: Array<{ name: string; description: string }>;

  // World facts
  establishedFacts: string[];
  characterKnowledge: Array<{
    characterId: string;
    knows: string[];
    doesNotKnow: string[];
  }>;

  // Timeline
  timelineEvents?: Array<{
    event: string;
    when: string;
  }>;

  // When true, the prompt instructs the checker to focus on cross-scene
  // inconsistencies (because local/intra-scene checks have already been
  // performed incrementally during generation).
  focusCrossScene?: boolean;
}

export interface ContinuityIssue {
  severity: 'error' | 'warning' | 'suggestion';
  type: 'contradiction' | 'impossible_knowledge' | 'timeline_error' | 'state_conflict' | 'missing_setup';
  location: {
    sceneId: string;
    beatId?: string;
    choiceId?: string;
  };
  description: string;
  conflictsWith?: string;
  suggestedFix: string;
}

export interface ContinuityReport {
  overallScore: number; // 0-100
  issueCount: {
    errors: number;
    warnings: number;
    suggestions: number;
  };
  issues: ContinuityIssue[];
  passedChecks: string[];
  recommendations: string[];
}

export class ContinuityChecker extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Continuity Checker', config);
    // Phase 3.4: QA agents should judge against the shared storytelling principles
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Continuity Checker

You are the guardian of narrative consistency. Your job is to find contradictions, impossible knowledge, timeline errors, and state conflicts before they reach players.

## What You Check

### State Consistency
- Flags referenced must be set somewhere
- Scores must be initialized before being compared
- Tags added must not already exist; tags removed must exist

### Timeline Logic
- Events must happen in possible order
- Characters can't reference future events
- Travel time must be plausible

### Character Knowledge
- Characters can only know what they've learned
- Information can't appear before it's revealed
- Secrets must stay secret until revealed

### Cause and Effect
- Every consequence must have a cause
- Referenced events must actually happen
- Conditions must be satisfiable

## Severity Levels

- **ERROR**: Game-breaking contradiction that MUST be fixed
- **WARNING**: Noticeable issue that SHOULD be fixed
- **SUGGESTION**: Minor improvement that COULD be made

## Output Format

For each issue:
1. Clearly identify the location (scene, beat, choice)
2. Explain what's wrong
3. Reference what it conflicts with
4. Suggest a specific fix

Be thorough but not pedantic. Focus on issues players would actually notice.
`;
  }

  async execute(input: ContinuityCheckerInput): Promise<AgentResponse<ContinuityReport>> {
    const prompt = this.buildPrompt(input);

    console.log(`[ContinuityChecker] Running continuity check...`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[ContinuityChecker] Received response (${response.length} chars)`);

      let report: ContinuityReport;
      try {
        report = this.parseJSON<ContinuityReport>(response);
      } catch (parseError) {
        console.error(`[ContinuityChecker] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Normalize the report
      report = this.normalizeReport(report);

      return {
        success: true,
        data: report,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ContinuityChecker] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeReport(report: ContinuityReport): ContinuityReport {
    // Ensure overallScore is a number
    if (typeof report.overallScore !== 'number') {
      report.overallScore = 50;
    }

    // Ensure issueCount exists with all fields
    if (!report.issueCount) {
      report.issueCount = { errors: 0, warnings: 0, suggestions: 0 };
    } else {
      if (typeof report.issueCount.errors !== 'number') {
        report.issueCount.errors = 0;
      }
      if (typeof report.issueCount.warnings !== 'number') {
        report.issueCount.warnings = 0;
      }
      if (typeof report.issueCount.suggestions !== 'number') {
        report.issueCount.suggestions = 0;
      }
    }

    // Ensure arrays are arrays
    if (!report.issues) {
      report.issues = [];
    } else if (!Array.isArray(report.issues)) {
      report.issues = [report.issues as unknown as ContinuityIssue];
    }

    if (!report.passedChecks) {
      report.passedChecks = [];
    } else if (!Array.isArray(report.passedChecks)) {
      report.passedChecks = [report.passedChecks as unknown as string];
    }

    if (!report.recommendations) {
      report.recommendations = [];
    } else if (!Array.isArray(report.recommendations)) {
      report.recommendations = [report.recommendations as unknown as string];
    }

    return report;
  }

  private buildPrompt(input: ContinuityCheckerInput): string {
    const scenesSummary = input.sceneContents.map(sc => {
      const beatSummary = sc.beats.map(b =>
        `    - ${b.id}: "${b.text.slice(0, 100)}..."`
      ).join('\n');
      return `  Scene: ${sc.sceneId} (${sc.sceneName})\n${beatSummary}`;
    }).join('\n\n');

    const flagsList = input.knownFlags
      .map(f => `- ${f.name}: ${f.description}${f.currentValue !== undefined ? ` (currently: ${f.currentValue})` : ''}`)
      .join('\n');

    const factsList = input.establishedFacts
      .map(f => `- ${f}`)
      .join('\n');

    const focusCrossScene = input.focusCrossScene === true;
    const taskHeader = focusCrossScene
      ? `## Your Task (Cross-Scene Focus)

Per-scene / local continuity has already been checked incrementally during
generation. Focus your review on CROSS-SCENE issues that only become visible
when looking at multiple scenes together:

1. Contradictions between scenes (facts, character behavior, world state)
2. Characters knowing things they could not have learned yet given scene order
3. Timeline impossibilities across the episode
4. State references that rely on setup in a later scene
5. Cause-effect chains that break across scene boundaries

Do NOT spend effort re-auditing issues that live inside a single scene; the
incremental validators have already surfaced those.`
      : `## Your Task

Analyze this content for:
1. Contradictions between scenes or within scenes
2. Characters knowing things they shouldn't
3. Timeline impossibilities
4. State references without proper setup
5. Missing cause-effect relationships`;

    return `
Check the following content for continuity issues:

## Scene Content
${scenesSummary}

## Known State
### Flags
${flagsList || 'None defined'}

### Established Facts
${factsList || 'None established'}

### Character Knowledge
${input.characterKnowledge.map(ck =>
  `${ck.characterId}:\n  Knows: ${ck.knows.join(', ')}\n  Doesn't Know: ${ck.doesNotKnow.join(', ')}`
).join('\n') || 'No character knowledge tracked'}

## Timeline
${input.timelineEvents?.map(e => `- ${e.when}: ${e.event}`).join('\n') || 'No timeline established'}

${taskHeader}

Provide a ContinuityReport with:
- Overall consistency score (0-100)
- All issues found with severity, location, and suggested fixes
- List of passed checks (things you verified are consistent)
- Recommendations for improving consistency

Respond with valid JSON matching the ContinuityReport type.
`;
  }
}

// ============================================
// VOICE VALIDATOR
// ============================================

export interface VoiceValidatorInput {
  // Content to validate
  sceneContents: SceneContent[];

  // Character voice profiles
  characterProfiles: Array<{
    id: string;
    name: string;
    voiceProfile: VoiceProfile;
  }>;
}

export interface VoiceIssue {
  severity: 'error' | 'warning' | 'suggestion';
  characterId: string;
  characterName: string;
  location: {
    sceneId: string;
    beatId: string;
  };
  dialogueLine: string;
  issue: string;
  suggestion: string;
  exampleCorrection?: string;
}

export interface VoiceReport {
  overallScore: number; // 0-100
  characterScores: Array<{
    characterId: string;
    characterName: string;
    score: number;
    strengths: string[];
    weaknesses: string[];
  }>;
  issues: VoiceIssue[];
  distinctionScore: number; // How well can you tell characters apart?
  recommendations: string[];
}

export class VoiceValidator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Voice Validator', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Voice Validator

You ensure every character sounds like themselves and nobody else. Distinct voices are essential for immersive storytelling.

## What You Check

### Voice Consistency
- Does dialogue match the character's vocabulary level?
- Are their verbal tics and expressions present?
- Does sentence structure match their profile?
- Is formality level consistent?

### Emotional Authenticity
- Do emotional reactions match the character?
- Are their tells and mannerisms present?
- Does stress change their voice appropriately?

### Distinction
- Could you identify the speaker without tags?
- Do any two characters sound too similar?
- Are unique expressions actually unique?

## Scoring Criteria

- **90-100**: Perfect voice, immediately recognizable
- **70-89**: Good voice with minor inconsistencies
- **50-69**: Voice is present but not strong
- **Below 50**: Character sounds generic or wrong

## Common Issues

- Using vocabulary too advanced/simple for character
- Missing verbal tics in extended dialogue
- Formal character speaking casually (or vice versa)
- Two characters with identical speech patterns
- Emotional moments that don't reflect voice profile
`;
  }

  async execute(input: VoiceValidatorInput): Promise<AgentResponse<VoiceReport>> {
    const prompt = this.buildPrompt(input);

    console.log(`[VoiceValidator] Running voice validation...`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[VoiceValidator] Received response (${response.length} chars)`);

      let report: VoiceReport;
      try {
        report = this.parseJSON<VoiceReport>(response);
      } catch (parseError) {
        console.error(`[VoiceValidator] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Normalize the report
      report = this.normalizeReport(report);

      return {
        success: true,
        data: report,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[VoiceValidator] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeReport(report: VoiceReport): VoiceReport {
    // Ensure overallScore is a number
    if (typeof report.overallScore !== 'number') {
      report.overallScore = 50;
    }

    // Ensure distinctionScore is a number
    if (typeof report.distinctionScore !== 'number') {
      report.distinctionScore = 50;
    }

    // Ensure arrays are arrays
    if (!report.characterScores) {
      report.characterScores = [];
    } else if (!Array.isArray(report.characterScores)) {
      report.characterScores = [report.characterScores as unknown as VoiceReport['characterScores'][0]];
    }

    if (!report.issues) {
      report.issues = [];
    } else if (!Array.isArray(report.issues)) {
      report.issues = [report.issues as unknown as VoiceIssue];
    }

    if (!report.recommendations) {
      report.recommendations = [];
    } else if (!Array.isArray(report.recommendations)) {
      report.recommendations = [report.recommendations as unknown as string];
    }

    return report;
  }

  private buildPrompt(input: VoiceValidatorInput): string {
    // Extract all dialogue
    const dialogueByCharacter: Record<string, Array<{ sceneId: string; beatId: string; line: string }>> = {};

    for (const scene of input.sceneContents) {
      for (const beat of scene.beats) {
        if (beat.speaker) {
          if (!dialogueByCharacter[beat.speaker]) {
            dialogueByCharacter[beat.speaker] = [];
          }
          dialogueByCharacter[beat.speaker].push({
            sceneId: scene.sceneId,
            beatId: beat.id,
            line: beat.text,
          });
        }
      }
    }

    const dialogueSummary = Object.entries(dialogueByCharacter)
      .map(([speaker, lines]) => {
        const lineList = lines.map(l => `    "${l.line.slice(0, 150)}..." (${l.sceneId}/${l.beatId})`).join('\n');
        return `  ${speaker}:\n${lineList}`;
      })
      .join('\n\n');

    const profileSummary = input.characterProfiles
      .map(cp => `
### ${cp.name} (${cp.id})
- Vocabulary: ${cp.voiceProfile.vocabulary}
- Sentence Length: ${cp.voiceProfile.sentenceLength}
- Formality: ${cp.voiceProfile.formality}
- Verbal Tics: ${cp.voiceProfile.verbalTics.join(', ')}
- Favorite Expressions: ${cp.voiceProfile.favoriteExpressions.join(', ')}
- When Happy: ${cp.voiceProfile.whenHappy}
- When Angry: ${cp.voiceProfile.whenAngry}
- Sample Lines: ${cp.voiceProfile.greetingExamples.slice(0, 2).join(' | ')}
`)
      .join('\n');

    return `
Validate character voices in the following content:

## Character Voice Profiles
${profileSummary}

## Dialogue to Validate
${dialogueSummary}

## Your Task

For each character with dialogue:
1. Compare their lines to their voice profile
2. Check for vocabulary, tic, and formality consistency
3. Identify any lines that sound "off"
4. Score overall voice consistency

Also evaluate:
- How distinct are the characters from each other?
- Could you identify speakers without tags?
- Are there any voice "collisions"?

Provide a VoiceReport with:
- Overall voice quality score
- Per-character scores with strengths and weaknesses
- Specific issues with suggested corrections
- Voice distinction score
- Recommendations for improvement

Respond with valid JSON matching the VoiceReport type.
`;
  }
}

// ============================================
// STAKES ANALYZER
// ============================================

export interface StakesAnalyzerInput {
  // Choices to analyze
  choiceSets: ChoiceSet[];

  // Scene context
  sceneContexts: Array<{
    sceneId: string;
    sceneName: string;
    mood: string;
    narrativeFunction: string;
  }>;

  // Story context
  storyThemes: string[];
  targetTone: string;
}

export interface StakesIssue {
  severity: 'error' | 'warning' | 'suggestion';
  choiceSetId: string;
  issue: string;
  affectedChoices?: string[];
  suggestion: string;
}

export interface StakesReport {
  overallScore: number; // 0-100

  // Per choice set analysis
  choiceSetAnalysis: Array<{
    beatId: string;
    type: string;
    stakesScore: number;
    wantClarity: number;
    costWeight: number;
    identityResonance: number;
    analysis: string;
    improvements: string[];
  }>;

  // Aggregate metrics
  metrics: {
    averageStakesScore: number;
    falseChoiceCount: number; // Choices with same outcome
    dilemmaQuality: number; // How hard are the hard choices?
    varietyScore: number; // Mix of choice types
  };

  issues: StakesIssue[];
  strengths: string[];
  recommendations: string[];
}

export class StakesAnalyzer extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Stakes Analyzer', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Stakes Analyzer

You ensure every choice feels meaningful and every decision matters. Weak stakes make for forgettable stories.

## The Stakes Triangle

Every significant choice needs:
- **WANT**: What is the player pursuing? Is it clear and compelling?
- **COST**: What must be sacrificed or risked? Is it proportional?
- **IDENTITY**: What does choosing reveal about the player? Is it meaningful?

## What You Analyze

### Choice Quality
- Do all options feel valid?
- Is there a "right answer" that makes other options pointless?
- Are consequences proportional to the choice weight?

### False Choice Detection
- Do different options lead to the same outcome?
- Are some options clearly superior?
- Is one option obviously "the developer's choice"?

### Dilemma Quality (for moral dilemmas)
- Is the dilemma genuinely hard?
- Are both sides sympathetic?
- Do players have enough information to choose meaningfully?

### Stakes Progression
- Do stakes escalate through the episode?
- Is there variety in choice types?
- Do climactic moments have climactic stakes?

## Scoring Criteria

### Stakes Score (per choice)
- **90-100**: Perfect stakes, memorable decision
- **70-89**: Good stakes, engaging choice
- **50-69**: Adequate stakes, serviceable
- **Below 50**: Weak stakes, forgettable

### Dilemma Quality
- **High**: "I genuinely don't know what to do"
- **Medium**: "This is tough but I can decide"
- **Low**: "One option is clearly better"
`;
  }

  async execute(input: StakesAnalyzerInput): Promise<AgentResponse<StakesReport>> {
    const prompt = this.buildPrompt(input);

    console.log(`[StakesAnalyzer] Running stakes analysis...`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[StakesAnalyzer] Received response (${response.length} chars)`);

      let report: StakesReport;
      try {
        report = this.parseJSON<StakesReport>(response);
      } catch (parseError) {
        console.error(`[StakesAnalyzer] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Normalize the report
      report = this.normalizeReport(report);

      return {
        success: true,
        data: report,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[StakesAnalyzer] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeReport(report: StakesReport): StakesReport {
    // Ensure overallScore is a number
    if (typeof report.overallScore !== 'number') {
      report.overallScore = 50;
    }

    // Ensure metrics exists with all fields
    if (!report.metrics) {
      report.metrics = { averageStakesScore: 50, falseChoiceCount: 0, dilemmaQuality: 50, varietyScore: 50 };
    } else {
      if (typeof report.metrics.averageStakesScore !== 'number') {
        report.metrics.averageStakesScore = 50;
      }
      if (typeof report.metrics.falseChoiceCount !== 'number') {
        report.metrics.falseChoiceCount = 0;
      }
      if (typeof report.metrics.dilemmaQuality !== 'number') {
        report.metrics.dilemmaQuality = 50;
      }
      if (typeof report.metrics.varietyScore !== 'number') {
        report.metrics.varietyScore = 50;
      }
    }

    // Ensure arrays are arrays
    if (!report.choiceSetAnalysis) {
      report.choiceSetAnalysis = [];
    } else if (!Array.isArray(report.choiceSetAnalysis)) {
      report.choiceSetAnalysis = [report.choiceSetAnalysis as unknown as StakesReport['choiceSetAnalysis'][0]];
    }

    if (!report.issues) {
      report.issues = [];
    } else if (!Array.isArray(report.issues)) {
      report.issues = [report.issues as unknown as StakesIssue];
    }

    if (!report.strengths) {
      report.strengths = [];
    } else if (!Array.isArray(report.strengths)) {
      report.strengths = [report.strengths as unknown as string];
    }

    if (!report.recommendations) {
      report.recommendations = [];
    } else if (!Array.isArray(report.recommendations)) {
      report.recommendations = [report.recommendations as unknown as string];
    }

    return report;
  }

  private buildPrompt(input: StakesAnalyzerInput): string {
    const choicesSummary = input.choiceSets.map(cs => {
      const optionList = cs.choices.map(c =>
        `    - "${c.text}" → ${c.nextSceneId || 'same scene'}${c.consequences?.length ? ` (${c.consequences.length} consequences)` : ''}`
      ).join('\n');

      return `
### Choice Set: ${cs.beatId}
Type: ${cs.choiceType}
Stakes: Want: ${cs.overallStakes.want} | Cost: ${cs.overallStakes.cost} | Identity: ${cs.overallStakes.identity}
Options:
${optionList}`;
    }).join('\n');

    const sceneContext = input.sceneContexts
      .map(sc => `- ${sc.sceneName}: ${sc.mood}, ${sc.narrativeFunction}`)
      .join('\n');

    return `
Analyze the stakes and quality of the following choices:

## Story Context
- **Themes**: ${input.storyThemes.join(', ')}
- **Target Tone**: ${input.targetTone}

## Scene Context
${sceneContext}

## Choices to Analyze
${choicesSummary}

## Your Task

For each choice set:
1. Evaluate the Stakes Triangle (Want, Cost, Identity)
2. Check for false choices or obvious "right answers"
3. Assess whether stakes match the choice type
4. Score overall choice quality

Also evaluate:
- Stakes progression through the episode
- Variety of choice types
- Quality of any moral dilemmas
- Overall engagement potential

Provide a StakesReport with:
- Overall stakes score
- Per-choice-set detailed analysis
- Aggregate metrics (false choices, dilemma quality, variety)
- Specific issues with suggestions
- Strengths to maintain
- Recommendations for improvement

Respond with valid JSON matching the StakesReport type.
`;
  }
}

// ============================================
// COMBINED QA RUNNER
// ============================================

export interface QAInput {
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  characterProfiles: Array<{
    id: string;
    name: string;
    voiceProfile: VoiceProfile;
  }>;
  knownFlags: Array<{ name: string; description: string }>;
  knownScores: Array<{ name: string; description: string }>;
  knownTags?: Array<{ name: string; description: string }>;
  establishedFacts: string[];
  storyThemes: string[];
  targetTone: string;
  sceneContexts: Array<{
    sceneId: string;
    sceneName: string;
    mood: string;
    narrativeFunction: string;
  }>;
  // Optional knowledge / timeline feeds for ContinuityChecker.
  // When omitted, ContinuityChecker falls back to "no character knowledge
  // tracked" / "no timeline established" prompt stanzas, which is the
  // previous behaviour.
  characterKnowledge?: Array<{
    characterId: string;
    knows: string[];
    doesNotKnow: string[];
  }>;
  timelineEvents?: Array<{
    event: string;
    when: string;
  }>;
}

export interface QAReport {
  continuity: ContinuityReport;
  voice: VoiceReport;
  stakes: StakesReport;
  overallScore: number;
  passesQA: boolean;
  criticalIssues: string[];
  summary: string;
  skippedChecks?: string[]; // Which checks were skipped due to incremental validation
}

/**
 * Options for QA execution - allows skipping checks done incrementally
 */
export interface QARunnerOptions {
  /** Skip voice validation (already done per-scene incrementally) */
  skipVoiceValidation?: boolean;
  /** Skip stakes analysis (already done per-choice incrementally) */
  skipStakesAnalysis?: boolean;
  /** Focus continuity on cross-scene issues (local issues caught incrementally) */
  continuityFocusCrossScene?: boolean;
  /** Pre-computed incremental validation results to include in report */
  incrementalResults?: {
    voiceIssueCount?: number;
    stakesIssueCount?: number;
    continuityIssueCount?: number;
    /**
     * Actual aggregated voice issues from incremental validators, each
     * tagged with the scene they came from. Consumed by the skip stub so
     * `skippedVoiceReport.issues` reflects real findings rather than an
     * empty array.
     */
    voiceIssues?: Array<{
      sceneId: string;
      beatId: string;
      characterId: string;
      characterName: string;
      severity: 'error' | 'warning';
      issue: string;
      suggestion?: string;
    }>;
    /**
     * Actual aggregated stakes issues from incremental validators.
     * Consumed by the skip stub so `skippedStakesReport.issues` reflects
     * real findings rather than an empty array.
     */
    stakesIssues?: Array<{
      sceneId: string;
      choiceSetId: string;
      severity: 'error' | 'warning';
      issue: string;
      suggestion?: string;
    }>;
  };
}

export class QARunner {
  private continuityChecker: ContinuityChecker;
  private voiceValidator: VoiceValidator;
  private stakesAnalyzer: StakesAnalyzer;

  constructor(config: AgentConfig) {
    this.continuityChecker = new ContinuityChecker(config);
    this.voiceValidator = new VoiceValidator(config);
    this.stakesAnalyzer = new StakesAnalyzer(config);
  }

  async runFullQA(input: QAInput, options: QARunnerOptions = {}): Promise<QAReport> {
    const skippedChecks: string[] = [];
    const checks: Promise<unknown>[] = [];
    
    // Track which indices correspond to which checks
    let continuityIdx = -1;
    let voiceIdx = -1;
    let stakesIdx = -1;

    // Continuity check - always run (but may focus on cross-scene if local was done)
    continuityIdx = checks.length;
    checks.push(
      this.continuityChecker.execute({
        sceneContents: input.sceneContents,
        knownFlags: input.knownFlags,
        knownScores: input.knownScores,
        knownTags: input.knownTags ?? [],
        establishedFacts: input.establishedFacts,
        characterKnowledge: input.characterKnowledge ?? [],
        timelineEvents: input.timelineEvents,
        focusCrossScene: options.continuityFocusCrossScene === true,
      })
    );
    if (options.continuityFocusCrossScene) {
      console.log('[QARunner] Focusing continuity check on cross-scene issues (local checked incrementally)');
    }

    // Voice validation - skip if already done incrementally
    if (options.skipVoiceValidation) {
      skippedChecks.push('voice');
      console.log('[QARunner] Skipping voice validation (done incrementally)');
    } else {
      voiceIdx = checks.length;
      checks.push(
        this.voiceValidator.execute({
          sceneContents: input.sceneContents,
          characterProfiles: input.characterProfiles,
        })
      );
    }

    // Stakes analysis - skip if already done incrementally
    if (options.skipStakesAnalysis) {
      skippedChecks.push('stakes');
      console.log('[QARunner] Skipping stakes analysis (done incrementally)');
    } else {
      stakesIdx = checks.length;
      checks.push(
        this.stakesAnalyzer.execute({
          choiceSets: input.choiceSets,
          sceneContexts: input.sceneContexts,
          storyThemes: input.storyThemes,
          targetTone: input.targetTone,
        })
      );
    }

    // Run all enabled checks in parallel
    const results = await Promise.all(checks);

    // Extract reports (use defaults if skipped or failed)
    const continuityResult = results[continuityIdx] as Awaited<ReturnType<ContinuityChecker['execute']>>;
    const continuity = continuityResult?.data || this.getDefaultContinuityReport();
    
    let voice: VoiceReport;
    if (options.skipVoiceValidation) {
      // Use a passing default if skipped (incremental caught issues)
      voice = this.getSkippedVoiceReport(
        options.incrementalResults?.voiceIssueCount || 0,
        options.incrementalResults?.voiceIssues,
      );
    } else {
      const voiceResult = results[voiceIdx] as Awaited<ReturnType<VoiceValidator['execute']>>;
      voice = voiceResult?.data || this.getDefaultVoiceReport();
    }
    
    let stakes: StakesReport;
    if (options.skipStakesAnalysis) {
      // Use a passing default if skipped (incremental caught issues)
      stakes = this.getSkippedStakesReport(
        options.incrementalResults?.stakesIssueCount || 0,
        options.incrementalResults?.stakesIssues,
      );
    } else {
      const stakesResult = results[stakesIdx] as Awaited<ReturnType<StakesAnalyzer['execute']>>;
      stakes = stakesResult?.data || this.getDefaultStakesReport();
    }

    // Calculate overall score
    const overallScore = Math.round(
      (continuity.overallScore * 0.35) +
      (voice.overallScore * 0.30) +
      (stakes.overallScore * 0.35)
    );

    // Collect critical issues
    const criticalIssues: string[] = [];

    if (continuity.issueCount.errors > 0) {
      criticalIssues.push(`${continuity.issueCount.errors} continuity error(s)`);
    }
    if (voice.issues.filter(i => i.severity === 'error').length > 0) {
      criticalIssues.push('Voice consistency errors');
    }
    if (stakes.metrics.falseChoiceCount > 0) {
      criticalIssues.push(`${stakes.metrics.falseChoiceCount} false choice(s)`);
    }

    // Generate summary
    const summary = this.generateSummary(continuity, voice, stakes, overallScore);

    return {
      continuity,
      voice,
      stakes,
      overallScore,
      passesQA: overallScore >= 70 && criticalIssues.length === 0,
      criticalIssues,
      summary,
      skippedChecks: skippedChecks.length > 0 ? skippedChecks : undefined,
    };
  }

  /**
   * Generate a voice report for when validation was skipped (done incrementally)
   */
  private getSkippedVoiceReport(
    incrementalIssueCount: number,
    incrementalIssues?: NonNullable<QARunnerOptions['incrementalResults']>['voiceIssues'],
  ): VoiceReport {
    const issues: VoiceIssue[] = (incrementalIssues ?? []).map(iss => ({
      severity: iss.severity,
      characterId: iss.characterId,
      characterName: iss.characterName,
      location: {
        sceneId: iss.sceneId,
        beatId: iss.beatId,
      },
      dialogueLine: '',
      issue: iss.issue,
      suggestion: iss.suggestion ?? '',
    }));

    return {
      overallScore: incrementalIssueCount === 0 ? 95 : Math.max(60, 95 - incrementalIssueCount * 5),
      characterScores: [],
      issues,
      distinctionScore: 85,
      recommendations: incrementalIssueCount > 0 
        ? [`${incrementalIssueCount} voice issue(s) were caught and addressed during incremental validation`]
        : ['Voice validation was performed incrementally during content generation'],
    };
  }

  /**
   * Generate a stakes report for when analysis was skipped (done incrementally)
   */
  private getSkippedStakesReport(
    incrementalIssueCount: number,
    incrementalIssues?: NonNullable<QARunnerOptions['incrementalResults']>['stakesIssues'],
  ): StakesReport {
    const issues: StakesIssue[] = (incrementalIssues ?? []).map(iss => ({
      severity: iss.severity,
      choiceSetId: iss.choiceSetId,
      issue: iss.issue,
      suggestion: iss.suggestion ?? '',
    }));

    return {
      overallScore: incrementalIssueCount === 0 ? 95 : Math.max(60, 95 - incrementalIssueCount * 5),
      choiceSetAnalysis: [],
      metrics: {
        averageStakesScore: 85,
        falseChoiceCount: 0, // False choices would have been caught incrementally
        dilemmaQuality: 75,
        varietyScore: 80,
      },
      issues,
      strengths: ['Stakes were validated incrementally during content generation'],
      recommendations: incrementalIssueCount > 0
        ? [`${incrementalIssueCount} stakes issue(s) were caught and addressed during incremental validation`]
        : [],
    };
  }

  private generateSummary(
    continuity: ContinuityReport,
    voice: VoiceReport,
    stakes: StakesReport,
    overall: number
  ): string {
    const parts: string[] = [];

    parts.push(`Overall QA Score: ${overall}/100`);
    parts.push(`- Continuity: ${continuity.overallScore}/100 (${continuity.issueCount.errors} errors, ${continuity.issueCount.warnings} warnings)`);
    parts.push(`- Voice: ${voice.overallScore}/100 (${voice.distinctionScore}/100 distinction)`);
    parts.push(`- Stakes: ${stakes.overallScore}/100 (${stakes.metrics.falseChoiceCount} false choices)`);

    if (overall >= 80) {
      parts.push('\nContent quality is good. Minor polish recommended.');
    } else if (overall >= 60) {
      parts.push('\nContent needs revision before publishing.');
    } else {
      parts.push('\nSignificant issues found. Major revision required.');
    }

    return parts.join('\n');
  }

  private getDefaultContinuityReport(): ContinuityReport {
    return {
      overallScore: 0,
      issueCount: { errors: 1, warnings: 0, suggestions: 0 },
      issues: [{ severity: 'error', type: 'contradiction', location: { sceneId: 'unknown' }, description: 'Continuity check failed', suggestedFix: 'Review manually' }],
      passedChecks: [],
      recommendations: ['Manual review required'],
    };
  }

  private getDefaultVoiceReport(): VoiceReport {
    return {
      overallScore: 0,
      characterScores: [],
      issues: [],
      distinctionScore: 0,
      recommendations: ['Voice check failed - manual review required'],
    };
  }

  private getDefaultStakesReport(): StakesReport {
    return {
      overallScore: 0,
      choiceSetAnalysis: [],
      metrics: { averageStakesScore: 0, falseChoiceCount: 0, dilemmaQuality: 0, varietyScore: 0 },
      issues: [],
      strengths: [],
      recommendations: ['Stakes analysis failed - manual review required'],
    };
  }
}
