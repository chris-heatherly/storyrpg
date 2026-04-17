#!/usr/bin/env npx ts-node --esm
/**
 * CLI: validate-assets
 *
 * Usage:
 *   npm run validate:assets -- <story-dir-or-json>
 *
 * Examples:
 *   npm run validate:assets -- generated-stories/blade-runner-defector_2026-04-14T16-51-56
 *   npm run validate:assets -- generated-stories/blade-runner-defector_2026-04-14T16-51-56/08-final-story.json
 */

import path from 'path';
import fs from 'fs';
import { walkStoryAssetsFromFile, formatAssetWalkReport } from '../src/ai-agents/validators/storyAssetWalker';

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: validate-assets <story-dir-or-json>');
    process.exit(1);
  }

  let jsonPath = target;
  if (fs.statSync(target).isDirectory()) {
    jsonPath = path.join(target, '08-final-story.json');
  }

  if (!fs.existsSync(jsonPath)) {
    console.error(`File not found: ${jsonPath}`);
    process.exit(1);
  }

  console.log(`Validating assets in: ${jsonPath}\n`);

  const report = await walkStoryAssetsFromFile(jsonPath);
  console.log(formatAssetWalkReport(report));

  if (report.missing + report.broken + report.unreachable > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
