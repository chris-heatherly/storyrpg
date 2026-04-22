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
const { spawn } = require('child_process');
const manifestModule = require('./storyManifest');
const codec = require('./storyCodec');

function registerImageFeedbackRoutes(app, { rootDir, storiesDir, cachedJsonStore }) {
  if (!rootDir || !storiesDir || !cachedJsonStore) {
    throw new Error('registerImageFeedbackRoutes requires rootDir, storiesDir, and cachedJsonStore');
  }
  const FEEDBACK_FILE = path.resolve(rootDir, '.image-feedback.json');
  const feedbackStore = cachedJsonStore(FEEDBACK_FILE, 'image-feedback');

  function loadFeedback() { return feedbackStore.get(); }
  function saveFeedback(feedback) { feedbackStore.set(feedback); }

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
      const runnerPath = path.resolve(rootDir, 'src/ai-agents/server/regenerate-image.ts');
      const payloadPath = path.join(os.tmpdir(), `storyrpg-regenerate-${Date.now()}-${Math.random().toString(36).slice(2)}.payload.json`);
      const resultPath = path.join(os.tmpdir(), `storyrpg-regenerate-${Date.now()}-${Math.random().toString(36).slice(2)}.result.json`);

      fs.writeFileSync(payloadPath, JSON.stringify({ ...payload, resultPath }, null, 2), 'utf8');

      const proc = spawn('npx', [
        'ts-node',
        '-r',
        'tsconfig-paths/register',
        '--project',
        'tsconfig.worker.json',
        '--transpile-only',
        runnerPath,
        payloadPath,
      ], {
        cwd: rootDir,
        env: { ...process.env, FORCE_COLOR: '0', TS_NODE_PREFER_TS_EXTS: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
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
    const { imageUrl, storyId, sceneId, beatId, feedback, promptPath: requestPromptPath, identifier, metadata } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing required field: imageUrl' });
    }

    console.log(`[Proxy] Regenerating image for story ${storyId}, beat ${beatId || sceneId}`);
    console.log(`[Proxy] Feedback reasons: ${feedback?.reasons?.join(', ') || 'none'}`);
    console.log(`[Proxy] Feedback notes: ${feedback?.notes || 'none'}`);

    try {
      let promptPath = requestPromptPath || null;
      let resolvedIdentifier = identifier || null;

      if (!promptPath && storyId && fs.existsSync(storiesDir)) {
        const dirs = fs.readdirSync(storiesDir, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name);

        for (const dir of dirs) {
          const outputDir = path.join(storiesDir, dir);
          const primary = manifestModule.resolveStoryFile(outputDir);
          if (!primary) continue;
          try {
            const parsed = JSON.parse(fs.readFileSync(primary.abs, 'utf8'));
            const decoded = codec.safeDecodeStory(parsed);
            if (!decoded.ok || decoded.pkg.storyId !== storyId) continue;
            const promptsDir = path.join(outputDir, 'prompts');
            if (fs.existsSync(promptsDir)) {
              const promptFiles = fs.readdirSync(promptsDir);
              for (const pf of promptFiles) {
                const pfLower = pf.toLowerCase();
                if ((beatId && pfLower.includes(beatId.toLowerCase()))
                  || (sceneId && pfLower.includes(sceneId.toLowerCase()))) {
                  promptPath = path.join(promptsDir, pf);
                  const promptData = JSON.parse(fs.readFileSync(promptPath, 'utf8'));
                  resolvedIdentifier = promptData.identifier || pf.replace('.json', '');
                  break;
                }
              }
            }
            break;
          } catch (err) {
            console.error(`[Proxy] Error reading story ${dir}:`, err.message);
          }
        }
      }

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

      res.json({
        success: true,
        message: 'Image rerendered successfully',
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
