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
import type { SourceMaterialAnalysis, TreatmentEpisodeGuidance } from '../../types/sourceAnalysis';
import type { PipelineEvent } from './events';
import { extractTreatmentFromMarkdown } from '../utils/treatmentExtraction';

type Emit = (event: Omit<PipelineEvent, 'timestamp'>) => void;

function treatmentEpisodeSummary(guidance: TreatmentEpisodeGuidance | undefined): string | undefined {
  return guidance?.synopsis
    || guidance?.episodePromise
    || guidance?.dramaticQuestion
    || guidance?.encounterCentralConflict
    || guidance?.entryGoal;
}

function treatmentEpisodeResolution(guidance: TreatmentEpisodeGuidance | undefined): string | undefined {
  return guidance?.resolutionAftermath
    || guidance?.endingPressure
    || guidance?.endStateChange
    || guidance?.authoredCliffhanger
    || guidance?.consequenceResidue
    || guidance?.exitShift;
}

function normalizeEntityRef(value: string | undefined): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^loc[-_\s]+/i, ' ')
    .replace(/^char[-_\s]+/i, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function entityTokens(value: string | undefined): string[] {
  return normalizeEntityRef(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !['the', 'and', 'via', 'text', 'off', 'screen', 'presence'].includes(token));
}

function entityRefMatches(candidateId: string | undefined, candidateName: string | undefined, refs: Set<string>): boolean {
  const candidateKeys = [normalizeEntityRef(candidateId), normalizeEntityRef(candidateName)].filter(Boolean);

  if (candidateKeys.some((key) => refs.has(key))) return true;

  const candidateTokenSets = [entityTokens(candidateId), entityTokens(candidateName)].filter((tokens) => tokens.length > 0);
  for (const ref of refs) {
    const refTokens = new Set(entityTokens(ref));
    if (refTokens.size === 0) continue;
    for (const candidateTokens of candidateTokenSets) {
      if (candidateTokens.length === 0) continue;
      if (candidateTokens.every((token) => refTokens.has(token))) return true;
      if ([...refTokens].every((token) => candidateTokens.includes(token))) return true;
    }
  }

  return false;
}

function baseEntityName(value: string | undefined): string {
  return normalizeEntityRef(value);
}

function dedupeByBaseName<T extends { name: string; importance?: string; firstAppearance?: number }>(items: T[]): T[] {
  const priority = (item: T): number => {
    const importanceScore = item.importance === 'core' ? 3 : item.importance === 'supporting' ? 2 : 1;
    const canonicalScore = /\([^)]*\)/.test(item.name) ? 0 : 1;
    const firstAppearanceScore = Number.isFinite(item.firstAppearance) ? -Number(item.firstAppearance) / 100 : 0;
    return importanceScore + canonicalScore + firstAppearanceScore;
  };

  const byName = new Map<string, T>();
  for (const item of items) {
    const key = baseEntityName(item.name);
    const current = byName.get(key);
    if (!current || priority(item) > priority(current)) {
      byName.set(key, item);
    }
  }
  return Array.from(byName.values());
}

type MajorCharacter = SourceMaterialAnalysis['majorCharacters'][number];

interface TreatmentCharacterCard {
  name: string;
  roleText: string;
}

function canonicalCharacterName(value: string | undefined): string {
  return normalizeEntityRef(String(value || '').replace(/\s*\([^)]*\)\s*$/, ''));
}

function parseTreatmentCharacterCards(sourceText: string | undefined): Map<string, TreatmentCharacterCard> {
  const cards = new Map<string, TreatmentCharacterCard>();
  const text = sourceText || '';
  const matches = [...text.matchAll(/(?:^|\n)-\s+\*\*Name:\*\*\s+([^\n]+)\n([\s\S]*?)(?=\n-\s+\*\*Name:\*\*|\n##\s+|\n###\s+|$)/g)];
  for (const match of matches) {
    const rawName = match[1]?.trim();
    const body = match[2] || '';
    const roleMatch = body.match(/(?:^|\n)-\s+\*\*Role:\*\*\s+([^\n]+)/);
    const key = canonicalCharacterName(rawName);
    if (!key || !roleMatch?.[1]?.trim()) continue;
    cards.set(key, {
      name: rawName.replace(/\s*\([^)]*\)\s*$/, '').trim(),
      roleText: roleMatch[1].trim(),
    });
  }
  return cards;
}

function roleFromTreatmentRoleText(roleText: string, fallback: MajorCharacter['role']): MajorCharacter['role'] {
  if (/\b(love interest|romantic lead|second lead|partner|werewolf|pricolici)\b/i.test(roleText)) return 'love_interest';
  if (/\b(rival|spy|handler|succubus|betray)\b/i.test(roleText)) return 'rival';
  if (/\b(mentor|teacher|guide)\b/i.test(roleText)) return 'mentor';
  if (/\b(ally|protector|hunter|journalist|friend|practitioner|bookshop)\b/i.test(roleText)) return 'ally';
  if (/\b(antagonist|villain|strigoi|vampire|possessor|coven)\b/i.test(roleText)) return 'antagonist';
  return fallback;
}

function roleFromArchitecturePressure(pressureRole: string | undefined, fallback: MajorCharacter['role']): MajorCharacter['role'] {
  switch (pressureRole) {
    case 'antagonist':
    case 'temptation':
      return 'antagonist';
    case 'ally':
      return 'ally';
    case 'mirror':
      return 'rival';
    default:
      return fallback;
  }
}

function repairMajorCharactersFromTreatment(
  analysis: SourceMaterialAnalysis,
  sourceText: string | undefined,
): SourceMaterialAnalysis['majorCharacters'] {
  const cards = parseTreatmentCharacterCards(sourceText);
  const architectureByName = new Map(
    (analysis.characterArchitecture?.supportingCharacters || [])
      .map((character) => [canonicalCharacterName(character.characterName), character] as const),
  );

  return (analysis.majorCharacters || []).map((character) => {
    const key = canonicalCharacterName(character.name);
    const card = cards.get(key);
    const architecture = architectureByName.get(key);
    const hasBlankDescription = !character.description?.trim();
    const repairedRole = card
      ? roleFromTreatmentRoleText(card.roleText, character.role)
      : roleFromArchitecturePressure(architecture?.pressureRole, character.role);
    const repairedImportance = architecture?.screenTimeTier === 'major'
      ? 'core'
      : architecture?.screenTimeTier === 'supporting'
        ? 'supporting'
        : character.importance;

    return {
      ...character,
      role: character.role === 'neutral' ? repairedRole : character.role,
      importance: character.importance === 'supporting' && repairedImportance === 'core'
        ? 'core'
        : character.importance,
      description: hasBlankDescription && card?.roleText ? card.roleText : character.description,
    };
  });
}

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
      const normalized = normalizeEntityRef(locRef);
      if (normalized) neededLocationRefs.add(normalized);
    }
  }

  // Also include locations from the starting location of episode 1 if generating from start
  if (episodeRange.start === 1 && analysis.keyLocations.length > 0) {
    // Always include the first location as it's likely the starting point
    neededLocationRefs.add(normalizeEntityRef(analysis.keyLocations[0].id));
    neededLocationRefs.add(normalizeEntityRef(analysis.keyLocations[0].name));
  }

  // Filter locations - match by ID or by name (fuzzy matching)
  const filteredLocations = analysis.keyLocations.filter(loc => {
    return entityRefMatches(loc.id, loc.name, neededLocationRefs);
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
      const normalized = normalizeEntityRef(charRef);
      if (normalized) neededCharacterRefs.add(normalized);
    }
  }

  // Filter characters - match by name (with fuzzy matching) or always include core
  const filteredCharacters = analysis.majorCharacters.filter(char => {
    // Always include core characters - they're central to the story
    if (char.importance === 'core') {
      return true;
    }

    return entityRefMatches(char.id, char.name, neededCharacterRefs);
  });

  // If no characters were matched, include all core/supporting ones
  const charactersToUse = dedupeByBaseName(filteredCharacters.length > 0
    ? filteredCharacters
    : analysis.majorCharacters.filter(c => c.importance === 'core' || c.importance === 'supporting'));

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
 * guidance (titles and structural roles).
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
    const summary = treatmentEpisodeSummary(guidance);
    const resolution = treatmentEpisodeResolution(guidance);
    const structuralRole = guidance.normalizedStructuralRoles?.length
      ? guidance.normalizedStructuralRoles
      : existing?.structuralRole;

    return {
      ...(existing || {
        episodeNumber,
        title: guidance.authoredTitle || `Episode ${episodeNumber}`,
        synopsis: summary || `Treatment episode ${episodeNumber}`,
        sourceChapters: [`Treatment episode ${episodeNumber}`],
        sourceSummary: summary || '',
        plotPoints: [],
        mainCharacters: [protagonistName],
        supportingCharacters: [],
        locations: [],
        estimatedSceneCount: 1,
        estimatedChoiceCount: 1,
        narrativeFunction: {
          setup: guidance.entryGoal || guidance.openingImage || summary || 'Treatment setup',
          conflict: guidance.obstacle || guidance.forcedChoice || guidance.encounterCentralConflict || guidance.episodePromise || guidance.dramaticQuestion || 'Treatment conflict',
          resolution: resolution || 'Treatment turn',
        },
      }),
      episodeNumber,
      title: guidance.authoredTitle || existing?.title || `Episode ${episodeNumber}`,
      synopsis: summary || existing?.synopsis || `Treatment episode ${episodeNumber}`,
      sourceSummary: summary || existing?.sourceSummary || '',
      estimatedSceneCount: existing?.estimatedSceneCount || 1,
      estimatedChoiceCount: existing?.estimatedChoiceCount || 1,
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
    majorCharacters: repairMajorCharactersFromTreatment(analysis, sourceText),
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
    || outlines.some((outline) => outline.treatmentGuidance);
  if (!isTreatmentPlan) return baseBrief;

  const planByNumber = new Map((plan.episodes || []).map((episode) => [episode.episodeNumber, episode]));
  const isStale = plan.totalEpisodes !== outlines.length
    || (plan.episodes || []).length !== outlines.length
    || outlines.some((outline) => {
      const planned = planByNumber.get(outline.episodeNumber);
      if (!planned) return true;
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
    const summary = treatmentEpisodeSummary(guidance);
    const resolution = treatmentEpisodeResolution(guidance);
    const narrativeFunction = outline.narrativeFunction || {
      setup: guidance?.entryGoal || guidance?.openingImage || summary || 'Treatment setup',
      conflict: guidance?.obstacle || guidance?.forcedChoice || guidance?.encounterCentralConflict || guidance?.episodePromise || guidance?.dramaticQuestion || 'Treatment conflict',
      resolution: resolution || 'Treatment turn',
    };

    return {
      ...(existing || {}),
      ...outline,
      episodeNumber: outline.episodeNumber,
      title: guidance?.authoredTitle || outline.title || existing?.title || `Episode ${outline.episodeNumber}`,
      synopsis: summary || outline.synopsis || existing?.synopsis || '',
      sourceChapters: outline.sourceChapters?.length
        ? outline.sourceChapters
        : (existing?.sourceChapters?.length ? existing.sourceChapters : [`Treatment episode ${outline.episodeNumber}`]),
      sourceSummary: summary || outline.sourceSummary || existing?.sourceSummary || '',
      plotPoints: outline.plotPoints || existing?.plotPoints || [],
      mainCharacters: outline.mainCharacters?.length
        ? outline.mainCharacters
        : (existing?.mainCharacters?.length ? existing.mainCharacters : [protagonistName]),
      supportingCharacters: outline.supportingCharacters || existing?.supportingCharacters || [],
      locations: outline.locations || existing?.locations || [],
      estimatedSceneCount: outline.estimatedSceneCount || existing?.estimatedSceneCount || 1,
      estimatedChoiceCount: outline.estimatedChoiceCount || existing?.estimatedChoiceCount || 1,
      narrativeFunction,
      structuralRole: outline.structuralRole || existing?.structuralRole,
      treatmentGuidance: guidance || existing?.treatmentGuidance,
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
    legacyStructure: analysis.legacyStructure || plan.legacyStructure,
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
