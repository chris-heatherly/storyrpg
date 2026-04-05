const fs = require('fs');
const path = require('path');

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

  app.post('/write-file', (req, res) => {
    const { filePath, content, isBase64 } = req.body;
    if (!filePath || content === undefined) return res.status(400).send('Missing data');

    try {
      const absolutePath = assertSafeWritePath(filePath);
      const directory = path.dirname(absolutePath);
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });

      if (isBase64) {
        const buffer = Buffer.from(content, 'base64');
        fs.writeFileSync(absolutePath, buffer);
        console.log(`[Proxy] Wrote binary file (${buffer.length} bytes): ${filePath}`);
      } else {
        fs.writeFileSync(absolutePath, content, 'utf8');
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).send(error.message);
    }
  });
}

module.exports = {
  registerFileRoutes,
};
