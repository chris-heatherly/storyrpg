/**
 * LLM Response Parser
 * 
 * Utilities for parsing and cleaning LLM responses.
 * Handles common issues like markdown code blocks, truncation, etc.
 */

import { createLogger } from './shared';

const logger = createLogger('LLMParser');

// ========================================
// JSON CLEANING
// ========================================

/**
 * Clean markdown code blocks from LLM response.
 */
export function cleanMarkdownCodeBlocks(content: string): string {
  let cleaned = content.trim();
  
  // Remove ```json or ``` at start
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  
  // Remove ``` at end
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  
  return cleaned.trim();
}

/**
 * Remove common prefixes that LLMs sometimes add.
 */
export function cleanPrefixes(content: string): string {
  const prefixes = [
    'Here is the JSON:',
    'Here\'s the JSON:',
    'The JSON is:',
    'JSON:',
    'Output:',
    'Result:',
    'Response:',
  ];
  
  let cleaned = content.trim();
  
  for (const prefix of prefixes) {
    if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleaned = cleaned.slice(prefix.length).trim();
    }
  }
  
  return cleaned;
}

/**
 * Find the start of JSON content.
 */
export function findJsonStart(content: string): number {
  const objectStart = content.indexOf('{');
  const arrayStart = content.indexOf('[');
  
  if (objectStart === -1 && arrayStart === -1) {
    return -1;
  }
  
  if (objectStart === -1) return arrayStart;
  if (arrayStart === -1) return objectStart;
  
  return Math.min(objectStart, arrayStart);
}

/**
 * Find the end of JSON content (accounting for nesting).
 */
export function findJsonEnd(content: string, startChar: '{' | '['): number {
  const endChar = startChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (char === '\\') {
      escape = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (char === startChar) {
      depth++;
    } else if (char === endChar) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  
  return -1;
}

/**
 * Extract JSON from content that may have surrounding text.
 */
export function extractJson(content: string): string {
  const cleaned = cleanPrefixes(cleanMarkdownCodeBlocks(content));
  
  const start = findJsonStart(cleaned);
  if (start === -1) {
    throw new Error('No JSON object or array found in content');
  }
  
  const startChar = cleaned[start] as '{' | '[';
  const jsonContent = cleaned.slice(start);
  const end = findJsonEnd(jsonContent, startChar);
  
  if (end === -1) {
    // JSON might be truncated, return what we have
    return jsonContent;
  }
  
  return jsonContent.slice(0, end + 1);
}

// ========================================
// JSON REPAIR
// ========================================

/**
 * Balance brackets in potentially truncated JSON.
 */
export function balanceBrackets(json: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  
  for (const char of json) {
    if (escape) {
      escape = false;
      continue;
    }
    
    if (char === '\\') {
      escape = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (char === '{' || char === '[') {
      stack.push(char);
    } else if (char === '}') {
      if (stack.length > 0 && stack[stack.length - 1] === '{') {
        stack.pop();
      }
    } else if (char === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === '[') {
        stack.pop();
      }
    }
  }
  
  // Close unclosed brackets
  let result = json;
  while (stack.length > 0) {
    const open = stack.pop();
    result += open === '{' ? '}' : ']';
  }
  
  return result;
}

/**
 * Fix common JSON issues from LLM output.
 */
export function fixCommonJsonIssues(json: string): string {
  let fixed = json;
  
  // Remove trailing commas before closing brackets
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  
  // Fix unquoted property names (simple cases)
  fixed = fixed.replace(/(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  
  // Fix single quotes to double quotes (outside of strings)
  // This is risky, so we only do it for obvious cases
  fixed = fixed.replace(/'([^']+)':/g, '"$1":');
  
  return fixed;
}

/**
 * Attempt to repair and parse JSON.
 */
export function repairAndParseJson<T>(content: string): T {
  // First, try to parse as-is
  try {
    return JSON.parse(content);
  } catch (e) {
    logger.debug('Initial parse failed, attempting repairs');
  }
  
  // Clean markdown blocks
  let cleaned = cleanMarkdownCodeBlocks(content);
  
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    logger.debug('Parse after markdown cleaning failed');
  }
  
  // Extract JSON from surrounding text
  try {
    cleaned = extractJson(content);
    return JSON.parse(cleaned);
  } catch (e) {
    logger.debug('Parse after extraction failed');
  }
  
  // Fix common issues
  try {
    cleaned = fixCommonJsonIssues(cleaned);
    return JSON.parse(cleaned);
  } catch (e) {
    logger.debug('Parse after fixing issues failed');
  }
  
  // Balance brackets (for truncated responses)
  try {
    cleaned = balanceBrackets(cleaned);
    return JSON.parse(cleaned);
  } catch (e) {
    logger.debug('Parse after balancing brackets failed');
  }
  
  // Final attempt with all repairs
  try {
    cleaned = balanceBrackets(fixCommonJsonIssues(extractJson(content)));
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse JSON after all repair attempts: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ========================================
// LLM RESPONSE PARSING
// ========================================

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  rawContent?: string;
}

/**
 * Parse LLM response content as JSON.
 */
export function parseLLMResponse<T>(content: string): ParseResult<T> {
  try {
    const data = repairAndParseJson<T>(content);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      rawContent: content.slice(0, 500), // First 500 chars for debugging
    };
  }
}

/**
 * Parse LLM response with a validation function.
 */
export function parseLLMResponseWithValidation<T>(
  content: string,
  validate: (data: unknown) => data is T,
  errorMessage: string = 'Invalid response structure'
): ParseResult<T> {
  const parsed = parseLLMResponse<unknown>(content);
  
  if (!parsed.success) {
    return parsed as ParseResult<T>;
  }
  
  if (!validate(parsed.data)) {
    return {
      success: false,
      error: errorMessage,
      rawContent: content.slice(0, 500),
    };
  }
  
  return { success: true, data: parsed.data as T };
}

/**
 * Parse LLM response with a schema/shape check.
 */
export function parseLLMResponseWithShape<T extends Record<string, unknown>>(
  content: string,
  requiredKeys: (keyof T)[]
): ParseResult<T> {
  const parsed = parseLLMResponse<T>(content);
  
  if (!parsed.success || !parsed.data) {
    return parsed;
  }
  
  const missingKeys = requiredKeys.filter(key => !(key in parsed.data!));
  
  if (missingKeys.length > 0) {
    return {
      success: false,
      error: `Missing required keys: ${missingKeys.join(', ')}`,
      rawContent: content.slice(0, 500),
    };
  }
  
  return { success: true, data: parsed.data };
}

// ========================================
// TEXT EXTRACTION
// ========================================

/**
 * Extract a specific field from LLM response.
 */
export function extractField<T>(
  content: string,
  fieldName: string,
  defaultValue?: T
): T | undefined {
  try {
    const parsed = repairAndParseJson<Record<string, unknown>>(content);
    return (parsed[fieldName] as T) ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Extract text between markers.
 */
export function extractBetweenMarkers(
  content: string,
  startMarker: string,
  endMarker: string
): string | undefined {
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return undefined;
  
  const contentStart = startIdx + startMarker.length;
  const endIdx = content.indexOf(endMarker, contentStart);
  
  if (endIdx === -1) {
    // Return everything after start marker
    return content.slice(contentStart).trim();
  }
  
  return content.slice(contentStart, endIdx).trim();
}
