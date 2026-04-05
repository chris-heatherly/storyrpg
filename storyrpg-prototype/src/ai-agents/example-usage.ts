/**
 * Example Usage of the AI Agent Pipeline
 *
 * This script demonstrates how to use the Full Story Pipeline
 * to generate story content from a creative brief.
 *
 * Run with: npm run generate
 */

import { FullCreativeBrief, PipelineEvent } from './pipeline/FullStoryPipeline';
import {
  storyToTypeScript,
  getStoryFileName,
  validateStoryForExport,
  formatStoryStats,
  generateIndexExport,
} from './utils/storyExporter';
import { runStoryGeneration } from './services/storyGenerationService';

// Example creative brief for "The Velvet Job"
const heistBrief: FullCreativeBrief = {
  story: {
    title: 'The Velvet Job',
    genre: 'Heist Thriller',
    synopsis: 'A master thief assembles a crew for one last impossible heist: stealing the legendary Celestine Diamond from the most secure museum in the world.',
    tone: 'Tense, stylish, morally gray with moments of dark humor',
    themes: ['loyalty', 'greed', 'redemption', 'trust'],
  },

  world: {
    premise: 'Modern day, fictional city where high-tech security meets old-school thievery. The underworld has rules, and breaking them has consequences.',
    timePeriod: 'Present day',
    technologyLevel: 'Modern with advanced security systems',
    keyLocations: [
      {
        id: 'hartwell-museum',
        name: 'Hartwell Museum',
        type: 'building',
        description: 'The city\'s premier art museum, housing priceless artifacts behind state-of-the-art security.',
        importance: 'major',
      },
      {
        id: 'the-van',
        name: 'The Van',
        type: 'vehicle',
        description: 'A nondescript van serving as mobile command center for the heist.',
        importance: 'major',
      },
      {
        id: 'velvet-den',
        name: 'The Velvet Den',
        type: 'building',
        description: 'A hidden speakeasy where the underworld conducts business.',
        importance: 'minor',
      },
    ],
  },

  protagonist: {
    id: 'alex',
    name: 'Alex',
    pronouns: 'he/him',
    description: 'A legendary thief known for impossible jobs. Smart, calculating, but haunted by a job that went wrong years ago.',
    role: 'crew leader',
  },

  npcs: [
    {
      id: 'jules',
      name: 'Jules Chen',
      role: 'ally',
      description: 'Tech specialist and hacker. Young, brilliant, with a dry wit that masks genuine anxiety.',
      importance: 'major',
      relationshipToProtagonist: 'Trusted partner for 3 years',
    },
    {
      id: 'marcus',
      name: 'Marcus Webb',
      role: 'ally',
      description: 'Former military, handles security and extraction. Stoic, professional, hiding a gambling debt.',
      importance: 'major',
      relationshipToProtagonist: 'New to the crew, still earning trust',
    },
    {
      id: 'victoria',
      name: 'Victoria Ashworth',
      role: 'neutral',
      description: 'Museum curator and inside contact. Upper class, sophisticated, but drowning in debt.',
      importance: 'supporting',
      relationshipToProtagonist: 'Uneasy alliance, mutual distrust',
    },
  ],

  episode: {
    number: 1,
    title: 'The Briefing',
    synopsis: 'The night of the heist has arrived. Final preparations, crew tensions, and the first steps into danger.',
    startingLocation: 'the-van',
  },

  options: {
    targetSceneCount: 5,
    majorChoiceCount: 2,
    runQA: true,
    qaThreshold: 70,
  },
};

// Example creative brief for a fantasy story
const fantasyBrief: FullCreativeBrief = {
  story: {
    title: 'Shadows of Ravenmoor',
    genre: 'Dark Fantasy Mystery',
    synopsis: 'A disgraced inquisitor returns to their hometown to investigate a series of disappearances, only to uncover a conspiracy that reaches into their own past.',
    tone: 'Gothic, atmospheric, morally complex with supernatural horror elements',
    themes: ['redemption', 'faith', 'secrets', 'homecoming'],
  },

  world: {
    premise: 'A late medieval world where magic is real but feared. The Church maintains order through Inquisitors.',
    timePeriod: 'Late medieval fantasy',
    technologyLevel: 'Medieval with magical elements',
    magicSystem: 'Magic is inherited and feared. Inquisitors can sense it but using it is heresy.',
    keyLocations: [
      {
        id: 'ravenmoor-gate',
        name: 'Ravenmoor Gate',
        type: 'landmark',
        description: 'The ancient stone gateway into town, covered in protective wards.',
        importance: 'major',
      },
      {
        id: 'blackwood-tavern',
        name: 'The Blackwood Tavern',
        type: 'building',
        description: 'The town\'s only inn and tavern, run by an old friend.',
        importance: 'major',
      },
      {
        id: 'old-church',
        name: 'St. Aldric\'s Church',
        type: 'building',
        description: 'The ancient church at the town center, its bell tower watching over all.',
        importance: 'minor',
      },
    ],
  },

  protagonist: {
    id: 'morgan',
    name: 'Morgan',
    pronouns: 'she/her',
    description: 'A former Inquisitor stripped of rank for showing mercy. Carries guilt and a secret: she can sense magic.',
    role: 'investigator',
  },

  npcs: [
    {
      id: 'father-aldric',
      name: 'Father Aldric',
      role: 'ally',
      description: 'The town priest. Kind-faced but weary. He sent the letter requesting help.',
      importance: 'major',
      relationshipToProtagonist: 'Former mentor, like a father figure',
    },
    {
      id: 'sera',
      name: 'Sera Blackwood',
      role: 'neutral',
      description: 'Morgan\'s childhood friend who stayed in Ravenmoor. Now runs the tavern.',
      importance: 'major',
      relationshipToProtagonist: 'Former best friends, complicated by abandonment',
    },
    {
      id: 'lord-vance',
      name: 'Lord Edmund Vance',
      role: 'antagonist',
      description: 'Local noble. Charming, politically savvy, deeply invested in keeping secrets.',
      importance: 'supporting',
      relationshipToProtagonist: 'Knew Morgan as a child, now wary of her',
    },
  ],

  episode: {
    number: 1,
    title: 'Homecoming',
    synopsis: 'After years in exile, Morgan returns to Ravenmoor. Old faces, old wounds, and the first signs that something is terribly wrong.',
    startingLocation: 'ravenmoor-gate',
  },

  options: {
    targetSceneCount: 5,
    majorChoiceCount: 2,
    runQA: true,
    qaThreshold: 70,
  },
};

async function runExample() {
  // Use eval('require') to hide Node.js modules from mobile bundlers
  const req = typeof eval !== 'undefined' ? eval('require') : undefined;
  if (typeof req !== 'function') {
    throw new Error('Node.js environment required for CLI tools');
  }
  
  // Safe loading of Node modules
  const cliFs = req('fs');
  const nodePath = req('path');

  console.log('='.repeat(60));
  console.log('AI Agent Pipeline - Full Story Generation');
  console.log('='.repeat(60));

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('\n❌ Error: No API key found!');
    console.log('Please set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.');
    process.exit(1);
  }

  // Set up event monitoring
  const handleEvent = (event: PipelineEvent) => {
    const prefix = getEventPrefix(event.type);
    console.log(`${prefix} ${event.message}`);
  };

  // Choose which brief to run based on env var or default to heist
  const storyType = process.env.STORY_TYPE || 'heist';
  const brief = storyType === 'fantasy' ? fantasyBrief : heistBrief;

  console.log(`\n📖 Generating: "${brief.story.title}"`);
  console.log(`   Episode ${brief.episode.number}: "${brief.episode.title}"`);
  console.log('-'.repeat(60));

  const startTime = Date.now();

  // Run the pipeline
  const { result } = await runStoryGeneration({
    brief,
    onEvent: handleEvent,
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Output results
  console.log('\n' + '='.repeat(60));

  if (result.success && result.story) {
    console.log('✅ Story generated successfully!');
    console.log(`⏱  Duration: ${duration}s`);
    console.log('');

    // Validate before export
    const validation = validateStoryForExport(result.story);
    if (!validation.valid) {
      console.log('⚠️  Validation warnings:');
      validation.errors.forEach(err => console.log(`   - ${err}`));
      console.log('');
    }

    // Print stats
    console.log(formatStoryStats(result.story));
    console.log('');

    // Generate TypeScript file
    const tsContent = storyToTypeScript(result.story);
    const fileName = getStoryFileName(result.story);
    const outputPath = nodePath.join(__dirname, '..', 'data', 'stories', fileName);

    // Ensure directory exists
    const outputDir = nodePath.dirname(outputPath);
    if (!cliFs.existsSync(outputDir)) {
      cliFs.mkdirSync(outputDir, { recursive: true });
    }

    // Write TypeScript file
    cliFs.writeFileSync(outputPath, tsContent);
    console.log(`📁 Saved to: ${outputPath}`);

    // Also save raw JSON for debugging
    const jsonPath = outputPath.replace('.ts', '.json');
    cliFs.writeFileSync(jsonPath, JSON.stringify(result.story, null, 2));
    console.log(`📁 Debug JSON: ${jsonPath}`);

    // Print index export line
    console.log('\n📋 Add this to src/data/stories/index.ts:');
    console.log(`   ${generateIndexExport(result.story)}`);

  } else {
    console.log('❌ Story generation failed!');
    console.log(`Error: ${result.error}`);
  }

  console.log('\n' + '='.repeat(60));
}

function getEventPrefix(type: string): string {
  switch (type) {
    case 'phase_start':
      return '\n🚀';
    case 'phase_complete':
      return '✅';
    case 'agent_start':
      return '  🤖';
    case 'agent_complete':
      return '  ✓ ';
    case 'checkpoint':
      return '⏸️ ';
    case 'error':
      return '❌';
    default:
      return '  •';
  }
}

// Run if executed directly
runExample().catch(console.error);
