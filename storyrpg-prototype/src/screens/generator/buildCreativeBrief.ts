import type { FullCreativeBrief } from '../../ai-agents/pipeline/FullStoryPipeline';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { SeasonPlan } from '../../types/seasonPlan';

export interface BuildGeneratorCreativeBriefInput {
  documentBrief: FullCreativeBrief | null;
  sourceAnalysis: SourceMaterialAnalysis | null;
  seasonPlan: SeasonPlan | null;
  customStoryTitle: string;
  userPrompt: string;
}

function analyzedBrief(
  sourceAnalysis: SourceMaterialAnalysis,
  customStoryTitle: string,
  userPrompt: string,
): FullCreativeBrief {
  const firstEpisode = sourceAnalysis.episodeBreakdown?.[0];
  return {
    story: {
      title: customStoryTitle || sourceAnalysis.sourceTitle || 'New Story',
      genre: sourceAnalysis.genre || 'Adventure',
      synopsis: sourceAnalysis.anchors?.goal || sourceAnalysis.storyArcs?.[0]?.description || sourceAnalysis.sourceTitle || '',
      tone: sourceAnalysis.tone || 'Dramatic',
      themes: sourceAnalysis.themes || [],
    },
    world: {
      premise: sourceAnalysis.setting?.worldDetails || sourceAnalysis.setting?.location || '',
      timePeriod: sourceAnalysis.setting?.timePeriod || '',
      technologyLevel: '',
      keyLocations: (sourceAnalysis.keyLocations || []).map((location) => ({
        id: location.id,
        name: location.name,
        type: 'location',
        description: location.description,
        importance: location.importance,
      })),
    },
    protagonist: {
      id: sourceAnalysis.protagonist?.id || 'protagonist',
      name: sourceAnalysis.protagonist?.name || 'Hero',
      pronouns: 'they/them',
      description: sourceAnalysis.protagonist?.description || '',
      role: 'protagonist',
    },
    npcs: (sourceAnalysis.majorCharacters || [])
      .filter((character) => character.id !== sourceAnalysis.protagonist?.id)
      .map((character) => ({
        id: character.id,
        name: character.name,
        role: character.role === 'antagonist' ? 'antagonist' : character.role === 'neutral' ? 'neutral' : 'ally',
        description: character.description,
        importance: character.importance === 'core' ? 'major' : character.importance === 'supporting' ? 'supporting' : 'minor',
      })),
    episode: {
      number: firstEpisode?.episodeNumber || 1,
      title: firstEpisode?.title || 'Episode 1',
      synopsis: firstEpisode?.synopsis || '',
      startingLocation: sourceAnalysis.keyLocations?.[0]?.id || '',
    },
    userPrompt: userPrompt.trim() || undefined,
  } as FullCreativeBrief;
}

function promptOnlyBrief(customStoryTitle: string, userPrompt: string): FullCreativeBrief | null {
  const prompt = userPrompt.trim();
  if (!prompt) return null;
  return {
    story: {
      title: customStoryTitle || 'New Story',
      genre: 'Action',
      synopsis: prompt.substring(0, 100),
      tone: 'Dramatic',
      themes: [],
    },
    world: { premise: '', timePeriod: '', technologyLevel: '', keyLocations: [] },
    protagonist: { id: 'p1', name: 'Hero', pronouns: 'he/him', description: '', role: '' },
    npcs: [],
    episode: { number: 1, title: 'Episode 1', synopsis: '', startingLocation: '' },
    userPrompt: prompt,
  } as FullCreativeBrief;
}

export function buildGeneratorCreativeBrief(input: BuildGeneratorCreativeBriefInput): FullCreativeBrief | null {
  const prompt = input.userPrompt.trim();
  let brief: FullCreativeBrief | null = null;

  if (input.sourceAnalysis) {
    brief = analyzedBrief(input.sourceAnalysis, input.customStoryTitle, prompt);
  } else if (input.documentBrief) {
    brief = {
      ...input.documentBrief,
      story: {
        ...input.documentBrief.story,
        title: input.customStoryTitle || input.documentBrief.story.title,
      },
      userPrompt: prompt || undefined,
    };
  } else {
    brief = promptOnlyBrief(input.customStoryTitle, prompt);
  }

  if (brief && input.seasonPlan) {
    brief.seasonPlan = input.seasonPlan;
  }

  if (brief && input.sourceAnalysis) {
    brief.endingMode = input.sourceAnalysis.resolvedEndingMode;
    brief.endingTargets = input.sourceAnalysis.resolvedEndings;
  }

  return brief;
}
