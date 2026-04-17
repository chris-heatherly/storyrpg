import type { Story, EmbeddedEncounterChoice, GeneratedStorylet } from '../../types';
import type { AssetRegistry } from './assetRegistry';
import type { AssetRecord } from './slotTypes';

function cloneStory(story: Story): Story {
  return JSON.parse(JSON.stringify(story)) as Story;
}

function findStoryScene(story: Story, sceneId?: string) {
  if (!sceneId) return undefined;
  for (const episode of story.episodes || []) {
    const scene = (episode.scenes || []).find((candidate) => candidate.id === sceneId);
    if (scene) return scene;
  }
  return undefined;
}

function walkChoicePath(
  choices: EmbeddedEncounterChoice[] | undefined,
  path: string,
): { choice?: EmbeddedEncounterChoice; tier?: 'success' | 'complicated' | 'failure' } {
  const segments = path.split('::').filter(Boolean);
  let currentChoices = choices;
  let currentChoice: EmbeddedEncounterChoice | undefined;
  let currentTier: 'success' | 'complicated' | 'failure' | undefined;

  for (const segment of segments) {
    if (segment === 'success' || segment === 'complicated' || segment === 'failure') {
      currentTier = segment;
      const next = currentChoice?.outcomes?.[segment]?.nextSituation?.choices;
      currentChoices = next;
      continue;
    }
    currentChoice = currentChoices?.find((choice) => choice.id === segment);
  }

  return { choice: currentChoice, tier: currentTier };
}

function applyEncounterRecord(story: Story, record: AssetRecord): void {
  const scene = findStoryScene(story, record.slot.sceneId);
  if (!scene?.encounter || !record.latestUrl) return;

  if (record.slot.family === 'encounter-setup' && record.slot.beatId) {
    for (const phase of scene.encounter.phases || []) {
      const beat = (phase.beats || []).find((candidate: any) => candidate.id === record.slot.beatId);
      if (beat && 'setupText' in beat) {
        beat.situationImage = record.latestUrl;
        return;
      }
    }
  }

  if ((record.slot.family === 'encounter-outcome' || record.slot.family === 'encounter-situation') && record.slot.beatId) {
    for (const phase of scene.encounter.phases || []) {
      const beat = (phase.beats || []).find((candidate: any) => candidate.id === record.slot.beatId);
      if (!beat || !('choices' in beat)) continue;
      const path = record.slot.choiceMapKey || '';
      const { choice, tier } = walkChoicePath(beat.choices as never, path);
      const resolvedTier = record.slot.outcomeTier || tier;
      if (!choice || !resolvedTier) continue;
      if (record.slot.family === 'encounter-outcome') {
        choice.outcomes[resolvedTier].outcomeImage = record.latestUrl;
        return;
      }
      choice.outcomes[resolvedTier].nextSituation = choice.outcomes[resolvedTier].nextSituation || {
        setupText: '',
        choices: [],
      };
      choice.outcomes[resolvedTier].nextSituation!.situationImage = record.latestUrl;
      return;
    }
  }
}

function applyStoryletRecord(story: Story, record: AssetRecord): void {
  const scene = findStoryScene(story, record.slot.sceneId);
  if (!scene?.encounter?.storylets || !record.latestUrl) return;
  const outcomeName = record.slot.outcomeName as keyof NonNullable<typeof scene.encounter.storylets>;
  const storylet = scene.encounter.storylets[outcomeName] as GeneratedStorylet | undefined;
  if (!storylet || !record.slot.beatId) return;
  const beat = (storylet.beats || []).find((candidate) => candidate.id === record.slot.beatId);
  if (beat) {
    beat.image = record.latestUrl;
  }
}

export function assembleStoryAssetsFromRegistry(story: Story, registry: AssetRegistry): Story {
  const next = cloneStory(story);

  for (const record of registry.values()) {
    if (record.status !== 'succeeded' || !record.latestUrl) continue;

    if (record.slot.family === 'story-scene') {
      const scene = findStoryScene(next, record.slot.sceneId);
      if (scene) scene.backgroundImage = record.latestUrl;
      continue;
    }

    if (record.slot.family === 'story-beat') {
      const scene = findStoryScene(next, record.slot.sceneId);
      const beat = scene?.beats?.find((candidate) => candidate.id === record.slot.beatId);
      if (beat) beat.image = record.latestUrl;
      continue;
    }

    if (record.slot.family === 'story-beat-panel') {
      const scene = findStoryScene(next, record.slot.sceneId);
      const beat = scene?.beats?.find((candidate) => candidate.id === record.slot.beatId);
      if (beat) {
        if (!beat.panelImages) beat.panelImages = [];
        const panelIdx = record.slot.metadata?.panelIndex as number | undefined;
        if (panelIdx !== undefined) {
          beat.panelImages[panelIdx] = record.latestUrl;
        } else {
          beat.panelImages.push(record.latestUrl);
        }
      }
      continue;
    }

    if (
      record.slot.family === 'encounter-setup' ||
      record.slot.family === 'encounter-outcome' ||
      record.slot.family === 'encounter-situation'
    ) {
      applyEncounterRecord(next, record);
      continue;
    }

    if (record.slot.family === 'storylet-aftermath') {
      applyStoryletRecord(next, record);
    }
  }

  return next;
}
