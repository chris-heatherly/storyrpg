const fs = require('fs');
const path = require('path');

function registerRefImageRoutes(app, { refImagesDir, port }) {
  if (!fs.existsSync(refImagesDir)) {
    fs.mkdirSync(refImagesDir, { recursive: true });
  }

  app.use('/ref-images', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.post('/ref-images/upload', async (req, res) => {
    const { data: base64Data, mimeType } = req.body;
    if (!base64Data) return res.status(400).json({ error: 'Missing base64 data' });

    try {
      const buffer = Buffer.from(base64Data, 'base64');
      const ext =
        mimeType?.includes('jpeg') || mimeType?.includes('jpg')
          ? 'jpg'
          : mimeType?.includes('webp')
            ? 'webp'
            : 'png';
      const filename = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
      const filePath = path.join(refImagesDir, filename);
      fs.writeFileSync(filePath, buffer);

      let url;
      try {
        const contentType =
          mimeType || (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', new Blob([buffer], { type: contentType }), filename);
        const catboxRes = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
        const catboxUrl = (await catboxRes.text()).trim();
        if (catboxRes.ok && catboxUrl.startsWith('https://')) {
          url = catboxUrl;
          console.log(`[Proxy] ref-images: Uploaded to catbox.moe: ${url}`);
        } else {
          throw new Error(`catbox.moe returned: ${catboxUrl}`);
        }
      } catch (catboxErr) {
        console.warn(`[Proxy] ref-images: catbox.moe upload failed (${catboxErr.message}), falling back to ngrok URL`);
        const baseUrl = process.env.PROXY_PUBLIC_URL || `http://localhost:${port}`;
        url = `${baseUrl.replace(/\/$/, '')}/ref-images/${filename}`;
      }

      res.json({ url, filename });
    } catch (error) {
      console.error('[Proxy] ref-images upload error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/ref-images/:filename', (req, res) => {
    const { filename } = req.params;
    if (filename.includes('..')) return res.status(403).send('Invalid path');

    const filePath = path.join(refImagesDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

    const ext = path.extname(filename).toLowerCase();
    const contentTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    };
    res.set('Content-Type', contentTypes[ext] || 'application/octet-stream');
    res.sendFile(filePath, { dotfiles: 'allow' });
  });
}

module.exports = {
  registerRefImageRoutes,
};
