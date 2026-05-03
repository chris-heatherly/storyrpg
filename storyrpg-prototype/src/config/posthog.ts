import { Platform } from 'react-native';

// PostHog native client for iOS/Android platforms.
// On web, posthog-js is used via analyticsService.ts instead.
// Configuration is loaded from app.config.js extras via expo-constants.

type NativePostHogClient = {
  identify?: (distinctId: string, properties?: Record<string, unknown>) => void;
  register?: (properties: Record<string, unknown>) => void;
  capture?: (eventName: string, properties?: Record<string, unknown>) => void;
};

let posthogInstance: NativePostHogClient | null = null;

function createNativeClient(): NativePostHogClient | null {
  if (Platform.OS === 'web') return null;

  try {
    // expo-constants reads from app.config.js extras at build time
    const Constants = require('expo-constants').default;
    const apiKey = Constants.expoConfig?.extra?.posthogProjectToken as string | undefined;
    const host = Constants.expoConfig?.extra?.posthogHost as string | undefined;

    const isConfigured = Boolean(apiKey) && apiKey !== 'phc_your_project_token_here';

    if (!isConfigured) {
      console.warn(
        '[PostHog] Project token not configured for native. Set POSTHOG_PROJECT_TOKEN in .env.'
      );
    }

    if (!host) {
      console.warn('[PostHog] Host not configured. Set POSTHOG_HOST in .env.');
    }

    const PostHog = require('posthog-react-native').PostHog;
    return new PostHog(apiKey || 'placeholder_key', {
      host: host || undefined,
      disabled: !isConfigured || !host,
      captureAppLifecycleEvents: true,
      debug: __DEV__,
      flushAt: 20,
      flushInterval: 10000,
      maxBatchSize: 100,
      maxQueueSize: 1000,
    });
  } catch (err) {
    console.warn('[PostHog] Failed to initialize native client:', err);
    return null;
  }
}

export function getNativePostHog(): NativePostHogClient | null {
  if (Platform.OS === 'web') return null;
  if (!posthogInstance) {
    posthogInstance = createNativeClient();
  }
  return posthogInstance;
}
