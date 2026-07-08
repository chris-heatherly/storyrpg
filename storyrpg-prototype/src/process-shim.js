/**
 * Must load before any module that pulls in readable-stream / crypto-browserify.
 * Those packages call process.version.slice(...) at module init; process/browser
 * leaves version undefined in web bundles.
 */
(function ensureProcessShim() {
  var g = typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : undefined;
  if (!g) return;

  if (!g.process) {
    try {
      g.process = require('process/browser');
    } catch (_) {
      g.process = { env: {}, nextTick: function (cb) { setTimeout(cb, 0); } };
    }
  }

  var proc = g.process;
  if (!proc.env) proc.env = {};
  if (typeof proc.version !== 'string') proc.version = 'v18.0.0';
  if (typeof proc.browser === 'undefined') proc.browser = true;
  if (typeof proc.nextTick !== 'function') {
    proc.nextTick = function (cb) {
      var args = Array.prototype.slice.call(arguments, 1);
      setTimeout(function () { cb.apply(null, args); }, 0);
    };
  }
})();
