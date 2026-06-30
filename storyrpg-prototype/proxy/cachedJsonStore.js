const fs = require('fs');
const { atomicWriteJsonSync } = require('./atomicIo');

const FLUSH_INTERVAL_MS = 500;

function createCachedStore(filePath, label) {
  let cache = null;
  let dirty = false;
  let flushTimer = null;

  function load() {
    if (cache !== null) return cache;
    try {
      cache = fs.existsSync(filePath)
        ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
        : [];
    } catch (e) {
      console.warn(`[Proxy] Failed to load ${label}:`, e.message);
      cache = [];
    }
    return cache;
  }

  function get() {
    return load();
  }

  function set(rows) {
    cache = rows;
    dirty = true;
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushNow();
    }, FLUSH_INTERVAL_MS);
  }

  function flushNow() {
    if (!dirty || cache === null) return;
    try {
      atomicWriteJsonSync(filePath, cache, { pretty: true });
      dirty = false;
    } catch (e) {
      console.error(`[Proxy] Failed to flush ${label}:`, e.message);
    }
  }

  function flushSync() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushNow();
  }

  return { get, set, flushSync, flushNow };
}

module.exports = {
  createCachedStore,
};
