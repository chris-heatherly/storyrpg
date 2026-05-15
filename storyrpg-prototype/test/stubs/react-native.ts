export const Platform = {
  OS: 'web',
};

// Minimal StyleSheet stub so modules that call `StyleSheet.create({...})` at
// import-time (e.g. theme/uiConstants) can be imported by unit tests without
// pulling in the real React Native runtime.
export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (style: unknown) => style,
  absoluteFillObject: {},
  hairlineWidth: 1,
};

export const Dimensions = {
  get: () => ({ width: 375, height: 667, scale: 1, fontScale: 1 }),
};

export const PixelRatio = {
  get: () => 1,
  getFontScale: () => 1,
  roundToNearestPixel: (n: number) => n,
};
