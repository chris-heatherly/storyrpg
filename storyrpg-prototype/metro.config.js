const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Force using CommonJS exports for web to avoid import.meta issues
config.resolver.unstable_conditionNames = ['require', 'default'];

// Polyfill paths
const fsPolyfill = path.resolve(__dirname, 'src/fs-polyfill.js');
const fsPromisesPolyfill = path.resolve(__dirname, 'src/fs-promises-polyfill.js');
const pathPolyfill = path.resolve(__dirname, 'src/path-polyfill.js');

// Explicitly point fs and path to our polyfills
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'fs': fsPolyfill,
  'node:fs': fsPolyfill,
  'fs/promises': fsPromisesPolyfill,
  'node:fs/promises': fsPromisesPolyfill,
  'path': pathPolyfill,
  'node:path': pathPolyfill,
  'os': require.resolve('os-browserify/browser'),
  'crypto': require.resolve('crypto-browserify'),
  'stream': require.resolve('stream-browserify'),
  'buffer': require.resolve('buffer'),
};

// Stub out native Node modules that only run in the worker process
const emptyModule = path.resolve(__dirname, 'src/empty-module.js');

// Use resolveRequest as a more aggressive redirection for modules inside node_modules
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'fs' || moduleName === 'node:fs') {
    return {
      filePath: fsPolyfill,
      type: 'sourceFile',
    };
  }
  if (moduleName === 'fs/promises' || moduleName === 'node:fs/promises') {
    return {
      filePath: fsPromisesPolyfill,
      type: 'sourceFile',
    };
  }
  if (moduleName === 'path' || moduleName === 'node:path') {
    return {
      filePath: pathPolyfill,
      type: 'sourceFile',
    };
  }
  // sharp is a native Node.js image library used only in the worker process.
  // Stub it out for Metro so it doesn't try to bundle native bindings.
  if (moduleName === 'sharp') {
    return {
      filePath: emptyModule,
      type: 'sourceFile',
    };
  }
  
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
