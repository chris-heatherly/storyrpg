const fs = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('./atomicIo');
const { Storage } = require('@google-cloud/storage');
const {
  getStoryStorageMode,
  getGcsBucketName,
  mapProxyPathToGcsObjectPath,
} = require('./gcsConfig');

function createSafeWritePathResolver({ rootDir, allowedRoots }) {
  return function assertSafeWritePath(requestedPath) {
    if (typeof requestedPath !== 'string' || requestedPath.trim().length === 0) {
      throw new Error('Invalid path');
    }
    if (path.isAbsolute(requestedPath)) {
      throw new Error('Absolute paths are not allowed');
    }
    if (requestedPath.includes('..')) {
      throw new Error('Invalid path');
    }

    const resolved = path.resolve(rootDir, requestedPath);
    const isAllowed = allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
    if (!isAllowed) {
      throw new Error(`Write path not allowed: ${requestedPath}`);
    }
    return resolved;
  };
}

function registerFileRoutes(app, { rootDir, storiesDir, refImagesDir, pipelineMemoryRoot, workerCheckpointOutputDir }) {
  const assertSafeWritePath = createSafeWritePathResolver({
    rootDir,
    allowedRoots: [storiesDir, refImagesDir, pipelineMemoryRoot, workerCheckpointOutputDir],
  });

  app.post('/write-file', async (req, res) => {
    const { filePath, content, isBase64 } = req.body;
    if (!filePath || content === undefined) return res.status(400).send('Missing data');

    try {
      const mode = getStoryStorageMode();

      // GCS mode: only support story output writes (generated-stories/*)
      if (mode === 'gcs') {
        const bucketName = getGcsBucketName();
        if (!bucketName) throw new Error('GCS_BUCKET_NAME is required when STORY_STORAGE_MODE=gcs');

        const objectPath = mapProxyPathToGcsObjectPath(filePath);
        if (!objectPath) {
          // For safety, do not allow arbitrary uploads in GCS mode.
          throw new Error(`GCS write path not allowed: ${filePath}`);
        }

        const storage = new Storage();
        const bucket = storage.bucket(bucketName);
        const file = bucket.file(objectPath);

        if (isBase64) {
          const buffer = Buffer.from(content, 'base64');
          await file.save(buffer, {
            resumable: false,
            contentType: 'application/octet-stream',
            metadata: { cacheControl: 'public, max-age=31536000, immutable' },
          });
          console.log(`[Proxy:GCS] Wrote binary object (${buffer.length} bytes): gs://${bucketName}/${objectPath}`);
        } else {
          await file.save(String(content), {
            resumable: false,
            contentType: 'application/json; charset=utf-8',
            metadata: { cacheControl: objectPath.endsWith('.json') ? 'no-cache' : 'public, max-age=31536000, immutable' },
          });
          console.log(`[Proxy:GCS] Wrote text object: gs://${bucketName}/${objectPath}`);
        }

        return res.json({ success: true, storage: 'gcs', objectPath });
      }

      // Local mode (existing behavior)
      const absolutePath = assertSafeWritePath(filePath);
      const directory = path.dirname(absolutePath);
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });

      if (isBase64) {
        const buffer = Buffer.from(content, 'base64');
        atomicWriteFileSync(absolutePath, buffer);
        console.log(`[Proxy] Wrote binary file (${buffer.length} bytes): ${filePath}`);
      } else {
        atomicWriteFileSync(absolutePath, Buffer.from(String(content), 'utf8'));
      }
      return res.json({ success: true, storage: 'local' });
    } catch (error) {
      res.status(500).send(error.message);
    }
  });
}

module.exports = {
  registerFileRoutes,
};
