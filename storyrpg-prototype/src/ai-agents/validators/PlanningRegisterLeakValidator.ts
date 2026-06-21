import type { Story } from '../../types';
import { PLANNING_REGISTER_LEAK_PATTERNS } from '../constants/planningRegisterText';

export interface PlanningRegisterLeakFinding {
  pattern: string;
  excerpt: string;
  path: string;
  episodeId?: string;
  episodeNumber?: number;
  sceneId?: string;
  beatId?: string;
}

export interface PlanningRegisterLeakResult {
  findings: PlanningRegisterLeakFinding[];
  fieldsScanned: number;
}

const SCANNABLE_KEY = /(text|prose|description|prompt|caption|moment|summary|cue|note|cost|stakes|setup|escalation|outcome|success|failure|partial|complicated|victory|defeat|visual|metadata|contract|geography|purpose|question|function)/i;
const SKIPPED_KEY = /(id|flag|next|starting|imageData|base64|url|path|uri|sha|hash)$/i;

function excerpt(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  const index = Math.max(0, (match?.index ?? 0) - 50);
  const end = Math.min(text.length, index + 180);
  return text.slice(index, end).replace(/\s+/g, ' ').trim();
}

function shouldScanString(key: string, inEncounter: boolean): boolean {
  if (SKIPPED_KEY.test(key)) return false;
  return inEncounter || SCANNABLE_KEY.test(key);
}

export class PlanningRegisterLeakValidator {
  validate(input: { story: Story }): PlanningRegisterLeakResult {
    const findings: PlanningRegisterLeakFinding[] = [];
    let fieldsScanned = 0;

    const scanText = (
      value: unknown,
      path: string,
      ctx: Omit<PlanningRegisterLeakFinding, 'pattern' | 'excerpt' | 'path'>,
    ): void => {
      if (typeof value !== 'string' || value.trim().length === 0) return;
      fieldsScanned += 1;
      for (const { label, pattern } of PLANNING_REGISTER_LEAK_PATTERNS) {
        if (!pattern.test(value)) continue;
        findings.push({
          pattern: label,
          excerpt: excerpt(value, pattern),
          path,
          ...ctx,
        });
      }
    };

    const scanObject = (
      value: unknown,
      path: string,
      ctx: Omit<PlanningRegisterLeakFinding, 'pattern' | 'excerpt' | 'path'>,
      inEncounter = false,
    ): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach((item, index) => scanObject(item, `${path}[${index}]`, ctx, inEncounter));
        return;
      }
      const obj = value as Record<string, unknown>;
      for (const [key, child] of Object.entries(obj)) {
        const childPath = path ? `${path}.${key}` : key;
        const childInEncounter = inEncounter || key === 'encounter';
        if (typeof child === 'string') {
          if (shouldScanString(key, childInEncounter)) scanText(child, childPath, ctx);
        } else if (child && typeof child === 'object') {
          if (!SKIPPED_KEY.test(key)) scanObject(child, childPath, ctx, childInEncounter);
        }
      }
    };

    for (const [episodeIndex, episode] of (input.story.episodes || []).entries()) {
      const episodeCtx = {
        episodeId: episode.id,
        episodeNumber: episode.number ?? episodeIndex + 1,
      };
      for (const [sceneIndex, scene] of (episode.scenes || []).entries()) {
        const sceneCtx = { ...episodeCtx, sceneId: scene.id };
        const sceneRecord = scene as unknown as Record<string, unknown>;
        scanText(sceneRecord.description, `episodes[${episodeIndex}].scenes[${sceneIndex}].description`, sceneCtx);
        scanText(sceneRecord.geography, `episodes[${episodeIndex}].scenes[${sceneIndex}].geography`, sceneCtx);
        scanText(sceneRecord.dramaticPurpose, `episodes[${episodeIndex}].scenes[${sceneIndex}].dramaticPurpose`, sceneCtx);
        scanText(sceneRecord.dramaticQuestion, `episodes[${episodeIndex}].scenes[${sceneIndex}].dramaticQuestion`, sceneCtx);
        scanText(sceneRecord.narrativeFunction, `episodes[${episodeIndex}].scenes[${sceneIndex}].narrativeFunction`, sceneCtx);
        scanObject((scene as unknown as Record<string, unknown>).visualMetadata, `episodes[${episodeIndex}].scenes[${sceneIndex}].visualMetadata`, sceneCtx);
        scanObject((scene as unknown as Record<string, unknown>).visualContract, `episodes[${episodeIndex}].scenes[${sceneIndex}].visualContract`, sceneCtx);
        scanObject(scene.encounter, `episodes[${episodeIndex}].scenes[${sceneIndex}].encounter`, sceneCtx, true);
        scanObject((scene as unknown as Record<string, unknown>).storylets, `episodes[${episodeIndex}].scenes[${sceneIndex}].storylets`, sceneCtx);

        for (const [beatIndex, beat] of (scene.beats || []).entries()) {
          const beatCtx = { ...sceneCtx, beatId: beat.id };
          const beatPath = `episodes[${episodeIndex}].scenes[${sceneIndex}].beats[${beatIndex}]`;
          scanText(beat.text, `${beatPath}.text`, beatCtx);
          scanObject((beat as unknown as Record<string, unknown>).textVariants, `${beatPath}.textVariants`, beatCtx);
          scanObject((beat as unknown as Record<string, unknown>).visualMetadata, `${beatPath}.visualMetadata`, beatCtx);
          scanObject((beat as unknown as Record<string, unknown>).visualContract, `${beatPath}.visualContract`, beatCtx);
          scanObject((beat as unknown as Record<string, unknown>).choices, `${beatPath}.choices`, beatCtx);
        }
      }
    }

    return { findings, fieldsScanned };
  }
}
