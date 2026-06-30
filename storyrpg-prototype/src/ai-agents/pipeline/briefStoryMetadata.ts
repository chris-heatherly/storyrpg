/**
 * Brief story-metadata reconciliation.
 *
 * For document/treatment-sourced runs the deterministic `documentParser` can't
 * extract an explicit genre and stamps generic defaults (`'Adventure'`,
 * `'Engaging and immersive'`, …) onto `brief.story`. The SourceMaterialAnalyzer /
 * SeasonPlanner later infer the real genre into `seasonPlan`/`analysis`, but
 * nothing copied it back onto `brief.story`, so the final story package and every
 * `brief.story.genre` reader (image prompts, art-style selection) shipped the
 * "Adventure" default (Gen-4 defect).
 *
 * This overwrites `brief.story.{genre,tone,synopsis,themes}` from the season plan
 * (or, failing that, the source analysis) ONLY when the current value is empty or
 * is a known documentParser default — so an explicitly user-set genre is never
 * clobbered. Pure: returns a new brief (or the same reference when nothing
 * changed); the second return flag lets the caller emit a debug event.
 *
 * Extracted from FullStoryPipeline to keep that monolith from growing.
 */

import type { FullCreativeBrief } from './FullStoryPipeline';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';

// Known documentParser fallbacks (src/ai-agents/utils/documentParser.ts).
const DEFAULT_GENRE = 'Adventure';
const DEFAULT_TONE = 'Engaging and immersive';
const DEFAULT_SYNOPSIS = 'An interactive story.';
const DEFAULT_THEMES = ['adventure', 'choice', 'consequence'];

const isDefaultThemes = (themes: string[] | undefined): boolean =>
  !themes || themes.length === 0
  || JSON.stringify([...themes].sort()) === JSON.stringify([...DEFAULT_THEMES].sort());

export interface ReconcileResult {
  brief: FullCreativeBrief;
  /** True when any story-metadata field was overwritten. */
  changed: boolean;
  /** The resulting genre (for the caller's debug message). */
  genre: string;
}

export function reconcileBriefStoryMetadata(
  baseBrief: FullCreativeBrief,
  analysis: SourceMaterialAnalysis,
): ReconcileResult {
  const plan = baseBrief.seasonPlan;
  const story = baseBrief.story;
  if (!story) return { brief: baseBrief, changed: false, genre: '' };

  const pickGenre = plan?.genre || analysis?.genre;
  const pickTone = plan?.tone || analysis?.tone;
  const pickSynopsis = plan?.seasonSynopsis;
  const pickThemes = (plan?.themes?.length ? plan.themes : analysis?.themes) || [];

  let changed = false;
  const nextStory = { ...story };

  if ((!story.genre || story.genre === DEFAULT_GENRE) && pickGenre && pickGenre !== story.genre) {
    nextStory.genre = pickGenre;
    changed = true;
  }
  if ((!story.tone || story.tone === DEFAULT_TONE) && pickTone && pickTone !== story.tone) {
    nextStory.tone = pickTone;
    changed = true;
  }
  if ((!story.synopsis || story.synopsis === DEFAULT_SYNOPSIS) && pickSynopsis && pickSynopsis !== story.synopsis) {
    nextStory.synopsis = pickSynopsis;
    changed = true;
  }
  if (isDefaultThemes(story.themes) && pickThemes.length) {
    nextStory.themes = pickThemes;
    changed = true;
  }

  if (!changed) return { brief: baseBrief, changed: false, genre: story.genre };
  return { brief: { ...baseBrief, story: nextStory }, changed: true, genre: nextStory.genre };
}
