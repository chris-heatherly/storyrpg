/**
 * Entry point for the StoryRPG prototype
 *
 * Node.js module aliasing for `fs`/`path`/`os`/`crypto`/`stream`/`buffer` is
 * handled by `metro.config.js` (Metro resolver) and `babel.config.js`
 * (module-resolver alias). That covers every `import` / `require` of those
 * modules inside the bundle.
 *
 * Nothing in the app reads from `global.fs` / `global.path`, so we only
 * guarantee a minimal `process` shim here for libraries that poke at
 * `process.env` / `process.nextTick` directly.
 */

if (typeof global !== 'undefined') {
  const maybeProcess = (global as unknown as { process?: NodeJS.Process }).process;
  if (!maybeProcess) {
    (global as unknown as { process: NodeJS.Process }).process =
      require('process/browser') as NodeJS.Process;
  }

  const proc = (global as unknown as { process: NodeJS.Process }).process;
  if (proc) {
    if (!proc.env) {
      (proc as unknown as { env: Record<string, string | undefined> }).env = {};
    }
    if (typeof proc.nextTick !== 'function') {
      (proc as unknown as { nextTick: (cb: (...args: unknown[]) => void, ...args: unknown[]) => void }).nextTick =
        (cb, ...args) => setTimeout(() => cb(...args), 0);
    }
  }
}

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
