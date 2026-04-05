import type { Story } from '../../types';
import { collectMissingEncounterImageKeys } from '../utils/encounterImageCoverage';
import type { AssetRegistry } from './assetRegistry';
import type { AssetRecord } from './slotTypes';

export interface CoverageValidationReport {
  missingRequiredSlotIds: string[];
  missingRequiredCoverageKeys: string[];
  unresolvedRequiredRecords: AssetRecord[];
  missingStoryFields: string[];
}

export function validateRegistryCoverage(story: Story, registry: AssetRegistry): CoverageValidationReport {
  const unresolvedRequiredRecords = registry.getMissingRequiredSlots();
  const missingRequiredSlotIds = unresolvedRequiredRecords.map((record) => record.slot.slotId);
  const missingRequiredCoverageKeys = unresolvedRequiredRecords.map((record) => record.slot.coverageKey);
  const missingStoryFields: string[] = [];

  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      for (const beat of scene.beats || []) {
        if (!beat.image) {
          missingStoryFields.push(`beat:${scene.id}::${beat.id}`);
        }
      }
      if (scene.encounter) {
        missingStoryFields.push(...collectMissingEncounterImageKeys(scene.id, scene.encounter));
        for (const [outcomeName, storylet] of Object.entries(scene.encounter.storylets || {})) {
          for (const beat of storylet?.beats || []) {
            if (!beat.image) {
              missingStoryFields.push(`storylet:${scene.id}::${outcomeName}::${beat.id}`);
            }
          }
        }
      }
    }
  }

  return {
    missingRequiredSlotIds,
    missingRequiredCoverageKeys,
    unresolvedRequiredRecords,
    missingStoryFields,
  };
}
