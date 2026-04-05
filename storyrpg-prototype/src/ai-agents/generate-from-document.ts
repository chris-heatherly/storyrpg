#!/usr/bin/env npx ts-node --esm
/**
 * Generate Story from Document
 *
 * CLI tool that reads a story brief document and generates a complete
 * interactive story using the AI pipeline.
 */

import * as path from 'path';
import { parseDocument } from './utils/documentParser';
import { PipelineConfig, defaultValidationConfig } from './config';
import { storyToTypeScript, getStoryFileName, formatStoryStats } from './utils/storyExporter';
import { runStoryGeneration } from './services/storyGenerationService';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log('');
  log(`${'═'.repeat(50)}`, 'cyan');
  log(`  ${title}`, 'bright');
  log(`${'═'.repeat(50)}`, 'cyan');
}

async function main() {
  // Use eval('require') to hide Node.js modules from mobile bundlers
  const req = typeof eval !== 'undefined' ? eval('require') : undefined;
  if (typeof req !== 'function') {
    throw new Error('Node.js environment required for CLI tools');
  }
  
  const cliFs = req('fs').promises;

  logSection('STORYRPG AI GENERATOR - FROM DOCUMENT');

  // Get document path from command line arguments
  const args = process.argv.slice(2);
  let documentPath = '';
  let artStyle = process.env.ART_STYLE;

  // Simple argument parsing
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--art-style' && i + 1 < args.length) {
      artStyle = args[i + 1];
      i++;
    } else if (args[i] === '--template') {
      // Handled below
    } else if (!documentPath && !args[i].startsWith('--')) {
      documentPath = args[i];
    }
  }

  if (args.length === 0 || (!documentPath && !args.includes('--template'))) {
    log('\nUsage: npx ts-node --esm src/ai-agents/generate-from-document.ts <document-path> [--art-style "your style"]', 'yellow');
    log('\nExample:', 'dim');
    log('  npx ts-node --esm src/ai-agents/generate-from-document.ts ./my-story-brief.md --art-style "Cinematic Sci-Fi"', 'dim');
    log('\nOr use npm script:', 'dim');
    log('  npm run generate:doc -- ./my-story-brief.md --art-style "Studio Ghibli"', 'dim');
    log('\nDocument Template:', 'yellow');
    log('  Run with --template to see an example document format', 'dim');
    process.exit(1);
  }

  // Check for template flag
  if (args.includes('--template')) {
    logSection('DOCUMENT TEMPLATE');
    console.log(`
# My Story Title

## Genre
Fantasy Adventure

## Synopsis
A young adventurer discovers an ancient artifact that changes everything.
The fate of the kingdom rests in their hands.

## Tone
Epic, mysterious, with moments of levity

## Themes
- destiny
- sacrifice
- friendship

## World
A medieval fantasy realm where magic is fading from the world.
Time Period: High Medieval
Technology: Medieval with fading magic

## Protagonist
Name: Kira
Description: A resourceful young herbalist with untapped magical potential.
Pronouns: she/her

## Characters
- The Mentor: An aging wizard who sees potential in the protagonist
- The Rival: A jealous noble who seeks the artifact for themselves
- The Guide: A mysterious traveler with knowledge of the old ways

## Locations
- The Village: A quiet hamlet on the edge of the Whispering Woods
- The Ruins: Ancient temple where the artifact was found
- The Capital: A grand city where power players scheme

## Episode
Title: The Discovery
Synopsis: Strange lights in the forest lead to a life-changing find.
`);
    log('\nSave this template to a .md file and modify it for your story.', 'green');
    process.exit(0);
  }

  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log('\nError: ANTHROPIC_API_KEY environment variable is required', 'red');
    log('Set it with: export ANTHROPIC_API_KEY=your-api-key', 'dim');
    process.exit(1);
  }

  // Read document
  log(`\nReading document: ${documentPath}`, 'cyan');
  if (artStyle) {
    log(`Art Style: ${artStyle}`, 'magenta');
  }

  let content: string;
  try {
    const fullPath = path.resolve(documentPath);
    content = await cliFs.readFile(fullPath, 'utf-8');
    log(`  Document loaded (${content.length} characters)`, 'green');
  } catch (err) {
    log(`\nError: Could not read file: ${documentPath}`, 'red');
    log(`  ${err instanceof Error ? err.message : String(err)}`, 'dim');
    process.exit(1);
  }

  // Parse document
  log('\nParsing document...', 'cyan');
  const fileName = path.basename(documentPath);
  const parseResult = parseDocument(content, fileName);

  if (!parseResult.success || !parseResult.brief) {
    log(`\nError: Failed to parse document`, 'red');
    log(`  ${parseResult.error}`, 'dim');
    process.exit(1);
  }

  log(`  Title: ${parseResult.document?.title || 'Unknown'}`, 'green');
  log(`  Genre: ${parseResult.document?.genre || 'Unknown'}`, 'green');
  log(`  Protagonist: ${parseResult.document?.protagonistName || 'Unknown'}`, 'green');

  if (parseResult.warnings.length > 0) {
    log('\nWarnings:', 'yellow');
    parseResult.warnings.forEach(warning => {
      log(`  - ${warning}`, 'yellow');
    });
  }

  // Create pipeline config
  const config: PipelineConfig = {
    agents: {
      storyArchitect: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey,
        maxTokens: 4096,
        temperature: 0.7,
      },
      sceneWriter: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey,
        maxTokens: 4096,
        temperature: 0.85,
      },
      choiceAuthor: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey,
        maxTokens: 4096,
        temperature: 0.75,
      },
    },
    validation: defaultValidationConfig,
    debug: true,
    outputDir: './generated',
    artStyle: artStyle,
  };

  // Create pipeline
  logSection('STARTING GENERATION');

  // Set up event listener
  const handleEvent = (event: any) => {
    const timestamp = event.timestamp.toLocaleTimeString();

    switch (event.type) {
      case 'phase_start':
        log(`\n[${timestamp}] Starting: ${event.phase}`, 'cyan');
        break;
      case 'phase_complete':
        log(`[${timestamp}] Completed: ${event.phase}`, 'green');
        break;
      case 'agent_start':
        log(`  → ${event.agent}: ${event.message}`, 'dim');
        break;
      case 'agent_complete':
        log(`  ✓ ${event.agent} completed`, 'green');
        break;
      case 'error':
        log(`[${timestamp}] Error: ${event.message}`, 'red');
        break;
      case 'checkpoint':
        log(`[${timestamp}] Checkpoint: ${event.message}`, 'yellow');
        break;
    }
  };

  // Run generation
  log(`\nGenerating story: "${parseResult.brief.story.title}"`, 'bright');

  try {
    const { result } = await runStoryGeneration({
      config,
      brief: parseResult.brief,
      onEvent: handleEvent,
    });

    if (result.success && result.story) {
      logSection('GENERATION COMPLETE');

      log('\nStory Stats:', 'green');
      log(formatStoryStats(result.story), 'dim');

      // Export to TypeScript
      const outputDir = './generated';
      try {
        await cliFs.mkdir(outputDir, { recursive: true });
      } catch {
        // Directory exists
      }

      const fileName = getStoryFileName(result.story);
      const filePath = path.join(outputDir, fileName);
      const tsCode = storyToTypeScript(result.story);

      await cliFs.writeFile(filePath, tsCode, 'utf-8');
      log(`\nStory saved to: ${filePath}`, 'green');

      // Also save as JSON for easy inspection
      const jsonPath = path.join(outputDir, fileName.replace('.ts', '.json'));
      await cliFs.writeFile(jsonPath, JSON.stringify(result.story, null, 2), 'utf-8');
      log(`JSON saved to: ${jsonPath}`, 'green');

      log('\nGeneration completed successfully!', 'bright');
    } else {
      log(`\nGeneration failed: ${result.error}`, 'red');
      process.exit(1);
    }
  } catch (err) {
    log(`\nGeneration error: ${err instanceof Error ? err.message : String(err)}`, 'red');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
