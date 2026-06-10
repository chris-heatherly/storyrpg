/**
 * Treatment / source-analysis refresh helpers.
 *
 * Faithful ports of FullStoryPipeline.filterAnalysisForEpisodeRange,
 * refreshAnalysisFromTreatmentDocument, and refreshBriefSeasonPlanFromAnalysis
 * (pure moves — same fuzzy matching, same staleness rules, same events via the
 * injected emitter). These run at the head of the multi-episode driver to keep
 * a cached SourceMaterialAnalysis / seasonPlan aligned with the authoritative
 * treatment document before any generation happens.
 *
 * Extracted from FullStoryPipeline to keep that monolith from growing.
 */

import type { FullCreativeBrief } from './FullStoryPipeline';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { PipelineEvent } from './events';
import { extractTreatmentFromMarkdown } from '../utils/treatmentExtraction';

type Emit = (event: Omit<PipelineEvent, 'timestamp'>) => void;

/**
 * Narrow a full-season analysis down to the episodes being generated, carrying
 * only the locations/characters those episodes reference (with fuzzy matching
 * and core-character / first-location fallbacks).
 */
export function filterAnalysisForEpisodeRange(
  analysis: SourceMaterialAnalysis,
  episodeRange: { start: number; end: number; specific?: number[] },
  episodesToGenerate: number[] | undefined,
  emit: Emit,
): SourceMaterialAnalysis {
  // Determine which episodes to include
  const specificEpisodes = episodesToGenerate || episodeRange.specific;

  // Get the episode outlines for the selected episodes (specific list or range)
  const selectedEpisodes = specificEpisodes
    ? analysis.episodeBreakdown.filter(ep => specificEpisodes.includes(ep.episodeNumber))
    : analysis.episodeBreakdown.filter(
        ep => ep.episodeNumber >= episodeRange.start && ep.episodeNumber <= episodeRange.end
      );

  // Collect all unique location references mentioned in selected episodes
  const neededLocationRefs = new Set<string>();
  for (const episode of selectedEpisodes) {
    const episodeLocs = episode.locations || [];
    for (const locRef of episodeLocs) {
      neededLocationRefs.add(locRef.toLowerCase());
    }
  }

  // Also include locations from the starting location of episode 1 if generating from start
  if (episodeRange.start === 1 && analysis.keyLocations.length > 0) {
    // Always include the first location as it's likely the starting point
    neededLocationRefs.add(analysis.keyLocations[0].id.toLowerCase());
    neededLocationRefs.add(analysis.keyLocations[0].name.toLowerCase());
  }

  // Filter locations - match by ID or by name (fuzzy matching)
  const filteredLocations = analysis.keyLocations.filter(loc => {
    const locIdLower = loc.id.toLowerCase();
    const locNameLower = loc.name.toLowerCase();

    // Direct match by ID or name
    if (neededLocationRefs.has(locIdLower) || neededLocationRefs.has(locNameLower)) {
      return true;
    }

    // Partial match - check if any reference contains or is contained in location name
    for (const ref of neededLocationRefs) {
      if (locNameLower.includes(ref) || ref.includes(locNameLower)) {
        return true;
      }
    }

    return false;
  });

  // If no locations were matched (perhaps location IDs don't match), include first few
  // based on selected episode count
  const locationsToUse = filteredLocations.length > 0
    ? filteredLocations
    : analysis.keyLocations.slice(0, Math.min(selectedEpisodes.length + 1, analysis.keyLocations.length));

  emit({ type: 'debug', phase: 'filtering', message: `Episode locations needed: ${Array.from(neededLocationRefs).join(', ')}` });
  emit({ type: 'debug', phase: 'filtering', message: `Filtered locations: ${locationsToUse.map(l => l.id).join(', ')}` });

  // Collect all unique character references mentioned in selected episodes
  const neededCharacterRefs = new Set<string>();
  for (const episode of selectedEpisodes) {
    const mainChars = episode.mainCharacters || [];
    const supportChars = episode.supportingCharacters || [];
    for (const charRef of [...mainChars, ...supportChars]) {
      neededCharacterRefs.add(charRef.toLowerCase());
    }
  }

  // Filter characters - match by name (with fuzzy matching) or always include core
  const filteredCharacters = analysis.majorCharacters.filter(char => {
    const charNameLower = char.name.toLowerCase();

    // Always include core characters - they're central to the story
    if (char.importance === 'core') {
      return true;
    }

    // Direct match by name
    if (neededCharacterRefs.has(charNameLower)) {
      return true;
    }

    // Partial match - check if any reference contains or is contained in character name
    for (const ref of neededCharacterRefs) {
      // Check both directions - "Rose" matches "Rose the Healer" and vice versa
      const refParts = ref.split(/\s+/);
      const nameParts = charNameLower.split(/\s+/);

      // Match if first name matches or full name contains reference
      if (refParts.some(part => nameParts.includes(part)) ||
          charNameLower.includes(ref) ||
          ref.includes(charNameLower)) {
        return true;
      }
    }

    return false;
  });

  // If no characters were matched, include all core/supporting ones
  const charactersToUse = filteredCharacters.length > 0
    ? filteredCharacters
    : analysis.majorCharacters.filter(c => c.importance === 'core' || c.importance === 'supporting');

  emit({ type: 'debug', phase: 'filtering', message: `Episode characters needed: ${Array.from(neededCharacterRefs).join(', ')}` });
  emit({ type: 'debug', phase: 'filtering', message: `Filtered characters: ${charactersToUse.map(c => c.name).join(', ')}` });

  return {
    ...analysis,
    keyLocations: locationsToUse,
    majorCharacters: charactersToUse,
    totalEstimatedEpisodes: selectedEpisodes.length,
    episodeBreakdown: selectedEpisodes,
  };
}

/**
 * Re-derive the per-episode breakdown of a cached analysis from the treatment
 * document itself, so a stale cached analysis can't ship outdated episode
 * guidance (titles, structural roles, sceneEpisode mode).
 */
export function refreshAnalysisFromTreatmentDocument(
  analysis: SourceMaterialAnalysis,
  sourceText: string | undefined,
  emit: Emit,
): SourceMaterialAnalysis {
  if (!sourceText?.trim()) return analysis;
  const treatment = extractTreatmentFromMarkdown(sourceText);
  const treatmentEpisodeNumbers = Object.keys(treatment.episodes || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!treatment.isTreatment || treatmentEpisodeNumbers.length === 0) return analysis;

  const existingByNumber = new Map((analysis.episodeBreakdown || []).map((episode) => [episode.episodeNumber, episode]));
  const protagonistName = analysis.majorCharacters?.find((character) => character.importance === 'core')?.name
    || analysis.majorCharacters?.[0]?.name
    || 'the protagonist';

  const episodeBreakdown = treatmentEpisodeNumbers.map((episodeNumber) => {
    const existing = existingByNumber.get(episodeNumber);
    const guidance = treatment.episodes[episodeNumber];
    const structuralRole = guidance.normalizedStructuralRoles?.length
      ? guidance.normalizedStructuralRoles
      : existing?.structuralRole;

    return {
      ...(existing || {
        episodeNumber,
        title: guidance.authoredTitle || `Episode ${episodeNumber}`,
        synopsis: guidance.episodePromise || guidance.dramaticQuestion || guidance.entryGoal || `Treatment sceneEpisode ${episodeNumber}`,
        sourceChapters: [`Treatment sceneEpisode ${episodeNumber}`],
        sourceSummary: guidance.episodePromise || guidance.dramaticQuestion || guidance.entryGoal || '',
        plotPoints: [],
        mainCharacters: [protagonistName],
        supportingCharacters: [],
        locations: [],
        estimatedSceneCount: 1,
        estimatedChoiceCount: 1,
        narrativeFunction: {
          setup: guidance.entryGoal || guidance.openingImage || 'Treatment setup',
          conflict: guidance.obstacle || guidance.forcedChoice || 'Treatment conflict',
          resolution: guidance.exitShift || guidance.endingPressure || guidance.authoredCliffhanger || 'Treatment turn',
        },
      }),
      episodeNumber,
      title: guidance.authoredTitle || existing?.title || `Episode ${episodeNumber}`,
      synopsis: existing?.synopsis || guidance.episodePromise || guidance.dramaticQuestion || guidance.entryGoal || `Treatment sceneEpisode ${episodeNumber}`,
      sourceSummary: existing?.sourceSummary || guidance.episodePromise || guidance.dramaticQuestion || guidance.entryGoal || '',
      estimatedSceneCount: treatment.seasonGuidance?.episodeStructureMode === 'sceneEpisodes'
        ? 1
        : (existing?.estimatedSceneCount || 1),
      estimatedChoiceCount: treatment.seasonGuidance?.episodeStructureMode === 'sceneEpisodes'
        ? Math.max(1, Math.min(existing?.estimatedChoiceCount || 1, 2))
        : (existing?.estimatedChoiceCount || 1),
      episodeStructureMode: treatment.seasonGuidance?.episodeStructureMode || existing?.episodeStructureMode,
      routeMeta: treatment.seasonGuidance?.episodeStructureMode === 'sceneEpisodes'
        ? {
            kind: 'master' as const,
            spineIndex: episodeNumber,
            displayLabel: `${episodeNumber}`,
            isMilestoneEncounter: existing?.routeMeta?.isMilestoneEncounter || false,
          }
        : existing?.routeMeta,
      structuralRole,
      treatmentGuidance: guidance,
    };
  });

  if (episodeBreakdown.length !== analysis.episodeBreakdown?.length) {
    emit({
      type: 'debug',
      phase: 'treatment_refresh',
      message: `Refreshed cached source analysis from treatment document (${episodeBreakdown.length} treatment episode(s)).`,
    });
  }

  return {
    ...analysis,
    sourceFormat: 'story_treatment',
    totalEstimatedEpisodes: episodeBreakdown.length,
    treatmentSeasonGuidance: treatment.seasonGuidance || analysis.treatmentSeasonGuidance,
    resolvedEndings: treatment.endings?.length ? treatment.endings : analysis.resolvedEndings,
    episodeBreakdown,
  };
}

/**
 * Re-align a brief's cached seasonPlan with the (treatment-refreshed) analysis
 * when the plan's episode guidance has gone stale relative to the treatment.
 */
export function refreshBriefSeasonPlanFromAnalysis(
  baseBrief: FullCreativeBrief,
  analysis: SourceMaterialAnalysis,
  emit: Emit,
): FullCreativeBrief {
  const plan = baseBrief.seasonPlan;
  const outlines = analysis?.episodeBreakdown || [];
  if (!plan || outlines.length === 0) return baseBrief;

  const isTreatmentPlan = analysis.sourceFormat === 'story_treatment'
    || analysis.treatmentSeasonGuidance?.episodeStructureMode === 'sceneEpisodes'
    || outlines.some((outline) => outline.treatmentGuidance);
  if (!isTreatmentPlan) return baseBrief;

  const planByNumber = new Map((plan.episodes || []).map((episode) => [episode.episodeNumber, episode]));
  const treatmentMode = analysis.treatmentSeasonGuidance?.episodeStructureMode;

  const isStale = plan.totalEpisodes !== outlines.length
    || (plan.episodes || []).length !== outlines.length
    || outlines.some((outline) => {
      const planned = planByNumber.get(outline.episodeNumber);
      if (!planned) return true;
      if (treatmentMode && planned.episodeStructureMode !== treatmentMode) return true;
      if ((planned.treatmentGuidance?.authoredTitle || planned.title) !== (outline.treatmentGuidance?.authoredTitle || outline.title)) {
        return true;
      }
      const plannedChoices = (planned.treatmentGuidance?.majorChoicePressures || []).join('\n');
      const outlineChoices = (outline.treatmentGuidance?.majorChoicePressures || []).join('\n');
      return plannedChoices !== outlineChoices;
    });

  if (!isStale) return baseBrief;

  const protagonistName = analysis.protagonist?.name
    || analysis.majorCharacters?.find((character) => character.importance === 'core')?.name
    || analysis.majorCharacters?.[0]?.name
    || plan.protagonist?.name
    || 'the protagonist';

  const alignedEpisodes = outlines.map((outline) => {
    const existing = planByNumber.get(outline.episodeNumber);
    const previousEpisode = outline.episodeNumber > 1 ? [outline.episodeNumber - 1] : [];
    const nextEpisode = outline.episodeNumber < outlines.length ? [outline.episodeNumber + 1] : [];
    const guidance = outline.treatmentGuidance;
    const narrativeFunction = outline.narrativeFunction || {
      setup: guidance?.entryGoal || guidance?.openingImage || 'Treatment setup',
      conflict: guidance?.obstacle || guidance?.forcedChoice || 'Treatment conflict',
      resolution: guidance?.exitShift || guidance?.endingPressure || guidance?.authoredCliffhanger || 'Treatment turn',
    };

    return {
      ...(existing || {}),
      ...outline,
      episodeNumber: outline.episodeNumber,
      title: guidance?.authoredTitle || outline.title || existing?.title || `Episode ${outline.episodeNumber}`,
      synopsis: outline.synopsis || guidance?.episodePromise || guidance?.dramaticQuestion || existing?.synopsis || '',
      sourceChapters: outline.sourceChapters?.length
        ? outline.sourceChapters
        : (existing?.sourceChapters?.length ? existing.sourceChapters : [`Treatment sceneEpisode ${outline.episodeNumber}`]),
      sourceSummary: outline.sourceSummary || guidance?.episodePromise || guidance?.dramaticQuestion || existing?.sourceSummary || '',
      plotPoints: outline.plotPoints || existing?.plotPoints || [],
      mainCharacters: outline.mainCharacters?.length
        ? outline.mainCharacters
        : (existing?.mainCharacters?.length ? existing.mainCharacters : [protagonistName]),
      supportingCharacters: outline.supportingCharacters || existing?.supportingCharacters || [],
      locations: outline.locations || existing?.locations || [],
      estimatedSceneCount: treatmentMode === 'sceneEpisodes'
        ? 1
        : (outline.estimatedSceneCount || existing?.estimatedSceneCount || 1),
      estimatedChoiceCount: treatmentMode === 'sceneEpisodes'
        ? Math.max(1, Math.min(outline.estimatedChoiceCount || existing?.estimatedChoiceCount || 1, 2))
        : (outline.estimatedChoiceCount || existing?.estimatedChoiceCount || 1),
      narrativeFunction,
      structuralRole: outline.structuralRole || existing?.structuralRole,
      treatmentGuidance: guidance || existing?.treatmentGuidance,
      episodeStructureMode: treatmentMode || outline.episodeStructureMode || existing?.episodeStructureMode,
      routeMeta: treatmentMode === 'sceneEpisodes'
        ? {
            kind: 'master' as const,
            spineIndex: outline.episodeNumber,
            displayLabel: `${outline.episodeNumber}`,
            isMilestoneEncounter: existing?.routeMeta?.isMilestoneEncounter || false,
          }
        : (outline.routeMeta || existing?.routeMeta),
      status: existing?.status || 'planned',
      dependsOn: existing?.dependsOn?.length ? existing.dependsOn : previousEpisode,
      setupsForEpisodes: existing?.setupsForEpisodes?.length ? existing.setupsForEpisodes : nextEpisode,
      resolvesPlotsFrom: existing?.resolvesPlotsFrom?.length ? existing.resolvesPlotsFrom : previousEpisode,
      introducesCharacters: existing?.introducesCharacters || [],
      endingRoutes: existing?.endingRoutes,
      cliffhangerPlan: existing?.cliffhangerPlan,
    };
  });

  const refreshedPlan = {
    ...plan,
    totalEpisodes: outlines.length,
    updatedAt: new Date(),
    episodes: alignedEpisodes,
    anchors: analysis.anchors || plan.anchors,
    sevenPoint: analysis.sevenPoint || plan.sevenPoint,
    endingMode: analysis.resolvedEndingMode || analysis.detectedEndingMode || plan.endingMode,
    resolvedEndings: analysis.resolvedEndings?.length ? analysis.resolvedEndings : plan.resolvedEndings,
    characterArchitecture: analysis.characterArchitecture || plan.characterArchitecture,
    warnings: [
      ...(plan.warnings || []).filter((warning) =>
        !warning.includes('Refreshed stale seasonPlan episode guidance from source analysis')
      ),
      `Refreshed stale seasonPlan episode guidance from source analysis (${outlines.length} treatment episode(s)).`,
    ],
  };

  emit({
    type: 'debug',
    phase: 'season_plan_refresh',
    message: `Refreshed stale seasonPlan episode guidance from source analysis (${outlines.length} treatment episode(s)).`,
  });

  return {
    ...baseBrief,
    seasonPlan: refreshedPlan,
  };
}
