/**
 * Pixar Principles Validator
 * 
 * Validates adherence to Pixar's 22 Rules of Storytelling:
 * - Story Spine structure (Rule #4)
 * - Character opinions and stakes (Rules #13, #16)
 * - Causality and coincidences (Rule #19)
 * - Polar opposite challenges (Rule #6)
 * - Anti-obvious choices (Rule #12)
 * - Burning question/theme (Rule #14)
 * - Odds stacking (Rule #16)
 */

import {
  SeasonBible,
  EpisodePlan,
  Episode,
  Scene,
  Beat,
  Story,
  StorySpinePosition,
} from '../../types';
import { CharacterBible, CharacterProfile } from '../agents/CharacterDesigner';
import { EncounterStructure } from '../agents/EncounterArchitect';

// ========================================
// ISSUE TYPES
// ========================================

export type PixarIssueType =
  // Story Spine (Rule #4)
  | 'missing_story_spine_position'
  | 'story_spine_gap'
  | 'missing_inciting_incident'
  | 'weak_climax'
  
  // Character Opinions (Rule #13)
  | 'passive_character'
  | 'missing_core_opinion'
  | 'no_character_friction'
  
  // Stakes (Rule #16)
  | 'missing_personal_stakes'
  | 'abstract_stakes'
  | 'odds_not_stacked'
  
  // Polar Opposites (Rule #6)
  | 'missing_polar_opposite'
  | 'character_never_challenged'
  
  // Causality (Rule #19)
  | 'coincidence_escape'
  | 'unmotivated_success'
  | 'deus_ex_machina'
  
  // Anti-Obvious (Rule #12)
  | 'predictable_choice'
  | 'no_surprise_element'
  
  // Burning Question (Rule #14)
  | 'missing_burning_question'
  | 'episode_disconnected_from_theme'
  
  // Trying Over Succeeding (Rule #1)
  | 'easy_success'
  | 'no_struggle';

export type PixarIssueSeverity = 'error' | 'warning' | 'suggestion';

export interface PixarIssue {
  severity: PixarIssueSeverity;
  type: PixarIssueType;
  rule: string;                    // Which Pixar rule this relates to
  ruleText: string;                // The actual rule text
  location: {
    episodeNumber?: number;
    sceneId?: string;
    beatId?: string;
    characterId?: string;
    encounterId?: string;
  };
  description: string;
  suggestion: string;
  autoFixable: boolean;
}

export interface PixarValidationReport {
  valid: boolean;
  overallScore: number;            // 0-100, how well the story follows Pixar principles
  errorCount: number;
  warningCount: number;
  suggestionCount: number;
  issues: PixarIssue[];
  
  // Breakdown by category
  scores: {
    storySpine: number;            // Rule #4
    characterOpinions: number;     // Rule #13
    stakesAndOdds: number;         // Rule #16
    polarOpposites: number;        // Rule #6
    causality: number;             // Rule #19
    surprise: number;              // Rule #12
    burningQuestion: number;       // Rule #14
    struggleAndTrying: number;     // Rule #1
  };
  
  summary: string;
  highlights: string[];            // What the story does well
  priorityFixes: string[];         // Most important things to address
}

// ========================================
// PIXAR RULES REFERENCE
// ========================================

const PIXAR_RULES: Record<string, string> = {
  '1': 'You admire a character for trying more than for their successes.',
  '4': 'Once upon a time... Every day... One day... Because of that... Until finally...',
  '6': 'What is your character good at, comfortable with? Throw the polar opposite at them.',
  '7': 'Come up with your ending before you figure out your middle.',
  '12': 'Discount the 1st thing that comes to mind. And the 2nd, 3rd, 4th, 5th – get the obvious out of the way.',
  '13': 'Give your characters opinions. Passive/malleable might seem likable to you as you write, but it\'s poison to the audience.',
  '14': 'Why must you tell THIS story? What\'s the belief burning within you that your story feeds off of?',
  '16': 'What are the stakes? Give us reason to root for the character. What happens if they don\'t succeed? Stack the odds against.',
  '19': 'Coincidences to get characters into trouble are great; coincidences to get them out of it are cheating.',
  '21': 'You gotta identify with your situation/characters, can\'t just write \'cool\'.',
  '22': 'What\'s the essence of your story? Most economical telling of it?',
};

// ========================================
// PIXAR PRINCIPLES VALIDATOR
// ========================================

export class PixarPrinciplesValidator {
  
  /**
   * Validate a complete season against Pixar principles
   */
  validateSeason(
    seasonBible: SeasonBible,
    characterBible?: CharacterBible,
    story?: Story
  ): PixarValidationReport {
    // Guard against null/undefined input
    if (!seasonBible) {
      return {
        issues: [{
          type: 'missing_story_spine',
          severity: 'critical',
          message: 'Cannot validate: seasonBible is undefined',
          rule: 4,
          ruleText: this.PIXAR_RULES[4],
        }],
        overallScore: 0,
        categoryScores: {
          storySpine: 0,
          burningQuestion: 0,
          characterOpinions: 0,
          polarOpposites: 0,
          stakesAndOdds: 0,
          causality: 0,
          surprise: 0,
          admireTrying: 0,
        },
        summary: 'Validation failed: No season bible provided',
        highlights: [],
        priorityFixes: ['Provide a valid season bible to validate'],
      };
    }
    
    const issues: PixarIssue[] = [];
    
    // 1. Validate Story Spine (Rule #4)
    issues.push(...this.validateStorySpine(seasonBible));
    
    // 2. Validate Burning Question (Rule #14)
    issues.push(...this.validateBurningQuestion(seasonBible));
    
    // 3. Validate Character Opinions (Rule #13)
    if (characterBible) {
      issues.push(...this.validateCharacterOpinions(characterBible));
    }
    
    // 4. Validate Polar Opposites (Rule #6)
    if (characterBible) {
      issues.push(...this.validatePolarOpposites(characterBible, seasonBible));
    }
    
    // 5. Validate Stakes and Odds (Rule #16)
    issues.push(...this.validateStakesAndOdds(seasonBible));
    
    // 6. Validate Causality (Rule #19)
    if (story) {
      issues.push(...this.validateCausality(story));
    }
    
    // 7. Validate Surprise/Anti-Obvious (Rule #12)
    if (story) {
      issues.push(...this.validateSurprise(story));
    }
    
    // Calculate scores
    const scores = this.calculateScores(seasonBible, characterBible, issues);
    
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const suggestionCount = issues.filter(i => i.severity === 'suggestion').length;
    
    return {
      valid: errorCount === 0,
      overallScore: scores.overall,
      errorCount,
      warningCount,
      suggestionCount,
      issues,
      scores: {
        storySpine: scores.storySpine,
        characterOpinions: scores.characterOpinions,
        stakesAndOdds: scores.stakesAndOdds,
        polarOpposites: scores.polarOpposites,
        causality: scores.causality,
        surprise: scores.surprise,
        burningQuestion: scores.burningQuestion,
        struggleAndTrying: scores.struggleAndTrying,
      },
      summary: this.generateSummary(seasonBible, issues, scores),
      highlights: this.findHighlights(seasonBible, characterBible, scores),
      priorityFixes: this.findPriorityFixes(issues),
    };
  }

  /**
   * Validate an individual episode against Pixar principles
   */
  validateEpisode(
    episode: Episode,
    plan: EpisodePlan,
    seasonBible: SeasonBible
  ): PixarIssue[] {
    const issues: PixarIssue[] = [];
    const loc = { episodeNumber: plan.episodeNumber };
    
    // Check Story Spine position alignment
    if (!plan.storySpinePosition) {
      issues.push({
        severity: 'warning',
        type: 'missing_story_spine_position',
        rule: '4',
        ruleText: PIXAR_RULES['4'],
        location: loc,
        description: `Episode ${plan.episodeNumber} has no Story Spine position assigned`,
        suggestion: 'Assign a position: setup, routine, inciting, consequence, climax, or newNormal',
        autoFixable: true,
      });
    }
    
    // Check theme connection
    if (!plan.themeConnection && seasonBible.burningQuestion) {
      issues.push({
        severity: 'suggestion',
        type: 'episode_disconnected_from_theme',
        rule: '14',
        ruleText: PIXAR_RULES['14'],
        location: loc,
        description: `Episode ${plan.episodeNumber} doesn't explicitly connect to the burning question`,
        suggestion: `Connect to: "${seasonBible.burningQuestion.question}"`,
        autoFixable: false,
      });
    }
    
    // Check for struggle (Rule #1)
    const hasEncounter = episode.scenes.some(s => s.encounter);
    if (!hasEncounter) {
      issues.push({
        severity: 'warning',
        type: 'easy_success',
        rule: '1',
        ruleText: PIXAR_RULES['1'],
        location: loc,
        description: `Episode ${plan.episodeNumber} has no encounters - characters may succeed too easily`,
        suggestion: 'Add challenges where characters must TRY and potentially fail',
        autoFixable: false,
      });
    }
    
    return issues;
  }

  /**
   * Validate an encounter against Pixar principles
   */
  validateEncounter(
    encounter: EncounterStructure,
    sceneId: string
  ): PixarIssue[] {
    const issues: PixarIssue[] = [];
    const loc = { sceneId, encounterId: encounter.sceneId };
    
    // Check odds stacking (Rule #16)
    if (!encounter.pixarStakes || encounter.pixarStakes.initialOddsAgainst < 50) {
      issues.push({
        severity: 'warning',
        type: 'odds_not_stacked',
        rule: '16',
        ruleText: PIXAR_RULES['16'],
        location: loc,
        description: 'Encounter odds are not sufficiently stacked against the player',
        suggestion: 'Increase initial odds against to 60-70% for earned success',
        autoFixable: false,
      });
    }
    
    // Check for personal stakes (Rule #16)
    if (!encounter.pixarStakes?.whatPlayerLoses) {
      issues.push({
        severity: 'warning',
        type: 'missing_personal_stakes',
        rule: '16',
        ruleText: PIXAR_RULES['16'],
        location: loc,
        description: 'Encounter lacks clear personal stakes',
        suggestion: 'Define what the player PERSONALLY loses if they fail (not abstract)',
        autoFixable: false,
      });
    }
    
    // Check for surprise element (Rule #12)
    if (!encounter.pixarSurprise?.unexpectedElement) {
      issues.push({
        severity: 'suggestion',
        type: 'no_surprise_element',
        rule: '12',
        ruleText: PIXAR_RULES['12'],
        location: loc,
        description: 'Encounter has no documented surprise element',
        suggestion: 'Add something unexpected that subverts player expectations',
        autoFixable: false,
      });
    }
    
    // Check causality (Rule #19)
    if (encounter.pixarCausality?.noCoincidenceEscapes === false) {
      issues.push({
        severity: 'error',
        type: 'coincidence_escape',
        rule: '19',
        ruleText: PIXAR_RULES['19'],
        location: loc,
        description: 'Encounter allows player to escape through coincidence - this is CHEATING',
        suggestion: 'Remove coincidental escapes - success must come from player action',
        autoFixable: false,
      });
    }
    
    return issues;
  }

  // ========================================
  // PRIVATE VALIDATION METHODS
  // ========================================

  private validateStorySpine(bible: SeasonBible): PixarIssue[] {
    const issues: PixarIssue[] = [];
    
    // Check for Story Spine mapping
    if (!bible.storySpineMapping) {
      issues.push({
        severity: 'warning',
        type: 'story_spine_gap',
        rule: '4',
        ruleText: PIXAR_RULES['4'],
        location: {},
        description: 'Season lacks a Story Spine mapping',
        suggestion: 'Map episodes to: setup → routine → inciting → consequence → climax → newNormal',
        autoFixable: true,
      });
      return issues;
    }
    
    const spine = bible.storySpineMapping;
    
    // Must have inciting incident
    if (!spine.incitingEpisode) {
      issues.push({
        severity: 'error',
        type: 'missing_inciting_incident',
        rule: '4',
        ruleText: PIXAR_RULES['4'],
        location: {},
        description: 'Season has no "But one day..." inciting incident episode',
        suggestion: 'Identify which episode disrupts the status quo',
        autoFixable: false,
      });
    }
    
    // Must have climax
    if (!spine.climaxEpisode) {
      issues.push({
        severity: 'error',
        type: 'weak_climax',
        rule: '4',
        ruleText: PIXAR_RULES['4'],
        location: {},
        description: 'Season has no "Until finally..." climax episode',
        suggestion: 'The finale should be the climax episode',
        autoFixable: true,
      });
    }
    
    // Check consequence chain
    if (spine.consequenceEpisodes.length === 0) {
      issues.push({
        severity: 'warning',
        type: 'story_spine_gap',
        rule: '4',
        ruleText: PIXAR_RULES['4'],
        location: {},
        description: 'Season has no "Because of that..." consequence episodes',
        suggestion: 'Middle episodes should show cause-and-effect chains',
        autoFixable: true,
      });
    }
    
    // Check each episode has a spine position
    for (const plan of bible.episodePlans) {
      if (!plan.storySpinePosition) {
        issues.push({
          severity: 'warning',
          type: 'missing_story_spine_position',
          rule: '4',
          ruleText: PIXAR_RULES['4'],
          location: { episodeNumber: plan.episodeNumber },
          description: `Episode ${plan.episodeNumber} has no Story Spine position`,
          suggestion: 'Assign: setup, routine, inciting, consequence, climax, or newNormal',
          autoFixable: true,
        });
      }
    }
    
    return issues;
  }

  private validateBurningQuestion(bible: SeasonBible): PixarIssue[] {
    const issues: PixarIssue[] = [];
    
    if (!bible.burningQuestion || !bible.burningQuestion.question) {
      issues.push({
        severity: 'error',
        type: 'missing_burning_question',
        rule: '14',
        ruleText: PIXAR_RULES['14'],
        location: {},
        description: 'Season has no Burning Question defined',
        suggestion: 'Define: "Why must THIS story be told? What belief drives it?"',
        autoFixable: false,
      });
      return issues;
    }
    
    // Check if burning question is substantial
    if (bible.burningQuestion.question.length < 20) {
      issues.push({
        severity: 'warning',
        type: 'missing_burning_question',
        rule: '14',
        ruleText: PIXAR_RULES['14'],
        location: {},
        description: 'Burning Question is too brief to be meaningful',
        suggestion: 'Expand: What thematic question does every episode explore?',
        autoFixable: false,
      });
    }
    
    return issues;
  }

  private validateCharacterOpinions(characterBible: CharacterBible): PixarIssue[] {
    const issues: PixarIssue[] = [];
    
    for (const char of characterBible.characters) {
      const loc = { characterId: char.id };
      
      // Check for pixarDepth
      if (!char.pixarDepth) {
        issues.push({
          severity: 'warning',
          type: 'passive_character',
          rule: '13',
          ruleText: PIXAR_RULES['13'],
          location: loc,
          description: `Character "${char.name}" lacks Pixar depth fields`,
          suggestion: 'Add: coreOpinion, personalStakes, polarOpposite, wouldNever, wouldAlwaysTry',
          autoFixable: false,
        });
        continue;
      }
      
      // Check core opinion
      if (!char.pixarDepth.coreOpinion || char.pixarDepth.coreOpinion.length < 10) {
        issues.push({
          severity: 'warning',
          type: 'missing_core_opinion',
          rule: '13',
          ruleText: PIXAR_RULES['13'],
          location: loc,
          description: `Character "${char.name}" lacks a core opinion`,
          suggestion: 'Define: What do they believe that others DON\'T?',
          autoFixable: false,
        });
      }
      
      // Check personal stakes
      if (!char.pixarDepth.personalStakes || char.pixarDepth.personalStakes.length < 10) {
        issues.push({
          severity: 'warning',
          type: 'missing_personal_stakes',
          rule: '16',
          ruleText: PIXAR_RULES['16'],
          location: loc,
          description: `Character "${char.name}" lacks personal stakes`,
          suggestion: 'Define: What do THEY personally lose if things go wrong?',
          autoFixable: false,
        });
      }
    }
    
    // Check for character friction (opinions that clash)
    const opinions = characterBible.characters
      .filter(c => c.pixarDepth?.strongOpinionOn)
      .map(c => c.pixarDepth!.strongOpinionOn);
    
    if (opinions.length >= 2) {
      // Check if any opinions might clash
      const uniqueTopics = new Set(opinions);
      if (uniqueTopics.size === opinions.length) {
        // All different topics - might be missing friction
        issues.push({
          severity: 'suggestion',
          type: 'no_character_friction',
          rule: '13',
          ruleText: PIXAR_RULES['13'],
          location: {},
          description: 'Characters have opinions on different topics - no natural friction',
          suggestion: 'Have characters disagree about the SAME topic for drama',
          autoFixable: false,
        });
      }
    }
    
    return issues;
  }

  private validatePolarOpposites(
    characterBible: CharacterBible,
    seasonBible: SeasonBible
  ): PixarIssue[] {
    const issues: PixarIssue[] = [];
    
    for (const char of characterBible.characters) {
      const loc = { characterId: char.id };
      
      // Check for polar opposite definition
      if (!char.pixarDepth?.polarOpposite) {
        if (char.importance === 'major') {
          issues.push({
            severity: 'warning',
            type: 'missing_polar_opposite',
            rule: '6',
            ruleText: PIXAR_RULES['6'],
            location: loc,
            description: `Major character "${char.name}" has no polar opposite challenge defined`,
            suggestion: 'Define: What situation challenges their greatest strength?',
            autoFixable: false,
          });
        }
        continue;
      }
      
      // Check if any episode challenges this character with their polar opposite
      const charArcs = seasonBible.characterArcs.filter(a => a.characterId === char.id);
      const hasPolarOppositeChallenge = charArcs.some(arc => 
        arc.keyMoments.some(km => 
          km.moment.toLowerCase().includes('challenge') ||
          km.moment.toLowerCase().includes('confront') ||
          km.moment.toLowerCase().includes('face')
        )
      );
      
      if (!hasPolarOppositeChallenge && char.importance !== 'background') {
        issues.push({
          severity: 'suggestion',
          type: 'character_never_challenged',
          rule: '6',
          ruleText: PIXAR_RULES['6'],
          location: loc,
          description: `Character "${char.name}" is never shown facing their polar opposite`,
          suggestion: `Plan an episode where they face: "${char.pixarDepth.polarOpposite}"`,
          autoFixable: false,
        });
      }
    }
    
    return issues;
  }

  private validateStakesAndOdds(bible: SeasonBible): PixarIssue[] {
    const issues: PixarIssue[] = [];
    
    // Check that stakes escalate through the season
    let stakesEscalate = false;
    for (let i = 1; i < bible.episodePlans.length; i++) {
      const current = bible.episodePlans[i];
      const previous = bible.episodePlans[i - 1];
      
      // Check if stakes are mentioned in must-accomplish or logline
      const currentStakes = current.mustAccomplish.join(' ') + current.logline;
      const previousStakes = previous.mustAccomplish.join(' ') + previous.logline;
      
      // Simple heuristic: later episodes should have more urgent language
      const urgentWords = ['must', 'final', 'only', 'last', 'everything', 'survive'];
      const currentUrgency = urgentWords.filter(w => currentStakes.toLowerCase().includes(w)).length;
      const previousUrgency = urgentWords.filter(w => previousStakes.toLowerCase().includes(w)).length;
      
      if (currentUrgency > previousUrgency) {
        stakesEscalate = true;
        break;
      }
    }
    
    if (!stakesEscalate && bible.episodePlans.length >= 4) {
      issues.push({
        severity: 'suggestion',
        type: 'odds_not_stacked',
        rule: '16',
        ruleText: PIXAR_RULES['16'],
        location: {},
        description: 'Stakes may not be escalating through the season',
        suggestion: 'Ensure later episodes have higher stakes than earlier ones',
        autoFixable: false,
      });
    }
    
    return issues;
  }

  private validateCausality(story: Story): PixarIssue[] {
    const issues: PixarIssue[] = [];
    
    // This would require deeper semantic analysis
    // For now, check encounters for coincidence flags
    for (const episode of story.episodes) {
      for (const scene of episode.scenes) {
        if (scene.encounter) {
          // Check the encounter's outcomes for coincidental escapes
          const outcomes = scene.encounter.outcomes;
          
          // Heuristic: check if defeat has a recovery path that seems coincidental
          if (outcomes.defeat?.recoveryPath) {
            const recovery = outcomes.defeat.recoveryPath.toLowerCase();
            const coincidenceWords = ['lucky', 'happen', 'chance', 'fortunate', 'coincidence'];
            
            if (coincidenceWords.some(w => recovery.includes(w))) {
              issues.push({
                severity: 'error',
                type: 'coincidence_escape',
                rule: '19',
                ruleText: PIXAR_RULES['19'],
                location: { episodeNumber: episode.number, sceneId: scene.id },
                description: 'Defeat recovery path may rely on coincidence',
                suggestion: 'Recovery from defeat must come from player agency, not luck',
                autoFixable: false,
              });
            }
          }
        }
      }
    }
    
    return issues;
  }

  private validateSurprise(story: Story): PixarIssue[] {
    const issues: PixarIssue[] = [];
    
    // Check that not all episodes follow predictable patterns
    // This is a heuristic check
    
    let predictableCount = 0;
    for (const episode of story.episodes) {
      // Check if episode follows standard hero's journey beats too closely
      const beatTexts = episode.scenes
        .flatMap(s => s.beats)
        .map(b => b.text?.toLowerCase() || '');
      
      const cliches = [
        'suddenly realized',
        'at that moment',
        'little did they know',
        'as luck would have it',
        'against all odds',
      ];
      
      const clicheCount = cliches.filter(c => 
        beatTexts.some(t => t.includes(c))
      ).length;
      
      if (clicheCount >= 2) {
        predictableCount++;
      }
    }
    
    if (predictableCount > story.episodes.length / 2) {
      issues.push({
        severity: 'warning',
        type: 'predictable_choice',
        rule: '12',
        ruleText: PIXAR_RULES['12'],
        location: {},
        description: 'Story may rely too heavily on clichéd storytelling patterns',
        suggestion: 'Discount the obvious - what would surprise the audience?',
        autoFixable: false,
      });
    }
    
    return issues;
  }

  // ========================================
  // SCORING METHODS
  // ========================================

  private calculateScores(
    bible: SeasonBible,
    characterBible: CharacterBible | undefined,
    issues: PixarIssue[]
  ): {
    overall: number;
    storySpine: number;
    characterOpinions: number;
    stakesAndOdds: number;
    polarOpposites: number;
    causality: number;
    surprise: number;
    burningQuestion: number;
    struggleAndTrying: number;
  } {
    // Calculate per-category scores
    const issuesByRule: Record<string, PixarIssue[]> = {};
    for (const issue of issues) {
      if (!issuesByRule[issue.rule]) issuesByRule[issue.rule] = [];
      issuesByRule[issue.rule].push(issue);
    }
    
    const calculateRuleScore = (ruleNumber: string, maxIssues: number = 5) => {
      const ruleIssues = issuesByRule[ruleNumber] || [];
      const errorCount = ruleIssues.filter(i => i.severity === 'error').length;
      const warningCount = ruleIssues.filter(i => i.severity === 'warning').length;
      const penalty = (errorCount * 20) + (warningCount * 10);
      return Math.max(0, 100 - penalty);
    };
    
    const storySpine = calculateRuleScore('4');
    const characterOpinions = calculateRuleScore('13');
    const stakesAndOdds = calculateRuleScore('16');
    const polarOpposites = calculateRuleScore('6');
    const causality = calculateRuleScore('19');
    const surprise = calculateRuleScore('12');
    const burningQuestion = calculateRuleScore('14');
    const struggleAndTrying = calculateRuleScore('1');
    
    // Calculate overall as weighted average
    const overall = Math.round(
      (storySpine * 0.15) +
      (characterOpinions * 0.15) +
      (stakesAndOdds * 0.15) +
      (polarOpposites * 0.10) +
      (causality * 0.15) +
      (surprise * 0.10) +
      (burningQuestion * 0.10) +
      (struggleAndTrying * 0.10)
    );
    
    return {
      overall,
      storySpine,
      characterOpinions,
      stakesAndOdds,
      polarOpposites,
      causality,
      surprise,
      burningQuestion,
      struggleAndTrying,
    };
  }

  private generateSummary(
    bible: SeasonBible,
    issues: PixarIssue[],
    scores: { overall: number }
  ): string {
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    
    let summary = `Pixar Principles Validation: ${bible.storyTitle || 'Untitled'}\n`;
    summary += `Overall Pixar Score: ${scores.overall}/100\n\n`;
    
    if (scores.overall >= 80) {
      summary += 'This story follows Pixar\'s storytelling principles well!\n';
    } else if (scores.overall >= 60) {
      summary += 'This story has good bones but could better follow Pixar\'s principles.\n';
    } else {
      summary += 'This story would benefit significantly from applying Pixar\'s principles.\n';
    }
    
    if (errors.length > 0) {
      summary += `\nCRITICAL ISSUES (${errors.length}):\n`;
      errors.forEach(e => summary += `  - [Rule #${e.rule}] ${e.description}\n`);
    }
    
    if (warnings.length > 0) {
      summary += `\nWARNINGS (${warnings.length}):\n`;
      warnings.slice(0, 5).forEach(w => summary += `  - [Rule #${w.rule}] ${w.description}\n`);
      if (warnings.length > 5) {
        summary += `  ... and ${warnings.length - 5} more\n`;
      }
    }
    
    return summary;
  }

  private findHighlights(
    bible: SeasonBible,
    characterBible: CharacterBible | undefined,
    scores: { storySpine: number; burningQuestion: number }
  ): string[] {
    const highlights: string[] = [];
    
    if (scores.storySpine >= 80) {
      highlights.push('Strong Story Spine structure (Rule #4)');
    }
    
    if (bible.burningQuestion?.question) {
      highlights.push(`Clear Burning Question: "${bible.burningQuestion.question}" (Rule #14)`);
    }
    
    if (characterBible) {
      const charsWithOpinions = characterBible.characters.filter(c => c.pixarDepth?.coreOpinion).length;
      if (charsWithOpinions >= 3) {
        highlights.push(`${charsWithOpinions} characters with strong opinions (Rule #13)`);
      }
    }
    
    return highlights;
  }

  private findPriorityFixes(issues: PixarIssue[]): string[] {
    // Prioritize errors, then warnings by rule importance
    const rulePriority = ['19', '4', '14', '16', '13', '6', '12', '1'];
    
    const prioritized = issues
      .filter(i => i.severity === 'error' || i.severity === 'warning')
      .sort((a, b) => {
        // Errors first
        if (a.severity === 'error' && b.severity !== 'error') return -1;
        if (b.severity === 'error' && a.severity !== 'error') return 1;
        // Then by rule priority
        return rulePriority.indexOf(a.rule) - rulePriority.indexOf(b.rule);
      });
    
    return prioritized.slice(0, 5).map(i => `[Rule #${i.rule}] ${i.suggestion}`);
  }
}

export default PixarPrinciplesValidator;
