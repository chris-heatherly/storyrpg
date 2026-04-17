// @ts-nocheck — TODO(tech-debt): Phase 6 image-adapter refactor.
import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from '../BaseAgent';
import { SceneContent } from '../SceneWriter';
import { EpisodeBlueprint } from '../StoryArchitect';
import { EncounterStructure, BeatContent } from '../EncounterArchitect';

export interface AuditReport {
  isComplete: boolean;
  missingAssets: Array<{
    id: string;
    type: 'scene' | 'beat' | 'encounter-situation' | 'encounter-sequence' | 'cover';
    context: string;
  }>;
  totalExpected: number;
  totalFound: number;
  coverage: number; // percentage
}

export interface AuditRequest {
  blueprint: EpisodeBlueprint;
  sceneContents: SceneContent[];
  imageResults: Map<string, string>;
  encounterResults?: Map<string, { structure: EncounterStructure; content: BeatContent[] }>;
  imageStrategy: 'selective' | 'all-beats';
}

export class AssetAuditorAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Asset Auditor', config);
  }

  async execute(input: AuditRequest): Promise<AgentResponse<AuditReport>> {
    const missingAssets: AuditReport['missingAssets'] = [];
    let totalExpected = 0;
    let totalFound = 0;

    // 1. Check Covers
    totalExpected += 2; // Story cover and Episode cover
    if (!input.imageResults.has('story-cover')) {
      missingAssets.push({ id: 'story-cover', type: 'cover', context: 'Story Hero Image' });
    } else totalFound++;

    if (!input.imageResults.has('episode-cover')) {
      missingAssets.push({ id: 'episode-cover', type: 'cover', context: `Episode ${input.blueprint.number} Hero Image` });
    } else totalFound++;

    // 2. Check Scenes and Beats
    for (const sceneContent of input.sceneContents) {
      const sceneBlueprint = input.blueprint.scenes.find(s => s.id === sceneContent.sceneId);
      
      // Scene Background
      totalExpected++;
      if (!input.imageResults.has(`scene-${sceneContent.sceneId}`)) {
        missingAssets.push({ 
          id: sceneContent.sceneId, 
          type: 'scene', 
          context: `Background for scene: ${sceneContent.sceneName}` 
        });
      } else totalFound++;

      // Beats
      const strategy = input.imageStrategy || 'selective';
      const expectedBeats = sceneContent.beats.filter(beat => {
        if (strategy === 'all-beats') return true;
        return beat.id === sceneContent.startingBeatId || beat.isChoicePoint;
      });

      for (const beat of expectedBeats) {
        totalExpected++;
        if (!input.imageResults.has(`beat-${beat.id}`)) {
          missingAssets.push({ 
            id: beat.id, 
            type: 'beat', 
            context: `Illustration for beat in ${sceneContent.sceneName}: ${beat.text.substring(0, 30)}...` 
          });
        } else totalFound++;
      }
    }

    // 3. Check Encounters
    if (input.encounterResults) {
      for (const [sceneId, encounter] of input.encounterResults.entries()) {
        for (const beat of encounter.content) {
          // Situation
          totalExpected++;
          if (!input.imageResults.has(`encounter-${sceneId}-${beat.beatId}-situation`)) {
            missingAssets.push({ 
              id: `${sceneId}-${beat.beatId}-situation`, 
              type: 'encounter-situation', 
              context: `Encounter situation for beat ${beat.beatId}` 
            });
          } else totalFound++;

          // Sequences for variants
          for (const variant of beat.outcomeVariants) {
            totalExpected++;
            const key = `encounter-${sceneId}-${beat.beatId}-${variant.outcome}-sequence`;
            if (!input.imageResults.has(key)) {
              missingAssets.push({ 
                id: key, 
                type: 'encounter-sequence', 
                context: `Outcome sequence for ${variant.outcome}` 
              });
            } else totalFound++;
          }
        }
      }
    }

    const report: AuditReport = {
      isComplete: missingAssets.length === 0,
      missingAssets,
      totalExpected,
      totalFound,
      coverage: totalExpected > 0 ? (totalFound / totalExpected) * 100 : 100
    };

    return {
      success: true,
      data: report
    };
  }

  protected getAgentSpecificPrompt(): string {
    return `You are the Asset Auditor. Your job is to ensure every narrative beat and scene that requires a visual asset actually has one assigned and correctly linked.`;
  }
}
