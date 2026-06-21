export const PLANNING_REGISTER_LEAK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Open the episode', pattern: /\bOpen\s+the\s+episode\b/i },
  { label: 'Introduce X on-page', pattern: /\bIntroduce\s+[^.!?\n]{1,100}?\s+on-page\b/i },
  { label: 'Authored treatment choice', pattern: /\bAuthored\s+treatment\s+choice\b/i },
  { label: 'Authored choice pressure', pattern: /\bauthored\s+choice\s+pressure\b/i },
  { label: 'Next beat response', pattern: /\bnext\s+beat\s+visibly\s+responds\b/i },
  { label: 'Decide how to handle', pattern: /\bDecide\s+how\s+to\s+handle\b/i },
];

export function isPlanningRegisterText(text: string | undefined): boolean {
  if (!text || text.trim().length === 0) return false;
  return PLANNING_REGISTER_LEAK_PATTERNS.some(({ pattern }) => pattern.test(text));
}
