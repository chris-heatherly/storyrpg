import type { Beat, Scene, Story } from '../../types';

/** Visual-contract persistence audit (R2.6 extract from FullStoryPipeline). */
export function auditStoryVisualContractPersistence(story: Story): {
  passed: boolean;
  sceneCount: number;
  scenesWithSequencePlan: number;
  nonEstablishingBeatCount: number;
  nonEstablishingBeatsWithCoveragePlan: number;
  missingScenePlanIds: string[];
  missingCoverageBeatIds: string[];
} {
  const report = {
    passed: true,
    sceneCount: 0,
    scenesWithSequencePlan: 0,
    nonEstablishingBeatCount: 0,
    nonEstablishingBeatsWithCoveragePlan: 0,
    missingScenePlanIds: [] as string[],
    missingCoverageBeatIds: [] as string[],
  };

  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      report.sceneCount += 1;
      if (scene.sceneVisualSequencePlan) {
        report.scenesWithSequencePlan += 1;
      } else if ((scene.beats || []).length > 1) {
        report.missingScenePlanIds.push(scene.id);
      }

      for (const beat of scene.beats || []) {
        const isEstablishingBeat = (beat as Beat & { shotType?: string }).shotType === 'establishing'
          || beat.coveragePlan?.stagingPattern === 'environment';
        if (isEstablishingBeat) continue;
        report.nonEstablishingBeatCount += 1;
        if (beat.coveragePlan) {
          report.nonEstablishingBeatsWithCoveragePlan += 1;
        } else {
          report.missingCoverageBeatIds.push(`${scene.id}::${beat.id}`);
        }
      }
    }
  }

  report.passed = report.missingScenePlanIds.length === 0 && report.missingCoverageBeatIds.length === 0;
  return report;
}
