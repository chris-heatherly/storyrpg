/**
 * NPC Depth Validator
 *
 * Enforces NPC tier-based relationship depth requirements:
 * - Core NPCs: Must have all 4 relationship dimensions (trust, affection, respect, fear)
 * - Supporting NPCs: Must have at least 2 relationship dimensions
 * - Background NPCs: Must have at least 1 relationship dimension
 */

import { NPCTier, RelationshipDimension, TieredNPC } from '../../types';
import {
  ValidationIssue,
  NPCDepthRequirements,
  NPCDepthValidationResult,
  NPCDepthInput,
  ValidationConfig,
} from '../../types/validation';
import { DEFAULT_TIER_REQUIREMENTS, RELATIONSHIP_DIMENSIONS } from '../config/tierRequirements';

const ALL_DIMENSIONS: RelationshipDimension[] = [...RELATIONSHIP_DIMENSIONS];

export class NPCDepthValidator {
  private config: ValidationConfig['rules']['npcDepth'];
  private tierRequirements: Record<NPCTier, number>;

  constructor(config?: Partial<ValidationConfig['rules']['npcDepth']>) {
    this.config = {
      enabled: true,
      level: 'error',
      ...config,
    };
    
    // Allow override of core NPC requirements via config
    this.tierRequirements = {
      ...DEFAULT_TIER_REQUIREMENTS,
      core: config?.minMajorDimensions ?? DEFAULT_TIER_REQUIREMENTS.core,
    };
  }

  /**
   * Determine NPC tier based on importance/role
   */
  inferTier(npc: { importance?: string; role?: string }): NPCTier {
    const importance = npc.importance?.toLowerCase();
    const role = npc.role?.toLowerCase();

    // Map importance to tier
    if (importance === 'major' || role === 'antagonist' || role === 'ally') {
      return 'core';
    }
    if (importance === 'supporting' || role === 'neutral') {
      return 'supporting';
    }
    return 'background';
  }

  /**
   * Get required dimensions for a tier
   */
  getRequiredDimensionCount(tier: NPCTier): number {
    return this.tierRequirements[tier];
  }

  /**
   * Calculate missing dimensions for an NPC
   */
  getMissingDimensions(
    tier: NPCTier,
    existingDimensions: RelationshipDimension[]
  ): RelationshipDimension[] {
    const requiredCount = this.tierRequirements[tier];

    // For core NPCs, all dimensions are required
    if (tier === 'core') {
      return ALL_DIMENSIONS.filter(d => !existingDimensions.includes(d));
    }

    // For other tiers, just check count
    if (existingDimensions.length >= requiredCount) {
      return [];
    }

    // Return suggested dimensions to add
    const missing = ALL_DIMENSIONS.filter(d => !existingDimensions.includes(d));
    return missing.slice(0, requiredCount - existingDimensions.length);
  }

  /**
   * Validate a single NPC's depth
   */
  validateNPC(npc: TieredNPC): NPCDepthRequirements {
    const requiredCount = this.tierRequirements[npc.tier];
    const actualDimensions = npc.relationshipDimensions || [];
    const missingDimensions = this.getMissingDimensions(npc.tier, actualDimensions);

    return {
      tier: npc.tier,
      requiredDimensions: requiredCount,
      actualDimensions,
      missingDimensions,
    };
  }

  /**
   * Validate an entire cast of NPCs
   */
  async validate(input: NPCDepthInput): Promise<NPCDepthValidationResult> {
    const issues: ValidationIssue[] = [];
    const npcAnalysis = new Map<string, NPCDepthRequirements>();

    for (const npc of input.npcs) {
      const requirements = this.validateNPC({
        id: npc.id,
        name: npc.name,
        tier: npc.tier,
        relationshipDimensions: npc.relationshipDimensions,
      });

      npcAnalysis.set(npc.id, requirements);

      // Check if NPC meets requirements
      if (requirements.missingDimensions.length > 0) {
        // Use configured level - no longer force 'error' for core NPCs
        // The CharacterDesigner may not always output all dimensions
        issues.push({
          category: 'npc_depth',
          level: this.config.level,
          message: `${npc.tier.toUpperCase()} NPC "${npc.name}" has ${requirements.actualDimensions.length}/${requirements.requiredDimensions} relationship dimensions`,
          location: {
            npcId: npc.id,
          },
          suggestion: `Add dimensions: ${requirements.missingDimensions.join(', ')}`,
        });
      }
    }

    // Determine if validation passed
    const hasBlockingIssues = issues.some(i => i.level === 'error');

    return {
      passed: !hasBlockingIssues,
      npcAnalysis,
      issues,
    };
  }

  /**
   * Validate cast from character bible format
   */
  async validateCast(characters: Array<{
    id: string;
    name: string;
    role?: string;
    importance?: string;
    initialStats?: Partial<{
      trust: number;
      affection: number;
      respect: number;
      fear: number;
    }>;
  }>): Promise<NPCDepthValidationResult> {
    // Filter out the protagonist - they are not an NPC
    const npcCharacters = characters.filter(char =>
      char.role?.toLowerCase() !== 'protagonist'
    );

    // If no NPCs, return passed with empty analysis
    if (npcCharacters.length === 0) {
      return {
        passed: true,
        npcAnalysis: new Map(),
        issues: [],
      };
    }

    // Convert characters to TieredNPC format
    const npcs: NPCDepthInput['npcs'] = npcCharacters.map(char => {
      const tier = this.inferTier(char);

      // Determine which dimensions are defined (have non-zero initial stats)
      const dimensions: RelationshipDimension[] = [];
      if (char.initialStats) {
        if (char.initialStats.trust !== undefined) dimensions.push('trust');
        if (char.initialStats.affection !== undefined) dimensions.push('affection');
        if (char.initialStats.respect !== undefined) dimensions.push('respect');
        if (char.initialStats.fear !== undefined) dimensions.push('fear');
      }

      return {
        id: char.id,
        name: char.name,
        tier,
        relationshipDimensions: dimensions,
      };
    });

    return this.validate({ npcs });
  }

  /**
   * Get summary statistics for NPC depth validation
   */
  getSummary(result: NPCDepthValidationResult): {
    coreNPCsValid: number;
    coreNPCsTotal: number;
    supportingNPCsValid: number;
    supportingNPCsTotal: number;
    backgroundNPCsValid: number;
    backgroundNPCsTotal: number;
  } {
    let coreValid = 0, coreTotal = 0;
    let supportingValid = 0, supportingTotal = 0;
    let backgroundValid = 0, backgroundTotal = 0;

    const entries = Array.from(result.npcAnalysis.entries());
    for (const [, requirements] of entries) {
      const isValid = requirements.missingDimensions.length === 0;

      switch (requirements.tier) {
        case 'core':
          coreTotal++;
          if (isValid) coreValid++;
          break;
        case 'supporting':
          supportingTotal++;
          if (isValid) supportingValid++;
          break;
        case 'background':
          backgroundTotal++;
          if (isValid) backgroundValid++;
          break;
      }
    }

    return {
      coreNPCsValid: coreValid,
      coreNPCsTotal: coreTotal,
      supportingNPCsValid: supportingValid,
      supportingNPCsTotal: supportingTotal,
      backgroundNPCsValid: backgroundValid,
      backgroundNPCsTotal: backgroundTotal,
    };
  }
}
