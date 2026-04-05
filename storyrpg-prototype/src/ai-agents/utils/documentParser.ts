/**
 * Document Parser
 *
 * Parses documents (markdown, text, JSON, PDF) to extract story brief information
 * for the AI story generation pipeline.
 */

import { FullCreativeBrief } from '../pipeline/FullStoryPipeline';

// Dynamic import for pdfjs-dist
let pdfjsLib: any;

/**
 * Get PDF.js library instance, initializing it once if needed.
 */
async function getPdfjsLib() {
  if (!pdfjsLib) {
    try {
      // Use dynamic import to avoid bundling Node.js dependencies if not needed
      pdfjsLib = await import('pdfjs-dist');
      // Configure PDF.js worker
      if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
      }
    } catch (err) {
      console.warn('[DocumentParser] Failed to load pdfjs-dist:', err);
      return null;
    }
  }
  return pdfjsLib;
}

export interface ParsedDocument {
  title?: string;
  genre?: string;
  synopsis?: string;
  tone?: string;
  themes?: string[];
  worldPremise?: string;
  timePeriod?: string;
  technologyLevel?: string;
  protagonistName?: string;
  protagonistDescription?: string;
  protagonistPronouns?: 'he/him' | 'she/her' | 'they/them';
  npcs?: Array<{
    name: string;
    role: string;
    description: string;
  }>;
  locations?: Array<{
    name: string;
    type: string;
    description: string;
  }>;
  episodeTitle?: string;
  episodeSynopsis?: string;
  rawContent: string;
}

export interface DocumentParseResult {
  success: boolean;
  document?: ParsedDocument;
  brief?: FullCreativeBrief;
  error?: string;
  warnings: string[];
}

/**
 * Parse a document and extract story brief information.
 * Supports markdown, plain text, and JSON formats.
 */
export function parseDocument(content: string, fileName?: string): DocumentParseResult {
  const warnings: string[] = [];

  console.log(`[DocumentParser] Parsing document: ${fileName || 'unnamed'} (${content.length} chars)`);

  if (!content || content.trim().length === 0) {
    return {
      success: false,
      error: 'Document is empty',
      warnings: [],
    };
  }

  // Detect format based on content or file extension
  const isJson = content.trim().startsWith('{') || fileName?.endsWith('.json');
  const isMarkdown = fileName?.endsWith('.md') || content.includes('# ') || content.includes('## ');

  let parsed: ParsedDocument;

  try {
    if (isJson) {
      parsed = parseJsonDocument(content);
    } else if (isMarkdown) {
      parsed = parseMarkdownDocument(content);
    } else {
      parsed = parsePlainTextDocument(content);
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to parse document: ${err instanceof Error ? err.message : String(err)}`,
      warnings: [],
    };
  }

  // Validate required fields - try harder to find a title
  if (!parsed.title) {
    // Try to extract title from first line that looks like a title
    const titleFromContent = extractTitleFromContent(parsed.rawContent);
    if (titleFromContent) {
      parsed.title = titleFromContent;
      warnings.push(`Title extracted from content: "${titleFromContent}"`);
    } else {
      warnings.push('No title found - using "Untitled Story"');
      parsed.title = 'Untitled Story';
    }
  }

  // Clean up the title - remove quotes, extra whitespace, file extension patterns
  parsed.title = cleanTitle(parsed.title);

  if (!parsed.genre) {
    warnings.push('No genre found - using "Adventure"');
    parsed.genre = 'Adventure';
  }

  if (!parsed.synopsis) {
    warnings.push('No synopsis found - generating from content');
    parsed.synopsis = extractSynopsisFromContent(parsed.rawContent);
  }

  // Debug: Log parsed document summary
  console.log(`[DocumentParser] Parsed document:`, {
    title: parsed.title,
    genre: parsed.genre,
    locationsCount: parsed.locations?.length || 0,
    npcsCount: parsed.npcs?.length || 0,
    locationNames: parsed.locations?.map(l => l.name) || [],
  });

  // Convert to FullCreativeBrief
  const brief = documentToBrief(parsed);

  // Debug: Log brief summary
  console.log(`[DocumentParser] Created brief:`, {
    startingLocation: brief.episode.startingLocation,
    keyLocationsCount: brief.world.keyLocations.length,
    keyLocationIds: brief.world.keyLocations.map(l => l.id),
  });

  return {
    success: true,
    document: parsed,
    brief,
    warnings,
  };
}

/**
 * Parse a JSON document into story brief format
 */
function parseJsonDocument(content: string): ParsedDocument {
  const json = JSON.parse(content);

  return {
    title: json.title || json.storyTitle || json.name,
    genre: json.genre || json.storyGenre,
    synopsis: json.synopsis || json.description || json.summary,
    tone: json.tone || json.atmosphere,
    themes: json.themes || json.mainThemes,
    worldPremise: json.worldPremise || json.world?.premise || json.setting,
    timePeriod: json.timePeriod || json.world?.timePeriod || json.era,
    technologyLevel: json.technologyLevel || json.world?.technology || json.techLevel,
    protagonistName: json.protagonist?.name || json.mainCharacter?.name || json.playerName,
    protagonistDescription: json.protagonist?.description || json.mainCharacter?.description,
    protagonistPronouns: json.protagonist?.pronouns || json.mainCharacter?.pronouns || 'he/him',
    npcs: json.npcs || json.characters || json.supportingCharacters,
    locations: json.locations || json.world?.locations || json.places,
    episodeTitle: json.episode?.title || json.firstEpisode?.title || json.episodeTitle,
    episodeSynopsis: json.episode?.synopsis || json.firstEpisode?.synopsis || json.episodeSynopsis,
    rawContent: content,
  };
}

/**
 * Parse a markdown document into story brief format
 */
function parseMarkdownDocument(content: string): ParsedDocument {
  const lines = content.split('\n');
  const parsed: ParsedDocument = { rawContent: content };

  let currentSection = '';
  let currentContent: string[] = [];

  const sectionPatterns: Record<string, RegExp> = {
    title: /^#\s+(.+)$|^title:\s*(.+)$/i,
    genre: /^##?\s*genre|^genre:\s*/i,
    synopsis: /^##?\s*(synopsis|summary|overview|description)/i,
    tone: /^##?\s*tone|^tone:\s*/i,
    themes: /^##?\s*themes/i,
    world: /^##?\s*(world|setting|premise)/i,
    protagonist: /^##?\s*(protagonist|main character|player)/i,
    characters: /^##?\s*(characters|npcs|cast)/i,
    locations: /^##?\s*(locations|places|settings)/i,
    episode: /^##?\s*(episode|chapter|act)/i,
  };

  for (const line of lines) {
    // Check for title (first h1)
    const titleMatch = line.match(/^#\s+(.+)$/);
    if (titleMatch && !parsed.title) {
      parsed.title = titleMatch[1].trim();
      continue;
    }

    // Check for section headers
    let foundSection = false;
    for (const [section, pattern] of Object.entries(sectionPatterns)) {
      if (pattern.test(line)) {
        // Save previous section content
        if (currentSection && currentContent.length > 0) {
          assignSectionContent(parsed, currentSection, currentContent.join('\n'));
        }
        currentSection = section;
        currentContent = [];
        foundSection = true;
        break;
      }
    }

    if (!foundSection && currentSection) {
      currentContent.push(line);
    }

    // Check for inline key:value pairs
    const kvMatch = line.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      assignKeyValue(parsed, key.toLowerCase(), value.trim());
    }
  }

  // Save last section
  if (currentSection && currentContent.length > 0) {
    assignSectionContent(parsed, currentSection, currentContent.join('\n'));
  }

  return parsed;
}

/**
 * Parse a plain text document into story brief format
 */
function parsePlainTextDocument(content: string): ParsedDocument {
  const lines = content.split('\n').filter(line => line.trim());
  const parsed: ParsedDocument = { rawContent: content };

  // Try to extract key information from plain text
  for (const line of lines) {
    const kvMatch = line.match(/^(\w+[\w\s]*):\s*(.+)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      assignKeyValue(parsed, key.toLowerCase().trim(), value.trim());
    }
  }

  // Use first substantial line as title if not found
  if (!parsed.title && lines.length > 0) {
    parsed.title = lines[0].substring(0, 100);
  }

  // Use document content as synopsis if not found
  if (!parsed.synopsis) {
    parsed.synopsis = content.substring(0, 500);
  }

  return parsed;
}

/**
 * Assign content to a parsed section
 */
function assignSectionContent(parsed: ParsedDocument, section: string, content: string): void {
  const trimmed = content.trim();

  switch (section) {
    case 'synopsis':
      parsed.synopsis = trimmed;
      break;
    case 'tone':
      parsed.tone = trimmed;
      break;
    case 'themes':
      parsed.themes = trimmed.split(/[,\n]/).map(t => t.trim()).filter(Boolean);
      break;
    case 'world':
      parsed.worldPremise = trimmed;
      // Try to extract time period and tech level
      const timeMatch = trimmed.match(/time period[:\s]+([^.\n]+)/i);
      if (timeMatch) parsed.timePeriod = timeMatch[1].trim();
      const techMatch = trimmed.match(/technology[:\s]+([^.\n]+)/i);
      if (techMatch) parsed.technologyLevel = techMatch[1].trim();
      break;
    case 'protagonist':
      // Extract protagonist info
      const nameMatch = trimmed.match(/name[:\s]+([^.\n]+)/i);
      if (nameMatch) parsed.protagonistName = nameMatch[1].trim();
      const descMatch = trimmed.match(/description[:\s]+(.+)/i);
      if (descMatch) parsed.protagonistDescription = descMatch[1].trim();
      if (!parsed.protagonistDescription) {
        parsed.protagonistDescription = trimmed;
      }
      break;
    case 'characters':
      parsed.npcs = parseCharacterList(trimmed);
      break;
    case 'locations':
      parsed.locations = parseLocationList(trimmed);
      break;
    case 'episode':
      const epTitleMatch = trimmed.match(/title[:\s]+([^.\n]+)/i);
      if (epTitleMatch) parsed.episodeTitle = epTitleMatch[1].trim();
      const epSynMatch = trimmed.match(/synopsis[:\s]+(.+)/i);
      if (epSynMatch) parsed.episodeSynopsis = epSynMatch[1].trim();
      if (!parsed.episodeSynopsis) {
        parsed.episodeSynopsis = trimmed;
      }
      break;
  }
}

/**
 * Assign a key-value pair to parsed document
 */
function assignKeyValue(parsed: ParsedDocument, key: string, value: string): void {
  switch (key) {
    case 'title':
    case 'story title':
    case 'name':
      parsed.title = value;
      break;
    case 'genre':
      parsed.genre = value;
      break;
    case 'synopsis':
    case 'summary':
    case 'description':
      parsed.synopsis = value;
      break;
    case 'tone':
    case 'atmosphere':
      parsed.tone = value;
      break;
    case 'themes':
      parsed.themes = value.split(/[,;]/).map(t => t.trim());
      break;
    case 'setting':
    case 'world':
    case 'premise':
      parsed.worldPremise = value;
      break;
    case 'time period':
    case 'era':
      parsed.timePeriod = value;
      break;
    case 'technology':
    case 'tech level':
      parsed.technologyLevel = value;
      break;
    case 'protagonist':
    case 'main character':
    case 'player name':
      parsed.protagonistName = value;
      break;
    case 'episode':
    case 'episode title':
    case 'chapter':
      parsed.episodeTitle = value;
      break;
  }
}

/**
 * Parse a character list from text
 */
function parseCharacterList(content: string): Array<{ name: string; role: string; description: string }> {
  const characters: Array<{ name: string; role: string; description: string }> = [];
  const lines = content.split('\n').filter(line => line.trim());

  for (const line of lines) {
    // Try to match "- Name: Description" or "* Name - Description"
    const match = line.match(/^[-*]\s*([^:–-]+)[:\s–-]+(.+)$/);
    if (match) {
      characters.push({
        name: match[1].trim(),
        role: 'supporting',
        description: match[2].trim(),
      });
    }
  }

  return characters;
}

/**
 * Parse a location list from text
 */
function parseLocationList(content: string): Array<{ name: string; type: string; description: string }> {
  const locations: Array<{ name: string; type: string; description: string }> = [];
  const lines = content.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const match = line.match(/^[-*]\s*([^:–-]+)[:\s–-]+(.+)$/);
    if (match) {
      locations.push({
        name: match[1].trim(),
        type: 'location',
        description: match[2].trim(),
      });
    }
  }

  return locations;
}

/**
 * Clean up a title string - remove common artifacts
 */
function cleanTitle(title: string): string {
  return title
    // Remove file extension patterns
    .replace(/\.(txt|md|pdf|json|doc|docx)$/i, '')
    // Remove leading/trailing quotes
    .replace(/^["']|["']$/g, '')
    // Remove multiple spaces
    .replace(/\s+/g, ' ')
    // Trim
    .trim()
    // Capitalize first letter of each word if all lowercase
    || 'Untitled Story';
}

/**
 * Try to extract a title from document content using various heuristics
 */
function extractTitleFromContent(content: string): string | null {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Strategy 1: Look for markdown h1 (# Title)
  for (const line of lines.slice(0, 10)) {
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      return h1Match[1].trim();
    }
  }

  // Strategy 2: Look for "Title:" or "Story:" key-value pair
  for (const line of lines.slice(0, 20)) {
    const titleMatch = line.match(/^(?:title|story|name):\s*(.+)$/i);
    if (titleMatch && titleMatch[1].length > 2 && titleMatch[1].length < 100) {
      return titleMatch[1].trim();
    }
  }

  // Strategy 3: Look for ALL CAPS line (common for titles)
  for (const line of lines.slice(0, 5)) {
    if (line.length > 3 && line.length < 80 && line === line.toUpperCase() && /[A-Z]/.test(line)) {
      // Convert to title case
      return line.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  // Strategy 4: Use first short line that looks like a title (not a sentence)
  for (const line of lines.slice(0, 5)) {
    // Good title candidates: short, don't end with period, not too long
    if (line.length > 3 && line.length < 60 && !line.endsWith('.') && !line.includes(':')) {
      return line;
    }
  }

  return null;
}

/**
 * Extract a synopsis from raw content
 */
function extractSynopsisFromContent(content: string): string {
  // Take first meaningful paragraph
  const paragraphs = content.split(/\n\n+/).filter(p => {
    const trimmed = p.trim();
    return trimmed.length > 50 && !trimmed.startsWith('#');
  });

  if (paragraphs.length > 0) {
    return paragraphs[0].substring(0, 500).trim();
  }

  return 'An interactive story awaits.';
}

/**
 * Convert parsed document to FullCreativeBrief
 */
function documentToBrief(doc: ParsedDocument): FullCreativeBrief {
  // Build locations - use document locations if provided, otherwise leave empty for AI to generate
  const hasLocations = doc.locations && doc.locations.length > 0;
  let keyLocations: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    importance: 'major' | 'minor' | 'backdrop';
  }>;

  if (hasLocations) {
    // Use locations from document
    keyLocations = doc.locations!.map((loc, i) => ({
      id: `location-${i + 1}`,
      name: loc.name,
      type: loc.type || 'location',
      description: loc.description,
      importance: (i === 0 ? 'major' : 'minor') as 'major' | 'minor' | 'backdrop',
    }));
  } else {
    // No locations provided - WorldBuilder will generate them based on story context
    keyLocations = [];
  }

  // Build NPCs - use document NPCs if provided, otherwise leave empty for AI to generate
  const hasNpcs = doc.npcs && doc.npcs.length > 0;
  let npcs: Array<{
    id: string;
    name: string;
    role: 'ally' | 'antagonist' | 'neutral';
    description: string;
    importance: 'major' | 'supporting' | 'minor';
    relationshipToProtagonist: string;
  }>;

  if (hasNpcs) {
    npcs = doc.npcs!.map((npc, i) => ({
      id: `npc-${i + 1}`,
      name: npc.name,
      role: (npc.role || 'neutral') as 'ally' | 'antagonist' | 'neutral',
      description: npc.description,
      importance: (i === 0 ? 'major' : 'supporting') as 'major' | 'supporting' | 'minor',
      relationshipToProtagonist: npc.role === 'ally' ? 'Trusted companion' : npc.role === 'antagonist' ? 'Adversary' : 'Acquaintance',
    }));
  } else {
    // No NPCs provided - CharacterDesigner will generate them based on story context
    npcs = [];
  }

  // Starting location - use first location if available, otherwise AI will determine
  const startingLocationId = hasLocations ? 'location-1' : '';

  return {
    story: {
      title: doc.title || 'Untitled Story',
      genre: doc.genre || 'Adventure',
      synopsis: doc.synopsis || 'An interactive story.',
      tone: doc.tone || 'Engaging and immersive',
      themes: doc.themes || ['adventure', 'choice', 'consequence'],
    },
    world: {
      premise: doc.worldPremise || 'A world of mystery and adventure.',
      timePeriod: doc.timePeriod || 'Contemporary',
      technologyLevel: doc.technologyLevel || 'Modern',
      keyLocations,
    },
    protagonist: {
      id: 'protagonist',
      name: doc.protagonistName || 'The Hero',
      pronouns: doc.protagonistPronouns || 'he/him',
      description: doc.protagonistDescription || 'The protagonist of our story.',
      role: 'protagonist',
    },
    npcs,
    episode: {
      number: 1,
      title: doc.episodeTitle || 'Chapter One',
      synopsis: doc.episodeSynopsis || 'The beginning of the adventure.',
      startingLocation: startingLocationId,
    },
    options: {
      targetSceneCount: 5,
      majorChoiceCount: 2,
      runQA: true,
      qaThreshold: 60,
    },

    // Include raw document for agents to reference
    rawDocument: doc.rawContent,
  };
}

/**
 * Read a file and parse it as a story document.
 * For use in Node.js environment (CLI tools).
 */
export async function parseDocumentFromFile(filePath: string): Promise<DocumentParseResult> {
  try {
    // Use eval('require') to hide Node.js modules from mobile bundlers
    const req = typeof eval !== 'undefined' ? eval('require') : undefined;
    if (typeof req !== 'function') {
      throw new Error('Node.js environment required for file parsing');
    }
    
    const nodeFs = req('fs').promises;
    const content = await nodeFs.readFile(filePath, 'utf-8');
    const fileName = filePath.split('/').pop();
    return parseDocument(content, fileName);
  } catch (err) {
    return {
      success: false,
      error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
      warnings: [],
    };
  }
}

/**
 * Parse a PDF file and extract its text content.
 * Works with both ArrayBuffer (from file input) and base64 string.
 */
export async function parsePdfDocument(data: ArrayBuffer | string): Promise<string> {
  const lib = await getPdfjsLib();
  if (!lib) {
    throw new Error('PDF parsing is not available in this environment');
  }

  try {
    console.log(`[DocumentParser] Parsing PDF document...`);

    // Convert base64 string to ArrayBuffer if needed
    let pdfData: ArrayBuffer;
    if (typeof data === 'string') {
      // Assume it's base64 encoded
      const binaryString = atob(data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      pdfData = bytes.buffer;
    } else {
      pdfData = data;
    }

    // Load the PDF document
    const loadingTask = lib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;

    console.log(`[DocumentParser] PDF loaded: ${pdf.numPages} pages`);

    // Extract text from all pages
    const textParts: string[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Combine text items into paragraphs (filter out marked content, keep only text items)
      const pageText = textContent.items
        .filter((item: any) => 'str' in item)
        .map((item: any) => (item as { str: string }).str || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (pageText) {
        textParts.push(pageText);
      }
    }

    const fullText = textParts.join('\n\n');
    console.log(`[DocumentParser] Extracted ${fullText.length} chars from PDF`);

    return fullText;
  } catch (error) {
    console.error(`[DocumentParser] PDF parsing failed:`, error);
    throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Parse a PDF and convert to DocumentParseResult.
 * Extracts text from PDF and then parses it as plain text.
 */
export async function parseDocumentFromPdf(data: ArrayBuffer | string, fileName?: string): Promise<DocumentParseResult> {
  try {
    const textContent = await parsePdfDocument(data);
    // Parse the extracted text as a plain text or markdown document
    return parseDocument(textContent, fileName?.replace('.pdf', '.txt'));
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse PDF: ${error instanceof Error ? error.message : String(error)}`,
      warnings: [],
    };
  }
}

/**
 * Generate a sample document template
 */
export function generateDocumentTemplate(): string {
  return `# My Story Title

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
`;
}
