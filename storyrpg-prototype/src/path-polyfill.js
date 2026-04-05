/**
 * Simple Node.js path polyfill for React Native (CommonJS version)
 */

const join = (...parts) => {
  let result = parts[0] || '';
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (typeof part !== 'string') continue;
    if (!result.endsWith('/') && !part.startsWith('/')) {
      result += '/';
    } else if (result.endsWith('/') && part.startsWith('/')) {
      result = result.slice(0, -1);
    }
    result += part;
  }
  return result;
};

const resolve = (...parts) => join(...parts);
const basename = (p, ext) => {
  if (typeof p !== 'string') return '';
  const base = p.split('/').pop();
  if (ext && base.endsWith(ext)) {
    return base.slice(0, -ext.length);
  }
  return base;
};
const dirname = (p) => {
  if (typeof p !== 'string') return '.';
  return p.split('/').slice(0, -1).join('/') || '.';
};
const extname = (p) => {
  if (typeof p !== 'string') return '';
  const base = basename(p);
  const idx = base.lastIndexOf('.');
  return idx === -1 ? '' : base.slice(idx);
};

const path = {
  join,
  resolve,
  basename,
  dirname,
  extname,
  sep: '/',
  delimiter: ':',
  parse: (p) => ({
    root: '/',
    dir: dirname(p),
    base: basename(p),
    ext: extname(p),
    name: basename(p, extname(p)),
  }),
  format: (obj) => join(obj.dir || '', obj.base || (obj.name + (obj.ext || ''))),
};

// Add default for ESM interop
path.default = path;

module.exports = path;
