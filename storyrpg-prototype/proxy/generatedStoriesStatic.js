const fs = require('fs');
const path = require('path');

const {
  getStoryStorageMode,
  getGcsBucketName,
  getGcsPublicBaseUrl,
  mapProxyPathToGcsObjectPath,
} = require('./gcsConfig');

const CONTENT_TYPES = [
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.json', 'application/json'],
  ['.mp3', 'audio/mpeg'],
];

function contentTypeFor(filePath) {
  const match = CONTENT_TYPES.find(([ext]) => filePath.endsWith(ext));
  return match ? match[1] : 'application/octet-stream';
}

/**
 * Resolve a request path to an absolute file path confined to storiesDir.
 * Returns null when the path escapes the root (e.g. via `../` segments) —
 * mirrors resolveInside() in artifactRoutes.js. Express does NOT normalize
 * `../` out of req.path, so raw clients can otherwise traverse to any file
 * the process can read (.env, source, host files).
 */
function resolveGeneratedStoryPath(storiesDir, requestPath) {
  if (typeof requestPath !== 'string' || requestPath.includes('\0')) return null;
  const rootAbs = path.resolve(storiesDir);
  const resolved = path.resolve(rootAbs, `.${path.sep}${requestPath.replace(/^\/+/, '')}`);
  if (resolved !== rootAbs && !resolved.startsWith(`${rootAbs}${path.sep}`)) return null;
  return resolved;
}

/**
 * Static file middleware for /generated-stories (permissive CORS so the web
 * build works). Serves local files confined to storiesDir, or 302-redirects
 * to GCS objects when STORY_STORAGE_MODE=gcs.
 */
function createGeneratedStoriesStatic({ storiesDir }) {
  return (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Private-Network', 'true');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    const mode = getStoryStorageMode();
    if (mode === 'gcs') {
      const bucket = getGcsBucketName();
      if (!bucket) return res.status(500).send('GCS_BUCKET_NAME is required when STORY_STORAGE_MODE=gcs');

      // Redirect proxy-style paths to GCS objects.
      // /generated-stories/<runDir>/...  ->  https://storage.googleapis.com/<bucket>/stories/<runDir>/...
      const proxyPath = `generated-stories/${req.path.replace(/^\/+/, '')}`;
      const objectPath = mapProxyPathToGcsObjectPath(proxyPath);
      if (!objectPath) return res.status(404).send('Not found');

      const publicBase = getGcsPublicBaseUrl();
      const url = `${publicBase}/${objectPath}`.replace(/([^:]\/)\/+/g, '$1');
      return res.redirect(302, url);
    }

    const fullPath = resolveGeneratedStoryPath(storiesDir, req.path);
    if (!fullPath || !fs.existsSync(fullPath)) return res.status(404).send('File not found');

    res.set('Content-Type', contentTypeFor(fullPath));

    const stream = fs.createReadStream(fullPath);
    stream.on('error', (err) => {
      console.error(`[Proxy] Stream error: ${err.message}`);
      if (!res.headersSent) res.status(500).send('Error');
    });
    stream.pipe(res);
  };
}

module.exports = { createGeneratedStoriesStatic, resolveGeneratedStoryPath };
