export function resolvePromptUrlFromImageUrl(imageUrl: string): string | null {
  if (!imageUrl || imageUrl.startsWith('data:')) return null;

  const generatedStoryMatch = imageUrl.match(
    /^(.*?generated-stories\/[^/]+\/images\/)(?:.*\/)?([^/?#]+)\.(png|jpe?g|webp)(?:[?#].*)?$/i
  );
  if (generatedStoryMatch) {
    return `${generatedStoryMatch[1]}prompts/${generatedStoryMatch[2]}.json`;
  }

  return imageUrl
    .replace(/\/images\/(?:.*\/)?([^/?#]+)\.(png|jpg|jpeg|webp)(?:[?#].*)?$/i, '/images/prompts/$1.json');
}
