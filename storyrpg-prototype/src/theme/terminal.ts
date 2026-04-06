// Modern Theme - Cinematic Aesthetic
// Inspired by StoryRPG_Mobile2 design

export const TERMINAL = {
  // Core colors
  colors: {
    // Backgrounds
    bg: '#0f1115',
    bgLight: '#16191f',
    bgHighlight: '#1e2229',

    // Primary text (Modern Blue)
    primary: '#3b82f6',
    primaryDim: '#2563eb',
    primaryBright: '#60a5fa',
    primaryLight: '#93c5fd',

    // Success (Green)
    success: '#22c55e',
    successLight: '#86efac',

    // Secondary (Amber)
    amber: '#f59e0b',
    amberDim: '#d97706',
    amberLight: '#fbbf24',

    // Accent (Cyan/Sky)
    cyan: '#06b6d4',
    cyanDim: '#0891b2',

    // Text hierarchy
    textStrong: '#f1f5f9',
    textBody: '#cbd5e1',
    textLight: '#e2e8f0',

    // Muted
    muted: '#475569',
    mutedLight: '#64748b',

    // Error/warning
    error: '#ef4444',
    warning: '#f59e0b',

    // Borders
    border: '#1e2229',
    borderBright: '#334155',
  },

  // Typography
  fonts: {
    mono: 'System', // Switching to system font for cleaner look
    sans: 'System',
  },

  // Common text styles
  text: {
    primary: {
      color: '#3b82f6',
      fontFamily: 'System',
    },
    muted: {
      color: '#475569',
      fontFamily: 'System',
    },
    amber: {
      color: '#f59e0b',
      fontFamily: 'System',
    },
    cyan: {
      color: '#06b6d4',
      fontFamily: 'System',
    },
  },

  // ASCII symbols kept for logic but styled minimally
  box: {
    topLeft: '',
    topRight: '',
    bottomLeft: '',
    bottomRight: '',
    horizontal: '',
    vertical: '',
    teeRight: '',
    teeLeft: '',
    teeDown: '',
    teeUp: '',
    cross: '',
  },

  // Common symbols
  symbols: {
    prompt: '',
    cursor: '▊',
    bullet: '•',
    arrow: '→',
    check: '✓',
    cross: '✗',
    star: '★',
    diamond: '◆',
    separator: '•',
  },
};

// Helper to create ASCII box border string
export const createBoxTop = (width: number): string => {
  return TERMINAL.box.topLeft + TERMINAL.box.horizontal.repeat(width - 2) + TERMINAL.box.topRight;
};

export const createBoxBottom = (width: number): string => {
  return TERMINAL.box.bottomLeft + TERMINAL.box.horizontal.repeat(width - 2) + TERMINAL.box.bottomRight;
};

export const createDivider = (width: number): string => {
  return TERMINAL.box.horizontal.repeat(width);
};
