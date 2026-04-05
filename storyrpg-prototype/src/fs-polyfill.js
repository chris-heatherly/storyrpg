/**
 * Simple Node.js fs polyfill for React Native (CommonJS version)
 * This file is designed to be as robust as possible to prevent "is not a function" errors.
 */

const noop = () => {};
const asyncNoop = async () => {};
const falseNoop = () => false;
const emptyStringNoop = () => '';
const emptyArrayNoop = () => [];

const fsMethods = {
  existsSync: (path) => {
    console.log('[fs-polyfill] existsSync called for:', path);
    return false;
  },
  mkdirSync: (path, options) => {
    console.log('[fs-polyfill] mkdirSync called for:', path);
  },
  readFileSync: (path, options) => {
    console.log('[fs-polyfill] readFileSync called for:', path);
    return '';
  },
  writeFileSync: (path, data, options) => {
    console.log('[fs-polyfill] writeFileSync called for:', path);
  },
  readdirSync: (path, options) => {
    console.log('[fs-polyfill] readdirSync called for:', path);
    return [];
  },
  statSync: (path) => {
    console.log('[fs-polyfill] statSync called for:', path);
    return {
      isDirectory: () => false,
      isFile: () => false,
      size: 0,
      mtime: new Date(),
      birthtime: new Date(),
    };
  },
  lstatSync: (path) => {
    console.log('[fs-polyfill] lstatSync called for:', path);
    return {
      isDirectory: () => false,
      isFile: () => false,
      size: 0,
      mtime: new Date(),
      birthtime: new Date(),
    };
  },
  chmodSync: noop,
  chownSync: noop,
  closeSync: noop,
  copyFileSync: noop,
  fstatSync: () => ({ size: 0 }),
  fsyncSync: noop,
  ftruncateSync: noop,
  futimesSync: noop,
  linkSync: noop,
  readSync: () => 0,
  readlinkSync: emptyStringNoop,
  realpathSync: (p) => p,
  renameSync: noop,
  rmdirSync: noop,
  rmSync: noop,
  symlinkSync: noop,
  truncateSync: noop,
  unlinkSync: noop,
  utimesSync: noop,
  writeSync: () => 0,
};

const promises = {
  readFile: async (path, options) => {
    console.log('[fs-polyfill] promises.readFile called for:', path);
    return '';
  },
  writeFile: async (path, data, options) => {
    console.log('[fs-polyfill] promises.writeFile called for:', path);
  },
  mkdir: async (path, options) => {
    console.log('[fs-polyfill] promises.mkdir called for:', path);
  },
  readdir: async (path, options) => {
    console.log('[fs-polyfill] promises.readdir called for:', path);
    return [];
  },
  stat: async (path) => fsMethods.statSync(path),
  lstat: async (path) => fsMethods.lstatSync(path),
  access: asyncNoop,
  appendFile: asyncNoop,
  chmod: asyncNoop,
  chown: asyncNoop,
  copyFile: asyncNoop,
  link: asyncNoop,
  opendir: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
  readlink: async () => '',
  realpath: async (p) => p,
  rename: asyncNoop,
  rm: asyncNoop,
  rmdir: asyncNoop,
  symlink: asyncNoop,
  truncate: asyncNoop,
  unlink: asyncNoop,
  utimes: asyncNoop,
};

// Base fs object
const fs = {
  ...fsMethods,
  promises,
  constants: {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
  },
};

// Add default for ESM interop
fs.default = fs;

// Create a Proxy to handle any missing methods gracefully
const robustFs = new Proxy(fs, {
  get: (target, prop) => {
    if (prop in target) {
      return target[prop];
    }
    
    // If a missing method is requested, return a noop to prevent crashes
    console.warn(`[fs-polyfill] Missing property/method requested: fs.${String(prop)}`);
    
    // Common properties that might be checked
    if (prop === 'realpath') return (p, cb) => (cb ? cb(null, p) : p);
    
    return noop;
  }
});

module.exports = robustFs;
