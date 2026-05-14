/**
 * MidAPI (Midjourney) proxy routes:
 *   GET  /midapi-test              — diagnostic sweep across task types
 *   GET  /midapi-poll/:taskId      — quick raw poll for diagnostics
 *   POST /midapi-callback          — webhook receiver (caches terminal results)
 *   *   /midapi/*                  — generic passthrough with cache short-circuit
 *
 * The exported `midapiCallbackCache` is shared with the main proxy for
 * periodic GC from the memory-watchdog loop.
 */

const fs = require('fs');
const path = require('path');

function registerMidApiRoutes(app, { rootDir }) {
  const midapiCallbackCache = new Map(); // taskId → { receivedAt, data }
  let lastMidapiToken = null;

  app.get('/midapi-test', async (req, res) => {
    if (!lastMidapiToken) {
      return res.status(400).json({ error: 'No MidAPI token captured yet. Make a generation request first.' });
    }

    const publicImageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png';
    const refImagesDir = path.resolve(rootDir, '.ref-images');
    let ngrokImageUrl = null;
    if (fs.existsSync(refImagesDir)) {
      const files = fs.readdirSync(refImagesDir).filter((f) => f.match(/\.(jpg|jpeg|png)$/i));
      if (files.length > 0 && process.env.PROXY_PUBLIC_URL) {
        ngrokImageUrl = `${process.env.PROXY_PUBLIC_URL}/ref-images/${files[files.length - 1]}`;
      }
    }

    const tests = [];
    const baseUrl = 'https://api.midapi.ai/api/v1/mj';
    const headers = { 'Authorization': `Bearer ${lastMidapiToken}`, 'Content-Type': 'application/json' };

    try {
      const r = await fetch(`${baseUrl}/generate`, {
        method: 'POST', headers,
        body: JSON.stringify({ taskType: 'mj_txt2img', prompt: 'a red circle on white background --v 7', speed: 'fast', aspectRatio: '1:1', version: '7', stylization: 100, weirdness: 0 }),
      });
      const d = await r.json();
      tests.push({ test: 'txt2img (no images)', status: r.status, code: d.code, msg: d.msg, taskId: d.data?.taskId || null });
    } catch (e) { tests.push({ test: 'txt2img', error: e.message }); }

    try {
      const r = await fetch(`${baseUrl}/generate`, {
        method: 'POST', headers,
        body: JSON.stringify({ taskType: 'mj_omni_reference', prompt: 'a person standing, front view --v 7', speed: 'fast', aspectRatio: '1:1', version: '7', stylization: 100, weirdness: 0, fileUrls: [publicImageUrl], ow: 100 }),
      });
      const d = await r.json();
      tests.push({ test: 'omni_reference (public URL)', status: r.status, code: d.code, msg: d.msg, taskId: d.data?.taskId || null });
    } catch (e) { tests.push({ test: 'omni_reference (public URL)', error: e.message }); }

    if (ngrokImageUrl) {
      try {
        const r = await fetch(`${baseUrl}/generate`, {
          method: 'POST', headers,
          body: JSON.stringify({ taskType: 'mj_omni_reference', prompt: 'a person standing, front view --v 7', speed: 'fast', aspectRatio: '1:1', version: '7', stylization: 100, weirdness: 0, fileUrls: [ngrokImageUrl], ow: 100 }),
        });
        const d = await r.json();
        tests.push({ test: 'omni_reference (ngrok URL)', status: r.status, code: d.code, msg: d.msg, taskId: d.data?.taskId || null, imageUrl: ngrokImageUrl });
      } catch (e) { tests.push({ test: 'omni_reference (ngrok URL)', error: e.message }); }
    } else {
      tests.push({ test: 'omni_reference (ngrok URL)', skipped: true, reason: 'No ngrok ref images found' });
    }

    try {
      const r = await fetch(`${baseUrl}/generate`, {
        method: 'POST', headers,
        body: JSON.stringify({ taskType: 'mj_img2img', prompt: 'a person standing, cartoon style --v 7', speed: 'fast', aspectRatio: '1:1', version: '7', stylization: 100, weirdness: 0, fileUrls: [publicImageUrl] }),
      });
      const d = await r.json();
      tests.push({ test: 'img2img (public URL)', status: r.status, code: d.code, msg: d.msg, taskId: d.data?.taskId || null });
    } catch (e) { tests.push({ test: 'img2img (public URL)', error: e.message }); }

    const catboxRefDir = path.resolve(rootDir, '.ref-images');
    let catboxTestUrl = null;
    if (fs.existsSync(catboxRefDir)) {
      const catboxFiles = fs.readdirSync(catboxRefDir).filter((f) => f.match(/\.(jpg|jpeg|png)$/i));
      if (catboxFiles.length > 0) {
        try {
          const imgBuf = fs.readFileSync(path.join(catboxRefDir, catboxFiles[catboxFiles.length - 1]));
          const form = new FormData();
          form.append('reqtype', 'fileupload');
          form.append('fileToUpload', new Blob([imgBuf], { type: 'image/jpeg' }), 'test-ref.jpg');
          const cbRes = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
          catboxTestUrl = (await cbRes.text()).trim();
          if (!catboxTestUrl.startsWith('https://')) catboxTestUrl = null;
        } catch (e) { console.warn('[Proxy] catbox upload for test failed:', e.message); }
      }
    }
    if (catboxTestUrl) {
      try {
        const r = await fetch(`${baseUrl}/generate`, {
          method: 'POST', headers,
          body: JSON.stringify({ taskType: 'mj_omni_reference', prompt: 'a person standing, front view --v 7', speed: 'fast', aspectRatio: '1:1', version: '7', stylization: 100, weirdness: 0, fileUrls: [catboxTestUrl], ow: 100 }),
        });
        const d = await r.json();
        tests.push({ test: 'omni_reference (catbox URL)', status: r.status, code: d.code, msg: d.msg, taskId: d.data?.taskId || null, imageUrl: catboxTestUrl });
      } catch (e) { tests.push({ test: 'omni_reference (catbox URL)', error: e.message }); }
    } else {
      tests.push({ test: 'omni_reference (catbox URL)', skipped: true, reason: 'No ref images to upload' });
    }

    try {
      const r = await fetch('https://api.midapi.ai/common/get-account-credits', { method: 'GET', headers });
      const d = await r.json();
      tests.push({ test: 'account credits', status: r.status, data: d });
    } catch (e) { tests.push({ test: 'account credits', error: e.message }); }

    console.log('[Proxy] MidAPI diagnostic: waiting 25s for tasks to process...');
    await new Promise((r) => setTimeout(r, 25000));

    const pollResults = [];
    for (const t of tests) {
      if (!t.taskId) continue;
      try {
        const r = await fetch(`${baseUrl}/record-info?taskId=${t.taskId}`, { method: 'GET', headers });
        const d = await r.json();
        const td = d.data || {};
        pollResults.push({
          test: t.test,
          taskId: t.taskId,
          successFlag: td.successFlag,
          errorMessage: td.errorMessage || null,
          hasResultUrls: !!(td.resultInfoJson?.resultUrls?.length),
          resultUrlCount: td.resultInfoJson?.resultUrls?.length || 0,
        });
      } catch (e) { pollResults.push({ test: t.test, taskId: t.taskId, pollError: e.message }); }
    }

    console.log('[Proxy] MidAPI diagnostic submit results:', JSON.stringify(tests, null, 2));
    console.log('[Proxy] MidAPI diagnostic poll results:', JSON.stringify(pollResults, null, 2));
    res.json({ timestamp: new Date().toISOString(), submits: tests, pollAfter25s: pollResults });
  });

  app.get('/midapi-poll/:taskId', async (req, res) => {
    if (!lastMidapiToken) return res.status(400).json({ error: 'No token' });
    try {
      const r = await fetch(`https://api.midapi.ai/api/v1/mj/record-info?taskId=${req.params.taskId}`, {
        method: 'GET', headers: { 'Authorization': `Bearer ${lastMidapiToken}` },
      });
      const d = await r.json();
      res.json(d);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/midapi-callback', (req, res) => {
    const callbackData = req.body;
    const taskId = callbackData?.data?.taskId || callbackData?.taskId;
    if (!taskId) {
      console.warn('[Proxy] MidAPI callback received without taskId:', JSON.stringify(callbackData).substring(0, 300));
      return res.status(200).json({ received: true });
    }
    const d = callbackData?.data || callbackData;
    const successFlag = d?.successFlag;
    const hasResultUrls = Array.isArray(d?.resultUrls) && d.resultUrls.length > 0;
    const hasNestedUrls = Array.isArray(d?.resultInfoJson?.resultUrls) && d.resultInfoJson.resultUrls.length > 0;
    const callbackCode = callbackData?.code;
    const isError = callbackCode >= 400 || (callbackData?.msg && callbackData.msg.toLowerCase().includes('fail'));
    const isTerminal = successFlag === 1 || successFlag === 2 || successFlag === 3 || hasResultUrls || hasNestedUrls || isError;
    console.log(`[Proxy] MidAPI CALLBACK received for task ${taskId}, successFlag=${successFlag}, hasResultUrls=${hasResultUrls}, hasNestedUrls=${hasNestedUrls}, isTerminal=${isTerminal}`);
    console.log(`[Proxy] MidAPI callback data keys: ${Object.keys(d || {}).join(', ')}`);
    console.log(`[Proxy] MidAPI callback data: ${JSON.stringify(callbackData).substring(0, 1500)}`);

    if (isTerminal) {
      const normalizedData = callbackData?.code !== undefined ? callbackData : { code: 200, msg: 'callback', data: callbackData };
      midapiCallbackCache.set(taskId, { receivedAt: Date.now(), data: normalizedData });
      console.log(`[Proxy] MidAPI: Cached terminal callback for task ${taskId}`);
    } else {
      console.log(`[Proxy] MidAPI: Skipped caching non-terminal callback for task ${taskId} (no results yet)`);
    }

    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [tid, entry] of midapiCallbackCache) {
      if (entry.receivedAt < cutoff) midapiCallbackCache.delete(tid);
    }

    res.status(200).json({ received: true, taskId });
  });

  app.use('/midapi', async (req, res) => {
    const token = req.headers['x-midapi-token'];
    if (token) lastMidapiToken = token;
    if (!token) {
      console.error('[Proxy] Missing MidAPI token');
      return res.status(401).json({ error: 'Missing API token' });
    }

    const apiPath = req.url.startsWith('/') ? req.url.slice(1) : req.url;

    if (apiPath.includes('record-info') && req.method === 'GET') {
      const taskMatch = apiPath.match(/taskId=([^&]+)/);
      const tid = taskMatch ? taskMatch[1] : null;
      if (tid && midapiCallbackCache.has(tid)) {
        const cached = midapiCallbackCache.get(tid);
        const ageSec = Math.round((Date.now() - cached.receivedAt) / 1000);
        console.log(`[Proxy] MidAPI: Returning CACHED callback result for ${tid} (cached ${ageSec}s ago)`);
        return res.status(200).json(cached.data);
      }
    }

    const url = `https://api.midapi.ai/${apiPath}`;
    const midapiAbort = new AbortController();
    const midapiTimer = setTimeout(() => midapiAbort.abort(), 60000);

    try {
      console.log(`[Proxy] Forwarding ${req.method} to MidAPI: ${url}`);

      let body = req.body;

      if (apiPath.includes('generate') && req.method === 'POST' && body) {
        const publicUrl = process.env.PROXY_PUBLIC_URL;
        if (publicUrl && !body.callBackUrl) {
          body = { ...body, callBackUrl: `${publicUrl.replace(/\/$/, '')}/midapi-callback` };
          console.log(`[Proxy] MidAPI: Injected callBackUrl: ${body.callBackUrl}`);
        }
      }

      const fetchOptions = {
        method: req.method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: midapiAbort.signal,
      };

      if (['POST', 'PUT', 'PATCH'].includes(req.method) && body) {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(midapiTimer);

      console.log(`[Proxy] MidAPI response status: ${response.status}`);

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { rawResponse: text };
      }

      if (response.status >= 400) {
        console.error('[Proxy] MidAPI error response:', data);
      }

      if (apiPath.includes('record-info') && data?.data) {
        const d = data.data;
        const taskMatch = apiPath.match(/taskId=([^&]+)/);
        const tid = taskMatch ? taskMatch[1] : 'unknown';
        if (!global._loggedTaskIds) global._loggedTaskIds = new Map();
        if (!global._loggedTaskIds.has(tid)) {
          global._loggedTaskIds.set(tid, Date.now());
          console.log(`[Proxy] MidAPI FULL poll response for ${tid}:`, JSON.stringify(data).substring(0, 2000));
          if (global._loggedTaskIds.size > 200) {
            const oldest = [...global._loggedTaskIds.entries()].sort((a, b) => a[1] - b[1]).slice(0, 100);
            for (const [k] of oldest) global._loggedTaskIds.delete(k);
          }
        }
        const hasNestedResultUrls = !!(d.resultInfoJson?.resultUrls?.length);
        const hasDirectResultUrls = !!(d.resultUrls?.length);
        const directResultUrlsSample = d.resultUrls ? JSON.stringify(d.resultUrls).substring(0, 200) : 'none';
        console.log(`[Proxy] MidAPI poll: successFlag=${d.successFlag}, status=${d.status}, errorMessage=${d.errorMessage || 'none'}, hasResultUrls(nested)=${hasNestedResultUrls}, hasResultUrls(direct)=${hasDirectResultUrls}`);
        if (hasDirectResultUrls) {
          console.log(`[Proxy] MidAPI poll: direct resultUrls: ${directResultUrlsSample}`);
        }
        if (!global._pollCounts) global._pollCounts = {};
        if (!global._pollCounts[tid]) global._pollCounts[tid] = 0;
        global._pollCounts[tid]++;
        if (global._pollCounts[tid] <= 5 || global._pollCounts[tid] % 10 === 0) {
          console.log(`[Proxy] MidAPI poll #${global._pollCounts[tid]} keys: ${JSON.stringify(Object.keys(d))}`);
        }
        const pollKeys = Object.keys(global._pollCounts);
        if (pollKeys.length > 200) {
          for (const k of pollKeys.slice(0, pollKeys.length - 100)) delete global._pollCounts[k];
        }
      }
      if (apiPath.includes('generate') && req.method === 'POST') {
        console.log('[Proxy] MidAPI generate response:', JSON.stringify(data).substring(0, 500));
      }

      res.status(response.status).json(data);
    } catch (error) {
      clearTimeout(midapiTimer);
      console.error(`[Proxy] Error calling MidAPI: ${error.message}`);
      const isTimeout = String(error?.message || '').toLowerCase().includes('abort');
      res.status(isTimeout ? 504 : 500).json({ error: error.message, timeout: isTimeout });
    }
  });

  return { midapiCallbackCache };
}

module.exports = { registerMidApiRoutes };
