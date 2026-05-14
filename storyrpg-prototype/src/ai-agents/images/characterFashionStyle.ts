import type { CharacterProfile } from '../agents/CharacterDesigner';
import type { CharacterFashionStyle } from '../../types/sourceAnalysis';

export function buildFashionPrimaryClothing(char: Pick<CharacterProfile, 'typicalAttire' | 'fashionStyle'>): string | undefined {
  const parts: string[] = [];
  const fashion = char.fashionStyle;

  if (char.typicalAttire) parts.push(char.typicalAttire);
  if (fashion?.styleSummary) parts.push(fashion.styleSummary);
  if (fashion?.signatureGarments?.length) parts.push(`signature garments: ${fashion.signatureGarments.join(', ')}`);
  if (fashion?.materials?.length) parts.push(`materials: ${fashion.materials.join(', ')}`);
  if (fashion?.styleTags?.length) parts.push(`fashion cues: ${fashion.styleTags.join(', ')}`);

  return parts.length > 0 ? parts.join('; ') : undefined;
}

export function buildFashionStyleSummary(fashionStyle?: CharacterFashionStyle): string | undefined {
  if (!fashionStyle) return undefined;

  const parts = [
    fashionStyle.styleSummary,
    fashionStyle.styleTags?.length ? `style tags: ${fashionStyle.styleTags.join(', ')}` : '',
    fashionStyle.signatureGarments?.length ? `signature garments: ${fashionStyle.signatureGarments.join(', ')}` : '',
    fashionStyle.materials?.length ? `materials: ${fashionStyle.materials.join(', ')}` : '',
    fashionStyle.colorPalette?.length ? `palette: ${fashionStyle.colorPalette.join(', ')}` : '',
    fashionStyle.accessories?.length ? `accessories: ${fashionStyle.accessories.join(', ')}` : '',
  ].filter(Boolean);

  return parts.length > 0 ? parts.join('; ') : undefined;
}
