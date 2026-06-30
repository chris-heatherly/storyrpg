const enabled = () => process.env.EXPO_PUBLIC_ENABLE_INTERNAL_APP_LINKS === 'true';

function cleanUrl(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

export function getReaderAppUrl(): string | null {
  return cleanUrl(process.env.EXPO_PUBLIC_READER_APP_URL);
}

export function getGeneratorAppUrl(): string | null {
  return cleanUrl(process.env.EXPO_PUBLIC_GENERATOR_APP_URL);
}

export function canShowInternalAppLinks(developerMode: boolean, targetUrl: string | null): boolean {
  return developerMode && enabled() && Boolean(targetUrl);
}
