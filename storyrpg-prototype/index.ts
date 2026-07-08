/**
 * Entry point for the StoryRPG prototype
 *
 * Node.js module aliasing for `fs`/`path`/`os`/`crypto`/`stream`/`buffer` is
 * handled by `metro.config.js` (Metro resolver) and `babel.config.js`
 * (module-resolver alias). That covers every `import` / `require` of those
 * modules inside the bundle.
 *
 * process.version must exist before any import that pulls readable-stream
 * (via crypto-browserify). ES import hoisting would otherwise load those
 * modules before an inline shim — so the shim is a side-effect require first.
 */

require('./src/process-shim');

import { registerRootComponent } from 'expo';

import App from '@storyrpg/app-entry';

registerRootComponent(App);
