export const PLANNING_REGISTER_LEAK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Open the episode', pattern: /\bOpen\s+the\s+episode\b/i },
  { label: 'Introduce X on-page', pattern: /\bIntroduce\s+[^.!?\n]{1,100}?\s+on-page\b/i },
  { label: 'Authored treatment choice', pattern: /\bAuthored\s+treatment\s+choice\b/i },
  { label: 'Authored choice pressure', pattern: /\bauthored\s+choice\s+pressure\b/i },
  { label: 'Next beat response', pattern: /\bnext\s+beat\s+visibly\s+responds\b/i },
  { label: 'Choice response mechanics summary', pattern: /\bThe\s+response\s+changes\s+access,\s*trust,\s*information,\s*or\s*danger\s+around\b/i },
  { label: 'Decide how to handle', pattern: /\bDecide\s+how\s+to\s+handle\b/i },
  { label: 'Cold-open prelude wrapper', pattern: /\bCold-open\s+prelude\s*:/i },
  { label: 'Planned scene continuation wrapper', pattern: /\bThen\s+continue\s+into\s+the\s+planned\s+scene\s*:/i },
  { label: 'Sequence staging directive', pattern: /\bStage\s+the\s+pressure\s+through\s+visible\s+action,\s*reaction,\s*object\s+movement,\s*distance,\s*or\s+dialogue\s+around\b/i },
  { label: 'Cold-open moment instruction', pattern: /\bOpen\s+with\s+this\s+cold-open\s+moment\b/i },
  { label: 'Required cold-open prelude instruction', pattern: /\bOpen\s+on\s+the\s+required\s+cold-open\s+prelude\b/i },
  { label: 'Aftermath stakes reset', pattern: /\bAftermath\s+that\s+resettles\s+stakes\b/i },
  { label: 'Hook/promise/stakes treatment labels', pattern: /\bHook\s*(?:—|-|:)[^.!?\n]{0,700}\bpromise\s*(?:—|-|:)[^.!?\n]{0,700}\bstakes\s*(?:—|-|:)/i },
  { label: 'Treatment structural label', pattern: /^\s*(?:Hook|promise|stakes)\s*(?:—|-|:)/i },
  { label: 'Embedded treatment structural label', pattern: /\b(?:around|because)\s+(?:Hook|promise|stakes)\s*(?:—|-|:)/i },
  { label: 'Structural beat service', pattern: /\bserves\s+the\s+(?:hook|plotTurn1|pinch1|midpoint|pinch2|climax|resolution)\s+beat\b/i },
  { label: 'Forward pressure', pattern: /\bForward\s+pressure\s*:/i },
  { label: 'Episode pressure instruction', pattern: /\bEscalate\s+the\s+episode\s+pressure\s+through\s+a\s+concrete\s+turn\s*:/i },
  { label: 'Fallout pressure instruction', pattern: /\bLet\s+the\s+fallout\s+settle\s+into\s+the\s+next\s+pressure\s*:/i },
  { label: 'Information ledger label', pattern: /\binformation\s+ledger\b/i },
  { label: 'Raw INFO token', pattern: /\bINFO[-_\s]+[A-Z0-9][A-Z0-9_-]*\b/i },
];

export function isPlanningRegisterText(text: string | undefined): boolean {
  if (!text || text.trim().length === 0) return false;
  return PLANNING_REGISTER_LEAK_PATTERNS.some(({ pattern }) => pattern.test(text));
}
