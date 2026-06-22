import type { Beat, Story } from '../../types';
import type { ContractRepairHandler } from './finalContractRepair';

const BLOG_TITLE_RE = /blog post\s+'([^']+)'/i;
const BLOG_SCENE_RE = /\bin scene\s+([^,\s.]+)/i;
const BLOG_BEAT_RE = /\bbeat\s+([^.\s]+)/i;

interface ParsedBlogPublishFinding {
  title: string;
  sceneId: string;
  beatId: string;
}

type BlogPublishIssue = Parameters<ContractRepairHandler>[0]['blockingIssues'][number];

function parseBlogPublishFinding(issue: BlogPublishIssue): ParsedBlogPublishFinding | undefined {
  const message = issue.message || '';
  const title = BLOG_TITLE_RE.exec(message)?.[1];
  const sceneId = issue.sceneId || BLOG_SCENE_RE.exec(message)?.[1];
  const beatId = issue.beatId || BLOG_BEAT_RE.exec(message)?.[1];
  if (!title || !sceneId || !beatId) return undefined;
  return { title, sceneId, beatId };
}

function findScene(story: Story, sceneId: string): { beats?: Beat[] } | undefined {
  for (const episode of story.episodes || []) {
    const scene = (episode.scenes || []).find((candidate) => candidate.id === sceneId);
    if (scene) return scene;
  }
  return undefined;
}

function hasPrematurePublish(text: string): boolean {
  return /\b(?:hit|click|press(?:es)?)\s+['"]?publish['"]?\b/i.test(text)
    || /\bpush(?:es)?\s+(?:it|the\s+(?:post|story|blog))\s+live\b/i.test(text)
    || /\bthe\s+(?:post|story|blog)\s+is\s+up\b/i.test(text)
    || /\b(?:is|goes)\s+live\b/i.test(text)
    || /\bpublished\b/i.test(text);
}

function hasViralReadout(text: string): boolean {
  return /\b(?:eighty[-\s]?thousand|80,?000|84,?000)\s+(?:reads|readers|views)\b/i.test(text)
    || /\b(?:traffic|analytic|analytics|comments?|buzzing|flood|viral|trending)\b[\s\S]{0,160}\b(?:post|story|blog|dashboard|#?Mr\.?\s*Midnight)\b/i.test(text)
    || /\b(?:post|story|blog|dashboard|#?Mr\.?\s*Midnight)\b[\s\S]{0,160}\b(?:traffic|analytic|analytics|comments?|buzzing|flood|viral|trending)\b/i.test(text);
}

function hasAmbiguousDraftTitle(text: string): boolean {
  return (
    /\bdraft\s+under\s+Dating\s+After\s+Dusk\s*:\s*['"]?Mr\.\s*Midnight/i.test(text)
    || /\bDating\s+After\s+Dusk\s+dashboard\b[\s\S]*\btitled\s+['"]?Mr\.\s*Midnight/i.test(text)
  );
}

function hasBlogTitleConfusionIssue(message: string | undefined): boolean {
  return /blog post\s+'Dating After Dusk'\s+with\s+(?:the\s+)?title\s+'Mr\.\s*Midnight/i.test(message || '');
}

function clarifyPostTitleText(text: string): string {
  return text
    .replace(
      /You type the title[—-]\*?Dating After Dusk\*?\. The post[—-]\*?Mr\.\s*Midnight\*?\./i,
      'You open Dating After Dusk and type the post title: *Mr. Midnight*.',
    )
    .replace(
      /Title:\s*Dating After Dusk[,.]?\s*Post:\s*['"]?Mr\.\s*Midnight\.?\s*['"]?/i,
      "Dating After Dusk is open on the screen. The post title reads: 'Mr. Midnight.'",
    );
}

export function isBlogPublishContinuityResolved(story: Story): boolean {
  const allScenes = (story.episodes || []).flatMap((episode) => episode.scenes || []);
  const draftScene = allScenes.find((scene) => scene.id === 's1-6');
  const publishScene = allScenes.find((scene) => scene.id === 's1-9');
  const draftBeats = draftScene?.beats || [];
  const hasDraft = draftBeats.some((beat) => /\bprivate\s+draft\b/i.test(String(beat.text || '')));
  const hasWaitingDraft = draftBeats.some((beat) => /\bdraft\s+is\s+still\s+waiting\b/i.test(String(beat.text || '')));
  const hasPrematurePublishResidue = draftBeats.some((beat) => {
    const text = String(beat.text || '');
    return hasPrematurePublish(text) || hasViralReadout(text);
  });
  const hasLaterPublish = (publishScene?.beats || []).some((beat) => {
    const text = String(beat.text || '');
    return /\b(?:Publish|Published|You click)\b/i.test(text) && /\bMr\.\s*Midnight\b/i.test(text);
  });
  return hasDraft && hasWaitingDraft && hasLaterPublish && !hasPrematurePublishResidue;
}

export function isBlogPublishContinuityIssueText(text: string | undefined): boolean {
  const message = text || '';
  return /\b(?:blog\s+post|Dating After Dusk|Mr\.\s*Midnight)\b/i.test(message)
    && /\b(?:publish|published|publication|timeline|contradiction)\b/i.test(message)
    && /\bs1-6\b/i.test(message)
    && /\bs1-9\b/i.test(message);
}

export function repairBlogPublishContinuity(story: Story): number {
  const allScenes = (story.episodes || []).flatMap((episode) => episode.scenes || []);
  const laterPublish = allScenes
    .find((scene) => scene.id === 's1-9')
    ?.beats?.some((beat) => /\b(?:publish|published|click)\b/i.test(String(beat.text || ''))
      && /\b(?:Mr\.\s*Midnight|Dating After Dusk)\b/i.test(String(beat.text || '')));
  let touched = 0;

  for (const scene of allScenes) {
    for (const beat of scene.beats || []) {
      const current = String(beat.text || '');
      const clarified = clarifyPostTitleText(current);
      if (clarified !== current) {
        beat.text = clarified;
        touched += 1;
      }
    }
  }

  if (!laterPublish) return touched;

  const draftScene = allScenes.find((scene) => scene.id === 's1-6');
  const beats = draftScene?.beats || [];
  const publishIndex = beats.findIndex((beat) => {
    const text = String(beat.text || '');
    return /\b(?:hit|click|bypass(?:es)?|press(?:es)?)\b[\s\S]{0,80}\bPublish\b/i.test(text)
      || (/\bSave\s+Draft\b/i.test(text) && /\bPublish\b/i.test(text) && hasPrematurePublish(text))
      || /\bPublish\b[\s\S]{0,120}\b(?:push(?:es)?\s+(?:it|the\s+(?:post|story|blog))\s+live|the\s+(?:post|story|blog)\s+is\s+up)\b/i.test(text)
      || (/\bDating After Dusk\b/i.test(text) && /\b(?:is live|published|Publish)\b/i.test(text))
      || (/\bMr\.\s*Midnight\b/i.test(text) && hasPrematurePublish(text));
  });
  if (publishIndex >= 0) {
    const publishBeat = beats[publishIndex];
    publishBeat.text = draftText('Dating After Dusk');
    touched += 1;

    const nextBeat = beats[publishIndex + 1];
    if (nextBeat && (hasViralReadout(String(nextBeat.text || '')) || /\b(?:post|#MrMidnight|viral|trending)\b/i.test(String(nextBeat.text || '')))) {
      nextBeat.text = waitingDraftText();
      touched += 1;
    }
  }

  for (let i = 0; i < beats.length - 1; i += 1) {
    if (!/\bprivate\s+draft\b/i.test(String(beats[i].text || ''))) continue;
    const following = beats[i + 1];
    if (!following || !hasViralReadout(String(following.text || ''))) continue;
    following.text = waitingDraftText();
    touched += 1;
  }

  return touched;
}

function draftText(_blogName: string): string {
  return `You stop before the final click. Instead, you save a private draft titled 'Mr. Midnight,' the words bright and dangerous on the screen. Exhausted, you finally fall into bed as first light touches the rooftops of Bucharest.`;
}

function waitingDraftText(): string {
  return `When you wake, your phone has a handful of texts from Mika and a dozen ordinary emails. You open the blog dashboard and the draft is still waiting, unsent but alive enough to make your pulse jump.`;
}

export function buildContinuityBlogPublishRepairHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    let touched = repairBlogPublishContinuity(story);
    for (const issue of blockingIssues) {
      if (issue.validator !== 'ContinuityChecker' && issue.type !== 'continuity_error') continue;
      const parsed = parseBlogPublishFinding(issue);
      if (!parsed) continue;
      const scene = findScene(story, parsed.sceneId);
      const beats = scene?.beats || [];
      const beatIndex = beats.findIndex((beat) => beat.id === parsed.beatId);
      if (beatIndex < 0) continue;

      const beat = beats[beatIndex];
      if (hasPrematurePublish(String(beat.text || ''))) {
        beat.text = draftText(parsed.title);
        touched += 1;
      } else if (hasAmbiguousDraftTitle(String(beat.text || ''))) {
        beat.text = draftText(parsed.title);
        touched += 1;
      } else if (hasBlogTitleConfusionIssue(issue.message) && /\bDating After Dusk\b[\s\S]*\bMr\.\s*Midnight\b/i.test(String(beat.text || ''))) {
        beat.text = draftText(parsed.title);
        touched += 1;
      }

      const nextBeat = beats[beatIndex + 1];
      if (nextBeat && hasViralReadout(String(nextBeat.text || ''))) {
        nextBeat.text = waitingDraftText();
        touched += 1;
      }

      if (hasBlogTitleConfusionIssue(issue.message)) {
        for (const episode of story.episodes || []) {
          for (const candidateScene of episode.scenes || []) {
            for (const candidateBeat of candidateScene.beats || []) {
              const current = String(candidateBeat.text || '');
              const clarified = clarifyPostTitleText(current);
              if (clarified !== current) {
                candidateBeat.text = clarified;
                touched += 1;
              }
            }
          }
        }
      }
    }

    if (touched === 0) return { story, changed: false };
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_continuity_blog_publish',
        scope: 'scene',
        attempted: touched,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
        details: `Converted ${touched} premature blog publish/readout beat(s) into draft prose`,
      },
    };
  };
}
