/**
 * Entry point for the StoryRPG prototype
 */

// 1. AT THE VERY TOP: Apply Node.js polyfills for React Native
if (typeof global !== 'undefined') {
  console.log('[Entry] Establishing global Node.js polyfills');
  
  const fsPolyfill = require('./src/fs-polyfill');
  const pathPolyfill = require('./src/path-polyfill');
  
  // Force apply to global.fs
  // @ts-ignore
  if (!global.fs) {
    // @ts-ignore
    global.fs = fsPolyfill;
  } else {
    // @ts-ignore
    Object.assign(global.fs, fsPolyfill);
  }
  
  // Force apply to global.path
  // @ts-ignore
  if (!global.path) {
    // @ts-ignore
    global.path = pathPolyfill;
  } else {
    // @ts-ignore
    Object.assign(global.path, pathPolyfill);
  }
  
  // Ensure process.env exists and has basic methods
  // @ts-ignore
  if (!global.process) {
    // @ts-ignore
    global.process = require('process/browser');
  }
  
  // @ts-ignore
  if (global.process) {
    if (!global.process.env) {
      // @ts-ignore
      global.process.env = {};
    }
    if (!global.process.nextTick) {
      // @ts-ignore
      global.process.nextTick = (cb: any, ...args: any[]) => setTimeout(() => cb(...args), 0);
    }
  }
}

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
