const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.resolve(__dirname, '..', '.model-cache.json');
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch (err) {
    console.warn('[ModelScan] Failed to load cache:', err.message);
  }
  return null;
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[ModelScan] Failed to save cache:', err.message);
  }
}

function isCacheStale(cache) {
  if (!cache || !cache.scannedAt) return true;
  return Date.now() - cache.scannedAt > STALE_MS;
}

function formatModelLabel(modelId) {
  return modelId
    .replace(/^models\//, '')
    .split(/[-_]/)
    .map(part => {
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ')
    .replace(/\s+\d{8}$/, match => ` (${match.trim()})`)
    .trim();
}

async function scanAnthropicModels(apiKey) {
  if (!apiKey) return [];
  try {
    const resp = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!resp.ok) {
      console.warn(`[ModelScan] Anthropic API returned ${resp.status}: ${resp.statusText}`);
      return [];
    }
    const body = await resp.json();
    const models = (body.data || [])
      .filter(m => m.type === 'model' && m.id && !m.id.includes('embed'))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .map(m => ({
        value: m.id,
        label: m.display_name || formatModelLabel(m.id),
        createdAt: m.created_at || null,
      }));
    console.log(`[ModelScan] Anthropic: found ${models.length} models`);
    return models;
  } catch (err) {
    console.warn('[ModelScan] Anthropic scan failed:', err.message);
    return [];
  }
}

async function scanGeminiModels(apiKey) {
  if (!apiKey) return [];
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`
    );
    if (!resp.ok) {
      console.warn(`[ModelScan] Gemini API returned ${resp.status}: ${resp.statusText}`);
      return [];
    }
    const body = await resp.json();
    const models = (body.models || [])
      .filter(m => {
        const methods = m.supportedGenerationMethods || [];
        return methods.includes('generateContent') && !m.name?.includes('embed');
      })
      .sort((a, b) => (b.name || '').localeCompare(a.name || ''))
      .map(m => {
        const id = (m.name || '').replace(/^models\//, '');
        return {
          value: id,
          label: m.displayName || formatModelLabel(id),
          description: m.description || null,
        };
      });
    console.log(`[ModelScan] Gemini: found ${models.length} models`);
    return models;
  } catch (err) {
    console.warn('[ModelScan] Gemini scan failed:', err.message);
    return [];
  }
}

function getAtlasCloudImageModels() {
  return [
    { value: 'google/nano-banana-2/text-to-image', label: 'Nano Banana 2', price: '$0.072/pic', description: 'Google NB2. 14 ref images, 5-char consistency, 4K, auto /edit routing. Best for StoryRPG.' },
    { value: 'google/nano-banana-pro/text-to-image', label: 'Nano Banana Pro', price: '$0.14/pic', description: 'Google NB Pro. 10 ref images, 5-char consistency, native 2K/4K. Premium quality.' },
    { value: 'bytedance/seedream-v5.0-lite', label: 'Seedream v5.0 Lite', price: '$0.035/pic', description: 'ByteDance latest. Visual CoT, 14 ref images, batch up to 15, 4K.' },
    { value: 'bytedance/seedream-v4.5', label: 'Seedream v4.5', price: '$0.038/pic', description: 'High quality, batch + edit support, 10 ref images.' },
    { value: 'openai/gpt-image-1.5/text-to-image', label: 'GPT Image 1.5', price: '$0.008/pic', description: 'OpenAI fast text-to-image. Photorealistic, concept art, stylized. Text only.' },
    { value: 'qwen/qwen-image-2.0/text-to-image', label: 'Qwen Image 2.0', price: '$0.028/pic', description: 'Alibaba enhanced image quality and prompt understanding. Up to 2K.' },
    { value: 'qwen/qwen-image-2.0-pro/text-to-image', label: 'Qwen Image 2.0 Pro', price: '$0.06/pic', description: 'Professional-grade. Superior quality, advanced prompt understanding.' },
    { value: 'alibaba/wan-2.7/text-to-image', label: 'Wan-2.7', price: '$0.03/pic', description: 'Fast iteration, strong prompt fidelity. Illustration and photorealistic.' },
    { value: 'alibaba/wan-2.7-pro/text-to-image', label: 'Wan-2.7 Pro', price: '$0.075/pic', description: 'Higher fidelity, 4K-ready workflows.' },
    { value: 'bytedance/seedream-v4', label: 'Seedream v4.0', price: '$0.026/pic', description: 'Good quality, lower cost.' },
    { value: 'z-image/turbo', label: 'Z-Image Turbo', price: '$0.01/pic', description: 'Sub-second generation, great for testing. Text only.' },
    { value: 'alibaba/qwen-image/text-to-image-plus', label: 'Qwen-Image Plus', price: '$0.021/pic', description: 'Good text rendering in images.' },
  ];
}

async function scanAtlasCloudModels(apiKey) {
  const knownModels = getAtlasCloudImageModels();
  if (!apiKey) return knownModels;
  try {
    const resp = await fetch('https://api.atlascloud.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      console.log(`[ModelScan] Atlas Cloud /v1/models returned ${resp.status}, using known catalog`);
      return knownModels;
    }
    const body = await resp.json();
    const apiModels = (body.data || [])
      .filter(m => {
        const id = m.id || '';
        return id.includes('image') || id.includes('seedream') || id.includes('flux')
          || id.includes('z-image') || id.includes('ideogram') || id.includes('hidream')
          || id.includes('qwen-image') || id.includes('nano-banana')
          || id.includes('gpt-image') || id.includes('wan-');
      })
      .map(m => ({
        value: m.id,
        label: formatModelLabel(m.id),
        description: m.description || null,
      }));
    if (apiModels.length > 0) {
      console.log(`[ModelScan] Atlas Cloud: found ${apiModels.length} image models from API`);
      const knownIds = new Set(apiModels.map(m => m.value));
      const merged = [...apiModels];
      for (const km of knownModels) {
        if (!knownIds.has(km.value)) merged.push(km);
      }
      return merged;
    }
    console.log('[ModelScan] Atlas Cloud: API returned no image models, using known catalog');
    return knownModels;
  } catch (err) {
    console.log('[ModelScan] Atlas Cloud scan failed, using known catalog:', err.message);
    return knownModels;
  }
}

async function performScan(overrideKeys) {
  const anthropicKey =
    overrideKeys?.anthropicApiKey ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ||
    '';
  const geminiKey =
    overrideKeys?.geminiApiKey ||
    process.env.EXPO_PUBLIC_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    '';
  const atlasKey =
    overrideKeys?.atlasCloudApiKey ||
    process.env.ATLAS_CLOUD_API_KEY ||
    '';

  const [anthropic, gemini, atlasCloud] = await Promise.all([
    scanAnthropicModels(anthropicKey),
    scanGeminiModels(geminiKey),
    scanAtlasCloudModels(atlasKey),
  ]);

  const result = {
    scannedAt: Date.now(),
    providers: {
      anthropic: anthropic.length > 0 ? anthropic : null,
      gemini: gemini.length > 0 ? gemini : null,
      atlasCloud: atlasCloud.length > 0 ? atlasCloud : null,
    },
  };

  saveCache(result);
  return result;
}

function registerModelScanRoutes(app) {
  app.get('/models/available', async (_req, res) => {
    try {
      let cache = loadCache();
      if (isCacheStale(cache)) {
        console.log('[ModelScan] Cache stale, scanning...');
        cache = await performScan();
      }
      res.json(cache);
    } catch (err) {
      console.error('[ModelScan] Error serving models:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/models/scan', async (req, res) => {
    try {
      const overrideKeys = {
        anthropicApiKey: req.body?.anthropicApiKey,
        geminiApiKey: req.body?.geminiApiKey,
      };
      console.log('[ModelScan] Forced scan requested');
      const result = await performScan(overrideKeys);
      res.json(result);
    } catch (err) {
      console.error('[ModelScan] Scan error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Auto-scan on server startup if cache is stale
  const cache = loadCache();
  if (isCacheStale(cache)) {
    console.log('[ModelScan] Startup: scheduling initial scan in 5s...');
    setTimeout(() => performScan().catch(err => {
      console.warn('[ModelScan] Startup scan failed:', err.message);
    }), 5000);
  } else {
    const age = Math.round((Date.now() - cache.scannedAt) / 3600000);
    console.log(`[ModelScan] Cache is fresh (${age}h old)`);
  }
}

module.exports = { registerModelScanRoutes };
