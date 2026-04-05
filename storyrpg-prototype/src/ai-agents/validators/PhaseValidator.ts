/**
 * Phase Validator
 * 
 * Validates output at each major phase of the pipeline.
 * Enables early error detection and feedback loops for repair.
 */

import { WorldBible, Location } from '../agents/WorldBuilder';
import { CharacterBible, CharacterProfile } from '../agents/CharacterDesigner';
import { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import { SceneContent } from '../agents/SceneWriter';
import { ChoiceSet } from '../agents/ChoiceAuthor';
import { EncounterStructure } from '../agents/EncounterArchitect';
import { SeasonBible, EpisodePlan } from '../../types';
import { getEncounterBeats } from '../utils/encounterImageCoverage';

// ========================================
// TYPES
// ========================================

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface PhaseValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  field?: string;
  suggestion?: string;
}

export interface PhaseValidationResult {
  phase: string;
  valid: boolean;
  score: number; // 0-100
  issues: PhaseValidationIssue[];
  canProceed: boolean; // false = blocking issues
  summary: string;
}

export interface PhaseValidationConfig {
  // Validation mode
  mode: 'strict' | 'normal' | 'lenient' | 'disabled';
  
  // Score thresholds
  blockingThreshold: number; // Below this score, pipeline halts (default 40)
  warningThreshold: number;  // Below this score, warnings are shown (default 70)
  
  // Retry settings
  enableRetry: boolean;      // Allow agents to retry on validation failure
  maxRetries: number;        // Max retry attempts per phase
  
  // Phase-specific overrides
  phaseOverrides?: {
    [phase: string]: {
      blockingThreshold?: number;
      warningThreshold?: number;
      enableRetry?: boolean;
    };
  };
}

// Default config
export const DEFAULT_VALIDATION_CONFIG: PhaseValidationConfig = {
  mode: 'normal',
  blockingThreshold: 40,
  warningThreshold: 70,
  enableRetry: true,
  maxRetries: 1,
};

// ========================================
// PHASE VALIDATOR CLASS
// ========================================

export class PhaseValidator {
  private config: PhaseValidationConfig;
  
  constructor(config: Partial<PhaseValidationConfig> = {}) {
    this.config = { ...DEFAULT_VALIDATION_CONFIG, ...config };
  }
  
  /**
   * Get effective threshold for a phase
   */
  private getThreshold(phase: string, type: 'blocking' | 'warning'): number {
    const override = this.config.phaseOverrides?.[phase];
    if (type === 'blocking') {
      return override?.blockingThreshold ?? this.config.blockingThreshold;
    }
    return override?.warningThreshold ?? this.config.warningThreshold;
  }
  
  /**
   * Check if validation is enabled
   */
  isEnabled(): boolean {
    return this.config.mode !== 'disabled';
  }
  
  /**
   * Check if retry is enabled for a phase
   */
  canRetry(phase: string): boolean {
    if (!this.config.enableRetry) return false;
    const override = this.config.phaseOverrides?.[phase];
    return override?.enableRetry ?? true;
  }

  getMaxRetries(): number {
    return this.config.maxRetries;
  }
  
  // ========================================
  // WORLD BUILDING VALIDATION
  // ========================================
  
  validateWorldBible(worldBible: WorldBible): PhaseValidationResult {
    const phase = 'world_building';
    const issues: PhaseValidationIssue[] = [];
    
    if (!worldBible) {
      return {
        phase,
        valid: false,
        score: 0,
        issues: [{ severity: 'error', code: 'NULL_WORLD', message: 'World bible is null/undefined' }],
        canProceed: false,
        summary: 'World building failed - no output',
      };
    }
    
    // Check locations
    if (!worldBible.locations || worldBible.locations.length === 0) {
      issues.push({
        severity: 'error',
        code: 'NO_LOCATIONS',
        message: 'No locations were generated',
        suggestion: 'Ensure locationsToCreate input is provided',
      });
    } else {
      // Validate each location
      for (const loc of worldBible.locations) {
        if (!loc.id) {
          issues.push({
            severity: 'error',
            code: 'LOCATION_NO_ID',
            message: `Location "${loc.name || 'unknown'}" has no ID`,
            field: 'locations',
          });
        }
        if (!loc.name || loc.name.trim().length === 0) {
          issues.push({
            severity: 'error',
            code: 'LOCATION_NO_NAME',
            message: `Location ${loc.id} has no name`,
            field: 'locations',
          });
        }
        if (!loc.fullDescription || loc.fullDescription.length < 50) {
          issues.push({
            severity: 'warning',
            code: 'LOCATION_THIN_DESCRIPTION',
            message: `Location "${loc.name}" has a thin description (${loc.fullDescription?.length || 0} chars)`,
            field: 'locations',
            suggestion: 'Descriptions should be at least 50 characters for immersive world building',
          });
        }
        if (!loc.sensoryDetails || Object.keys(loc.sensoryDetails).length === 0) {
          issues.push({
            severity: 'warning',
            code: 'LOCATION_NO_SENSORY',
            message: `Location "${loc.name}" has no sensory details`,
            field: 'locations',
            suggestion: 'Add sights, sounds, smells for richer descriptions',
          });
        }
      }
      
      // Check for duplicate IDs
      const ids = worldBible.locations.map(l => l.id);
      const uniqueIds = new Set(ids);
      if (uniqueIds.size !== ids.length) {
        issues.push({
          severity: 'error',
          code: 'DUPLICATE_LOCATION_IDS',
          message: 'Duplicate location IDs detected',
          field: 'locations',
        });
      }
    }
    
    // Check world rules
    if (!worldBible.worldRules || worldBible.worldRules.length < 3) {
      issues.push({
        severity: 'warning',
        code: 'FEW_WORLD_RULES',
        message: `Only ${worldBible.worldRules?.length || 0} world rules defined (recommend at least 3)`,
        field: 'worldRules',
        suggestion: 'World rules help maintain consistency across the story',
      });
    }
    
    // Check tensions
    if (!worldBible.tensions || worldBible.tensions.length === 0) {
      issues.push({
        severity: 'info',
        code: 'NO_TENSIONS',
        message: 'No world tensions defined',
        field: 'tensions',
        suggestion: 'Tensions create conflict opportunities',
      });
    }
    
    return this.buildResult(phase, issues);
  }
  
  // ========================================
  // CHARACTER DESIGN VALIDATION
  // ========================================
  
  validateCharacterBible(characterBible: CharacterBible, protagonistId?: string): PhaseValidationResult {
    const phase = 'character_design';
    const issues: PhaseValidationIssue[] = [];
    
    if (!characterBible) {
      return {
        phase,
        valid: false,
        score: 0,
        issues: [{ severity: 'error', code: 'NULL_CHARACTERS', message: 'Character bible is null/undefined' }],
        canProceed: false,
        summary: 'Character design failed - no output',
      };
    }
    
    // Check characters exist
    if (!characterBible.characters || characterBible.characters.length === 0) {
      issues.push({
        severity: 'error',
        code: 'NO_CHARACTERS',
        message: 'No characters were generated',
      });
    } else {
      // Check protagonist exists
      if (protagonistId) {
        const protagonist = characterBible.characters.find(c => c.id === protagonistId);
        if (!protagonist) {
          issues.push({
            severity: 'error',
            code: 'MISSING_PROTAGONIST',
            message: `Protagonist with ID "${protagonistId}" not found in character bible`,
            suggestion: 'Ensure protagonist is included in characters to create',
          });
        }
      }
      
      // Validate each character
      for (const char of characterBible.characters) {
        if (!char.id) {
          issues.push({
            severity: 'error',
            code: 'CHARACTER_NO_ID',
            message: `Character "${char.name || 'unknown'}" has no ID`,
          });
        }
        if (!char.name || char.name.trim().length === 0) {
          issues.push({
            severity: 'error',
            code: 'CHARACTER_NO_NAME',
            message: `Character ${char.id} has no name`,
          });
        }
        
        // Check character depth
        if (!char.want || char.want.length < 20) {
          issues.push({
            severity: 'warning',
            code: 'CHARACTER_SHALLOW_WANT',
            message: `Character "${char.name}" has shallow/missing WANT`,
            suggestion: 'Characters need clear goals and motivations',
          });
        }
        if (!char.flaw) {
          issues.push({
            severity: 'warning',
            code: 'CHARACTER_NO_FLAW',
            message: `Character "${char.name}" has no defined flaw`,
            suggestion: 'Flaws make characters relatable and create conflict',
          });
        }
        
        // Check voice profile
        if (!char.voiceProfile) {
          issues.push({
            severity: 'warning',
            code: 'CHARACTER_NO_VOICE',
            message: `Character "${char.name}" has no voice profile`,
            suggestion: 'Voice profiles ensure consistent dialogue',
          });
        } else if (!char.voiceProfile.signatureLines || char.voiceProfile.signatureLines.length < 2) {
          issues.push({
            severity: 'info',
            code: 'CHARACTER_FEW_SIGNATURES',
            message: `Character "${char.name}" has few signature lines`,
          });
        }
        
        // Check Pixar depth (if present)
        if (char.pixarDepth) {
          if (!char.pixarDepth.coreOpinion) {
            issues.push({
              severity: 'info',
              code: 'PIXAR_NO_OPINION',
              message: `Character "${char.name}" missing Pixar core opinion (Rule #13)`,
            });
          }
          if (!char.pixarDepth.personalStakes) {
            issues.push({
              severity: 'info',
              code: 'PIXAR_NO_STAKES',
              message: `Character "${char.name}" missing Pixar personal stakes (Rule #16)`,
            });
          }
        }
      }
      
      // Check for duplicate IDs
      const ids = characterBible.characters.map(c => c.id);
      const uniqueIds = new Set(ids);
      if (uniqueIds.size !== ids.length) {
        issues.push({
          severity: 'error',
          code: 'DUPLICATE_CHARACTER_IDS',
          message: 'Duplicate character IDs detected',
        });
      }
    }
    
    return this.buildResult(phase, issues);
  }
  
  // ========================================
  // EPISODE ARCHITECTURE VALIDATION
  // ========================================
  
  validateEpisodeBlueprint(
    blueprint: EpisodeBlueprint,
    worldBible: WorldBible,
    characterBible: CharacterBible
  ): PhaseValidationResult {
    const phase = 'episode_architecture';
    const issues: PhaseValidationIssue[] = [];
    
    if (!blueprint) {
      return {
        phase,
        valid: false,
        score: 0,
        issues: [{ severity: 'error', code: 'NULL_BLUEPRINT', message: 'Episode blueprint is null/undefined' }],
        canProceed: false,
        summary: 'Episode architecture failed - no output',
      };
    }
    
    // Check scenes exist
    if (!blueprint.scenes || blueprint.scenes.length === 0) {
      issues.push({
        severity: 'error',
        code: 'NO_SCENES',
        message: 'No scenes were generated',
      });
    } else {
      // Check scene count
      if (blueprint.scenes.length < 3) {
        issues.push({
          severity: 'error',
          code: 'TOO_FEW_SCENES',
          message: `Only ${blueprint.scenes.length} scenes generated (minimum 3)`,
          suggestion: 'Episodes need at least 3 scenes for proper pacing',
        });
      }
      
      // Validate scene structure
      const validSceneIds = new Set(blueprint.scenes.map(s => s.id));
      const validLocationIds = new Set(worldBible.locations.map(l => l.id));
      const validCharacterIds = new Set(characterBible.characters.map(c => c.id));
      
      let choicePointCount = 0;
      let consecutiveNoChoice = 0;
      let maxConsecutiveNoChoice = 0;
      
      for (let i = 0; i < blueprint.scenes.length; i++) {
        const scene = blueprint.scenes[i];
        
        // Check basic fields
        if (!scene.id) {
          issues.push({
            severity: 'error',
            code: 'SCENE_NO_ID',
            message: `Scene at index ${i} has no ID`,
          });
        }
        if (!scene.name) {
          issues.push({
            severity: 'warning',
            code: 'SCENE_NO_NAME',
            message: `Scene "${scene.id}" has no name`,
          });
        }
        
        // Validate location reference
        if (scene.location && !validLocationIds.has(scene.location)) {
          issues.push({
            severity: 'warning',
            code: 'INVALID_LOCATION_REF',
            message: `Scene "${scene.id}" references unknown location "${scene.location}"`,
            suggestion: 'Location IDs should match generated locations',
          });
        }
        
        // Validate NPC references
        for (const npcId of scene.npcsPresent || []) {
          if (!validCharacterIds.has(npcId)) {
            issues.push({
              severity: 'warning',
              code: 'INVALID_NPC_REF',
              message: `Scene "${scene.id}" references unknown NPC "${npcId}"`,
              suggestion: 'NPC IDs should match generated characters',
            });
          }
        }
        
        // Validate leadsTo references
        for (const targetId of scene.leadsTo || []) {
          if (!validSceneIds.has(targetId)) {
            issues.push({
              severity: 'error',
              code: 'INVALID_LEADSTO_REF',
              message: `Scene "${scene.id}" leads to unknown scene "${targetId}"`,
            });
          }
        }
        
        // Track choice density
        if (scene.choicePoint) {
          choicePointCount++;
          consecutiveNoChoice = 0;
          
          // Validate choice point
          if (!scene.choicePoint.type) {
            issues.push({
              severity: 'warning',
              code: 'CHOICE_NO_TYPE',
              message: `Choice in scene "${scene.id}" has no type`,
            });
          }
          if (!scene.choicePoint.stakes) {
            issues.push({
              severity: 'warning',
              code: 'CHOICE_NO_STAKES',
              message: `Choice in scene "${scene.id}" has no stakes defined`,
            });
          }
        } else {
          consecutiveNoChoice++;
          maxConsecutiveNoChoice = Math.max(maxConsecutiveNoChoice, consecutiveNoChoice);
        }
      }
      
      // Check choice density
      const choiceDensity = choicePointCount / blueprint.scenes.length;
      if (choiceDensity < 0.4) {
        issues.push({
          severity: 'error',
          code: 'LOW_CHOICE_DENSITY',
          message: `Choice density is ${(choiceDensity * 100).toFixed(0)}% (minimum 40%)`,
          suggestion: 'Add more choice points for player agency',
        });
      } else if (choiceDensity < 0.5) {
        issues.push({
          severity: 'warning',
          code: 'BORDERLINE_CHOICE_DENSITY',
          message: `Choice density is ${(choiceDensity * 100).toFixed(0)}% (recommend 50%+)`,
        });
      }
      
      // Check consecutive scenes without choice
      if (maxConsecutiveNoChoice > 2) {
        issues.push({
          severity: 'warning',
          code: 'CHOICE_GAP',
          message: `${maxConsecutiveNoChoice} consecutive scenes without a choice point`,
          suggestion: 'Players should have choices frequently',
        });
      }
      
      // Check starting scene
      if (!blueprint.startingSceneId) {
        issues.push({
          severity: 'error',
          code: 'NO_STARTING_SCENE',
          message: 'No starting scene ID defined',
        });
      } else if (!validSceneIds.has(blueprint.startingSceneId)) {
        issues.push({
          severity: 'error',
          code: 'INVALID_STARTING_SCENE',
          message: `Starting scene "${blueprint.startingSceneId}" not found in scenes`,
        });
      }
      
      // Check for duplicate scene IDs
      const sceneIds = blueprint.scenes.map(s => s.id);
      const uniqueSceneIds = new Set(sceneIds);
      if (uniqueSceneIds.size !== sceneIds.length) {
        issues.push({
          severity: 'error',
          code: 'DUPLICATE_SCENE_IDS',
          message: 'Duplicate scene IDs detected',
        });
      }
    }
    
    return this.buildResult(phase, issues);
  }
  
  // ========================================
  // SCENE CONTENT VALIDATION
  // ========================================
  
  validateSceneContents(
    sceneContents: SceneContent[],
    blueprint: EpisodeBlueprint,
    characterBible: CharacterBible
  ): PhaseValidationResult {
    const phase = 'scene_writing';
    const issues: PhaseValidationIssue[] = [];
    
    if (!sceneContents || sceneContents.length === 0) {
      return {
        phase,
        valid: false,
        score: 0,
        issues: [{ severity: 'error', code: 'NO_SCENE_CONTENT', message: 'No scene content was generated' }],
        canProceed: false,
        summary: 'Scene writing failed - no output',
      };
    }
    
    // Check all scenes have content
    const contentSceneIds = new Set(sceneContents.map(sc => sc.sceneId));
    for (const scene of blueprint.scenes) {
      if (!contentSceneIds.has(scene.id)) {
        issues.push({
          severity: 'error',
          code: 'MISSING_SCENE_CONTENT',
          message: `Scene "${scene.id}" has no content generated`,
        });
      }
    }
    
    // Validate each scene's content
    const characterNames = new Set(characterBible.characters.map(c => c.name.toLowerCase()));
    
    for (const content of sceneContents) {
      // Check beats
      if (!content.beats || content.beats.length === 0) {
        issues.push({
          severity: 'error',
          code: 'SCENE_NO_BEATS',
          message: `Scene "${content.sceneId}" has no beats`,
        });
        continue;
      }
      
      // Check beat content
      for (const beat of content.beats) {
        if (!beat.text || beat.text.trim().length === 0) {
          issues.push({
            severity: 'error',
            code: 'BEAT_EMPTY',
            message: `Beat "${beat.id}" in scene "${content.sceneId}" is empty`,
          });
        } else if (beat.text.length < 20) {
          issues.push({
            severity: 'warning',
            code: 'BEAT_TOO_SHORT',
            message: `Beat "${beat.id}" is very short (${beat.text.length} chars)`,
          });
        }
        
        // Check for undefined placeholders
        if (beat.text.includes('[undefined]') || beat.text.includes('undefined')) {
          issues.push({
            severity: 'error',
            code: 'BEAT_HAS_UNDEFINED',
            message: `Beat "${beat.id}" contains "undefined" text`,
          });
        }
        
        // Check for placeholder text
        if (beat.text.includes('[INSERT') || beat.text.includes('TODO') || beat.text.includes('PLACEHOLDER')) {
          issues.push({
            severity: 'error',
            code: 'BEAT_HAS_PLACEHOLDER',
            message: `Beat "${beat.id}" contains placeholder text`,
          });
        }
      }
      
      // Check total word count
      const totalWords = content.beats.reduce((sum, b) => sum + (b.text?.split(/\s+/).length || 0), 0);
      if (totalWords < 100) {
        issues.push({
          severity: 'warning',
          code: 'SCENE_TOO_SHORT',
          message: `Scene "${content.sceneId}" is very short (${totalWords} words)`,
        });
      }
    }
    
    return this.buildResult(phase, issues);
  }
  
  // ========================================
  // CHOICE VALIDATION
  // ========================================
  
  validateChoices(
    choiceSets: ChoiceSet[],
    blueprint: EpisodeBlueprint
  ): PhaseValidationResult {
    const phase = 'choice_generation';
    const issues: PhaseValidationIssue[] = [];
    
    // Count scenes that should have choices
    const scenesWithChoicePoints = blueprint.scenes.filter(s => s.choicePoint).length;
    
    if (!choiceSets || choiceSets.length === 0) {
      if (scenesWithChoicePoints > 0) {
        return {
          phase,
          valid: false,
          score: 0,
          issues: [{ severity: 'error', code: 'NO_CHOICES', message: 'No choices were generated' }],
          canProceed: false,
          summary: 'Choice generation failed - no output',
        };
      }
      // No choices expected, no choices generated - OK
      return {
        phase,
        valid: true,
        score: 100,
        issues: [],
        canProceed: true,
        summary: 'No choices needed for this episode',
      };
    }
    
    // Validate each choice set
    for (const choiceSet of choiceSets) {
      if (!choiceSet.choices || choiceSet.choices.length === 0) {
        issues.push({
          severity: 'error',
          code: 'CHOICESET_EMPTY',
          message: `Choice set for beat "${choiceSet.beatId}" has no choices`,
        });
        continue;
      }
      
      if (choiceSet.choices.length < 2) {
        issues.push({
          severity: 'error',
          code: 'TOO_FEW_CHOICES',
          message: `Choice set for beat "${choiceSet.beatId}" has only ${choiceSet.choices.length} choice (minimum 2)`,
        });
      }
      
      if (choiceSet.choices.length > 5) {
        issues.push({
          severity: 'warning',
          code: 'TOO_MANY_CHOICES',
          message: `Choice set for beat "${choiceSet.beatId}" has ${choiceSet.choices.length} choices (max 5 recommended)`,
          suggestion: 'Too many choices can overwhelm players',
        });
      }
      
      // Check individual choices
      const choiceIds = new Set<string>();
      for (const choice of choiceSet.choices) {
        // Check for duplicate IDs
        if (choiceIds.has(choice.id)) {
          issues.push({
            severity: 'error',
            code: 'DUPLICATE_CHOICE_ID',
            message: `Duplicate choice ID "${choice.id}" in beat "${choiceSet.beatId}"`,
          });
        }
        choiceIds.add(choice.id);
        
        // Check choice text
        if (!choice.text || choice.text.trim().length === 0) {
          issues.push({
            severity: 'error',
            code: 'CHOICE_EMPTY',
            message: `Choice "${choice.id}" has no text`,
          });
        } else if (choice.text.length < 10) {
          issues.push({
            severity: 'warning',
            code: 'CHOICE_TOO_SHORT',
            message: `Choice "${choice.id}" is very short`,
          });
        }
        
        // Check consequences
        if (!choice.consequences || choice.consequences.length === 0) {
          issues.push({
            severity: 'warning',
            code: 'CHOICE_NO_CONSEQUENCES',
            message: `Choice "${choice.id}" has no consequences`,
            suggestion: 'Choices should have meaningful impacts',
          });
        }
      }
    }
    
    return this.buildResult(phase, issues);
  }
  
  // ========================================
  // ENCOUNTER VALIDATION
  // ========================================
  
  validateEncounters(
    encounters: Array<{ sceneId: string; encounter: EncounterStructure }>,
    blueprint: EpisodeBlueprint
  ): PhaseValidationResult {
    const phase = 'encounter_generation';
    const issues: PhaseValidationIssue[] = [];
    
    // Count scenes that should have encounters
    const encounterScenes = blueprint.scenes.filter(s => s.isEncounter);
    
    if ((!encounters || encounters.length === 0) && encounterScenes.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'MISSING_ENCOUNTERS',
        message: `${encounterScenes.length} encounter scenes defined but no encounters generated`,
      });
    }
    
    // Validate each encounter
    for (const { sceneId, encounter } of encounters || []) {
      if (!encounter) {
        issues.push({
          severity: 'error',
          code: 'NULL_ENCOUNTER',
          message: `Encounter for scene "${sceneId}" is null`,
        });
        continue;
      }
      
      const encounterBeats = getEncounterBeats(encounter as any);

      // Check beats
      if (encounterBeats.length === 0) {
        issues.push({
          severity: 'error',
          code: 'ENCOUNTER_NO_BEATS',
          message: `Encounter for scene "${sceneId}" has no beats`,
        });
      } else if (encounterBeats.length < 2) {
        issues.push({
          severity: 'warning',
          code: 'ENCOUNTER_FEW_BEATS',
          message: `Encounter for scene "${sceneId}" has only ${encounterBeats.length} beat(s)`,
        });
      }
      
      // Check starting beat
      if (!encounter.startingBeatId) {
        issues.push({
          severity: 'error',
          code: 'ENCOUNTER_NO_START',
          message: `Encounter for scene "${sceneId}" has no starting beat`,
        });
      }
      
      // Check outcomes
      for (const beat of encounterBeats) {
        if (beat.choices) {
          for (const choice of beat.choices) {
            if (!choice.outcomes || choice.outcomes.length === 0) {
              issues.push({
                severity: 'warning',
                code: 'ENCOUNTER_CHOICE_NO_OUTCOMES',
                message: `Choice "${choice.id}" in encounter "${sceneId}" has no outcomes`,
              });
            }
          }
        }
      }
    }
    
    return this.buildResult(phase, issues);
  }
  
  // ========================================
  // HELPER METHODS
  // ========================================
  
  /**
   * Build validation result from issues
   */
  private buildResult(phase: string, issues: PhaseValidationIssue[]): PhaseValidationResult {
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const infoCount = issues.filter(i => i.severity === 'info').length;
    
    // Calculate score (errors = -10, warnings = -3, info = -1)
    let score = 100 - (errorCount * 10) - (warningCount * 3) - (infoCount * 1);
    score = Math.max(0, Math.min(100, score));
    
    const blockingThreshold = this.getThreshold(phase, 'blocking');
    const warningThreshold = this.getThreshold(phase, 'warning');
    
    const canProceed = this.config.mode === 'lenient' 
      ? errorCount === 0 
      : score >= blockingThreshold;
    
    const valid = errorCount === 0;
    
    // Build summary
    let summary: string;
    if (valid && warningCount === 0) {
      summary = `${phase} passed validation`;
    } else if (valid) {
      summary = `${phase} passed with ${warningCount} warning(s)`;
    } else {
      summary = `${phase} has ${errorCount} error(s), ${warningCount} warning(s)`;
    }
    
    if (score < warningThreshold) {
      summary += ` (score: ${score}/100)`;
    }
    
    return {
      phase,
      valid,
      score,
      issues,
      canProceed,
      summary,
    };
  }
  
  /**
   * Format validation result for logging
   */
  formatResult(result: PhaseValidationResult): string {
    const lines: string[] = [
      `=== ${result.phase.toUpperCase()} VALIDATION ===`,
      `Score: ${result.score}/100 | Valid: ${result.valid} | Can Proceed: ${result.canProceed}`,
      result.summary,
    ];
    
    if (result.issues.length > 0) {
      lines.push('Issues:');
      for (const issue of result.issues) {
        const prefix = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
        lines.push(`  ${prefix} [${issue.code}] ${issue.message}`);
        if (issue.suggestion) {
          lines.push(`     💡 ${issue.suggestion}`);
        }
      }
    }
    
    return lines.join('\n');
  }
}
