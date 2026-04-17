/**
 * Style-setup proxy routes used by the inline Style Setup section on
 * GeneratorScreen.
 *
 * The browser already has paths to run the LLM (via the Anthropic proxy)
 * and the image provider (Gemini direct, Atlas Cloud proxy, Midjourney
 * via midApi proxy) so no new LLM or image endpoints live here. The one
 * thing the UI cannot do client-side is persist a base64 anchor blob to
 * disk for the pipeline worker to read back. That is what this module
 * covers.
 *
 *   POST /style-anchor/save
 *     body: { storyId: string, role: 'character'|'arcStrip'|'environment',
 *             data: string (base64), mimeType: string }
 *     -> { imagePath: string }
 *
 *   GET /style-anchor/:storyId/:role
 *     -> streams the saved anchor image with correct Content-Type
 *
 * Both routes are scoped to generated-stories/<storyId>/style-bible/ so
 * a failed generation never writes outside the story's own directory.
 */

const fs = require('fs');
const path = require('path');

const ALLOWED_ROLES = new Set(['character', 'arcStrip', 'environment']);

function sanitizeStoryId(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[^a-zA-Z0-9_\-.]/g, '').slice(0, 200);
}

function extensionForMime(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function registerStyleRoutes(app, { storiesDir }) {
  if (!storiesDir) {
    throw new Error('registerStyleRoutes requires storiesDir');
  }

  app.post('/style-anchor/save', (req, res) => {
    const body = req.body || {};
    const storyId = sanitizeStoryId(body.storyId);
    const role = typeof body.role === 'string' ? body.role : '';
    const data = typeof body.data === 'string' ? body.data : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/png';

    if (!storyId) {
      return res.status(400).json({ error: 'Missing or invalid storyId' });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: `role must be one of ${Array.from(ALLOWED_ROLES).join(', ')}` });
    }
    if (!data) {
      return res.status(400).json({ error: 'Missing base64 data' });
    }

    try {
      const storyDir = path.resolve(storiesDir, storyId);
      const bibleDir = path.resolve(storyDir, 'style-bible');
      if (!storyDir.startsWith(path.resolve(storiesDir))) {
        return res.status(400).json({ error: 'Resolved storyId escapes storiesDir' });
      }
      fs.mkdirSync(bibleDir, { recursive: true });

      const ext = extensionForMime(mimeType);
      const filename = `${role}.${ext}`;
      const filePath = path.resolve(bibleDir, filename);
      const buffer = Buffer.from(data, 'base64');
      fs.writeFileSync(filePath, buffer);

      const relativePath = path.relative(storiesDir, filePath);
      res.json({
        imagePath: filePath,
        relativePath,
        bytes: buffer.length,
        role,
      });
    } catch (err) {
      console.error('[styleRoutes] save failed:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/style-anchor/:storyId/:role', (req, res) => {
    const storyId = sanitizeStoryId(req.params.storyId);
    const role = req.params.role;
    if (!storyId || !ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: 'Invalid storyId or role' });
    }
    const bibleDir = path.resolve(storiesDir, storyId, 'style-bible');
    if (!bibleDir.startsWith(path.resolve(storiesDir))) {
      return res.status(400).json({ error: 'Resolved path escapes storiesDir' });
    }
    const candidates = ['png', 'jpg', 'jpeg', 'webp'].map((ext) => path.resolve(bibleDir, `${role}.${ext}`));
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) {
      return res.status(404).json({ error: 'Anchor not found' });
    }
    const lower = found.toLowerCase();
    const contentType = lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      ? 'image/jpeg'
      : lower.endsWith('.webp')
      ? 'image/webp'
      : 'image/png';
    res.set('Content-Type', contentType);
    const stream = fs.createReadStream(found);
    stream.on('error', (err) => {
      console.error('[styleRoutes] stream error:', err.message);
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  });
}

module.exports = { registerStyleRoutes };
