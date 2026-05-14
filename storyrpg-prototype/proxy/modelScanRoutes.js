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

async function scanOpenAIModels(apiKey) {
  if (!apiKey) return [];
  try {
    const resp = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      console.warn(`[ModelScan] OpenAI API returned ${resp.status}: ${resp.statusText}`);
      return [];
    }
    const body = await resp.json();
    const models = (body.data || [])
      .filter((m) => {
        const id = (m.id || '').toLowerCase();
        return (
          id.startsWith('gpt-') ||
          id.startsWith('o1') ||
          id.startsWith('o3') ||
          id.startsWith('o4')
        );
      })
      .sort((a, b) => (b.id || '').localeCompare(a.id || ''))
      .map((m) => ({
        value: m.id,
        label: formatModelLabel(m.id),
      }));
    console.log(`[ModelScan] OpenAI: found ${models.length} models`);
    return models;
  } catch (err) {
    console.warn('[ModelScan] OpenAI scan failed:', err.message);
    return [];
  }
}

// Complete Atlas Cloud text-to-image catalog (kept in sync with
// https://www.atlascloud.ai/models/list?type=Text-to-Image). When the API
// /v1/models endpoint returns a list we merge with this so models the API
// hasn't published yet still appear.
function getAtlasCloudImageModels() {
  return [
    // Google
    { value: 'google/nano-banana-2/text-to-image', label: 'Nano Banana 2', price: '$0.08/pic', description: "Google's lightweight yet powerful model. 14 ref images, 5-char consistency, 4K, auto /edit routing. Best for StoryRPG." },
    { value: 'google/nano-banana-pro/text-to-image', label: 'Nano Banana Pro', price: '$0.14/pic', description: 'Google NB Pro. 10 ref images, 5-char consistency, native 2K/4K. Premium quality.' },
    { value: 'google/nano-banana-pro/text-to-image-ultra', label: 'Nano Banana Pro Ultra', price: '$0.15/pic', description: 'Next-gen Nano Banana Pro (Ultra). Sharpest detail, richest color control, faster diffusion.' },
    { value: 'google/nano-banana/text-to-image', label: 'Nano Banana', price: '$0.038/pic', description: "Google's state-of-the-art image generation and editing model." },
    { value: 'google/imagen4-ultra', label: 'Imagen 4 Ultra', price: '$0.06/pic', description: "Google's highest-quality image generation model." },
    { value: 'google/imagen4', label: 'Imagen 4', price: '$0.04/pic', description: "Google's Imagen 4 flagship model." },
    { value: 'google/imagen4-fast', label: 'Imagen 4 Fast', price: '$0.02/pic', description: "Fast variant of Google's Imagen 4 flagship." },
    { value: 'google/imagen3', label: 'Imagen 3', price: '$0.04/pic', description: "Google's prior-generation high-detail text-to-image model." },
    { value: 'google/imagen3-fast', label: 'Imagen 3 Fast', price: '$0.02/pic', description: 'Fast variant of Imagen 3.' },
    // OpenAI
    { value: 'openai/gpt-image-2/text-to-image', label: 'GPT Image 2', price: '$0.01/pic', description: "OpenAI's latest image model. Strongest character/style consistency with multi-reference edit workflows." },
    { value: 'openai/gpt-image-1.5/text-to-image', label: 'GPT Image 1.5', price: '$0.008/pic', description: "OpenAI's fast, cost-efficient text-to-image. Photorealistic, concept art, stylized. Text only." },
    { value: 'openai/gpt-image-1/text-to-image', label: 'GPT Image 1', price: '$0.009/pic', description: "OpenAI's GPT Image-1. Ideal for creating visual assets." },
    { value: 'openai/gpt-image-1-mini/text-to-image', label: 'GPT Image 1 Mini', price: '$0.004/pic', description: 'Cost-efficient multimodal OpenAI model (GPT-5 guided).' },
    // ByteDance (Seedream)
    { value: 'bytedance/seedream-v5.0-lite', label: 'Seedream v5.0 Lite', price: '$0.032/pic', description: 'ByteDance latest. Visual CoT, 14 ref images, 4K.' },
    { value: 'bytedance/seedream-v5.0-lite/sequential', label: 'Seedream v5.0 Lite Sequential', price: '$0.032/pic', description: 'Seedream v5.0 Lite batch mode — up to 15 related images per request.' },
    { value: 'bytedance/seedream-v4.5', label: 'Seedream v4.5', price: '$0.036/pic', description: 'High quality, batch + edit support, 10 ref images.' },
    { value: 'bytedance/seedream-v4.5/sequential', label: 'Seedream v4.5 Sequential', price: '$0.036/pic', description: 'Seedream v4.5 batch mode — up to 15 images per request.' },
    { value: 'bytedance/seedream-v4', label: 'Seedream v4.0', price: '$0.024/pic', description: 'Good quality, lower cost.' },
    { value: 'bytedance/seedream-v4/sequential', label: 'Seedream v4.0 Sequential', price: '$0.024/pic', description: 'Seedream v4 batch mode.' },
    // Qwen (Alibaba)
    { value: 'qwen/qwen-image-2.0/text-to-image', label: 'Qwen Image 2.0', price: '$0.028/pic', description: 'Alibaba enhanced image quality and prompt understanding. Up to 2K.' },
    { value: 'qwen/qwen-image-2.0-pro/text-to-image', label: 'Qwen Image 2.0 Pro', price: '$0.06/pic', description: 'Professional-grade. Superior quality, advanced prompt understanding.' },
    { value: 'alibaba/qwen-image/text-to-image-max', label: 'Qwen-Image Max', price: '$0.052/pic', description: 'General-purpose Qwen-Image. Great for complex text rendering.' },
    { value: 'alibaba/qwen-image/text-to-image-plus', label: 'Qwen-Image Plus', price: '$0.021/pic', description: 'Good text rendering in images.' },
    { value: 'atlascloud/qwen-image/text-to-image', label: 'Qwen-Image (Atlas)', price: '$0.02/pic', description: 'Qwen-Image 20B MMDiT model.' },
    // Alibaba Wan
    { value: 'alibaba/wan-2.7/text-to-image', label: 'Wan-2.7', price: '$0.03/pic', description: 'Fast iteration, strong prompt fidelity. Illustration and photorealistic.' },
    { value: 'alibaba/wan-2.7-pro/text-to-image', label: 'Wan-2.7 Pro', price: '$0.075/pic', description: 'Higher fidelity, 4K-ready workflows.' },
    { value: 'alibaba/wan-2.6/text-to-image', label: 'Wan-2.6', price: '$0.021/pic', description: 'Supports various artistic styles and realistic photographic effects.' },
    { value: 'alibaba/wan-2.5/text-to-image', label: 'Wan-2.5', price: '$0.021/pic', description: 'Alibaba WAN 2.5 general text-to-image.' },
    // Black Forest Labs (Flux)
    { value: 'black-forest-labs/flux-dev', label: 'Flux Dev', price: '$0.012/pic', description: 'Flux-dev 12B parameter rectified flow transformer. Text-to-image only.' },
    { value: 'black-forest-labs/flux-schnell', label: 'Flux Schnell', price: '$0.003/pic', description: 'FLUX.1 [schnell] — fastest 12B rectified-flow model, great for drafts. Text-to-image only.' },
    { value: 'black-forest-labs/flux-dev-lora', label: 'Flux Dev LoRA', price: '$0.015/pic', description: 'FLUX.1 [dev] with LoRA tag support for personalized styles and brands. Text-to-image only.' },
    { value: 'black-forest-labs/flux-kontext-dev', label: 'Flux Kontext Dev', price: '$0.025/pic', description: 'FLUX.1 Kontext [dev] — image editing via text prompts. Requires a reference image.' },
    { value: 'black-forest-labs/flux-kontext-dev-lora', label: 'Flux Kontext Dev LoRA', price: '$0.030/pic', description: 'FLUX.1 Kontext [dev] with LoRA support for brand/style-consistent image edits. Requires a reference image.' },
    // Others
    { value: 'z-image/turbo', label: 'Z-Image Turbo', price: '$0.01/pic', description: 'Sub-second 6B text-to-image model, great for testing. Text only.' },
    { value: 'baidu/ERNIE-Image-Turbo/text-to-image', label: 'ERNIE Image Turbo', price: 'FREE', description: 'Baidu ERNIE Image, low-latency turbo variant. Free tier.' },
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
          || id.includes('gpt-image') || id.includes('wan-')
          || id.includes('imagen') || id.includes('ERNIE') || id.includes('ernie');
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
  const openaiKey =
    overrideKeys?.openaiApiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.EXPO_PUBLIC_OPENAI_API_KEY ||
    '';

  const [anthropic, openai, gemini, atlasCloud] = await Promise.all([
    scanAnthropicModels(anthropicKey),
    scanOpenAIModels(openaiKey),
    scanGeminiModels(geminiKey),
    scanAtlasCloudModels(atlasKey),
  ]);

  const result = {
    scannedAt: Date.now(),
    providers: {
      anthropic: anthropic.length > 0 ? anthropic : null,
      openai: openai.length > 0 ? openai : null,
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
        openaiApiKey: req.body?.openaiApiKey,
        geminiApiKey: req.body?.geminiApiKey,
        atlasCloudApiKey: req.body?.atlasCloudApiKey,
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
