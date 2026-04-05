export type RuntimeOs = 'web' | 'native' | 'node';

export function getRuntimeOs(): RuntimeOs {
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    return 'native';
  }
  if (typeof window !== 'undefined') {
    return 'web';
  }
  return 'node';
}

export function isWebRuntime(): boolean {
  return getRuntimeOs() === 'web';
}

export function isNativeRuntime(): boolean {
  return getRuntimeOs() === 'native';
}

