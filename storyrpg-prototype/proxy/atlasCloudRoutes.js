/**
 * Atlas Cloud image-API proxy:
 *   POST /atlas-cloud-api/uploadMedia — multipart upload of base64 image
 *   *   /atlas-cloud-api/*            — generic passthrough proxy
 */

const ATLAS_CLOUD_TIMEOUT_MS = 120000;

function registerAtlasCloudRoutes(app) {
  app.post('/atlas-cloud-api/uploadMedia', async (req, res) => {
    const apiKey = req.headers['x-atlas-cloud-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key' });
    }

    const { base64Data, mimeType, fileName } = req.body || {};
    if (!base64Data) {
      return res.status(400).json({ error: 'Missing base64Data in request body' });
    }

    try {
      const buffer = Buffer.from(base64Data, 'base64');
      const boundary = `----AtlasUpload${Date.now()}`;
      const resolvedMime = mimeType || 'image/png';
      const resolvedName = fileName || `upload.${resolvedMime.includes('jpeg') || resolvedMime.includes('jpg') ? 'jpg' : 'png'}`;

      const bodyParts = [
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="file"; filename="${resolvedName}"\r\n`,
        `Content-Type: ${resolvedMime}\r\n\r\n`,
      ];
      const header = Buffer.from(bodyParts.join(''));
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const multipartBody = Buffer.concat([header, buffer, footer]);

      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), ATLAS_CLOUD_TIMEOUT_MS);

      const response = await fetch('https://api.atlascloud.ai/api/v1/model/uploadMedia', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(multipartBody.length),
        },
        body: multipartBody,
        signal: abort.signal,
      });
      clearTimeout(timer);

      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { rawResponse: text }; }

      console.log(`[Proxy] Atlas Cloud uploadMedia response: ${response.status}`);
      return res.status(response.status).json(data);
    } catch (error) {
      console.error('[Proxy] Atlas Cloud uploadMedia failed:', error.message);
      return res.status(500).json({ error: error.message });
    }
  });

  app.use('/atlas-cloud-api', async (req, res) => {
    const apiKey = req.headers['x-atlas-cloud-key'];
    if (!apiKey) {
      console.error('[Proxy] Missing Atlas Cloud API key');
      return res.status(401).json({ error: 'Missing API key' });
    }

    const apiPath = req.url.startsWith('/') ? req.url.slice(1) : req.url;
    const url = `https://api.atlascloud.ai/api/v1/model/${apiPath}`;

    const MAX_PROXY_RETRIES = 2;

    for (let attempt = 1; attempt <= MAX_PROXY_RETRIES; attempt++) {
      try {
        console.log(`[Proxy] Forwarding ${req.method} to Atlas Cloud: ${url} (attempt ${attempt})`);

        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), ATLAS_CLOUD_TIMEOUT_MS);

        const fetchOptions = {
          method: req.method,
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: abort.signal,
        };

        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
          fetchOptions.body = JSON.stringify(req.body);
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timer);

        console.log(`[Proxy] Atlas Cloud response status: ${response.status}`);

        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { rawResponse: text };
        }

        if (response.status >= 400) {
          console.error('[Proxy] Atlas Cloud error response:', data);
        }

        return res.status(response.status).json(data);
      } catch (error) {
        const isTimeout = String(error?.message || '').toLowerCase().includes('abort');
        console.error(`[Proxy] Atlas Cloud attempt ${attempt}/${MAX_PROXY_RETRIES} failed: ${error.message} (timeout=${isTimeout})`);

        if (attempt >= MAX_PROXY_RETRIES) {
          return res.status(isTimeout ? 504 : 500).json({ error: error.message, timeout: isTimeout });
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  });
}

module.exports = { registerAtlasCloudRoutes };
