/**
 * Structural Validator
 * 
 * Validates the structural integrity of generated story content:
 * - All required IDs are present and unique
 * - Navigation chains are valid (nextBeatId, nextSceneId, leadsTo)
 * - Encounter beats are properly sequenced
 * - Choices point to valid targets
 * - No orphaned content
 * 
 * Unlike LLM-based QA agents, this is pure programmatic validation.
 */

import { Story, Episode, Scene, Beat, Encounter } from '../../types';

export interface StructuralIssue {
  severity: 'error' | 'warning';
  type: 
    | 'missing_id' 
    | 'duplicate_id' 
    | 'broken_reference' 
    | 'orphaned_content' 
    | 'missing_required_field'
    | 'empty_content'
    | 'malformed_data'
    | 'invalid_sequence'
    | 'navigation_loop';
  location: {
    episodeId?: string;
    sceneId?: string;
    beatId?: string;
    encounterId?: string;
    choiceId?: string;
  };
  description: string;
  field?: string;
  expected?: string;
  actual?: string;
  autoFixable: boolean;
  suggestedFix?: string;
}

export interface StructuralReport {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: StructuralIssue[];
  summary: string;
}

export class StructuralValidator {
  /**
   * Validate an entire story structure
   */
  validateStory(story: Story): StructuralReport {
    const issues: StructuralIssue[] = [];
    
    // Check story-level fields
    if (!story.id) {
      issues.push(this.createIssue('error', 'missing_id', {}, 'Story is missing ID', 'id'));
    }
    if (!story.title) {
      issues.push(this.createIssue('warning', 'missing_required_field', {}, 'Story is missing title', 'title'));
    }
    
    // Validate episodes
    const episodeIds = new Set<string>();
    for (const episode of story.episodes || []) {
      // Check for duplicate episode IDs
      if (episodeIds.has(episode.id)) {
        issues.push(this.createIssue('error', 'duplicate_id', { episodeId: episode.id }, 
          `Duplicate episode ID: ${episode.id}`, 'id'));
      }
      episodeIds.add(episode.id);
      
      // Validate episode
      issues.push(...this.validateEpisode(episode, story));
    }
    
    return this.buildReport(issues);
  }
  
  /**
   * Validate an episode structure
   */
  validateEpisode(episode: Episode, story: Story): StructuralIssue[] {
    const issues: StructuralIssue[] = [];
    const loc = { episodeId: episode.id };
    
    // Check episode-level fields
    if (!episode.id) {
      issues.push(this.createIssue('error', 'missing_id', loc, 'Episode is missing ID', 'id'));
    }
    
    // Collect all scene IDs for reference validation
    const sceneIds = new Set<string>();
    const beatIds = new Set<string>();
    
    for (const scene of episode.scenes || []) {
      // Check for duplicate scene IDs
      if (sceneIds.has(scene.id)) {
        issues.push(this.createIssue('error', 'duplicate_id', { ...loc, sceneId: scene.id },
          `Duplicate scene ID: ${scene.id}`, 'id'));
      }
      sceneIds.add(scene.id);
      
      // Validate scene structure
      issues.push(...this.validateScene(scene, sceneIds, beatIds, loc));
    }
    
    // Check that leadsTo references are valid
    for (const scene of episode.scenes || []) {
      if (scene.leadsTo) {
        for (const targetId of scene.leadsTo) {
          if (!sceneIds.has(targetId) && !targetId.startsWith('episode-')) {
            issues.push(this.createIssue('error', 'broken_reference', 
              { ...loc, sceneId: scene.id },
              `Scene ${scene.id} leadsTo non-existent scene: ${targetId}`,
              'leadsTo', 'valid scene ID', targetId, true,
              `Remove or fix reference to ${targetId}`));
          }
        }
      }
    }
    
    return issues;
  }
  
  /**
   * Validate a scene structure
   */
  validateScene(
    scene: Scene, 
    allSceneIds: Set<string>,
    allBeatIds: Set<string>,
    parentLoc: { episodeId: string }
  ): StructuralIssue[] {
    const issues: StructuralIssue[] = [];
    const loc = { ...parentLoc, sceneId: scene.id };
    
    // Check scene-level fields
    if (!scene.id) {
      issues.push(this.createIssue('error', 'missing_id', loc, 'Scene is missing ID', 'id'));
      return issues; // Can't continue without ID
    }
    
    // Collect beat IDs for this scene
    const sceneBeatIds = new Set<string>();
    
    for (const beat of scene.beats || []) {
      if (!beat.id) {
        issues.push(this.createIssue('error', 'missing_id', loc, 
          `Beat in scene ${scene.id} is missing ID`, 'beat.id'));
        continue;
      }
      
      // Check for duplicate beat IDs
      if (allBeatIds.has(beat.id)) {
        issues.push(this.createIssue('error', 'duplicate_id', { ...loc, beatId: beat.id },
          `Duplicate beat ID: ${beat.id}`, 'id'));
      }
      allBeatIds.add(beat.id);
      sceneBeatIds.add(beat.id);
      
    // Validate beat structure
    issues.push(...this.validateBeat(beat, sceneBeatIds, allSceneIds, loc));

    // NEW: Check for missing or empty text
    if (!beat.text || beat.text.trim().length === 0 || beat.text === '[Scene continues...]') {
      // Check if it's recoverable from 'content' or 'narrative'
      const anyBeat = beat as any;
      const hasAlternative = anyBeat.content || anyBeat.narrative || (beat.textVariants && beat.textVariants.length > 0);
      
      issues.push(this.createIssue(
        hasAlternative ? 'warning' : 'error', 
        'empty_content', 
        { ...loc, beatId: beat.id },
        `Beat ${beat.id} has no narrative text`, 
        'text', 'non-empty string', 'empty', true,
        hasAlternative ? 'Recover from alternative fields' : 'Add placeholder text'
      ));
    }

    // NEW: Check for malformed text variants
    if (beat.textVariants) {
      beat.textVariants.forEach((variant, vIdx) => {
        const v = variant as any;
        if (!variant.text && !v.content) {
          issues.push(this.createIssue('error', 'malformed_data', { ...loc, beatId: beat.id },
            `Text variant at index ${vIdx} is missing text content`, 'textVariants[].text'));
        }
        
        // Check for missing condition type
        if (variant.condition && typeof variant.condition === 'object' && !variant.condition.type) {
          issues.push(this.createIssue('warning', 'malformed_data', { ...loc, beatId: beat.id },
            `Condition in text variant ${vIdx} is missing 'type'`, 'textVariants[].condition.type',
            'flag, score, etc.', 'undefined', true, 'Infer type from fields'));
        }
      });
    }
  }

    // Check starting beat exists
    if (scene.startingBeatId && !sceneBeatIds.has(scene.startingBeatId)) {
      issues.push(this.createIssue('error', 'broken_reference', loc,
        `Scene ${scene.id} startingBeatId references non-existent beat: ${scene.startingBeatId}`,
        'startingBeatId', 'valid beat ID', scene.startingBeatId, true,
        `Set startingBeatId to first beat: ${scene.beats?.[0]?.id || 'unknown'}`));
    }
    
    // Check for dead-end beats (last beat with no navigation)
    if (scene.beats && scene.beats.length > 0) {
      const lastBeat = scene.beats[scene.beats.length - 1];
      const hasNavigation = lastBeat.nextBeatId || lastBeat.nextSceneId || 
                           (lastBeat.choices && lastBeat.choices.length > 0);
      
      if (!hasNavigation) {
        issues.push(this.createIssue('error', 'missing_required_field', loc,
          `Scene ${scene.id} last beat ${lastBeat.id} has no navigation (dead end)`,
          'navigation', 'nextBeatId, nextSceneId, or choices', 'none', true,
          `Add choices or nextSceneId to prevent dead end`));
      }
    }
    
    // Validate encounter if present
    if (scene.encounter) {
      issues.push(...this.validateEncounter(scene.encounter, allSceneIds, loc));
    }
    
    return issues;
  }
  
  /**
   * Validate a beat structure
   */
  validateBeat(
    beat: Beat,
    sceneBeatIds: Set<string>,
    allSceneIds: Set<string>,
    parentLoc: { episodeId: string; sceneId: string }
  ): StructuralIssue[] {
    const issues: StructuralIssue[] = [];
    const loc = { ...parentLoc, beatId: beat.id };
    
    // Check nextBeatId is valid
    if (beat.nextBeatId) {
      if (!sceneBeatIds.has(beat.nextBeatId) && beat.nextBeatId !== beat.id) {
        issues.push(this.createIssue('error', 'broken_reference', loc,
          `Beat ${beat.id} nextBeatId references non-existent beat: ${beat.nextBeatId}`,
          'nextBeatId', 'valid beat ID in same scene', beat.nextBeatId, true,
          `Remove nextBeatId or fix reference`));
      }
      
      // Check for self-reference (infinite loop)
      if (beat.nextBeatId === beat.id) {
        issues.push(this.createIssue('error', 'navigation_loop', loc,
          `Beat ${beat.id} has nextBeatId pointing to itself (infinite loop)`,
          'nextBeatId', 'different beat ID', beat.id, true,
          `Set nextBeatId to the next sequential beat or remove it`));
      }
    }
    
    // Validate choices
    if (beat.choices) {
      const choiceIds = new Set<string>();
      for (const choice of beat.choices) {
        if (!choice.id) {
          issues.push(this.createIssue('warning', 'missing_id', loc,
            `Choice in beat ${beat.id} is missing ID`, 'choice.id'));
          continue;
        }
        
        if (choiceIds.has(choice.id)) {
          issues.push(this.createIssue('error', 'duplicate_id', { ...loc, choiceId: choice.id },
            `Duplicate choice ID: ${choice.id}`, 'id'));
        }
        choiceIds.add(choice.id);
        
        // Check choice navigation
        if (choice.nextBeatId && !sceneBeatIds.has(choice.nextBeatId)) {
          issues.push(this.createIssue('error', 'broken_reference', { ...loc, choiceId: choice.id },
            `Choice ${choice.id} nextBeatId references non-existent beat: ${choice.nextBeatId}`,
            'nextBeatId', 'valid beat ID', choice.nextBeatId, true));
        }
        
        if (choice.nextSceneId && !allSceneIds.has(choice.nextSceneId)) {
          issues.push(this.createIssue('error', 'broken_reference', { ...loc, choiceId: choice.id },
            `Choice ${choice.id} nextSceneId references non-existent scene: ${choice.nextSceneId}`,
            'nextSceneId', 'valid scene ID', choice.nextSceneId, true));
        }
      }
    }
    
    return issues;
  }
  
  /**
   * Validate an encounter structure
   */
  validateEncounter(
    encounter: Encounter,
    allSceneIds: Set<string>,
    parentLoc: { episodeId: string; sceneId: string }
  ): StructuralIssue[] {
    const issues: StructuralIssue[] = [];
    const loc = { ...parentLoc, encounterId: encounter.id };
    
    if (!encounter.id) {
      issues.push(this.createIssue('error', 'missing_id', loc, 
        'Encounter is missing ID', 'id'));
      return issues;
    }
    
    if (!encounter.name) {
      issues.push(this.createIssue('warning', 'missing_required_field', loc,
        `Encounter ${encounter.id} is missing name`, 'name'));
    }
    
    // Check phases
    if (!encounter.phases || encounter.phases.length === 0) {
      issues.push(this.createIssue('error', 'missing_required_field', loc,
        `Encounter ${encounter.id} has no phases`, 'phases'));
      return issues;
    }
    
    // Check starting phase exists
    const phaseIds = new Set(encounter.phases.map(p => p.id));
    if (encounter.startingPhaseId && !phaseIds.has(encounter.startingPhaseId)) {
      issues.push(this.createIssue('error', 'broken_reference', loc,
        `Encounter startingPhaseId references non-existent phase: ${encounter.startingPhaseId}`,
        'startingPhaseId', 'valid phase ID', encounter.startingPhaseId, true,
        `Set startingPhaseId to: ${encounter.phases[0]?.id}`));
    }
    
    // Validate each phase
    for (const phase of encounter.phases) {
      // Check phase has situationImage
      if (!phase.situationImage) {
        issues.push(this.createIssue('warning', 'missing_required_field', loc,
          `Encounter phase ${phase.id} is missing situationImage`, 'situationImage', 
          undefined, undefined, true,
          'Set situationImage from first beat success image or scene background'));
      }
      
      if (!phase.beats || phase.beats.length === 0) {
        issues.push(this.createIssue('error', 'missing_required_field', 
          { ...loc },
          `Encounter phase ${phase.id} has no beats`, 'beats'));
        continue;
      }
      
      // Validate encounter beats
      const phaseBeatIds = new Set<string>();
      const validateEncounterChoices = (choices: any[] | undefined, path: string) => {
        for (const choice of choices || []) {
          if (choice.nextBeatId && !phaseBeatIds.has(choice.nextBeatId)) {
            const nextBeatIndex = parseInt(String(choice.nextBeatId).replace('beat-', ''), 10) - 1;
            if (Number.isNaN(nextBeatIndex) || nextBeatIndex >= phase.beats.length || nextBeatIndex < 0) {
              issues.push(this.createIssue('error', 'broken_reference',
                { ...loc, choiceId: choice.id },
                `Encounter choice nextBeatId references non-existent beat: ${choice.nextBeatId}`,
                'nextBeatId', 'valid beat ID', choice.nextBeatId, true));
            }
          }

          for (const tier of ['success', 'complicated', 'failure'] as const) {
            const outcome = choice.outcomes?.[tier];
            if (!outcome) continue;
            if (!outcome.isTerminal && !outcome.nextBeatId && !outcome.nextSituation) {
              issues.push(this.createIssue('warning', 'missing_required_field',
                { ...loc, choiceId: choice.id },
                `Encounter outcome ${path}/${choice.id}/${tier} has no nextSituation, nextBeatId, or terminal ending`,
                'nextSituation', 'branching continuation or terminal outcome'));
            }
            if (outcome.nextSituation && (!outcome.nextSituation.choices || outcome.nextSituation.choices.length === 0)) {
              issues.push(this.createIssue('warning', 'missing_required_field',
                { ...loc, choiceId: choice.id },
                `Encounter outcome ${path}/${choice.id}/${tier} has an empty nextSituation`,
                'nextSituation.choices', 'at least one nested choice'));
            }
            if (outcome.nextSituation?.choices) {
              validateEncounterChoices(outcome.nextSituation.choices, `${path}/${choice.id}/${tier}`);
            }
            if (outcome.encounterOutcome === 'partialVictory') {
              if (!outcome.cost?.visibleComplication || !outcome.cost?.immediateEffect) {
                issues.push(this.createIssue('error', 'missing_required_field',
                  { ...loc, choiceId: choice.id },
                  `Partial victory outcome ${path}/${choice.id}/${tier} is missing structured cost data`,
                  'cost', 'visibleComplication + immediateEffect', JSON.stringify(outcome.cost || {}), true));
              }
              if (!outcome.visualContract?.visibleCost) {
                issues.push(this.createIssue('error', 'missing_required_field',
                  { ...loc, choiceId: choice.id },
                  `Partial victory outcome ${path}/${choice.id}/${tier} is missing visibleCost in its visual contract`,
                  'visualContract.visibleCost', 'non-empty string', undefined, true));
              }
            }
          }
        }
      };
      for (let i = 0; i < phase.beats.length; i++) {
        const beat = phase.beats[i];
        const expectedId = `beat-${i + 1}`;
        
        if (!beat.id) {
          issues.push(this.createIssue('error', 'missing_id', loc,
            `Encounter beat at index ${i} is missing ID`, 'beat.id', expectedId, 'undefined', true));
        } else {
          phaseBeatIds.add(beat.id);
          
          // Check beat ID follows expected pattern
          if (beat.id !== expectedId) {
            issues.push(this.createIssue('warning', 'invalid_sequence', loc,
              `Encounter beat ID ${beat.id} doesn't follow expected sequence`,
              'beat.id', expectedId, beat.id, true,
              `Rename beat to ${expectedId}`));
          }
        }
        
        validateEncounterChoices(beat.choices as any[], beat.id || `beat-${i + 1}`);
      }
    }
    
    // Check outcome navigation - ALL outcomes must have nextSceneId
    if (encounter.outcomes) {
      const requiredOutcomes = ['victory', 'defeat', 'escape', 'partialVictory'];
      for (const outcomeName of requiredOutcomes) {
        const outcome = (encounter.outcomes as any)[outcomeName];
        if (outcome) {
          if (!outcome.nextSceneId) {
            issues.push(this.createIssue('error', 'missing_required_field', loc,
              `Encounter ${outcomeName} outcome is missing nextSceneId (causes dead end)`,
              'nextSceneId', 'valid scene ID or episode-end', 'undefined', true,
              'Set nextSceneId to next scene or episode-end'));
          } else if (!allSceneIds.has(outcome.nextSceneId) && 
              !outcome.nextSceneId.startsWith('episode-') &&
              outcome.nextSceneId !== 'episode-end') {
            issues.push(this.createIssue('error', 'broken_reference', loc,
              `Encounter ${outcomeName} outcome nextSceneId references non-existent scene: ${outcome.nextSceneId}`,
              'nextSceneId', 'valid scene ID', outcome.nextSceneId, true));
          }
        }
      }
    }

    const partialVictoryStorylet = encounter.storylets?.partialVictory;
    if (encounter.outcomes?.partialVictory) {
      if (!encounter.outcomes.partialVictory.cost?.visibleComplication || !encounter.outcomes.partialVictory.cost?.immediateEffect) {
        issues.push(this.createIssue('error', 'missing_required_field', loc,
          `Encounter partialVictory outcome is missing structured cost data`,
          'outcomes.partialVictory.cost', 'visibleComplication + immediateEffect', JSON.stringify(encounter.outcomes.partialVictory.cost || {}), true));
      }
      if (!partialVictoryStorylet && !encounter.outcomes.partialVictory.nextSceneId) {
        issues.push(this.createIssue('error', 'missing_required_field', loc,
          `Encounter partialVictory requires an aftermath path or explicit nextSceneId`,
          'storylets.partialVictory', 'storylet or nextSceneId', 'missing', true));
      }
      if (partialVictoryStorylet && !partialVictoryStorylet.cost?.visibleComplication) {
        issues.push(this.createIssue('error', 'missing_required_field', loc,
          `Encounter partialVictory storylet is missing structured cost data`,
          'storylets.partialVictory.cost', 'visibleComplication', JSON.stringify(partialVictoryStorylet.cost || {}), true));
      }
      if (partialVictoryStorylet && !partialVictoryStorylet.beats?.some(beat => beat.visualContract?.visibleCost)) {
        issues.push(this.createIssue('error', 'missing_required_field', loc,
          `Encounter partialVictory storylet does not make the cost visible in any aftermath beat`,
          'storylets.partialVictory.beats[].visualContract.visibleCost', 'at least one visible cost cue', 'missing', true));
      }
    }
    
    return issues;
  }
  
  /**
   * Create a structural issue
   */
  private createIssue(
    severity: 'error' | 'warning',
    type: StructuralIssue['type'],
    location: StructuralIssue['location'],
    description: string,
    field?: string,
    expected?: string,
    actual?: string,
    autoFixable: boolean = false,
    suggestedFix?: string
  ): StructuralIssue {
    return {
      severity,
      type,
      location,
      description,
      field,
      expected,
      actual,
      autoFixable,
      suggestedFix,
    };
  }
  
  /**
   * Build the final report
   */
  private buildReport(issues: StructuralIssue[]): StructuralReport {
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    
    let summary: string;
    if (errors.length === 0 && warnings.length === 0) {
      summary = 'Story structure is valid. No issues found.';
    } else if (errors.length === 0) {
      summary = `Story structure is valid with ${warnings.length} warning(s).`;
    } else {
      summary = `Story structure has ${errors.length} error(s) and ${warnings.length} warning(s). Errors must be fixed before the story can be played.`;
    }
    
    return {
      valid: errors.length === 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      issues,
      summary,
    };
  }
  
  /**
   * Auto-fix common structural issues
   */
  autoFix(story: Story): { story: Story; fixedCount: number; fixes: string[] } {
    const fixes: string[] = [];
    let fixedCount = 0;
    
    for (const episode of story.episodes || []) {
      for (const scene of episode.scenes || []) {
        // Fix scene startingBeatId
        if (scene.beats && scene.beats.length > 0) {
          const beatIds = new Set(scene.beats.map(b => b.id));
          if (!scene.startingBeatId || !beatIds.has(scene.startingBeatId)) {
            scene.startingBeatId = scene.beats[0].id;
            fixes.push(`Fixed scene ${scene.id} startingBeatId to ${scene.beats[0].id}`);
            fixedCount++;
          }
        }
        
        // Fix beat navigation
        for (let i = 0; i < (scene.beats?.length || 0); i++) {
          const beat = scene.beats![i];
          const nextBeat = scene.beats![i + 1];
          const isLastBeat = i === (scene.beats?.length || 0) - 1;
          
          // Fix self-referencing nextBeatId
          if (beat.nextBeatId === beat.id) {
            beat.nextBeatId = nextBeat?.id;
            fixes.push(`Fixed beat ${beat.id} self-reference, now points to ${nextBeat?.id || 'undefined'}`);
            fixedCount++;
          }
          
          // Fix broken nextBeatId
          const beatIds = new Set(scene.beats!.map(b => b.id));
          if (beat.nextBeatId && !beatIds.has(beat.nextBeatId)) {
            beat.nextBeatId = nextBeat?.id;
          fixes.push(`Fixed beat ${beat.id} broken reference, now points to ${nextBeat?.id || 'undefined'}`);
          fixedCount++;
        }

        // NEW: Fix empty text
        if (!beat.text || beat.text.trim() === '' || beat.text === '[Scene continues...]') {
          const anyBeat = beat as any;
          let recovered = false;
          if (anyBeat.content) {
            if (typeof anyBeat.content === 'string') { beat.text = anyBeat.content; recovered = true; }
            else if (typeof anyBeat.content === 'object') {
              beat.text = anyBeat.content.narrative || anyBeat.content.text || anyBeat.content.dialogue?.[0]?.text || '';
              recovered = true;
            }
          } else if (anyBeat.narrative) {
            beat.text = anyBeat.narrative;
            recovered = true;
          } else if (beat.textVariants && beat.textVariants.length > 0) {
            beat.text = beat.textVariants[0].text;
            recovered = true;
          }
          
          if (!recovered || !beat.text || beat.text.trim() === '') {
            beat.text = "The story continues...";
          }
          fixes.push(`Fixed empty text for beat ${beat.id}`);
          fixedCount++;
        }

        // NEW: Fix malformed variants
        if (beat.textVariants) {
          beat.textVariants = beat.textVariants.map(variant => {
            const v = variant as any;
            // Fix content -> text
            if (v.content && !v.text) {
              v.text = v.content;
              delete v.content;
              fixedCount++;
            }
            // Fix lazy condition
            if (v.condition && typeof v.condition === 'object' && !v.condition.type) {
              const keys = Object.keys(v.condition);
              if (keys.length === 1 && typeof v.condition[keys[0]] === 'boolean') {
                v.condition = { type: 'flag', flag: keys[0], value: v.condition[keys[0]] };
                fixedCount++;
              }
            }
            return variant;
          }).filter(v => v.text && v.text.trim() !== '');
        }
        
        // FIX DEAD-END BEATS: Last beat of scene must have navigation
          if (isLastBeat) {
            const hasNavigation = beat.nextBeatId || beat.nextSceneId || 
                                 (beat.choices && beat.choices.length > 0);
            
            if (!hasNavigation) {
              // Find next scene
              const sceneIndex = episode.scenes.findIndex(s => s.id === scene.id);
              const nextScene = episode.scenes[sceneIndex + 1];
              const targetSceneId = (scene as any).fallbackSceneId || nextScene?.id || 'episode-end';
              
              // Add continue choice to prevent dead end
              beat.choices = [{
                id: 'continue',
                text: 'Continue...',
                choiceType: 'expression' as any,
                nextSceneId: targetSceneId,
              }];
              beat.nextBeatId = undefined;
              fixes.push(`Fixed dead-end beat ${scene.id}/${beat.id} -> ${targetSceneId}`);
              fixedCount++;
            }
          }
        }
        
        // Fix encounter beats
        if (scene.encounter) {
          for (const phase of scene.encounter.phases || []) {
            // Fix missing situationImage
            if (!phase.situationImage) {
              const firstBeat = phase.beats?.[0] as any;
              if (firstBeat?.outcomeSequences?.success?.[0]) {
                phase.situationImage = firstBeat.outcomeSequences.success[0];
                fixes.push(`Fixed phase ${phase.id} situationImage from first beat success image`);
                fixedCount++;
              } else if (scene.backgroundImage) {
                phase.situationImage = scene.backgroundImage;
                fixes.push(`Fixed phase ${phase.id} situationImage from scene background`);
                fixedCount++;
              }
            }
            
            // Renumber beats to be sequential
            for (let i = 0; i < (phase.beats?.length || 0); i++) {
              const beat = phase.beats![i] as any;
              const expectedId = `beat-${i + 1}`;
              if (beat.id !== expectedId) {
                const oldId = beat.id;
                beat.id = expectedId;
                
                // Update references in choices
                for (const b of phase.beats || []) {
                  if ((b as any).choices) {
                    for (const choice of (b as any).choices) {
                      if (choice.nextBeatId === oldId) {
                        choice.nextBeatId = expectedId;
                      }
                    }
                  }
                }
                
                fixes.push(`Fixed encounter beat ${oldId} -> ${expectedId}`);
                fixedCount++;
              }
            }
            
            // Fix last beat choices to not have nextBeatId
            const lastBeat = phase.beats?.[phase.beats.length - 1] as any;
            if (lastBeat?.choices) {
              for (const choice of lastBeat.choices) {
                if (choice.nextBeatId) {
                  const beatIds = new Set((phase.beats || []).map((b: any) => b.id));
                  if (!beatIds.has(choice.nextBeatId)) {
                    delete choice.nextBeatId;
                    fixes.push(`Removed broken nextBeatId from last beat choice`);
                    fixedCount++;
                  }
                }
              }
            }
          }
          
          // Fix encounter outcome nextSceneIds
          if (scene.encounter.outcomes) {
            const sceneIds = new Set(episode.scenes.map(s => s.id));
            const sceneIndex = episode.scenes.findIndex(s => s.id === scene.id);
            const nextScene = episode.scenes[sceneIndex + 1];
            const nextSceneId = nextScene?.id || 'episode-end';
            
            for (const [outcomeName, outcome] of Object.entries(scene.encounter.outcomes)) {
              if (outcome && !outcome.nextSceneId) {
                (outcome as any).nextSceneId = nextSceneId;
                fixes.push(`Fixed encounter ${outcomeName} outcome nextSceneId to ${nextSceneId}`);
                fixedCount++;
              }
            }
          }
        }
      }
    }
    
    return { story, fixedCount, fixes };
  }
}
