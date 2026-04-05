import { EncounterCost, EncounterVisualContract } from '../../types';
import { StateChange } from './llm-output';

export interface StoryletBeatDraft {
  id: string;
  text: string;
  speaker?: string;
  speakerName?: string;
  speakerMood?: string;
  image?: string;
  choices?: Array<{
    id: string;
    text: string;
    nextBeatId?: string;
    consequences?: StateChange[];
  }>;
  nextBeatId?: string;
  isTerminal?: boolean;
  visualContract?: EncounterVisualContract;
  cost?: EncounterCost;
}

export interface GeneratedStoryletDraft {
  id: string;
  name: string;
  triggerOutcome: 'victory' | 'partialVictory' | 'defeat' | 'escape';
  tone: 'triumphant' | 'bittersweet' | 'tense' | 'desperate' | 'relieved' | 'somber';
  narrativeFunction: string;
  beats: StoryletBeatDraft[];
  startingBeatId: string;
  consequences: StateChange[];
  setsFlags?: { flag: string; value: boolean }[];
  nextSceneId?: string;
  cost?: EncounterCost;
}
