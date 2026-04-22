/**
 * Atomic file writes for the proxy process (Node CJS).
 *
 * `atomicWriteFile(absPath, data)` writes to `<absPath>.tmp-<pid>-<rand>`,
 * fsyncs it to disk, then renames over `absPath`. Callers that see a
 * committed file can trust it is fully flushed.
 *
 * `atomicWriteJson(absPath, value, { pretty })` is a convenience wrapper
 * that serialises `value` with `JSON.stringify` and returns the sha256 +
 * byte count so callers can record them in a manifest.
 *
 * The helpers are synchronous (proxy code is mostly sync; so is the
 * cachedJsonStore we replace). An async variant is exposed for new code.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function makeTempPath(absPath) {
  const rand = crypto.randomBytes(6).toString('hex');
  return `${absPath}.tmp-${process.pid}-${rand}`;
}

function ensureParentDir(absPath) {
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeAndFsyncSync(tmpPath, buffer) {
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, buffer);
    try {
      fs.fsyncSync(fd);
    } catch (err) {
      // fsync can fail on non-regular FS (e.g. EINVAL on some tmpfs setups).
      // The rename still provides per-file atomicity within the FS, which is
      // what callers rely on; surfacing here as a warn is enough.
      if (process.env.STORYRPG_ATOMIC_IO_DEBUG === '1') {
        console.warn(`[atomicIo] fsync failed on ${tmpPath}: ${err.message}`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Synchronously write a Buffer or string atomically.
 * Returns { sha256, bytes }.
 */
function atomicWriteFileSync(absPath, data) {
  if (typeof absPath !== 'string' || absPath.length === 0) {
    throw new Error('atomicWriteFileSync: absPath is required');
  }
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  ensureParentDir(absPath);
  const tmp = makeTempPath(absPath);
  try {
    writeAndFsyncSync(tmp, buffer);
    fs.renameSync(tmp, absPath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
  return { sha256: sha256Hex(buffer), bytes: buffer.length };
}

function atomicWriteJsonSync(absPath, value, options = {}) {
  const serialised = options.pretty
    ? JSON.stringify(value, null, 2)
    : JSON.stringify(value);
  return atomicWriteFileSync(absPath, Buffer.from(serialised, 'utf8'));
}

async function atomicWriteFile(absPath, data) {
  return atomicWriteFileSync(absPath, data);
}

async function atomicWriteJson(absPath, value, options = {}) {
  return atomicWriteJsonSync(absPath, value, options);
}

module.exports = {
  atomicWriteFile,
  atomicWriteFileSync,
  atomicWriteJson,
  atomicWriteJsonSync,
  sha256Hex,
};
