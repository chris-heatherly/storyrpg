/**
 * Image feedback + regeneration routes:
 *   GET    /image-feedback              — list all feedback
 *   POST   /image-feedback              — add feedback
 *   PATCH  /image-feedback/:feedbackId  — update feedback
 *   DELETE /image-feedback/:feedbackId  — delete feedback
 *   POST   /regenerate-image            — spawn ts-node worker for rerender
 *   GET    /image-feedback/summary      — aggregate stats
 *
 * The returned `feedbackStore` is exposed so the bootstrap file can
 * flush it synchronously on SIGTERM/SIGINT.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const manifestModule = require('./storyManifest');
const codec = require('./storyCodec');
const { spawnTsNodeWorker } = require('./tsNodeSpawn');
const { atomicWriteJsonSync } = require('./atomicIo');

function registerImageFeedbackRoutes(app, { rootDir, storiesDir, feedbackFile, cachedJsonStore }) {
  if (!rootDir || !storiesDir || !cachedJsonStore) {
    throw new Error('registerImageFeedbackRoutes requires rootDir, storiesDir, and cachedJsonStore');
  }
  const appRoot = path.resolve(rootDir);
  const FEEDBACK_FILE = feedbackFile || path.resolve(rootDir, '.image-feedback.json');
  const feedbackStore = cachedJsonStore(FEEDBACK_FILE, 'image-feedback');

  function loadFeedback() { return feedbackStore.get(); }
  function saveFeedback(feedback) { feedbackStore.set(feedback); }

  function listStoryDirs() {
    if (!fs.existsSync(storiesDir)) return [];
    return fs.readdirSync(storiesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
  }

  function readStoryRecord(dir) {
    const outputDir = path.join(storiesDir, dir);
    const primary = manifestModule.resolveStoryFile(outputDir);
    if (!primary) return null;
    const parsed = JSON.parse(fs.readFileSync(primary.abs, 'utf8'));
    const decoded = codec.safeDecodeStory(parsed);
    if (!decoded.ok) return null;
    return { dir, outputDir, primary, raw: parsed, pkg: decoded.pkg };
  }

  function findStoryRecord(storyId) {
    if (!storyId) return null;
    for (const dir of listStoryDirs()) {
      try {
        const record = readStoryRecord(dir);
        if (record?.pkg.storyId === storyId) return record;
      } catch (err) {
        console.error(`[Proxy] Error reading story ${dir}:`, err.message);
      }
    }
    return null;
  }

  function scorePromptCandidate(promptData, filename, { sceneId, beatId }) {
    if (!promptData || typeof promptData !== 'object') return -1;
    if (filename.toLowerCase().endsWith('.qa.json')) return -1;
    const metadata = promptData.metadata || {};
    let score = 0;
    if (beatId && metadata.beatId === beatId) score += 100;
    if (sceneId && metadata.sceneId === sceneId) score += 40;
    const haystack = `${promptData.identifier || ''} ${filename}`.toLowerCase();
    if (beatId && haystack.includes(beatId.toLowerCase())) score += 20;
    if (sceneId && haystack.includes(sceneId.toLowerCase())) score += 8;
    if (/rerender|textfix|qa-regenerate/i.test(filename)) score -= 15;
    return score;
  }

  function findPromptForBeat(record, { promptPath, identifier, sceneId, beatId }) {
    if (promptPath) {
      const abs = path.isAbsolute(promptPath) ? promptPath : path.resolve(appRoot, promptPath);
      if (fs.existsSync(abs)) {
        const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
        return { promptPath: abs, identifier: identifier || data.identifier || path.basename(abs, '.json') };
      }
    }
    if (!record) return null;

    const promptsDir = [
      path.join(record.outputDir, 'images', 'prompts'),
      path.join(record.outputDir, 'prompts'),
    ].find((candidate) => fs.existsSync(candidate));
    if (!promptsDir) return null;

    let best = null;
    for (const filename of fs.readdirSync(promptsDir)) {
      if (!filename.endsWith('.json')) continue;
      try {
        const abs = path.join(promptsDir, filename);
        const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
        const score = scorePromptCandidate(data, filename, { sceneId, beatId });
        if (score < 0) continue;
        if (!best || score > best.score) {
          best = {
            score,
            promptPath: abs,
            identifier: data.identifier || filename.replace(/\.json$/, ''),
          };
        }
      } catch (err) {
        console.warn(`[Proxy] Skipping unreadable prompt ${filename}: ${err.message}`);
      }
    }
    return best;
  }

  function replaceBeatImageInStory(record, { episodeId, sceneId, beatId, imageUrl }, req) {
    if (!record || !imageUrl) return null;
    const story = record.pkg.story;
    let replaced = false;

    for (const episode of story.episodes || []) {
      if (episodeId && episode.id !== episodeId) continue;
      for (const scene of episode.scenes || []) {
        if (sceneId && scene.id !== sceneId) continue;
        for (const beat of scene.beats || []) {
          if (beat.id !== beatId) continue;
          beat.image = imageUrl;
          replaced = true;
          break;
        }
        if (replaced) break;
      }
      if (replaced) break;
    }

    if (!replaced) {
      throw new Error(`Beat not found for regeneration update: episode=${episodeId || '*'} scene=${sceneId || '*'} beat=${beatId || '*'}`);
    }

    let nextRaw;
    if (record.pkg.detectedSchemaVersion === 1) {
      nextRaw = story;
    } else {
      nextRaw = {
        ...record.raw,
        story,
        updatedAt: new Date().toISOString(),
      };
    }

    const { sha256, bytes } = atomicWriteJsonSync(record.primary.abs, nextRaw, { pretty: true });
    manifestModule.updateManifestForPrimaryRewrite(record.outputDir, {
      primaryStoryHash: sha256,
      primaryStoryBytes: bytes,
    });

    const updatedDecoded = codec.safeDecodeStory(nextRaw);
    if (!updatedDecoded.ok) throw updatedDecoded.error;
    return codec.projectForFullResponse(updatedDecoded.pkg, {
      req,
      port: process.env.PORT || 3001,
      dirName: record.dir,
    });
  }

  app.get('/image-feedback', (req, res) => {
    res.json(loadFeedback());
  });

  app.post('/image-feedback', (req, res) => {
    const feedbackItem = req.body;
    if (!feedbackItem || !feedbackItem.id) {
      return res.status(400).json({ error: 'Invalid feedback data' });
    }

    const feedback = loadFeedback();
    const existingIndex = feedback.findIndex((f) => f.id === feedbackItem.id);

    if (existingIndex >= 0) {
      feedback[existingIndex] = feedbackItem;
    } else {
      feedback.unshift(feedbackItem);
    }

    if (feedback.length > 500) {
      feedback.length = 500;
    }

    saveFeedback(feedback);
    console.log(`[Proxy] Saved image feedback: ${feedbackItem.id} (${feedbackItem.rating})`);
    res.json({ success: true });
  });

  app.patch('/image-feedback/:feedbackId', (req, res) => {
    const { feedbackId } = req.params;
    const updates = req.body;

    const feedback = loadFeedback();
    const feedbackIndex = feedback.findIndex((f) => f.id === feedbackId);

    if (feedbackIndex < 0) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    feedback[feedbackIndex] = { ...feedback[feedbackIndex], ...updates };
    saveFeedback(feedback);
    res.json({ success: true });
  });

  app.delete('/image-feedback/:feedbackId', (req, res) => {
    const { feedbackId } = req.params;

    let feedback = loadFeedback();
    const initialLength = feedback.length;
    feedback = feedback.filter((f) => f.id !== feedbackId);

    if (feedback.length === initialLength) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    saveFeedback(feedback);
    console.log(`[Proxy] Deleted image feedback: ${feedbackId}`);
    res.json({ success: true });
  });

  function runRegenerationWorker(payload) {
    return new Promise((resolve, reject) => {
      const runnerPath = path.resolve(appRoot, 'src/ai-agents/server/regenerate-image.ts');
      const payloadPath = path.join(os.tmpdir(), `storyrpg-regenerate-${Date.now()}-${Math.random().toString(36).slice(2)}.payload.json`);
      const resultPath = path.join(os.tmpdir(), `storyrpg-regenerate-${Date.now()}-${Math.random().toString(36).slice(2)}.result.json`);

      fs.writeFileSync(payloadPath, JSON.stringify({ ...payload, resultPath }, null, 2), 'utf8');

      const proc = spawnTsNodeWorker({
        appRootDir: appRoot,
        entryScriptPath: runnerPath,
        payloadPath,
      });

      let stderr = '';
      proc.stdout.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (text) console.log(`[Proxy][rerender] ${text}`);
      });
      proc.stderr.on('data', (chunk) => {
        stderr += String(chunk || '');
      });

      const cleanup = () => {
        try { fs.unlinkSync(payloadPath); } catch {
          // best-effort cleanup; missing temp file is expected on success paths
        }
        try { fs.unlinkSync(resultPath); } catch {
          // best-effort cleanup
        }
      };

      proc.on('error', (err) => {
        cleanup();
        reject(err);
      });

      proc.on('close', (code) => {
        try {
          const raw = fs.readFileSync(resultPath, 'utf8');
          const parsed = JSON.parse(raw);
          cleanup();
          if (code !== 0 || parsed?.success === false) {
            reject(new Error(parsed?.error || stderr || `Rerender worker failed with exit code ${code}`));
            return;
          }
          resolve(parsed);
        } catch (err) {
          cleanup();
          reject(new Error(stderr || err.message || `Rerender worker failed with exit code ${code}`));
        }
      });
    });
  }

  app.post('/regenerate-image', async (req, res) => {
    const { imageUrl, storyId, episodeId, sceneId, beatId, feedback, promptPath: requestPromptPath, identifier, metadata } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing required field: imageUrl' });
    }

    console.log(`[Proxy] Regenerating image for story ${storyId}, beat ${beatId || sceneId}`);
    console.log(`[Proxy] Feedback reasons: ${feedback?.reasons?.join(', ') || 'none'}`);
    console.log(`[Proxy] Feedback notes: ${feedback?.notes || 'none'}`);

    try {
      const storyRecord = findStoryRecord(storyId);
      const promptRecord = findPromptForBeat(storyRecord, {
        promptPath: requestPromptPath,
        identifier,
        sceneId,
        beatId,
      });
      const promptPath = promptRecord?.promptPath || null;
      const resolvedIdentifier = promptRecord?.identifier || identifier || null;

      if (!promptPath) {
        console.log('[Proxy] Could not find original prompt path for rerender request');
        return res.json({
          success: false,
          error: 'Could not find original prompt for this image',
          note: 'Image regeneration requires the original prompt file to be available',
        });
      }
      const result = await runRegenerationWorker({
        imageUrl,
        identifier: resolvedIdentifier,
        promptPath,
        metadata,
        feedback,
      });
      const updatedStory = storyRecord && beatId
        ? replaceBeatImageInStory(storyRecord, {
            episodeId,
            sceneId,
            beatId,
            imageUrl: result.newImageUrl || result.imageUrl,
          }, req)
        : null;

      res.json({
        success: true,
        message: 'Image rerendered successfully',
        story: updatedStory,
        ...result,
      });
    } catch (error) {
      console.error(`[Proxy] Error regenerating image: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/image-feedback/summary', (req, res) => {
    const feedback = loadFeedback();

    const positiveCount = feedback.filter((f) => f.rating === 'positive').length;
    const negativeCount = feedback.filter((f) => f.rating === 'negative').length;

    const reasonCounts = {};
    feedback.forEach((f) => {
      if (f.reasons) {
        f.reasons.forEach((reason) => {
          reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        });
      }
    });

    const topIssues = Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    res.json({
      totalFeedback: feedback.length,
      positiveCount,
      negativeCount,
      approvalRate: feedback.length > 0 ? `${(positiveCount / feedback.length * 100).toFixed(1)}%` : 'N/A',
      topIssues,
      recentFeedback: feedback.slice(0, 10),
    });
  });

  return { feedbackStore };
}

module.exports = { registerImageFeedbackRoutes };
