export const PLANNING_REGISTER_LEAK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Open the episode', pattern: /\bOpen\s+the\s+episode\b/i },
  { label: 'Introduce X on-page', pattern: /\bIntroduce\s+[^.!?\n]{1,100}?\s+on-page\b/i },
  { label: 'Authored treatment choice', pattern: /\bAuthored\s+treatment\s+choice\b/i },
  { label: 'Authored choice pressure', pattern: /\bauthored\s+choice\s+pressure\b/i },
  { label: 'Next beat response', pattern: /\bnext\s+beat\s+visibly\s+responds\b/i },
  { label: 'Decide how to handle', pattern: /\bDecide\s+how\s+to\s+handle\b/i },
  { label: 'Aftermath stakes reset', pattern: /\bAftermath\s+that\s+resettles\s+stakes\b/i },
  { label: 'Structural beat service', pattern: /\bserves\s+the\s+(?:hook|plotTurn1|pinch1|midpoint|pinch2|climax|resolution)\s+beat\b/i },
  { label: 'Forward pressure', pattern: /\bForward\s+pressure\s*:/i },
  { label: 'Episode pressure instruction', pattern: /\bEscalate\s+the\s+episode\s+pressure\s+through\s+a\s+concrete\s+turn\s*:/i },
  { label: 'Fallout pressure instruction', pattern: /\bLet\s+the\s+fallout\s+settle\s+into\s+the\s+next\s+pressure\s*:/i },
];

export function isPlanningRegisterText(text: string | undefined): boolean {
  if (!text || text.trim().length === 0) return false;
  return PLANNING_REGISTER_LEAK_PATTERNS.some(({ pattern }) => pattern.test(text));
}
