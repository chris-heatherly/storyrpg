/**
 * Browser QA Phase
 *
 * Runs the Playwright full-coverage playthrough against the saved story,
 * remediates image/network issues it finds, re-saves, and re-tests up to the
 * configured retry budget.
 *
 * Faithful port of the "PHASE 8: BROWSER QA" block from
 * FullStoryPipeline.generate() (pure move): same gate, same retry/remediation
 * loop, same events and non-fatal failure handling. The story can be
 * REPLACED during remediation (reassembled from the asset registry), so the
 * phase returns the current story and the caller must adopt it.
 */

import { Story } from '../../../types';
import { ImageGenerationService } from '../../services/imageGenerationService';
import { AssetRegistry } from '../../images/assetRegistry';
import { assembleStoryAssetsFromRegistry } from '../../images/storyAssetAssembler';
import {
  runPlaywrightQAMultiPath,
  type PlaywrightQAResult,
} from '../../validators/playwrightQARunner';
import { remediateImageIssues, resaveFinalStory } from '../../validators/qaRemediation';
import { PipelineContext } from './index';

// ========================================
// INPUT & CONTEXT TYPES
// ========================================

export interface BrowserQAInput {
  story: Story;
  storyTitle: string;
  outputDirectory: string;
}

export interface BrowserQADeps {
  imageService: ImageGenerationService;
  assetRegistry: AssetRegistry;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class BrowserQAPhase {
  readonly name = 'browser_qa';

  constructor(private readonly deps: BrowserQADeps) {}

  /**
   * Returns the story to continue with (replaced when remediation
   * reassembled assets onto it).
   */
  async run(input: BrowserQAInput, context: PipelineContext): Promise<Story> {
    let { story } = input;
    const { storyTitle, outputDirectory } = input;
    const maxRetries = context.config.validation?.playwrightQAMaxRetries ?? 1;

    context.emit({ type: 'phase_start', phase: 'browser_qa', message: 'Phase 8: Running full-coverage browser QA...' });

    let qaAttempt = 0;
    let lastQAResult: PlaywrightQAResult | null = null;

    while (qaAttempt <= maxRetries) {
      try {
        context.emit({
          type: 'progress',
          phase: 'browser_qa',
          message: qaAttempt === 0
            ? 'Analyzing story paths and launching parallel browser playthroughs...'
            : `Re-testing after remediation (attempt ${qaAttempt + 1}/${maxRetries + 1})...`,
        });

        lastQAResult = await runPlaywrightQAMultiPath({
          storyTitle,
          story,
          maxBeats: 200,
          timeoutMs: 300_000,
          maxParallel: 3,
          onProgress: (msg) => {
            context.emit({ type: 'progress', phase: 'browser_qa', message: msg });
          },
        });

        if (lastQAResult.skipped) {
          context.emit({
            type: 'warning',
            phase: 'browser_qa',
            message: `Browser QA skipped: ${lastQAResult.skipReason}`,
          });
          break;
        }

        const coverage = lastQAResult.coverageReport;
        const pathSummary = coverage
          ? `${coverage.completedPaths}/${coverage.totalPaths} paths, ${coverage.totalChoicesMade} choices exercised`
          : `${lastQAResult.totalBeats} beats`;

        console.log(`[Pipeline] Browser QA pass ${qaAttempt + 1}: ${pathSummary}, ` +
          `${lastQAResult.imageIssues.length} image issues, ${lastQAResult.networkFailures.length} network failures`);

        if (lastQAResult.passed) {
          context.emit({
            type: 'phase_complete',
            phase: 'browser_qa',
            message: `Browser QA passed — ${pathSummary}, 0 issues`,
          });
          break;
        }

        // Issues found — attempt remediation if we have retries left
        const issueCount = lastQAResult.imageIssues.length + lastQAResult.networkFailures.length;
        context.emit({
          type: 'warning',
          phase: 'browser_qa',
          message: `Browser QA found ${issueCount} issue(s) across ${pathSummary}`,
        });

        if (qaAttempt < maxRetries) {
          context.emit({
            type: 'progress',
            phase: 'browser_qa',
            message: `Remediating ${issueCount} issue(s)...`,
          });

          try {
            const remediation = await remediateImageIssues(
              lastQAResult.imageIssues,
              lastQAResult.networkFailures,
              story,
              this.deps.imageService,
              this.deps.assetRegistry,
              outputDirectory,
            );

            const regenCount = remediation.fixes.filter(f => f.action === 'regenerated').length;
            const skipCount = remediation.fixes.filter(f => f.action === 'skipped').length;

            console.log(`[Pipeline] QA Remediation: ${regenCount} regenerated, ${skipCount} skipped`);
            for (const fix of remediation.fixes) {
              console.log(`[Pipeline]   ${fix.action}: ${fix.identifier || fix.issueScreen} — ${fix.reason || fix.newUrl || ''}`);
            }

            if (remediation.hasChanges) {
              story = assembleStoryAssetsFromRegistry(story, this.deps.assetRegistry);
              story.outputDir = outputDirectory;
              resaveFinalStory(story, outputDirectory);
              context.emit({
                type: 'progress',
                phase: 'browser_qa',
                message: `Remediated ${regenCount} image(s), re-saved story. Re-testing...`,
              });
            } else {
              context.emit({
                type: 'warning',
                phase: 'browser_qa',
                message: 'No fixable issues found during remediation — skipping retest',
              });
              break;
            }
          } catch (remErr) {
            console.warn('[Pipeline] QA remediation error (non-fatal):', (remErr as Error).message);
            context.emit({
              type: 'warning',
              phase: 'browser_qa',
              message: `Remediation failed: ${(remErr as Error).message}`,
            });
            break;
          }
        }
      } catch (qaErr) {
        console.warn('[Pipeline] Browser QA error (non-fatal):', (qaErr as Error).message);
        context.emit({
          type: 'warning',
          phase: 'browser_qa',
          message: `Browser QA failed: ${(qaErr as Error).message}`,
        });
        break;
      }

      qaAttempt++;
    }

    if (lastQAResult && !lastQAResult.passed && !lastQAResult.skipped) {
      const remaining = lastQAResult.imageIssues.length + lastQAResult.networkFailures.length;
      context.emit({
        type: 'warning',
        phase: 'browser_qa',
        message: `Browser QA completed with ${remaining} unresolved issue(s) after ${qaAttempt} attempt(s)`,
      });
    }

    return story;
  }
}
