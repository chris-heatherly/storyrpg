export function formatSceneBeatLabelFromImageUrl(
  url: string | undefined,
  fallbackSceneId?: string | null,
  fallbackBeatId?: string | null
): string | null {
  const value = url || '';
  const candidates: Array<
    | { kind: 'beat'; re: RegExp }
    | { kind: 'shot'; re: RegExp }
  > = [
    { kind: 'beat', re: /encounter-scene-([0-9]+[a-z]?)-beat-([0-9]+)/i },
    { kind: 'beat', re: /beat-scene-([0-9]+[a-z]?)-beat-([0-9]+)/i },
    { kind: 'beat', re: /scene-([0-9]+[a-z]?)-beat-([0-9]+)/i },
    { kind: 'shot', re: /shot-scene-([0-9]+[a-z]?)-shot-([0-9]+)/i },
  ];

  for (const candidate of candidates) {
    const match = value.match(candidate.re);
    if (!match) continue;
    const scene = match[1];
    const number = match[2];
    return candidate.kind === 'beat'
      ? `Scene ${scene} • Beat ${number}`
      : `Scene ${scene} • Shot ${number}`;
  }

  const sceneFromId = fallbackSceneId?.match(/scene-([0-9]+[a-z]?)/i)?.[1];
  const beatFromId = fallbackBeatId?.match(/beat-([0-9]+)/i)?.[1];
  if (sceneFromId && beatFromId) return `Scene ${sceneFromId} • Beat ${beatFromId}`;
  if (sceneFromId) return `Scene ${sceneFromId}`;
  return null;
}
