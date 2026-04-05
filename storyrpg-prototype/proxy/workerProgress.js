/**
 * Worker progress estimation.
 * Maps pipeline phases and events to 0-100 progress values.
 */

const ANALYSIS_MILESTONES = {
  queued: 2,
  source_analysis: 70,
  season_plan: 90,
  complete: 100,
};

const GENERATION_MILESTONES = {
  queued: 2,
  init: 3,
  initialization: 4,
  source_analysis: 8,
  multi_episode_init: 10,
  foundation: 16,
  world: 24,
  characters: 34,
  npc_validation: 38,
  architecture: 46,
  branch_analysis: 50,
  content: 60,
  quick_validation: 68,
  qa: 72,
  master_images: 82,
  images: 88,
  encounter_images: 92,
  assembly: 96,
  saving: 98,
  audio_generation: 99,
  complete: 100,
};

function estimateWorkerProgress(mode, phase, eventType, previousProgress = 0, eventData = null, telemetry = null) {
  if (telemetry && typeof telemetry.overallProgress === 'number') {
    return Math.max(previousProgress, Math.min(100, telemetry.overallProgress));
  }
  if (mode === 'analysis') {
    if (phase && Object.prototype.hasOwnProperty.call(ANALYSIS_MILESTONES, phase)) {
      return Math.max(previousProgress, ANALYSIS_MILESTONES[phase]);
    }
    if (eventType === 'phase_complete') {
      return Math.min(99, Math.max(previousProgress, previousProgress + 4));
    }
    return previousProgress;
  }

  if (eventType === 'checkpoint' && eventData && typeof eventData.imageIndex === 'number' && typeof eventData.totalImages === 'number' && eventData.totalImages > 0) {
    const ratio = eventData.imageIndex / eventData.totalImages;
    if (phase === 'images' || phase === 'image_manifest') {
      const phaseStart = GENERATION_MILESTONES.images;
      const phaseEnd = GENERATION_MILESTONES.encounter_images;
      const subProgress = Math.round(phaseStart + ratio * (phaseEnd - phaseStart));
      return Math.max(previousProgress, subProgress);
    }
    if (phase === 'encounter_images') {
      const phaseStart = GENERATION_MILESTONES.encounter_images;
      const phaseEnd = GENERATION_MILESTONES.assembly;
      const subProgress = Math.round(phaseStart + ratio * (phaseEnd - phaseStart));
      return Math.max(previousProgress, subProgress);
    }
  }

  if (phase && Object.prototype.hasOwnProperty.call(GENERATION_MILESTONES, phase)) {
    return Math.max(previousProgress, GENERATION_MILESTONES[phase]);
  }

  if (typeof phase === 'string' && phase.startsWith('images_ep_')) {
    const epNum = Number(phase.replace('images_ep_', '')) || 1;
    const episodeProgress = Math.min(95, 84 + epNum * 3);
    return Math.max(previousProgress, episodeProgress);
  }

  if (typeof phase === 'string' && (phase.includes('validation') || phase.startsWith('branch_'))) {
    return Math.min(95, Math.max(previousProgress, previousProgress + 1));
  }

  if (eventType === 'phase_complete') {
    return Math.min(99, Math.max(previousProgress, previousProgress + 2));
  }

  return previousProgress;
}

module.exports = {
  estimateWorkerProgress,
  ANALYSIS_MILESTONES,
  GENERATION_MILESTONES,
};
