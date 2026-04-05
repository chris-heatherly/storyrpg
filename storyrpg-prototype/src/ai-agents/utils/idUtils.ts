/**
 * ID Utilities
 * 
 * Centralized utilities for generating, validating, and normalizing IDs
 * throughout the pipeline for consistency.
 */

// ========================================
// ID FORMAT CONSTANTS
// ========================================

export const ID_PREFIXES = {
  character: 'character-',
  location: 'location-',
  scene: 'scene-',
  beat: 'beat-',
  choice: 'choice-',
  episode: 'ep',
  npc: 'npc-',
  subplot: 'subplot-',
  promise: 'promise-',
  encounter: 'encounter-',
} as const;

// ========================================
// ID GENERATION
// ========================================

/**
 * Slugify a string for use in an ID
 * Converts to lowercase, replaces spaces with hyphens, removes special characters
 */
export function slugify(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate a character ID from a name
 */
export function generateCharacterId(name: string | null | undefined): string {
  if (!name) return `${ID_PREFIXES.character}unknown`;
  return `${ID_PREFIXES.character}${slugify(name)}`;
}

/**
 * Generate a location ID from a name
 */
export function generateLocationId(name: string | null | undefined): string {
  if (!name) return `${ID_PREFIXES.location}unknown`;
  return `${ID_PREFIXES.location}${slugify(name)}`;
}

/**
 * Generate a scene ID (sequential)
 */
export function generateSceneId(index: number): string {
  return `${ID_PREFIXES.scene}${index + 1}`;
}

/**
 * Generate a beat ID (sequential)
 */
export function generateBeatId(index: number): string {
  return `${ID_PREFIXES.beat}${index + 1}`;
}

/**
 * Generate a choice ID (sequential)
 */
export function generateChoiceId(index: number): string {
  return `${ID_PREFIXES.choice}${index + 1}`;
}

/**
 * Generate an episode ID
 */
export function generateEpisodeId(episodeNumber: number, title: string | null | undefined): string {
  const sluggedTitle = title ? slugify(title) : 'untitled';
  return `${ID_PREFIXES.episode}${episodeNumber}-${sluggedTitle}`;
}

/**
 * Generate a unique ID with timestamp and random suffix
 */
export function generateUniqueId(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `${prefix}${timestamp}-${random}`;
}

// ========================================
// ID VALIDATION
// ========================================

/**
 * Check if an ID has a valid format for its type
 */
export function isValidIdFormat(id: string, type: keyof typeof ID_PREFIXES): boolean {
  const prefix = ID_PREFIXES[type];
  return id.startsWith(prefix) && id.length > prefix.length;
}

/**
 * Validate an ID exists in a collection
 */
export function validateIdExists<T extends { id: string }>(
  id: string,
  collection: T[],
  typeName: string
): { valid: boolean; found?: T; error?: string } {
  const found = collection.find(item => item.id === id);
  if (found) {
    return { valid: true, found };
  }
  return { 
    valid: false, 
    error: `${typeName} with ID "${id}" not found in collection of ${collection.length} items` 
  };
}

/**
 * Check for duplicate IDs in a collection
 */
export function findDuplicateIds<T extends { id: string }>(collection: T[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  
  for (const item of collection) {
    if (seen.has(item.id)) {
      duplicates.push(item.id);
    } else {
      seen.add(item.id);
    }
  }
  
  return duplicates;
}

// ========================================
// ID NORMALIZATION
// ========================================

/**
 * Normalize an ID to match expected format
 * Converts old formats like 'char-X' to 'character-X'
 */
export function normalizeId(id: string | null | undefined, type: keyof typeof ID_PREFIXES): string {
  if (!id) return `${ID_PREFIXES[type]}unknown`;
  
  const expectedPrefix = ID_PREFIXES[type];
  
  // Already correct format
  if (id.startsWith(expectedPrefix)) {
    return id;
  }
  
  // Map old prefixes to new ones
  const oldPrefixMappings: Record<string, keyof typeof ID_PREFIXES> = {
    'char-': 'character',
    'loc-': 'location',
  };
  
  for (const [oldPrefix, targetType] of Object.entries(oldPrefixMappings)) {
    if (id.startsWith(oldPrefix) && targetType === type) {
      const suffix = id.slice(oldPrefix.length);
      return `${expectedPrefix}${suffix}`;
    }
  }
  
  // No prefix - add it
  if (!id.includes('-') || !Object.values(ID_PREFIXES).some(p => id.startsWith(p))) {
    return `${expectedPrefix}${slugify(id)}`;
  }
  
  // Unknown format - return as-is with warning
  console.warn(`[idUtils] Could not normalize ID "${id}" to type "${type}"`);
  return id;
}

/**
 * Try to match an ID against a collection, with fuzzy matching by name
 */
export function findBestMatch<T extends { id: string; name?: string }>(
  targetId: string,
  collection: T[],
  options: { allowNameMatch?: boolean; logWarnings?: boolean } = {}
): T | undefined {
  const { allowNameMatch = true, logWarnings = true } = options;
  
  // Exact match
  const exact = collection.find(item => item.id === targetId);
  if (exact) return exact;
  
  // Normalized match
  const normalizedTarget = targetId.toLowerCase();
  const normalized = collection.find(item => item.id.toLowerCase() === normalizedTarget);
  if (normalized) return normalized;
  
  // Name match (if allowed)
  if (allowNameMatch) {
    const byName = collection.find(item => {
      if (!item.name) return false;
      const nameSlug = slugify(item.name);
      return nameSlug === normalizedTarget || 
             normalizedTarget.includes(nameSlug) ||
             nameSlug.includes(normalizedTarget);
    });
    if (byName) {
      if (logWarnings) {
        console.log(`[idUtils] Matched "${targetId}" to "${byName.id}" by name`);
      }
      return byName;
    }
  }
  
  if (logWarnings) {
    console.warn(`[idUtils] Could not find match for ID "${targetId}" in ${collection.length} items`);
  }
  return undefined;
}

// ========================================
// ID COLLECTION UTILITIES
// ========================================

/**
 * Extract all IDs from a collection
 */
export function extractIds<T extends { id: string }>(collection: T[]): string[] {
  return collection.map(item => item.id);
}

/**
 * Create an ID lookup map for fast access
 */
export function createIdMap<T extends { id: string }>(collection: T[]): Map<string, T> {
  return new Map(collection.map(item => [item.id, item]));
}

/**
 * Validate all ID references in a structure
 */
export interface IdValidationResult {
  valid: boolean;
  missingRefs: Array<{ sourceId: string; targetId: string; refType: string }>;
  duplicates: Array<{ type: string; ids: string[] }>;
}

export function validateIdReferences(
  scenes: Array<{ id: string; leadsTo?: string[]; npcsPresent?: string[]; location?: string }>,
  characters: Array<{ id: string }>,
  locations: Array<{ id: string }>
): IdValidationResult {
  const result: IdValidationResult = {
    valid: true,
    missingRefs: [],
    duplicates: [],
  };
  
  const sceneIds = new Set(scenes.map(s => s.id));
  const charIds = new Set(characters.map(c => c.id));
  const locIds = new Set(locations.map(l => l.id));
  
  // Check for duplicates
  const sceneDupes = findDuplicateIds(scenes);
  if (sceneDupes.length > 0) {
    result.duplicates.push({ type: 'scene', ids: sceneDupes });
    result.valid = false;
  }
  
  // Validate references
  for (const scene of scenes) {
    // Check leadsTo references
    for (const targetId of scene.leadsTo || []) {
      if (!sceneIds.has(targetId)) {
        result.missingRefs.push({ sourceId: scene.id, targetId, refType: 'leadsTo' });
        result.valid = false;
      }
    }
    
    // Check NPC references
    for (const npcId of scene.npcsPresent || []) {
      if (!charIds.has(npcId)) {
        result.missingRefs.push({ sourceId: scene.id, targetId: npcId, refType: 'npcsPresent' });
        result.valid = false;
      }
    }
    
    // Check location reference
    if (scene.location && !locIds.has(scene.location)) {
      result.missingRefs.push({ sourceId: scene.id, targetId: scene.location, refType: 'location' });
      result.valid = false;
    }
  }
  
  return result;
}
