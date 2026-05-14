/**
 * E2: Pure-function helpers extracted from `imageGenerationService.ts`.
 * The service file is ~4500 lines — an incremental split keeps the
 * blast radius small. This module hosts helpers that have no dependency
 * on the service instance (no `this.`) and are safe to import anywhere.
 *
 * Future E2 passes are expected to move (in rough order of independence):
 *   - ProviderThrottle / rate-limiter wiring
 *   - Prompt budgeting helpers (`normalizeNegativesText`, `applyEncounterPromptBudget`)
 *   - Atlas uploadMedia + `ensureReferenceUrls` (A7)
 *   - Per-provider prompt builders (`buildMidjourneyPrompt`, `buildStableDiffusionPrompt`, etc.)
 * Moving them one-at-a-time lets each migration ship independently with a
 * green typecheck + test run.
 */

/**
 * Strips any host-specific absolute prefix from a path so the manifest
 * records only the portable project-relative portion (e.g. keep
 * `generated-stories/foo/image.png` but drop
 * `/Users/bob/repo/storyrpg-prototype/` in front of it). Works on both
 * POSIX and Windows separators.
 */
export function normalizeManagedOutputPath(filePath: string): string {
  if (!filePath) return filePath;
  const normalized = filePath.replace(/\\/g, '/');
  for (const marker of ['generated-stories/', 'generated-images/', 'generated-videos/', 'ref-images/']) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      return normalized.slice(idx);
    }
  }
  return filePath;
}

/**
 * Detect the actual MIME type from a base64-encoded image by inspecting
 * magic bytes, or extract it from a data URI prefix. Falls back to
 * `image/png` when detection fails.
 *
 * Keeping this out of the service class avoids re-instantiating the
 * detector on every call path and makes it trivially testable.
 */
export function detectImageMimeType(output: string): { mimeType: string; extension: string; base64Data: string } {
  // If the output is a data URI, extract the real MIME type from the prefix
  const dataUriMatch = output.match(/^data:(image\/[\w+.-]+);base64,/);
  if (dataUriMatch) {
    const mimeType = dataUriMatch[1];
    const base64Data = output.slice(dataUriMatch[0].length);
    const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg'
      : mimeType.includes('webp') ? 'webp'
      : 'png';
    return { mimeType, extension, base64Data };
  }

  // Raw base64 — sniff magic bytes from the first few bytes
  try {
    const head = atob(output.slice(0, 16));
    if (head.charCodeAt(0) === 0xFF && head.charCodeAt(1) === 0xD8) {
      return { mimeType: 'image/jpeg', extension: 'jpg', base64Data: output };
    }
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') {
      return { mimeType: 'image/webp', extension: 'webp', base64Data: output };
    }
  } catch (_) { /* atob may fail on non-base64 preamble — fall through */ }

  return { mimeType: 'image/png', extension: 'png', base64Data: output };
}
