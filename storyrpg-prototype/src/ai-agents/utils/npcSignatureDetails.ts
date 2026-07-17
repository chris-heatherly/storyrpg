/**
 * B1: the signature details a first on-page appearance should land — drawn
 * from the character bible (which already folds in the treatment's immutable
 * visual identity via CharacterDesignPhase). Capped small so the SceneWriter
 * directive stays a nudge, not a checklist.
 */
import type { CharacterProfile } from '../agents/CharacterDesigner';

export function npcSignatureDetails(profile: CharacterProfile | undefined): string[] | undefined {
  if (!profile) return undefined;
  const details = [
    ...(profile.distinctiveFeatures ?? []),
    ...(profile.typicalAttire?.trim() ? [`typical attire: ${profile.typicalAttire.trim()}`] : []),
    ...(profile.voiceProfile?.verbalTics ?? []).slice(0, 2).map((tic) => `verbal tic: "${tic}"`),
    ...(profile.voiceProfile?.signatureLines ?? []).slice(0, 1).map((line) => `signature line: "${line}"`),
  ]
    .map((detail) => detail.trim())
    .filter(Boolean)
    .slice(0, 5);
  return details.length > 0 ? details : undefined;
}
