/**
 * QA Remediation
 *
 * Takes Playwright QA results, identifies fixable issues (broken/missing images),
 * looks up the original prompts, re-generates the images, and patches the story JSON.
 */

import type { Story } from '../../types';
import { mediaRefAsString } from '../../assets/assetRef';

let nodeFs: any;
let nodePath: any;
try {
  nodeFs = require('fs');
  nodePath = require('path');
} catch { /* running in browser — module won't be called */ }
import type { PlaywrightImageIssue } from './playwrightQARunner';
import type { ImageGenerationService } from '../services/imageGenerationService';
import type { AssetRegistry } from '../images/assetRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RemediationFix {
  issueScreen: string;
  identifier: string;
  action: 'regenerated' | 'url_fixed' | 'skipped';
  oldUrl?: string;
  newUrl?: string;
  reason?: string;
}

export interface RemediationResult {
  fixes: RemediationFix[];
  /** True if at least one image was successfully re-generated */
  hasChanges: boolean;
}

interface SavedPrompt {
  identifier: string;
  metadata?: Record<string, unknown>;
  prompt: {
    prompt: string;
    negativePrompt?: string;
    style?: string;
    aspectRatio?: string;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a probable image identifier from a Playwright issue screen field.
 * Screen fields look like: "beat-31 (encounter-defeated)", "beat-12 (beat)",
 * "storylet-beat-15", etc.
 */
function parseIssueScreen(screen: string): { beatNumber: number; context: string } {
  const beatMatch = screen.match(/beat-(\d+)/);
  const beatNumber = beatMatch ? parseInt(beatMatch[1], 10) : -1;

  const contextMatch = screen.match(/\(([^)]+)\)/);
  const context = contextMatch ? contextMatch[1] : screen;

  return { beatNumber, context };
}

/**
 * Walk the story JSON to find the beat at a given playthrough index.
 * Returns the beat image URL and scene/encounter identifiers.
 */
function findBeatByPlaythroughIndex(
  story: Story,
  beatNumber: number,
): { imageUrl?: string; sceneId?: string; beatId?: string; identifier?: string } | null {
  let index = 0;
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      for (const beat of scene.beats || []) {
        index++;
        if (index === beatNumber) {
          const beatImageStr = mediaRefAsString(beat.image);
          return {
            imageUrl: beatImageStr || undefined,
            sceneId: scene.id,
            beatId: beat.id,
            identifier: beatImageStr && nodePath ? nodePath.basename(beatImageStr).replace(/\.[^.]+$/, '') : undefined,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Load a saved prompt JSON from the prompts directory.
 */
function loadPrompt(outputDir: string, identifier: string): SavedPrompt | null {
  if (!nodeFs || !nodePath) return null;
  const promptsDir = nodePath.join(outputDir, 'prompts');
  const promptPath = nodePath.join(promptsDir, `${identifier}.json`);
  try {
    if (nodeFs.existsSync(promptPath)) {
      return JSON.parse(nodeFs.readFileSync(promptPath, 'utf-8'));
    }
  } catch { /* ignore parse errors */ }

  // Try scanning the prompts directory for a partial match
  try {
    if (nodeFs.existsSync(promptsDir)) {
      const files = nodeFs.readdirSync(promptsDir);
      for (const file of files) {
        if (file.includes(identifier) && file.endsWith('.json')) {
          return JSON.parse(nodeFs.readFileSync(nodePath.join(promptsDir, file), 'utf-8'));
        }
      }
    }
  } catch { /* ignore */ }

  return null;
}

/**
 * Check if a URL points to an existing file on disk (for local proxy URLs).
 */
function resolveLocalFile(url: string, outputDir: string): string | null {
  if (!url || !nodeFs || !nodePath) return null;
  // Local proxy URLs: http://localhost:3001/generated-stories/<dir>/images/<file>
  const match = url.match(/\/generated-stories\/(.+)/);
  if (match) {
    const relPath = match[1];
    const baseDir = nodePath.resolve(outputDir, '..');
    const fullPath = nodePath.join(baseDir, relPath);
    if (nodeFs.existsSync(fullPath)) return fullPath;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main remediation
// ---------------------------------------------------------------------------

export async function remediateImageIssues(
  issues: PlaywrightImageIssue[],
  networkFailures: string[],
  story: Story,
  imageService: ImageGenerationService,
  assetRegistry: AssetRegistry,
  outputDir: string,
): Promise<RemediationResult> {
  const fixes: RemediationFix[] = [];

  // Combine image issues and network failures into a unified fix list
  const fixableIssues = issues.filter(i => i.type === 'broken' || i.type === 'placeholder');

  for (const issue of fixableIssues) {
    const { beatNumber, context } = parseIssueScreen(issue.screen);
    if (beatNumber < 0) {
      fixes.push({
        issueScreen: issue.screen,
        identifier: '',
        action: 'skipped',
        reason: `Could not parse beat number from screen "${issue.screen}"`,
      });
      continue;
    }

    // Try to find the beat in the story
    const beatInfo = findBeatByPlaythroughIndex(story, beatNumber);
    if (!beatInfo) {
      fixes.push({
        issueScreen: issue.screen,
        identifier: '',
        action: 'skipped',
        reason: `Beat ${beatNumber} not found in story JSON`,
      });
      continue;
    }

    const identifier = beatInfo.identifier || `beat-${beatInfo.sceneId}-${beatInfo.beatId}`;

    // Check if the file exists on disk but just has a URL problem
    if (beatInfo.imageUrl) {
      const localFile = resolveLocalFile(beatInfo.imageUrl, outputDir);
      if (localFile) {
        fixes.push({
          issueScreen: issue.screen,
          identifier,
          action: 'skipped',
          oldUrl: beatInfo.imageUrl,
          reason: 'Image file exists on disk — likely a rendering/opacity issue, not a missing asset',
        });
        continue;
      }
    }

    // Load the original prompt
    const savedPrompt = loadPrompt(outputDir, identifier);
    if (!savedPrompt) {
      fixes.push({
        issueScreen: issue.screen,
        identifier,
        action: 'skipped',
        reason: `No saved prompt found for identifier "${identifier}"`,
      });
      continue;
    }

    // Re-generate the image
    try {
      console.log(`[QARemediation] Re-generating image for "${identifier}" (${issue.screen})`);
      const result = await imageService.generateImage(
        savedPrompt.prompt as any,
        identifier,
        {
          ...(savedPrompt.metadata || {}),
          regeneration: ((savedPrompt.metadata?.regeneration as number) || 0) + 1,
        } as any,
      );

      if (result.imageUrl) {
        fixes.push({
          issueScreen: issue.screen,
          identifier,
          action: 'regenerated',
          oldUrl: beatInfo.imageUrl,
          newUrl: result.imageUrl,
        });
      } else {
        fixes.push({
          issueScreen: issue.screen,
          identifier,
          action: 'skipped',
          reason: 'Image regeneration returned no URL',
        });
      }
    } catch (err) {
      fixes.push({
        issueScreen: issue.screen,
        identifier,
        action: 'skipped',
        reason: `Regeneration failed: ${(err as Error).message}`,
      });
    }
  }

  // Handle network failures (404s) — try to find and regenerate the missing images
  for (const failure of networkFailures) {
    const urlMatch = failure.match(/\d+\s+(https?:\/\/.+)/);
    if (!urlMatch) continue;
    const failedUrl = urlMatch[1];

    const imageBasename = nodePath ? nodePath.basename(failedUrl).replace(/\.[^.]+$/, '') : '';
    const savedPrompt = loadPrompt(outputDir, imageBasename);
    if (!savedPrompt) {
      fixes.push({
        issueScreen: `network:${failedUrl.substring(0, 80)}`,
        identifier: imageBasename,
        action: 'skipped',
        reason: `No saved prompt for network-failed image "${imageBasename}"`,
      });
      continue;
    }

    try {
      console.log(`[QARemediation] Re-generating network-failed image: "${imageBasename}"`);
      const result = await imageService.generateImage(
        savedPrompt.prompt as any,
        imageBasename,
        {
          ...(savedPrompt.metadata || {}),
          regeneration: ((savedPrompt.metadata?.regeneration as number) || 0) + 1,
        } as any,
      );

      if (result.imageUrl) {
        fixes.push({
          issueScreen: `network:${failedUrl.substring(0, 80)}`,
          identifier: imageBasename,
          action: 'regenerated',
          oldUrl: failedUrl,
          newUrl: result.imageUrl,
        });
      }
    } catch (err) {
      fixes.push({
        issueScreen: `network:${failedUrl.substring(0, 80)}`,
        identifier: imageBasename,
        action: 'skipped',
        reason: `Regeneration failed: ${(err as Error).message}`,
      });
    }
  }

  return {
    fixes,
    hasChanges: fixes.some(f => f.action === 'regenerated' || f.action === 'url_fixed'),
  };
}

/**
 * Re-save the final story JSON after remediation.
 */
export function resaveFinalStory(story: Story, outputDir: string): void {
  if (!nodeFs || !nodePath) return;
  const storyPath = nodePath.join(outputDir, '08-final-story.json');
  nodeFs.writeFileSync(storyPath, JSON.stringify(story, null, 2), 'utf-8');
  console.log(`[QARemediation] Re-saved final story to ${storyPath}`);
}
