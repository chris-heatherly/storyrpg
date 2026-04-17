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

// ============================================
// PLOT HOLE DETECTOR
// ============================================

export interface PlotHoleDetectorInput {
  // Episode content
  episodeSummary: string;
  sceneContents: SceneContent[];

  // Story context
  storyContext: {
    title: string;
    genre: string;
    synopsis: string;
  };

  // Previous episode context
  previousEpisodeSummary?: string;
  establishedRules: string[]; // World rules that must be followed

  // Character information
  characterCapabilities: Array<{
    characterId: string;
    characterName: string;
    canDo: string[];
    cannotDo: string[];
  }>;

  // Unresolved threads from before
  openPlotThreads: Array<{
    description: string;
    introducedIn: string;
    importance: 'minor' | 'moderate' | 'major';
  }>;
}

export interface PlotHole {
  severity: 'minor' | 'moderate' | 'major' | 'critical';
  type: 'logical_inconsistency' | 'character_capability' | 'world_rule_violation' | 'unresolved_thread' | 'deus_ex_machina' | 'missing_motivation';
  location: {
    sceneId: string;
    beatId?: string;
    description: string;
  };
  description: string;
  whyItMatters: string;
  suggestedFix: string;
}

export interface PlotHoleReport {
  overallScore: number; // 0-100 (higher = fewer holes)
  plotHoles: PlotHole[];
  unresolvedThreads: Array<{
    thread: string;
    status: 'resolved' | 'advanced' | 'ignored' | 'contradicted';
    notes: string;
  }>;
  logicalFlowScore: number;
  worldConsistencyScore: number;
  characterConsistencyScore: number;
  recommendations: string[];
}

export class PlotHoleDetector extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Plot Hole Detector', config);
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Plot Hole Detector

You are the logic guardian who catches story problems before players do. A single plot hole can break immersion and undermine an otherwise great story.

## What You Detect

### Logical Inconsistencies
- Events that contradict earlier events
- Characters knowing things they shouldn't
- Timelines that don't add up
- Cause without effect or effect without cause

### Character Capability Violations
- Characters doing things they can't do
- Characters not using abilities when they obviously should
- Sudden skill gains without explanation
- Forgotten limitations

### World Rule Violations
- Breaking established physics/magic rules
- Inconsistent technology/power levels
- Geography/distance impossibilities
- Social rules broken without consequences

### Unresolved Threads
- Chekhov's guns that never fire
- Promises made and not kept
- Setup without payoff
- Introduced elements that disappear

### Deus Ex Machina
- Solutions that appear from nowhere
- Convenient coincidences that solve problems
- Previously unknown abilities/items saving the day
- External forces resolving internal conflicts

### Missing Motivation
- Characters acting without clear reasons
- Villain plans that make no sense
- Hero choices that seem random
- NPCs helping/hindering for no reason

## Severity Levels

- **CRITICAL**: Breaks the story, players WILL notice
- **MAJOR**: Significant issue, many players will notice
- **MODERATE**: Noticeable on reflection
- **MINOR**: Only careful readers will catch

## What's NOT a Plot Hole

- Unrealistic but genre-appropriate events
- Character mistakes (characters can be wrong)
- Deliberately mysterious elements
- Things explained later in the story
`;
  }

  async execute(input: PlotHoleDetectorInput): Promise<AgentResponse<PlotHoleReport>> {
    const prompt = this.buildPrompt(input);

    console.log(`[PlotHoleDetector] Scanning for plot holes...`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[PlotHoleDetector] Received response (${response.length} chars)`);

      let report: PlotHoleReport;
      try {
        report = this.parseJSON<PlotHoleReport>(response);
      } catch (parseError) {
        console.error(`[PlotHoleDetector] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
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
      console.error(`[PlotHoleDetector] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeReport(report: PlotHoleReport): PlotHoleReport {
    if (typeof report.overallScore !== 'number') {
      report.overallScore = 50;
    }
    if (typeof report.logicalFlowScore !== 'number') {
      report.logicalFlowScore = 50;
    }
    if (typeof report.worldConsistencyScore !== 'number') {
      report.worldConsistencyScore = 50;
    }
    if (typeof report.characterConsistencyScore !== 'number') {
      report.characterConsistencyScore = 50;
    }

    if (!report.plotHoles) {
      report.plotHoles = [];
    } else if (!Array.isArray(report.plotHoles)) {
      report.plotHoles = [report.plotHoles as unknown as PlotHole];
    }

    if (!report.unresolvedThreads) {
      report.unresolvedThreads = [];
    } else if (!Array.isArray(report.unresolvedThreads)) {
      report.unresolvedThreads = [report.unresolvedThreads as unknown as PlotHoleReport['unresolvedThreads'][0]];
    }

    if (!report.recommendations) {
      report.recommendations = [];
    } else if (!Array.isArray(report.recommendations)) {
      report.recommendations = [report.recommendations as unknown as string];
    }

    return report;
  }

  private buildPrompt(input: PlotHoleDetectorInput): string {
    const scenesSummary = input.sceneContents.map(sc => {
      const beatSummary = sc.beats.map(b => `    - ${b.id}: "${b.text.slice(0, 150)}..."`).join('\n');
      return `  Scene: ${sc.sceneId} (${sc.sceneName})\n${beatSummary}`;
    }).join('\n\n');

    const capabilitiesList = input.characterCapabilities
      .map(cc => `  ${cc.characterName}: Can do: [${cc.canDo.join(', ')}] | Cannot do: [${cc.cannotDo.join(', ')}]`)
      .join('\n');

    const threadsList = input.openPlotThreads
      .map(t => `  - [${t.importance}] ${t.description} (from: ${t.introducedIn})`)
      .join('\n');

    return `
Scan for plot holes in the following content:

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Synopsis**: ${input.storyContext.synopsis}

${input.previousEpisodeSummary ? `## Previous Episode\n${input.previousEpisodeSummary}` : ''}

## Episode Summary
${input.episodeSummary}

## Scene Content
${scenesSummary}

## Established World Rules
${input.establishedRules.map(r => `- ${r}`).join('\n') || 'None specified'}

## Character Capabilities
${capabilitiesList || 'None specified'}

## Open Plot Threads
${threadsList || 'None'}

## Your Task

Scan for:
1. Logical inconsistencies between scenes or with previous content
2. Characters doing things outside their capabilities
3. World rules being violated
4. Plot threads that should be addressed
5. Deus ex machina moments
6. Characters acting without clear motivation

Provide a PlotHoleReport with JSON.
`;
  }
}

// ============================================
// TONE ANALYZER
// ============================================

export interface ToneAnalyzerInput {
  // Content to analyze
  sceneContents: SceneContent[];

  // Target tone
  targetTone: {
    primary: string; // e.g., "dark", "whimsical", "serious"
    secondary?: string;
    avoid: string[]; // Tones to avoid
  };

  // Genre expectations
  genre: string;

  // Specific tone moments requested
  requestedMoments?: Array<{
    sceneId: string;
    intendedTone: string;
    purpose: string;
  }>;
}

export interface ToneIssue {
  severity: 'minor' | 'moderate' | 'major';
  sceneId: string;
  beatId?: string;
  detectedTone: string;
  expectedTone: string;
  excerpt: string;
  issue: string;
  suggestion: string;
}

export interface ToneReport {
  overallScore: number; // 0-100
  toneConsistency: number; // How consistent is the tone?
  genreAlignment: number; // Does it match genre expectations?

  dominantTones: Array<{
    tone: string;
    percentage: number;
  }>;

  toneByScene: Array<{
    sceneId: string;
    primaryTone: string;
    secondaryTones: string[];
    matchesTarget: boolean;
    notes: string;
  }>;

  issues: ToneIssue[];

  toneShifts: Array<{
    fromScene: string;
    toScene: string;
    fromTone: string;
    toTone: string;
    jarring: boolean;
    notes: string;
  }>;

  recommendations: string[];
}

export class ToneAnalyzer extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Tone Analyzer', config);
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Tone Analyzer

You ensure the emotional texture of the story matches its intended feel. Tone is the difference between a thriller and a comedy with the same plot.

## What You Analyze

### Tone Consistency
- Does the writing maintain its intended tone?
- Are there jarring shifts without purpose?
- Does word choice support the mood?

### Genre Alignment
- Does the tone match genre expectations?
- Are genre tropes used appropriately?
- Does it subvert expectations intentionally or accidentally?

### Emotional Texture
- Does the prose evoke the right feelings?
- Are tense moments actually tense?
- Are emotional beats landing?

### Tone Transitions
- Are shifts between tones smooth?
- Is comic relief timed well?
- Do tonal shifts serve the story?

## Common Tone Words

**Dark/Grim**: bleak, ominous, foreboding, haunting, gritty
**Light/Whimsical**: playful, cheerful, bubbly, quirky, warm
**Serious/Dramatic**: weighty, intense, solemn, grave, momentous
**Humorous**: witty, sardonic, absurd, ironic, playful
**Mysterious**: enigmatic, suspenseful, eerie, cryptic
**Romantic**: tender, passionate, longing, intimate, yearning
**Action-packed**: kinetic, urgent, breathless, explosive

## Tone Mismatches to Watch For

- Jokes in serious moments (unless intentional)
- Overly dark content in light stories
- Purple prose in fast-paced action
- Casual language in epic moments
- Tonal whiplash between scenes
`;
  }

  async execute(input: ToneAnalyzerInput): Promise<AgentResponse<ToneReport>> {
    const prompt = this.buildPrompt(input);

    console.log(`[ToneAnalyzer] Analyzing tone...`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[ToneAnalyzer] Received response (${response.length} chars)`);

      let report: ToneReport;
      try {
        report = this.parseJSON<ToneReport>(response);
      } catch (parseError) {
        console.error(`[ToneAnalyzer] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
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
      console.error(`[ToneAnalyzer] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeReport(report: ToneReport): ToneReport {
    if (typeof report.overallScore !== 'number') {
      report.overallScore = 50;
    }
    if (typeof report.toneConsistency !== 'number') {
      report.toneConsistency = 50;
    }
    if (typeof report.genreAlignment !== 'number') {
      report.genreAlignment = 50;
    }

    if (!report.dominantTones) {
      report.dominantTones = [];
    } else if (!Array.isArray(report.dominantTones)) {
      report.dominantTones = [report.dominantTones as unknown as ToneReport['dominantTones'][0]];
    }

    if (!report.toneByScene) {
      report.toneByScene = [];
    } else if (!Array.isArray(report.toneByScene)) {
      report.toneByScene = [report.toneByScene as unknown as ToneReport['toneByScene'][0]];
    }

    if (!report.issues) {
      report.issues = [];
    } else if (!Array.isArray(report.issues)) {
      report.issues = [report.issues as unknown as ToneIssue];
    }

    if (!report.toneShifts) {
      report.toneShifts = [];
    } else if (!Array.isArray(report.toneShifts)) {
      report.toneShifts = [report.toneShifts as unknown as ToneReport['toneShifts'][0]];
    }

    if (!report.recommendations) {
      report.recommendations = [];
    } else if (!Array.isArray(report.recommendations)) {
      report.recommendations = [report.recommendations as unknown as string];
    }

    return report;
  }

  private buildPrompt(input: ToneAnalyzerInput): string {
    const scenesSummary = input.sceneContents.map(sc => {
      const beatSummary = sc.beats.map(b => `    "${b.text.slice(0, 200)}..."`).join('\n');
      return `  Scene: ${sc.sceneId} (${sc.sceneName})\n${beatSummary}`;
    }).join('\n\n');

    return `
Analyze the tone of the following content:

## Target Tone
- **Primary**: ${input.targetTone.primary}
${input.targetTone.secondary ? `- **Secondary**: ${input.targetTone.secondary}` : ''}
- **Avoid**: ${input.targetTone.avoid.join(', ') || 'None specified'}

## Genre
${input.genre}

${input.requestedMoments ? `## Requested Tone Moments
${input.requestedMoments.map(m => `- ${m.sceneId}: ${m.intendedTone} (${m.purpose})`).join('\n')}` : ''}

## Content to Analyze
${scenesSummary}

## Your Task

Analyze:
1. What tones are actually present in the content?
2. How well do they match the target tone?
3. Are there any jarring tone shifts?
4. Does the genre alignment hold?

Provide a ToneReport with JSON.
`;
  }
}

// ============================================
// PACING AUDITOR
// ============================================

export interface PacingAuditorInput {
  // Episode structure
  episodeTitle: string;
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];

  // Pacing targets
  targetPacing: {
    overall: 'slow' | 'moderate' | 'fast' | 'variable';
    actionToReflectionRatio: number; // e.g., 0.6 means 60% action
  };

  // Scene metadata
  sceneMetadata: Array<{
    sceneId: string;
    purpose: 'bottleneck' | 'branch' | 'transition';
    intendedTension: 'low' | 'medium' | 'high' | 'climax';
  }>;
}

export interface PacingIssue {
  severity: 'minor' | 'moderate' | 'major';
  type: 'too_slow' | 'too_fast' | 'unearned_climax' | 'missing_breather' | 'flat_tension' | 'anticlimactic';
  location: {
    sceneId: string;
    beatIds?: string[];
  };
  description: string;
  suggestion: string;
}

export interface PacingReport {
  overallScore: number; // 0-100
  pacingMatchesTarget: boolean;

  tensionCurve: Array<{
    sceneId: string;
    averageTension: number; // 1-10
    peakTension: number;
    beatCount: number;
    estimatedDuration: string;
  }>;

  rhythmAnalysis: {
    actionPercentage: number;
    reflectionPercentage: number;
    dialoguePercentage: number;
    transitionPercentage: number;
    matchesTarget: boolean;
  };

  criticalMoments: Array<{
    sceneId: string;
    type: 'climax' | 'turning_point' | 'revelation' | 'choice';
    tensionLevel: number;
    isWellPaced: boolean;
    notes: string;
  }>;

  issues: PacingIssue[];
  recommendations: string[];
}

export class PacingAuditor extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Pacing Auditor', config);
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Pacing Auditor

You ensure the story moves at the right speed - fast enough to be exciting, slow enough to be meaningful. Good pacing is the heartbeat of narrative.

## What You Audit

### Tension Curve
- Does tension build appropriately?
- Are climaxes earned through buildup?
- Are there breather moments?
- Does the curve match the episode's purpose?

### Scene Rhythm
- How long does each scene feel?
- Are action scenes too long/short?
- Do reflection moments drag?
- Is dialogue well-paced?

### Beat Density
- How much happens per scene?
- Are beats too dense or sparse?
- Is information delivered at readable pace?

### Critical Moments
- Are turning points given proper weight?
- Do climaxes feel climactic?
- Are choices given time to breathe?

## Pacing Principles

### The Rule of Escalation
Tension should generally rise through an episode, with valleys for contrast.

### The Breather Rule
After high-tension sequences, players need a moment to process.

### The Weight Rule
Important moments need more time. Don't rush revelations.

### The Momentum Rule
Once action starts, maintain it. Don't break flow unnecessarily.

## Common Pacing Issues

- **Too Fast**: Important moments feel rushed
- **Too Slow**: Player gets bored, loses engagement
- **Unearned Climax**: Big moment without proper buildup
- **Missing Breather**: Relentless intensity exhausts
- **Flat Tension**: No sense of rising stakes
- **Anticlimactic**: Buildup without satisfying payoff
`;
  }

  async execute(input: PacingAuditorInput): Promise<AgentResponse<PacingReport>> {
    const prompt = this.buildPrompt(input);

    console.log(`[PacingAuditor] Auditing pacing...`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[PacingAuditor] Received response (${response.length} chars)`);

      let report: PacingReport;
      try {
        report = this.parseJSON<PacingReport>(response);
      } catch (parseError) {
        console.error(`[PacingAuditor] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
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
      console.error(`[PacingAuditor] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeReport(report: PacingReport): PacingReport {
    if (typeof report.overallScore !== 'number') {
      report.overallScore = 50;
    }
    if (typeof report.pacingMatchesTarget !== 'boolean') {
      report.pacingMatchesTarget = false;
    }

    if (!report.tensionCurve) {
      report.tensionCurve = [];
    } else if (!Array.isArray(report.tensionCurve)) {
      report.tensionCurve = [report.tensionCurve as unknown as PacingReport['tensionCurve'][0]];
    }

    if (!report.rhythmAnalysis) {
      report.rhythmAnalysis = {
        actionPercentage: 0,
        reflectionPercentage: 0,
        dialoguePercentage: 0,
        transitionPercentage: 0,
        matchesTarget: false
      };
    }

    if (!report.criticalMoments) {
      report.criticalMoments = [];
    } else if (!Array.isArray(report.criticalMoments)) {
      report.criticalMoments = [report.criticalMoments as unknown as PacingReport['criticalMoments'][0]];
    }

    if (!report.issues) {
      report.issues = [];
    } else if (!Array.isArray(report.issues)) {
      report.issues = [report.issues as unknown as PacingIssue];
    }

    if (!report.recommendations) {
      report.recommendations = [];
    } else if (!Array.isArray(report.recommendations)) {
      report.recommendations = [report.recommendations as unknown as string];
    }

    return report;
  }

  private buildPrompt(input: PacingAuditorInput): string {
    const scenesSummary = input.sceneContents.map(sc => {
      const metadata = input.sceneMetadata.find(m => m.sceneId === sc.sceneId);
      const beatSummary = sc.beats.map(b => `    - ${b.id}: ${b.text.slice(0, 100)}...`).join('\n');
      return `  Scene: ${sc.sceneId} (${sc.sceneName}) [${metadata?.purpose || 'unknown'}, intended: ${metadata?.intendedTension || 'unknown'}]
    Beats (${sc.beats.length}):
${beatSummary}`;
    }).join('\n\n');

    const choicesSummary = input.choiceSets.map(cs =>
      `  ${cs.beatId}: ${cs.choiceType} choice with ${cs.choices.length} options`
    ).join('\n');

    return `
Audit the pacing of the following episode:

## Episode: ${input.episodeTitle}

## Target Pacing
- Overall: ${input.targetPacing.overall}
- Action/Reflection Ratio: ${input.targetPacing.actionToReflectionRatio * 100}% action

## Scene Content
${scenesSummary}

## Choice Points
${choicesSummary}

## Your Task

Analyze:
1. Map the tension curve across all scenes
2. Calculate the rhythm balance (action/reflection/dialogue/transition)
3. Identify critical moments and evaluate their pacing
4. Find any pacing issues

Provide a PacingReport with JSON.
`;
  }
}

// ============================================
// SENSITIVITY REVIEWER
// ============================================

export interface SensitivityReviewerInput {
  // Content to review
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];

  // Content guidelines
  contentRating: 'E' | 'T' | 'M'; // Everyone, Teen, Mature
  sensitivityFlags: string[]; // Topics to be careful with

  // Story context
  storyContext: {
    genre: string;
    themes: string[];
    intendedAudience: string;
  };
}

export interface SensitivityIssue {
  severity: 'flag' | 'warning' | 'concern';
  category: 'violence' | 'sexual_content' | 'substance_use' | 'discrimination' | 'mental_health' | 'trauma' | 'other';
  location: {
    sceneId: string;
    beatId?: string;
    choiceId?: string;
  };
  content: string;
  concern: string;
  recommendation: string;
  ratingImplication?: string; // Does this push the rating?
}

export interface SensitivityReport {
  overallRating: 'E' | 'T' | 'M' | 'AO'; // Assessed rating
  matchesTarget: boolean;

  contentFlags: Array<{
    category: string;
    present: boolean;
    severity: 'none' | 'mild' | 'moderate' | 'strong';
    notes: string;
  }>;

  issues: SensitivityIssue[];

  positiveRepresentation: Array<{
    category: string;
    description: string;
    sceneId: string;
  }>;

  recommendations: string[];
  contentWarnings: string[]; // Suggested content warnings for players
}

export class SensitivityReviewer extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Sensitivity Reviewer', config);
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Sensitivity Reviewer

You help ensure content is appropriate for its intended audience and handles sensitive topics responsibly. You balance creative freedom with thoughtful representation.

## What You Review

### Age Appropriateness
- Violence levels (cartoon vs. graphic)
- Sexual content (none vs. implied vs. explicit)
- Language (clean vs. mild vs. strong)
- Mature themes (how deeply explored)

### Sensitive Topics
- Mental health representation
- Trauma and its effects
- Discrimination and prejudice
- Substance use and addiction
- Grief and loss
- Abuse (physical, emotional, etc.)

### Representation
- How are diverse groups portrayed?
- Are stereotypes reinforced or challenged?
- Is there positive representation?
- Are harmful tropes present?

## Rating Guidelines

### E (Everyone)
- No violence beyond cartoon slapstick
- No sexual content
- No strong language
- Themes appropriate for all ages

### T (Teen)
- Action violence, no gore
- Romantic content, no explicit
- Mild language
- Teen-appropriate themes

### M (Mature)
- Violence with consequences
- Sexual themes (non-explicit)
- Strong language
- Adult themes explored

## Important Principles

1. **Context Matters**: Violence in war stories differs from gratuitous violence
2. **Purpose Matters**: Is difficult content serving the story or just shock?
3. **Handling Matters**: Are sensitive topics treated with care?
4. **Balance Matters**: Don't censor legitimate storytelling, but flag genuine concerns

## What's NOT an Issue

- Conflict and tension (stories need these)
- Villains being villainous (they're supposed to be)
- Characters facing hardship (this builds character)
- Difficult themes handled well (this is good storytelling)
`;
  }

  async execute(input: SensitivityReviewerInput): Promise<AgentResponse<SensitivityReport>> {
    const prompt = this.buildPrompt(input);

    console.log(`[SensitivityReviewer] Reviewing content sensitivity...`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[SensitivityReviewer] Received response (${response.length} chars)`);

      let report: SensitivityReport;
      try {
        report = this.parseJSON<SensitivityReport>(response);
      } catch (parseError) {
        console.error(`[SensitivityReviewer] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
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
      console.error(`[SensitivityReviewer] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeReport(report: SensitivityReport): SensitivityReport {
    if (!report.overallRating) {
      report.overallRating = 'T';
    }
    if (typeof report.matchesTarget !== 'boolean') {
      report.matchesTarget = true;
    }

    if (!report.contentFlags) {
      report.contentFlags = [];
    } else if (!Array.isArray(report.contentFlags)) {
      report.contentFlags = [report.contentFlags as unknown as SensitivityReport['contentFlags'][0]];
    }

    if (!report.issues) {
      report.issues = [];
    } else if (!Array.isArray(report.issues)) {
      report.issues = [report.issues as unknown as SensitivityIssue];
    }

    if (!report.positiveRepresentation) {
      report.positiveRepresentation = [];
    } else if (!Array.isArray(report.positiveRepresentation)) {
      report.positiveRepresentation = [report.positiveRepresentation as unknown as SensitivityReport['positiveRepresentation'][0]];
    }

    if (!report.recommendations) {
      report.recommendations = [];
    } else if (!Array.isArray(report.recommendations)) {
      report.recommendations = [report.recommendations as unknown as string];
    }

    if (!report.contentWarnings) {
      report.contentWarnings = [];
    } else if (!Array.isArray(report.contentWarnings)) {
      report.contentWarnings = [report.contentWarnings as unknown as string];
    }

    return report;
  }

  private buildPrompt(input: SensitivityReviewerInput): string {
    const scenesSummary = input.sceneContents.map(sc => {
      const beatSummary = sc.beats.map(b => `    "${b.text}"`).join('\n');
      return `  Scene: ${sc.sceneId} (${sc.sceneName})\n${beatSummary}`;
    }).join('\n\n');

    const choicesSummary = input.choiceSets.map(cs => {
      const optionsList = cs.choices.map(c => `      - "${c.text}"`).join('\n');
      return `    ${cs.beatId}:\n${optionsList}`;
    }).join('\n');

    return `
Review the following content for sensitivity concerns:

## Content Guidelines
- **Target Rating**: ${input.contentRating}
- **Sensitivity Flags**: ${input.sensitivityFlags.join(', ') || 'None specified'}

## Story Context
- **Genre**: ${input.storyContext.genre}
- **Themes**: ${input.storyContext.themes.join(', ')}
- **Intended Audience**: ${input.storyContext.intendedAudience}

## Scene Content
${scenesSummary}

## Player Choices
${choicesSummary}

## Your Task

Review for:
1. Age-appropriateness matching the target rating
2. Sensitive topics and how they're handled
3. Representation of diverse groups
4. Potentially triggering content

Provide a SensitivityReport with JSON including:
- Assessed overall rating
- Content flags by category
- Specific issues with recommendations
- Positive representation highlights
- Suggested content warnings
`;
  }
}

// ============================================
// EXTENDED QA RUNNER
// ============================================

export interface ExtendedQAInput extends Omit<QAInput, 'targetTone'> {
  // Override targetTone to allow extended structure
  targetTone: string | {
    primary: string;
    secondary?: string;
    avoid: string[];
  };

  // Additional inputs for new agents
  episodeSummary?: string;
  establishedRules?: string[];
  characterCapabilities?: Array<{
    characterId: string;
    characterName: string;
    canDo: string[];
    cannotDo: string[];
  }>;
  openPlotThreads?: Array<{
    description: string;
    introducedIn: string;
    importance: 'minor' | 'moderate' | 'major';
  }>;
  targetPacing?: {
    overall: 'slow' | 'moderate' | 'fast' | 'variable';
    actionToReflectionRatio: number;
  };
  sceneMetadata?: Array<{
    sceneId: string;
    purpose: 'bottleneck' | 'branch' | 'transition';
    intendedTension: 'low' | 'medium' | 'high' | 'climax';
  }>;
  contentRating?: 'E' | 'T' | 'M';
  sensitivityFlags?: string[];
}

export interface ExtendedQAReport extends QAReport {
  plotHoles?: PlotHoleReport;
  tone?: ToneReport;
  pacing?: PacingReport;
  sensitivity?: SensitivityReport;
}

export class ExtendedQARunner extends QARunner {
  private plotHoleDetector: PlotHoleDetector;
  private toneAnalyzer: ToneAnalyzer;
  private pacingAuditor: PacingAuditor;
  private sensitivityReviewer: SensitivityReviewer;

  constructor(config: AgentConfig) {
    super(config);
    this.plotHoleDetector = new PlotHoleDetector(config);
    this.toneAnalyzer = new ToneAnalyzer(config);
    this.pacingAuditor = new PacingAuditor(config);
    this.sensitivityReviewer = new SensitivityReviewer(config);
  }

  async runExtendedQA(input: ExtendedQAInput): Promise<ExtendedQAReport> {
    // Convert to base QAInput format
    const baseInput: QAInput = {
      ...input,
      targetTone: typeof input.targetTone === 'string'
        ? input.targetTone
        : input.targetTone.primary,
    };

    // Run base QA first
    const baseReport = await this.runFullQA(baseInput);

    // Prepare extended checks
    const extendedPromises: Promise<AgentResponse<unknown>>[] = [];

    // Plot Hole Detection
    if (input.episodeSummary) {
      extendedPromises.push(
        this.plotHoleDetector.execute({
          episodeSummary: input.episodeSummary,
          sceneContents: input.sceneContents,
          storyContext: {
            title: '',
            genre: '',
            synopsis: input.episodeSummary,
          },
          previousEpisodeSummary: undefined,
          establishedRules: input.establishedRules || [],
          characterCapabilities: input.characterCapabilities || [],
          openPlotThreads: input.openPlotThreads || [],
        })
      );
    }

    // Tone Analysis - need extended targetTone format
    if (typeof input.targetTone === 'object') {
      extendedPromises.push(
        this.toneAnalyzer.execute({
          sceneContents: input.sceneContents,
          targetTone: input.targetTone,
          genre: input.storyThemes[0] || 'general',
        })
      );
    }

    // Pacing Audit
    if (input.targetPacing && input.sceneMetadata) {
      extendedPromises.push(
        this.pacingAuditor.execute({
          episodeTitle: '',
          sceneContents: input.sceneContents,
          choiceSets: input.choiceSets,
          targetPacing: input.targetPacing,
          sceneMetadata: input.sceneMetadata,
        })
      );
    }

    // Sensitivity Review
    if (input.contentRating) {
      extendedPromises.push(
        this.sensitivityReviewer.execute({
          sceneContents: input.sceneContents,
          choiceSets: input.choiceSets,
          contentRating: input.contentRating,
          sensitivityFlags: input.sensitivityFlags || [],
          storyContext: {
            genre: input.storyThemes[0] || 'general',
            themes: input.storyThemes,
            intendedAudience: input.contentRating === 'E' ? 'all ages' : input.contentRating === 'T' ? 'teens and up' : 'mature audiences',
          },
        })
      );
    }

    // Wait for all extended checks
    const extendedResults = await Promise.all(extendedPromises);

    // Build extended report
    const extendedReport: ExtendedQAReport = {
      ...baseReport,
    };

    // Add results based on what was run
    let resultIndex = 0;
    if (input.episodeSummary) {
      extendedReport.plotHoles = extendedResults[resultIndex]?.data as PlotHoleReport;
      resultIndex++;
    }
    if (input.targetTone) {
      extendedReport.tone = extendedResults[resultIndex]?.data as ToneReport;
      resultIndex++;
    }
    if (input.targetPacing && input.sceneMetadata) {
      extendedReport.pacing = extendedResults[resultIndex]?.data as PacingReport;
      resultIndex++;
    }
    if (input.contentRating) {
      extendedReport.sensitivity = extendedResults[resultIndex]?.data as SensitivityReport;
    }

    // Recalculate overall score including new agents
    const scores: number[] = [
      baseReport.continuity.overallScore,
      baseReport.voice.overallScore,
      baseReport.stakes.overallScore,
    ];

    if (extendedReport.plotHoles) {
      scores.push(extendedReport.plotHoles.overallScore);
    }
    if (extendedReport.tone) {
      scores.push(extendedReport.tone.overallScore);
    }
    if (extendedReport.pacing) {
      scores.push(extendedReport.pacing.overallScore);
    }
    // Sensitivity doesn't have a simple score, so we skip it for average

    extendedReport.overallScore = Math.round(
      scores.reduce((sum, s) => sum + s, 0) / scores.length
    );

    // Update passesQA
    extendedReport.passesQA = extendedReport.overallScore >= 70 && extendedReport.criticalIssues.length === 0;

    // Add critical issues from new agents
    if (extendedReport.plotHoles?.plotHoles.some(h => h.severity === 'critical')) {
      extendedReport.criticalIssues.push('Critical plot holes detected');
    }
    if (extendedReport.sensitivity?.issues.some(i => i.severity === 'concern')) {
      extendedReport.criticalIssues.push('Sensitivity concerns flagged');
    }

    return extendedReport;
  }
}
