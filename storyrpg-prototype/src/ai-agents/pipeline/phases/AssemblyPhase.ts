/**
 * Assembly Phase
 *
 * Phase 6 of story generation: assembles the final Story from the generated
 * parts (via the monolith's assembleStory closure), merges registry-tracked
 * assets onto it, runs the structural auto-fix and the gated craft auto-fix,
 * resolves player templates, enforces the pre-generation completeness gate
 * (registry coverage + the per-story missing-image walk), verifies asset
 * URLs over HTTP (Tier 1 QA), runs the deterministic flag-chronology and
 * quote-recall scans (escalating findings onto the QA report in place), and
 * stamps imagesStatus / the draft image manifest.
 *
 * Faithful port of the "PHASE 6: ASSEMBLY" region from
 * FullStoryPipeline.generate() (pure move): same gates, same events, same
 * abort behavior — with ONE documented deviation, see NOTE below. Assembly
 * itself (assembleStory) stays in the monolith because the multi-episode
 * loop and branch validation share it; it is injected as a closure.
 *
 * NOTE (documented deviation): the original completeness-gate walk contained
 * an encounter-validation abort branch that referenced `encounterValidation`
 * and `sceneBlueprint` — variables that only exist inside
 * runContentGeneration, not in generate() — so under @ts-nocheck it was a
 * latent ReferenceError whenever the walk reached a scene with an encounter.
 * That branch could never have run as written (the real encounter-validation
 * abort lives at generation time in runContentGeneration) and was dropped
 * here so the phase types cleanly.
 */

import { CharacterBible } from '../../agents/CharacterDesigner';
import { ChoiceSet } from '../../agents/ChoiceAuthor';
import { EncounterStructure } from '../../agents/EncounterArchitect';
import { EpisodeBlueprint } from '../../agents/StoryArchitect';
import { SceneContent } from '../../agents/SceneWriter';
import { WorldBible } from '../../agents/WorldBuilder';
import { QAReport } from '../../agents/QAAgents';
import { Story } from '../../../types';
import { AssetRegistry } from '../../images/assetRegistry';
import { assembleStoryAssetsFromRegistry } from '../../images/storyAssetAssembler';
import { validateRegistryCoverage } from '../../images/coverageValidator';
import { StructuralValidator } from '../../validators';
import { walkStoryAssets, formatAssetWalkReport } from '../../validators/storyAssetWalker';
import { findUnsupportedQuotedRecallIssues } from '../../validators/quoteRecallValidator';
import { applyCraftAutofix } from '../../remediation/applyCraftAutofix';
import { gateEnabledPredicate } from '../../remediation/gateDefaults';
import { type RemediationLedgerRecord } from '../../remediation/remediationLedger';
import { collectMissingEncounterImageKeys } from '../../utils/encounterImageCoverage';
import { slugify as idSlugify } from '../../utils/idUtils';
import { PipelineError } from '../errors';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

// ========================================
// INPUT & DEPENDENCY TYPES
// ========================================

export interface AssemblyPhaseInput {
  brief: FullCreativeBrief;
  worldBible: WorldBible;
  characterBible: CharacterBible;
  episodeBlueprint: EpisodeBlueprint;
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  encounters: Map<string, EncounterStructure>;
  imageResults?: { beatImages: Map<string, string>; sceneImages: Map<string, string> };
  encounterImageResults?: {
    encounterImages: Map<string, {
      setupImages: Map<string, string>;
      outcomeImages: Map<string, { success?: string; complicated?: string; failure?: string }>;
    }>;
    storyletImages?: Map<string, Map<string, Map<string, string>>>;
  };
  storyCoverUrl?: string;
  videoResults?: Map<string, string>;
  outputDirectory?: string;
  /** Mutated in place when the deterministic scans escalate findings. */
  qaReport?: QAReport;
}

/**
 * Everything the phase still borrows from the monolith. assembleStory and
 * the manifest/template/scan helpers are shared with the multi-episode loop
 * and stay injected as closures; the asset registry is passed by reference.
 */
export interface AssemblyPhaseDeps {
  assetRegistry: AssetRegistry;
  assembleStory: (
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    encounters: Map<string, EncounterStructure>,
    imageResults?: AssemblyPhaseInput['imageResults'],
    encounterImageResults?: AssemblyPhaseInput['encounterImageResults'],
    storyCoverUrl?: string,
    videoResults?: Map<string, string>
  ) => Story;
  recordRemediationSafe: (
    record: Omit<RemediationLedgerRecord, 'timestamp' | 'runDir'> & { timestamp?: string; runDir?: string },
  ) => Promise<void>;
  resolveGeneratedStoryPlayerTemplates: (story: Story, brief: FullCreativeBrief) => Story;
  runFlagChronologyScan: (story: Story) => string[];
  saveDraftImageManifest: (outputDirectory: string | undefined, story: Story) => Promise<void>;
  buildImageManifestFromStory: (story: Story) => { imagesStatus: Story['imagesStatus'] };
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class AssemblyPhase {
  readonly name = 'assembly';

  constructor(private readonly deps: AssemblyPhaseDeps) {}

  /** Returns the assembled (and possibly auto-fixed) story for the caller to adopt. */
  async run(input: AssemblyPhaseInput, context: PipelineContext): Promise<Story> {
    const {
      brief,
      worldBible,
      characterBible,
      episodeBlueprint,
      sceneContents,
      choiceSets,
      encounters,
      imageResults,
      encounterImageResults,
      storyCoverUrl,
      videoResults,
      outputDirectory,
      qaReport,
    } = input;

    context.emit({ type: 'phase_start', phase: 'assembly', message: 'Phase 6: Assembling final story' });
    let story = this.deps.assembleStory(
      brief,
      worldBible,
      characterBible,
      episodeBlueprint,
      sceneContents,
      choiceSets,
      encounters,
      imageResults,
      encounterImageResults,
      storyCoverUrl,
      videoResults
    );
    story = assembleStoryAssetsFromRegistry(story, this.deps.assetRegistry);

    // === STRUCTURAL AUTO-FIX ===
    // Repair common structural issues (missing startingBeatId, broken nextBeatId,
    // empty beat text, malformed variants) before the completeness gate runs.
    if (story) {
      try {
        const structuralValidator = new StructuralValidator();
        const autoFixResult = structuralValidator.autoFix(story);
        story = autoFixResult.story;
        if (autoFixResult.fixedCount > 0) {
          context.addCheckpoint('structural_autofix', {
            fixedCount: autoFixResult.fixedCount,
            fixes: autoFixResult.fixes,
          });
          context.emit({
            type: 'pipeline_event',
            event: 'structural_autofix_applied',
            fixedCount: autoFixResult.fixedCount,
            fixes: autoFixResult.fixes,
          } as any);
          console.log(
            `[Pipeline] StructuralValidator.autoFix applied ${autoFixResult.fixedCount} repairs`
          );
        }
      } catch (autoFixError) {
        console.warn(
          `[Pipeline] StructuralValidator.autoFix failed (non-fatal): ${(autoFixError as Error).message}`
        );
      }
    }

    // === CRAFT AUTO-FIX ===
    // Deterministic, gated craft repairs (stat-check balance, choice impact,
    // NPC depth, arc endpoints, mechanics leakage). Each is individually
    // gated behind a GATE_* env flag; with no flags set this is a no-op, so
    // default pipeline behavior is unchanged.
    if (story) {
      try {
        const craftFix = applyCraftAutofix(story, gateEnabledPredicate);
        if (craftFix.fixedCount > 0) {
          context.addCheckpoint('craft_autofix', {
            fixedCount: craftFix.fixedCount,
            records: craftFix.records,
          });
          context.emit({
            type: 'pipeline_event',
            event: 'craft_autofix_applied',
            fixedCount: craftFix.fixedCount,
            records: craftFix.records,
          } as any);
          // S3: craft autofix is deterministic (no LLM cost) so it does NOT
          // debit the remediation budget; we still record it for observability.
          await this.deps.recordRemediationSafe({
            rule: 'craft_autofix',
            scope: 'autofix',
            attempted: craftFix.fixedCount,
            succeeded: true,
            degraded: false,
            blocked: false,
            attempts: 1,
            storyId: idSlugify(brief.story.title),
            details: `Applied craft autofix to ${craftFix.fixedCount} element(s)`,
          });
        }
      } catch (craftFixError) {
        console.warn(
          `[Pipeline] applyCraftAutofix failed (non-fatal): ${(craftFixError as Error).message}`
        );
      }
    }
    story = this.deps.resolveGeneratedStoryPlayerTemplates(story, brief);

    // === PRE-GENERATION COMPLETENESS GATE ===
    // Strict: ANY missing image halts the pipeline. No silent fallbacks.
    // Skipped in story-only mode, where images are deliberately deferred and
    // the draft ships with imagesStatus 'pending' (see saveDraftImageManifest
    // below) — the gate would otherwise fail every story-only generate().
    if (story && context.config.generation?.assetGenerationMode !== 'story-only') {
      const registryCoverage = validateRegistryCoverage(story, this.deps.assetRegistry);

      if (registryCoverage.missingRequiredCoverageKeys.length > 0) {
        console.error(
          `[Pipeline] REGISTRY COVERAGE GATE: ${registryCoverage.missingRequiredCoverageKeys.length} required slots unresolved`
        );
        throw new PipelineError(
          `Registry coverage gate failed: ${registryCoverage.missingRequiredCoverageKeys.length} required image slots unresolved`,
          'completeness_gate',
          {
            context: {
              outputDirectory,
              missingCount: registryCoverage.missingRequiredCoverageKeys.length,
              missingImages: registryCoverage.missingRequiredCoverageKeys.slice(0, 50),
              failureKind: 'image_completeness',
            },
          }
        );
      }

      const missingImages: { category: string; key: string }[] = [];

      if (!story.coverImage) missingImages.push({ category: 'cover', key: 'story-cover' });

      for (const episode of story.episodes || []) {
        if (!episode.coverImage) missingImages.push({ category: 'cover', key: `episode:${episode.id}` });

        for (const scene of episode.scenes || []) {
          if (!scene.backgroundImage) {
            missingImages.push({ category: 'scene-bg', key: `scene:${scene.id}` });
          }

          for (const beat of scene.beats || []) {
            if (!beat.image) {
              missingImages.push({ category: 'beat', key: `beat:${scene.id}::${beat.id}` });
            }
          }

          if (scene.encounter) {
            const missingEncKeys = collectMissingEncounterImageKeys(scene.id, scene.encounter);
            for (const k of missingEncKeys) {
              missingImages.push({ category: 'encounter', key: k });
            }

            for (const [outcomeName, storylet] of Object.entries((scene.encounter as any).storylets || {})) {
              const sl = storylet as any;
              for (const beat of sl?.beats || []) {
                if (!beat.image) {
                  missingImages.push({ category: 'storylet', key: `storylet:${scene.id}::${outcomeName}::${beat.id}` });
                }
              }
            }

            // NOTE (documented deviation): the original code had an
            // encounter-validation abort branch here that referenced
            // `encounterValidation` / `sceneBlueprint` from
            // runContentGeneration's scope — out of scope in generate(), a
            // latent ReferenceError under @ts-nocheck. Dropped; the real
            // encounter-validation abort runs at generation time.
          }
        }
      }

      if (missingImages.length > 0) {
        const byCategory: Record<string, { category: string; key: string }[]> = {};
        for (const m of missingImages) {
          if (!byCategory[m.category]) byCategory[m.category] = [];
          byCategory[m.category].push(m);
        }
        const summary = Object.entries(byCategory)
          .map(([cat, items]) => `${items.length} ${cat}`)
          .join(', ');

        console.error(`[Pipeline] COMPLETENESS GATE FAILED: ${missingImages.length} images missing (${summary})`);
        for (const [cat, items] of Object.entries(byCategory)) {
          for (const item of items.slice(0, 10)) {
            console.error(`[Pipeline]   [${cat}] ${item.key}`);
          }
        }

        throw new PipelineError(
          `Image completeness gate failed: ${missingImages.length} images missing (${summary})`,
          'completeness_gate',
          {
            context: {
              outputDirectory,
              totalMissing: missingImages.length,
              byCategory: Object.fromEntries(
                Object.entries(byCategory).map(([cat, items]) => [cat, items.map(i => i.key).slice(0, 20)])
              ),
              failureKind: 'image_completeness',
            },
          }
        );
      } else {
        console.log(`[Pipeline] PRE-GENERATION COMPLETENESS: 100% image coverage — all image types verified.`);
      }
    }

    // === ASSET HTTP VERIFICATION (Tier 1 QA) ===
    if (story && context.config.validation?.assetHttpCheck !== false) {
      try {
        const assetReport = await walkStoryAssets(story, {
          httpTimeoutMs: 5000,
          concurrency: 20,
        });
        console.log(`[Pipeline] ${formatAssetWalkReport(assetReport)}`);
        if (assetReport.missing + assetReport.broken + assetReport.unreachable > 0) {
          const failCount = assetReport.missing + assetReport.broken + assetReport.unreachable;
          context.emit({
            type: 'warning',
            phase: 'asset_verification',
            message: `Asset HTTP check: ${failCount} image(s) failed verification (${assetReport.missing} missing, ${assetReport.broken} broken, ${assetReport.unreachable} unreachable)`,
          });
          if (context.config.validation?.assetHttpCheckFailFast) {
            throw new PipelineError(
              `Asset HTTP verification failed: ${failCount} image(s) not reachable`,
              'completeness_gate',
              { context: { failCount, missing: assetReport.missing, broken: assetReport.broken, unreachable: assetReport.unreachable } }
            );
          }
        }
      } catch (err) {
        if (err instanceof PipelineError) throw err;
        console.warn('[Pipeline] Asset HTTP verification failed (non-fatal):', (err as Error).message);
      }
    }

    // === DETERMINISTIC FLAG CHRONOLOGY SCAN ===
    // Walk the assembled story to catch forward-reference paradoxes that the
    // LLM-based QA may have missed or mis-classified. Any violations become
    // criticalIssues on the QA report, which would have triggered the repair
    // loop had they been caught earlier.
    if (story && qaReport) {
      const flagIssues = this.deps.runFlagChronologyScan(story);
      if (flagIssues.length > 0) {
        for (const issue of flagIssues) {
          if (!qaReport.criticalIssues.includes(issue)) {
            qaReport.criticalIssues.push(issue);
          }
        }
        if (qaReport.criticalIssues.length > 0) {
          qaReport.passesQA = false;
        }
        context.emit({
          type: 'warning',
          phase: 'qa',
          message: `Deterministic flag chronology scan found ${flagIssues.length} forward-reference issue(s): ${flagIssues.join('; ')}`,
        });
      }

      const quoteRecallIssues = findUnsupportedQuotedRecallIssues(story);
      if (quoteRecallIssues.length > 0) {
        for (const issue of quoteRecallIssues) {
          if (!qaReport.criticalIssues.includes(issue.detail)) {
            qaReport.criticalIssues.push(issue.detail);
          }
        }
        qaReport.passesQA = false;
        context.emit({
          type: 'warning',
          phase: 'qa',
          message: `Deterministic quote recall scan found ${quoteRecallIssues.length} unsupported recalled quote(s): ${quoteRecallIssues.map(issue => issue.quote).join('; ')}`,
        });
      }
    }

    if (story && context.config.generation?.assetGenerationMode === 'story-only') {
      story.imagesStatus = 'pending';
      if (outputDirectory) await this.deps.saveDraftImageManifest(outputDirectory, story);
    } else if (story && context.config.imageGen?.enabled) {
      story.imagesStatus = this.deps.buildImageManifestFromStory(story).imagesStatus;
    }

    return story;
  }
}
