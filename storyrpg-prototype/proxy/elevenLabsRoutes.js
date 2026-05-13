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

  function getAudioUrl(req, storyDir, beatId) {
    return `${getPublicBaseUrl(req)}/generated-stories/${storyDir}/audio/${beatId}.mp3`;
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
