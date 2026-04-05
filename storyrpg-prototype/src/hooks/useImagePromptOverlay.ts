import { useCallback, useEffect, useState } from 'react';

type ResolverContext = {
  imageUrl: string;
};

type UseImagePromptOverlayOptions = {
  resolvePromptUrl: (context: ResolverContext) => string | null;
  getContextLabel?: (imageUrl?: string) => string | null;
  syncImageUrl?: string;
};

export function useImagePromptOverlay({
  resolvePromptUrl,
  getContextLabel,
  syncImageUrl,
}: UseImagePromptOverlayOptions) {
  const [showPromptOverlay, setShowPromptOverlay] = useState(false);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const [promptContextLabel, setPromptContextLabel] = useState<string | null>(null);

  const fetchPrompt = useCallback(async (imageUrl?: string, autoOpen = true) => {
    if (!imageUrl) return;

    setIsLoadingPrompt(true);
    setPromptText(null);
    setPromptContextLabel(getContextLabel?.(imageUrl) ?? null);

    const promptUrl = resolvePromptUrl({ imageUrl });
    if (!promptUrl) {
      setPromptText('Cannot resolve prompt path for this image.');
      setIsLoadingPrompt(false);
      if (autoOpen) setShowPromptOverlay(true);
      return;
    }

    try {
      const response = await fetch(promptUrl);
      if (response.ok) {
        const data = await response.json();
        const prompt = data?.prompt;
        if (typeof prompt === 'string') {
          setPromptText(prompt);
        } else if (prompt && typeof prompt === 'object') {
          setPromptText(JSON.stringify(prompt, null, 2));
        } else {
          setPromptText(JSON.stringify(data, null, 2));
        }
      } else {
        setPromptText('Prompt file not found for this image.');
      }
    } catch {
      setPromptText('Failed to load prompt.');
    } finally {
      setIsLoadingPrompt(false);
      if (autoOpen) setShowPromptOverlay(true);
    }
  }, [getContextLabel, resolvePromptUrl]);

  useEffect(() => {
    if (!showPromptOverlay || !syncImageUrl) return;
    void fetchPrompt(syncImageUrl, false);
  }, [fetchPrompt, showPromptOverlay, syncImageUrl]);

  return {
    showPromptOverlay,
    setShowPromptOverlay,
    promptText,
    isLoadingPrompt,
    promptContextLabel,
    fetchPrompt,
  };
}
