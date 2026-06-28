/**
 * ElevenLabs audio proxy:
 *   GET  /audio-alignment         — alignment JSON for a cached beat
 *   POST /elevenlabs/tts          — single-beat TTS with write-through cache
 *   POST /elevenlabs/batch-generate — batch TTS across beats (cached + rate-limited)
 *   GET  /elevenlabs/voices       — list available ElevenLabs voices
 *
 * Audio is written to `{audioRootDir}/{storyDir}/audio/{beatId}.mp3`
 * with a sibling `.alignment.json`. Cached hits never hit ElevenLabs.
 */

const fs = require('fs');
const path = require('path');
const { atomicWriteFileSync, atomicWriteJsonSync } = require('./atomicIo');
const manifestModule = require('./storyManifest');
const codec = require('./storyCodec');

const DEFAULT_ELEVENLABS_VOICES = {
  narrator: 'onwK4e9ZLuTAKqWW03F9',
  male: 'TxGEqnHWrfWFTfGW9XjX',
  female: 'EXAVITQu4vr4xnSDxMaL',
  child: 'jBpfuIE2acCO8z3wKNLl',
};

const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const DEFAULT_GEMINI_TTS_VOICE = 'Kore';
const GEMINI_TTS_VOICES = [
  { id: 'Kore', name: 'Kore', provider: 'gemini', description: 'clear, steady, composed narrator', labels: { gender: 'female', age: 'middle', description: 'clear, measured, professional, calm', use_case: 'narration' } },
  { id: 'Puck', name: 'Puck', provider: 'gemini', description: 'bright, playful, youthful', labels: { gender: 'neutral', age: 'young', description: 'playful, energetic, quick, mischievous' } },
  { id: 'Charon', name: 'Charon', provider: 'gemini', description: 'low, grave, ominous', labels: { gender: 'male', age: 'old', description: 'deep, ominous, measured, grave, authoritative' } },
  { id: 'Fenrir', name: 'Fenrir', provider: 'gemini', description: 'rough, intense, forceful', labels: { gender: 'male', age: 'middle', description: 'intense, fierce, powerful, commanding' } },
  { id: 'Aoede', name: 'Aoede', provider: 'gemini', description: 'warm, lyrical, expressive', labels: { gender: 'female', age: 'young', description: 'warm, friendly, lyrical, tender' } },
  { id: 'Leda', name: 'Leda', provider: 'gemini', description: 'soft, young, open', labels: { gender: 'female', age: 'young', description: 'soft, gentle, youthful, open' } },
  { id: 'Orus', name: 'Orus', provider: 'gemini', description: 'formal, decisive, senior', labels: { gender: 'male', age: 'middle', description: 'authoritative, clear, confident, formal' } },
  { id: 'Callirrhoe', name: 'Callirrhoe', provider: 'gemini', description: 'smooth, elegant, mysterious', labels: { gender: 'female', age: 'middle', description: 'smooth, mysterious, poised, controlled' } },
  { id: 'Iapetus', name: 'Iapetus', provider: 'gemini', description: 'elderly, wise, weathered', labels: { gender: 'male', age: 'old', description: 'wise, weathered, calm, thoughtful' } },
  { id: 'Despina', name: 'Despina', provider: 'gemini', description: 'older, warm, grounded', labels: { gender: 'female', age: 'old', description: 'warm, grounded, grandmotherly, measured' } },
  { id: 'Zephyr', name: 'Zephyr', provider: 'gemini', description: 'light, airy, gentle', labels: { gender: 'neutral', age: 'young', description: 'gentle, soft, bright, calm' } },
  { id: 'Umbriel', name: 'Umbriel', provider: 'gemini', description: 'shadowed, restrained, cool', labels: { gender: 'neutral', age: 'middle', description: 'guarded, cool, mysterious, restrained' } },
];

function registerElevenLabsRoutes(app, { audioRootDir, port }) {
  if (!audioRootDir) {
    throw new Error('registerElevenLabsRoutes requires audioRootDir');
  }

  function findStoryDirByStoryId(storyId) {
    if (!storyId || !fs.existsSync(audioRootDir)) return null;
    const dirs = fs.readdirSync(audioRootDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const dir of dirs) {
      const storyDir = path.join(audioRootDir, dir);
      const primary = manifestModule.resolveStoryFile(storyDir);
      if (!primary) {
        if (dir.startsWith(storyId)) return dir;
        continue;
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(primary.abs, 'utf8'));
        const decoded = codec.safeDecodeStory(parsed);
        if (decoded.ok && decoded.pkg.storyId === storyId) return dir;
        if (!decoded.ok && dir.startsWith(storyId)) return dir;
      } catch {
        if (dir.startsWith(storyId)) return dir;
      }
    }
    return null;
  }

  function getPublicBaseUrl(req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers.host || `localhost:${port}`;
    return `${protocol}://${host}`;
  }

  function getAudioUrl(req, storyDir, beatId, ext = 'mp3') {
    return `${getPublicBaseUrl(req)}/generated-stories/${storyDir}/audio/${beatId}.${ext}`;
  }

  function normalizeAudioProvider(value) {
    return value === 'gemini' ? 'gemini' : 'elevenlabs';
  }

  function getProviderAudioExt(provider) {
    return provider === 'gemini' ? 'wav' : 'mp3';
  }

  function getProviderApiKey(req, provider) {
    if (provider === 'gemini') {
      return req.headers['x-gemini-api-key'] || process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    }
    return req.headers['x-elevenlabs-api-key'] || process.env.ELEVENLABS_API_KEY;
  }

  function makeWavFromPcm(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
  }

  function decodeGeminiAudioPart(ttsData) {
    const parts = ttsData?.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find((part) => part?.inlineData?.data || part?.inline_data?.data);
    const inlineData = audioPart?.inlineData || audioPart?.inline_data;
    const audioBase64 = inlineData?.data;
    const mimeType = inlineData?.mimeType || inlineData?.mime_type || 'audio/L16;codec=pcm;rate=24000';
    if (!audioBase64) throw new Error('No inline audio data received from Gemini TTS');

    const raw = Buffer.from(audioBase64, 'base64');
    if (/audio\/(?:wav|wave|mpeg|mp3)/i.test(mimeType)) {
      return { buffer: raw, mimeType };
    }
    const rateMatch = /rate=(\d+)/i.exec(mimeType);
    const sampleRate = rateMatch ? Number.parseInt(rateMatch[1], 10) : 24000;
    return {
      buffer: makeWavFromPcm(raw, Number.isFinite(sampleRate) ? sampleRate : 24000),
      mimeType: 'audio/wav',
    };
  }

  async function generateElevenLabsAudio({ apiKey, text, voiceId, voiceType = 'narrator', modelId = 'eleven_multilingual_v2', outputFormat = 'mp3_44100_128' }) {
    const resolvedVoiceId = voiceId || DEFAULT_ELEVENLABS_VOICES[voiceType] || DEFAULT_ELEVENLABS_VOICES.narrator;
    const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}/with-timestamps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        output_format: outputFormat,
      }),
    });
    if (!ttsResp.ok) {
      const errorText = await ttsResp.text();
      throw new Error(`ElevenLabs API error: ${ttsResp.status} - ${errorText}`);
    }
    const ttsData = await ttsResp.json();
    if (!ttsData.audio_base64) throw new Error('No audio_base64 received from ElevenLabs');
    return {
      buffer: Buffer.from(ttsData.audio_base64, 'base64'),
      alignment: ttsData.alignment || null,
      mimeType: 'audio/mpeg',
      voiceId: resolvedVoiceId,
      ext: 'mp3',
    };
  }

  async function generateGeminiAudio({ apiKey, text, voiceId, geminiModel }) {
    const model = geminiModel || DEFAULT_GEMINI_TTS_MODEL;
    const resolvedVoiceId = voiceId || DEFAULT_GEMINI_TTS_VOICE;
    const ttsResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: resolvedVoiceId },
            },
          },
        },
      }),
    });
    if (!ttsResp.ok) {
      const errorText = await ttsResp.text();
      throw new Error(`Gemini TTS API error: ${ttsResp.status} - ${errorText}`);
    }
    const ttsData = await ttsResp.json();
    const decoded = decodeGeminiAudioPart(ttsData);
    return {
      buffer: decoded.buffer,
      alignment: null,
      mimeType: decoded.mimeType,
      voiceId: resolvedVoiceId,
      ext: 'wav',
      model,
    };
  }

  async function generateProviderAudio({ provider, apiKey, text, voiceId, voiceType, modelId, outputFormat, geminiModel }) {
    if (provider === 'gemini') {
      return generateGeminiAudio({ apiKey, text, voiceId, geminiModel });
    }
    return generateElevenLabsAudio({ apiKey, text, voiceId, voiceType, modelId, outputFormat });
  }

  app.get('/audio-alignment', (req, res) => {
    const storyId = String(req.query.storyId || '');
    const beatId = String(req.query.beatId || '');
    if (!storyId || !beatId) return res.status(400).json({ error: 'Missing storyId or beatId' });

    const storyDir = findStoryDirByStoryId(storyId);
    if (!storyDir) return res.status(404).json({ error: 'Story directory not found' });
    const alignmentPath = path.join(audioRootDir, storyDir, 'audio', `${beatId}.alignment.json`);
    if (!fs.existsSync(alignmentPath)) return res.status(404).json({ error: 'Alignment not found' });

    try {
      const alignmentData = JSON.parse(fs.readFileSync(alignmentPath, 'utf8'));
      res.json(alignmentData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/audio/voices', async (req, res) => {
    const provider = normalizeAudioProvider(String(req.query.provider || 'elevenlabs'));
    if (provider === 'gemini') {
      return res.json({
        success: true,
        provider,
        voices: GEMINI_TTS_VOICES,
        defaults: { narrator: DEFAULT_GEMINI_TTS_VOICE },
        model: DEFAULT_GEMINI_TTS_MODEL,
      });
    }

    try {
      const apiKey = getProviderApiKey(req, provider);
      if (!apiKey) return res.status(401).json({ error: 'Missing ElevenLabs API key' });
      const voicesResp = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey },
      });
      if (!voicesResp.ok) {
        const errorText = await voicesResp.text();
        throw new Error(`ElevenLabs voices API error: ${voicesResp.status} - ${errorText}`);
      }
      const voicesData = await voicesResp.json();
      const voices = Array.isArray(voicesData?.voices) ? voicesData.voices : [];
      res.json({
        success: true,
        provider,
        voices: voices.map((v) => ({
          id: v.voice_id,
          name: v.name,
          provider,
          category: v.category,
          description: v.description,
          previewUrl: v.preview_url,
          labels: v.labels,
        })),
        defaults: DEFAULT_ELEVENLABS_VOICES,
      });
    } catch (error) {
      console.error('[Proxy] Audio voices error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/audio/tts', async (req, res) => {
    try {
      const provider = normalizeAudioProvider(req.body?.provider);
      const apiKey = getProviderApiKey(req, provider);
      if (!apiKey) return res.status(401).json({ error: `Missing ${provider === 'gemini' ? 'Gemini' : 'ElevenLabs'} API key` });

      const {
        text,
        audioScript,
        voiceId,
        voiceType = 'narrator',
        storyId,
        beatId,
        speaker,
        speakerMood,
        modelId = 'eleven_multilingual_v2',
        outputFormat = 'mp3_44100_128',
        geminiModel,
        performanceTagsEnabled,
      } = req.body || {};

      if (!text) return res.status(400).json({ error: 'Missing text' });
      const ttsText = String(audioScript || text);
      const ext = getProviderAudioExt(provider);
      const storyDir = storyId ? findStoryDirByStoryId(storyId) : null;
      const audioPath = storyDir && beatId ? path.join(audioRootDir, storyDir, 'audio', `${beatId}.${ext}`) : null;
      const alignmentPath = storyDir && beatId ? path.join(audioRootDir, storyDir, 'audio', `${beatId}.alignment.json`) : null;
      if (audioPath && fs.existsSync(audioPath)) {
        let alignment = null;
        if (alignmentPath && fs.existsSync(alignmentPath)) {
          try { alignment = JSON.parse(fs.readFileSync(alignmentPath, 'utf8'))?.alignment || null; } catch {}
        }
        return res.json({
          success: true,
          provider,
          voiceId,
          audioUrl: getAudioUrl(req, storyDir, beatId, ext),
          alignment,
          cached: true,
          characterCount: text.length,
        });
      }

      const generated = await generateProviderAudio({
        provider,
        apiKey,
        text: ttsText,
        voiceId,
        voiceType,
        modelId,
        outputFormat,
        geminiModel,
      });

      if (storyId && beatId && storyDir) {
        const audioSubDir = path.join(audioRootDir, storyDir, 'audio');
        if (!fs.existsSync(audioSubDir)) fs.mkdirSync(audioSubDir, { recursive: true });
        atomicWriteFileSync(path.join(audioSubDir, `${beatId}.${generated.ext}`), generated.buffer);
        atomicWriteJsonSync(
          path.join(audioSubDir, `${beatId}.alignment.json`),
          {
            text,
            audioScript: performanceTagsEnabled ? ttsText : undefined,
            speaker,
            speakerMood,
            provider,
            voiceId: generated.voiceId,
            model: generated.model || modelId,
            mimeType: generated.mimeType,
            alignment: generated.alignment,
            generatedAt: new Date().toISOString(),
          },
          { pretty: true },
        );
        return res.json({
          success: true,
          provider,
          voiceId: generated.voiceId,
          audioUrl: getAudioUrl(req, storyDir, beatId, generated.ext),
          alignment: generated.alignment,
          cached: false,
          characterCount: text.length,
        });
      }

      return res.json({
        success: true,
        provider,
        voiceId: generated.voiceId,
        audioData: generated.buffer.toString('base64'),
        alignment: generated.alignment,
        mimeType: generated.mimeType,
        characterCount: text.length,
      });
    } catch (error) {
      console.error('[Proxy] Audio TTS error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/audio/batch-generate', async (req, res) => {
    try {
      const provider = normalizeAudioProvider(req.body?.provider);
      const apiKey = getProviderApiKey(req, provider);
      if (!apiKey) return res.status(401).json({ error: `Missing ${provider === 'gemini' ? 'Gemini' : 'ElevenLabs'} API key` });

      const { storyId, beats, characterVoices, modelId = 'eleven_multilingual_v2', geminiModel, performanceTagsEnabled } = req.body || {};
      if (!storyId || !Array.isArray(beats)) return res.status(400).json({ error: 'Missing storyId or beats[]' });

      const storyDir = findStoryDirByStoryId(storyId);
      if (!storyDir) return res.status(404).json({ error: `Story directory not found for ${storyId}` });
      const audioSubDir = path.join(audioRootDir, storyDir, 'audio');
      if (!fs.existsSync(audioSubDir)) fs.mkdirSync(audioSubDir, { recursive: true });

      const ext = getProviderAudioExt(provider);
      const results = [];
      const errors = [];
      for (const beat of beats) {
        const { beatId, text, audioScript, speaker, speakerMood } = beat || {};
        if (!beatId || !text) {
          errors.push({ beatId: beatId || 'unknown', error: 'Missing beatId or text' });
          continue;
        }

        const audioPath = path.join(audioSubDir, `${beatId}.${ext}`);
        if (fs.existsSync(audioPath)) {
          results.push({ beatId, success: true, cached: true, provider, audioUrl: getAudioUrl(req, storyDir, beatId, ext) });
          continue;
        }

        let resolvedVoiceId = beat.voiceId;
        if (!resolvedVoiceId && speaker && characterVoices) {
          resolvedVoiceId = characterVoices[speaker.toLowerCase()] || characterVoices[speaker];
        }
        if (!resolvedVoiceId) resolvedVoiceId = provider === 'gemini' ? DEFAULT_GEMINI_TTS_VOICE : DEFAULT_ELEVENLABS_VOICES.narrator;

        try {
          const generated = await generateProviderAudio({
            provider,
            apiKey,
            text: String(audioScript || text),
            voiceId: resolvedVoiceId,
            modelId,
            geminiModel,
          });
          atomicWriteFileSync(path.join(audioSubDir, `${beatId}.${generated.ext}`), generated.buffer);
          atomicWriteJsonSync(
            path.join(audioSubDir, `${beatId}.alignment.json`),
            {
              text,
              audioScript: performanceTagsEnabled ? String(audioScript || text) : undefined,
              speaker,
              speakerMood,
              provider,
              voiceId: generated.voiceId,
              model: generated.model || modelId,
              mimeType: generated.mimeType,
              alignment: generated.alignment,
              generatedAt: new Date().toISOString(),
            },
            { pretty: true },
          );
          results.push({
            beatId,
            success: true,
            cached: false,
            provider,
            voiceId: generated.voiceId,
            audioUrl: getAudioUrl(req, storyDir, beatId, generated.ext),
          });
          await new Promise((resolve) => setTimeout(resolve, provider === 'gemini' ? 250 : 150));
        } catch (err) {
          errors.push({ beatId, error: err instanceof Error ? err.message : String(err) });
        }
      }

      res.json({
        success: true,
        provider,
        generated: results.filter((r) => r.success && !r.cached).length,
        cached: results.filter((r) => r.cached).length,
        failed: errors.length,
        results,
        errors,
      });
    } catch (error) {
      console.error('[Proxy] Audio batch error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/elevenlabs/tts', async (req, res) => {
    try {
      const apiKey = req.headers['x-elevenlabs-api-key'] || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(401).json({ error: 'Missing ElevenLabs API key' });

      const {
        text,
        voiceId,
        voiceType = 'narrator',
        storyId,
        beatId,
        speaker,
        modelId = 'eleven_multilingual_v2',
        outputFormat = 'mp3_44100_128',
      } = req.body || {};

      if (!text) return res.status(400).json({ error: 'Missing text' });
      const resolvedVoiceId = voiceId || DEFAULT_ELEVENLABS_VOICES[voiceType] || DEFAULT_ELEVENLABS_VOICES.narrator;

      const storyDir = storyId ? findStoryDirByStoryId(storyId) : null;
      let audioPath = null;
      let alignmentPath = null;
      if (storyDir && beatId) {
        audioPath = path.join(audioRootDir, storyDir, 'audio', `${beatId}.mp3`);
        alignmentPath = path.join(audioRootDir, storyDir, 'audio', `${beatId}.alignment.json`);
        if (fs.existsSync(audioPath)) {
          let alignment = null;
          if (fs.existsSync(alignmentPath)) {
            try { alignment = JSON.parse(fs.readFileSync(alignmentPath, 'utf8'))?.alignment || null; } catch {
              // Alignment file exists but is unreadable; fall through to null alignment.
            }
          }
          return res.json({
            success: true,
            audioUrl: getAudioUrl(req, storyDir, beatId),
            alignment,
            cached: true,
            characterCount: text.length,
          });
        }
      }

      const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}/with-timestamps`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          output_format: outputFormat,
        }),
      });

      if (!ttsResp.ok) {
        const errorText = await ttsResp.text();
        throw new Error(`ElevenLabs API error: ${ttsResp.status} - ${errorText}`);
      }
      const ttsData = await ttsResp.json();
      const audioBase64 = ttsData.audio_base64;
      const alignment = ttsData.alignment || null;
      if (!audioBase64) throw new Error('No audio_base64 received from ElevenLabs');

      if (storyId && beatId && storyDir) {
        const audioSubDir = path.join(audioRootDir, storyDir, 'audio');
        if (!fs.existsSync(audioSubDir)) fs.mkdirSync(audioSubDir, { recursive: true });
        atomicWriteFileSync(path.join(audioSubDir, `${beatId}.mp3`), Buffer.from(audioBase64, 'base64'));
        if (alignment) {
          atomicWriteJsonSync(
            path.join(audioSubDir, `${beatId}.alignment.json`),
            {
              text,
              speaker,
              voiceId: resolvedVoiceId,
              alignment,
              generatedAt: new Date().toISOString(),
            },
            { pretty: true },
          );
        }
        return res.json({
          success: true,
          audioUrl: getAudioUrl(req, storyDir, beatId),
          alignment,
          cached: false,
          characterCount: text.length,
        });
      }

      return res.json({
        success: true,
        audioData: audioBase64,
        alignment,
        mimeType: 'audio/mpeg',
        characterCount: text.length,
      });
    } catch (error) {
      console.error('[Proxy] ElevenLabs TTS error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/elevenlabs/batch-generate', async (req, res) => {
    try {
      const apiKey = req.headers['x-elevenlabs-api-key'] || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(401).json({ error: 'Missing ElevenLabs API key' });

      const { storyId, beats, characterVoices, modelId = 'eleven_multilingual_v2' } = req.body || {};
      if (!storyId || !Array.isArray(beats)) return res.status(400).json({ error: 'Missing storyId or beats[]' });

      const storyDir = findStoryDirByStoryId(storyId);
      if (!storyDir) return res.status(404).json({ error: `Story directory not found for ${storyId}` });
      const audioSubDir = path.join(audioRootDir, storyDir, 'audio');
      if (!fs.existsSync(audioSubDir)) fs.mkdirSync(audioSubDir, { recursive: true });

      const results = [];
      const errors = [];
      for (const beat of beats) {
        const { beatId, text, speaker } = beat || {};
        if (!beatId || !text) {
          errors.push({ beatId: beatId || 'unknown', error: 'Missing beatId or text' });
          continue;
        }

        const audioPath = path.join(audioSubDir, `${beatId}.mp3`);
        if (fs.existsSync(audioPath)) {
          results.push({ beatId, success: true, cached: true, audioUrl: getAudioUrl(req, storyDir, beatId) });
          continue;
        }

        let resolvedVoiceId = beat.voiceId;
        if (!resolvedVoiceId && speaker && characterVoices) {
          resolvedVoiceId = characterVoices[speaker.toLowerCase()] || characterVoices[speaker];
        }
        if (!resolvedVoiceId) resolvedVoiceId = DEFAULT_ELEVENLABS_VOICES.narrator;

        try {
          const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}/with-timestamps`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': apiKey,
            },
            body: JSON.stringify({ text, model_id: modelId }),
          });
          if (!ttsResp.ok) {
            const errorText = await ttsResp.text();
            throw new Error(`API error: ${ttsResp.status} - ${errorText}`);
          }
          const ttsData = await ttsResp.json();
          atomicWriteFileSync(audioPath, Buffer.from(ttsData.audio_base64, 'base64'));
          if (ttsData.alignment) {
            atomicWriteJsonSync(
              path.join(audioSubDir, `${beatId}.alignment.json`),
              {
                text,
                speaker,
                voiceId: resolvedVoiceId,
                alignment: ttsData.alignment,
                generatedAt: new Date().toISOString(),
              },
              { pretty: true },
            );
          }
          results.push({
            beatId,
            success: true,
            cached: false,
            voiceId: resolvedVoiceId,
            audioUrl: getAudioUrl(req, storyDir, beatId),
          });
          await new Promise((resolve) => setTimeout(resolve, 150));
        } catch (err) {
          errors.push({ beatId, error: err instanceof Error ? err.message : String(err) });
        }
      }

      res.json({
        success: true,
        generated: results.filter((r) => r.success && !r.cached).length,
        cached: results.filter((r) => r.cached).length,
        failed: errors.length,
        results,
        errors,
      });
    } catch (error) {
      console.error('[Proxy] ElevenLabs batch error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/elevenlabs/voices', async (req, res) => {
    try {
      const apiKey = req.headers['x-elevenlabs-api-key'] || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(401).json({ error: 'Missing ElevenLabs API key' });
      const voicesResp = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey },
      });
      if (!voicesResp.ok) {
        const errorText = await voicesResp.text();
        throw new Error(`ElevenLabs voices API error: ${voicesResp.status} - ${errorText}`);
      }
      const voicesData = await voicesResp.json();
      const voices = Array.isArray(voicesData?.voices) ? voicesData.voices : [];
      res.json({
        success: true,
        voices: voices.map((v) => ({
          id: v.voice_id,
          name: v.name,
          category: v.category,
          description: v.description,
          previewUrl: v.preview_url,
          labels: v.labels,
        })),
        defaults: DEFAULT_ELEVENLABS_VOICES,
      });
    } catch (error) {
      console.error('[Proxy] ElevenLabs voices error:', error);
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { registerElevenLabsRoutes, DEFAULT_ELEVENLABS_VOICES };
