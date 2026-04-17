// @ts-nocheck — TODO(tech-debt): type drift vs WorldBible/CharacterBible/StoryStructureAnalysis;
// address in Phase 7 type consolidation.
/**
 * Season Architect Agent
 * 
 * Plans the overall season structure, episode arcs, and cliffhangers.
 * Creates a SeasonBible that guides episode generation.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SeasonBible, EpisodePlan, WorldBible, CharacterBible } from '../../types';
import { StoryStructureAnalysis } from '../../types/sourceAnalysis';

export interface SeasonArchitectInput {
  storyTitle: string;
  genre: string;
  synopsis: string;
  tone: string;
  themes: string[];
  totalEpisodes: number;
  suggestedEpisodeCount?: number;
  protagonistInfo: {
    id: string;
    name: string;
    description: string;
    pronouns: string;
  };
  worldBible: WorldBible;
  characterBible: CharacterBible;
  sourceAnalysis?: StoryStructureAnalysis;
  userPrompt?: string;
  seasonNumber: number;
}

export class SeasonArchitect extends BaseAgent {
  constructor(config: AgentConfig) {
    super('SeasonArchitect', config);
    this.includeSystemPrompt = true;
  }

  async execute(input: SeasonArchitectInput): Promise<AgentResponse<SeasonBible>> {
    console.log(`[SeasonArchitect] Planning ${input.totalEpisodes}-episode season for "${input.storyTitle}"`);

    try {
      // Generate episode plans
      const episodePlans: EpisodePlan[] = [];
      
      for (let i = 1; i <= input.totalEpisodes; i++) {
        const isFinale = i === input.totalEpisodes;
        const isMidpoint = i === Math.ceil(input.totalEpisodes / 2);
        const seasonAct = i <= Math.ceil(input.totalEpisodes / 3) ? 1 : 
                         i <= Math.ceil(input.totalEpisodes * 2 / 3) ? 2 : 3;

        episodePlans.push({
          episodeNumber: i,
          title: `Episode ${i}`,
          logline: `Episode ${i} of ${input.storyTitle}`,
          seasonAct: seasonAct as 1 | 2 | 3,
          isTentpole: i === 1 || isFinale || isMidpoint,
          isMidseasonPivot: isMidpoint,
          isFinale,
          storySpinePosition: i === 1 ? 'setup' : 
                              i === 2 ? 'routine' :
                              i === 3 ? 'inciting' :
                              isFinale ? 'climax' : 'consequence',
          mustAccomplish: [`Advance the story of ${input.storyTitle}`],
          cliffhangerType: isFinale ? 'revelation' : 'danger',
          cliffhangerHook: isFinale ? 'The truth is finally revealed...' : 'A new threat emerges...',
          cliffhangerSetup: 'Build tension throughout the episode',
          primaryCharacterFocus: [input.protagonistInfo.id],
          arcProgressions: [],
          subplotsActive: [],
          subplotBeats: [],
          promisesMade: [],
          promisesFulfilled: [],
          revelationsDelivered: [],
          previousEpisodeThreads: i > 1 ? ['Continue from previous episode'] : [],
          nextEpisodeSetup: isFinale ? [] : ['Set up next episode'],
          plannedEncounters: [{
            type: 'combat',
            description: 'A dramatic confrontation',
            stakes: 'High stakes encounter',
            position: 'climax' as const,
          }],
          estimatedSceneCount: 6,
          estimatedBeatCount: 48,
        });
      }

      const seasonBible: SeasonBible = {
        seasonId: `season-${input.seasonNumber}`,
        storyTitle: input.storyTitle,
        seasonNumber: input.seasonNumber,
        totalEpisodes: input.totalEpisodes,
        suggestedEpisodeCount: input.suggestedEpisodeCount,
        userSelectedEpisodeCount: input.totalEpisodes,
        episodeLengthTarget: 'medium',
        centralQuestion: `What will happen in ${input.storyTitle}?`,
        thematicQuestion: input.themes[0] || 'The nature of heroism',
        centralQuestionAnswer: 'The protagonist succeeds against all odds',
        nextSeasonHook: {
          cliffhangerType: 'mystery',
          hook: 'A new mystery unfolds...',
          newQuestion: 'What comes next?',
          setup: 'The story continues...',
        },
        seasonStructure: {
          act1Episodes: episodePlans.filter(e => e.seasonAct === 1).map(e => e.episodeNumber),
          act2Episodes: episodePlans.filter(e => e.seasonAct === 2).map(e => e.episodeNumber),
          act3Episodes: episodePlans.filter(e => e.seasonAct === 3).map(e => e.episodeNumber),
          midseasonPivotEpisode: Math.ceil(input.totalEpisodes / 2),
          tentpoleEpisodes: [1, Math.ceil(input.totalEpisodes / 2), input.totalEpisodes],
          finaleEpisode: input.totalEpisodes,
          pacingNotes: 'Standard three-act pacing',
        },
        episodePlans,
        characterArcs: [],
        subplots: [],
        promiseLedger: {
          questionsRaised: [],
          characterTrajectories: [],
          relationshipTensions: [],
          themesIntroduced: [],
        },
        revelationSchedule: [],
        condensationRules: {
          subplotsToOmit: [],
          charactersToMergeOrReduce: [],
          beatsToCondense: [],
          pacing: 'moderate',
        },
        generatedEpisodes: [],
        lastGeneratedEpisode: 0,
        generationComplete: false,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      };

      console.log(`[SeasonArchitect] Created season bible with ${episodePlans.length} episode plans`);

      return {
        success: true,
        data: seasonBible,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SeasonArchitect] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }
}
