const fs = require('fs');
const path = require('path');

function registerStoryMutationRoutes(app, { storiesDir, deletedStoriesFile }) {
  app.get('/deleted-stories', (req, res) => {
    try {
      if (fs.existsSync(deletedStoriesFile)) {
        const data = JSON.parse(fs.readFileSync(deletedStoriesFile, 'utf8'));
        res.json({ deletedIds: data.deletedIds || [] });
      } else {
        res.json({ deletedIds: [] });
      }
    } catch (error) {
      console.error('[Proxy] Failed to read deleted stories file:', error);
      res.json({ deletedIds: [] });
    }
  });

  app.post('/deleted-stories', (req, res) => {
    const { deletedIds } = req.body;
    try {
      if (!fs.existsSync(storiesDir)) {
        fs.mkdirSync(storiesDir, { recursive: true });
      }
      fs.writeFileSync(
        deletedStoriesFile,
        JSON.stringify({ deletedIds, updatedAt: new Date().toISOString() }),
        'utf8',
      );
      console.log(`[Proxy] Saved ${deletedIds.length} deleted story IDs to filesystem`);
      res.json({ success: true });
    } catch (error) {
      console.error('[Proxy] Failed to save deleted stories file:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/delete-story/:storyId', (req, res) => {
    const { storyId } = req.params;
    if (!fs.existsSync(storiesDir)) return res.status(404).send('Not found');

    const dirs = fs
      .readdirSync(storiesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    let deleted = 0;
    for (const dir of dirs) {
      const storyFile = path.join(storiesDir, dir, '08-final-story.json');
      if (!fs.existsSync(storyFile)) continue;
      try {
        const story = JSON.parse(fs.readFileSync(storyFile, 'utf8'));
        if (story.id === storyId) {
          fs.rmSync(path.join(storiesDir, dir), { recursive: true, force: true });
          deleted += 1;
        }
      } catch {}
    }

    try {
      let deletedIds = [];
      if (fs.existsSync(deletedStoriesFile)) {
        const data = JSON.parse(fs.readFileSync(deletedStoriesFile, 'utf8'));
        deletedIds = data.deletedIds || [];
      }
      if (!deletedIds.includes(storyId)) {
        deletedIds.push(storyId);
        fs.writeFileSync(
          deletedStoriesFile,
          JSON.stringify({ deletedIds, updatedAt: new Date().toISOString() }),
          'utf8',
        );
        console.log(`[Proxy] Added ${storyId} to filesystem deleted stories list`);
      }
    } catch (error) {
      console.warn('[Proxy] Failed to update deleted stories file:', error);
    }

    res.json({ success: deleted > 0, deleted });
  });

  app.post('/install-builtin-story', (req, res) => {
    const { story } = req.body;
    if (!story || !story.id || !story.title) {
      return res.status(400).json({ error: 'Missing story data' });
    }

    try {
      if (!fs.existsSync(storiesDir)) {
        fs.mkdirSync(storiesDir, { recursive: true });
      }

      if (fs.existsSync(deletedStoriesFile)) {
        try {
          const deletedData = JSON.parse(fs.readFileSync(deletedStoriesFile, 'utf8'));
          const deletedIds = deletedData.deletedIds || [];
          if (deletedIds.includes(story.id)) {
            console.log(`[Proxy] Blocked installation of deleted story: ${story.title} (${story.id})`);
            return res.json({ success: false, blocked: true, reason: 'Story was previously deleted' });
          }
        } catch (error) {
          console.warn('[Proxy] Failed to check deleted stories file:', error);
        }
      }

      const dirs = fs
        .readdirSync(storiesDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

      for (const dir of dirs) {
        const storyFile = path.join(storiesDir, dir, '08-final-story.json');
        if (!fs.existsSync(storyFile)) continue;
        try {
          const existing = JSON.parse(fs.readFileSync(storyFile, 'utf8'));
          if (existing.id === story.id) {
            return res.json({ success: true, alreadyExists: true, outputDir: `generated-stories/${dir}/` });
          }
        } catch {}
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const slug = story.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50);
      const dirName = `${slug}_${timestamp}`;
      const storyDir = path.join(storiesDir, dirName);
      fs.mkdirSync(storyDir, { recursive: true });

      story.isBuiltIn = true;
      story.outputDir = `generated-stories/${dirName}/`;

      const storyFile = path.join(storyDir, '08-final-story.json');
      fs.writeFileSync(storyFile, JSON.stringify(story, null, 2), 'utf8');

      const manifest = {
        storyTitle: story.title,
        storyId: story.id,
        isBuiltIn: true,
        installedAt: new Date().toISOString(),
        files: [{ name: 'Final Story', path: storyFile, type: 'story' }],
      };
      fs.writeFileSync(path.join(storyDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

      console.log(`[Proxy] Installed built-in story: ${story.title} -> ${dirName}`);
      res.json({ success: true, outputDir: `generated-stories/${dirName}/` });
    } catch (error) {
      console.error('[Proxy] Error installing built-in story:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/check-builtin-stories', (req, res) => {
    try {
      const installedIds = new Set();
      let deletedIds = [];

      if (fs.existsSync(deletedStoriesFile)) {
        try {
          const deletedData = JSON.parse(fs.readFileSync(deletedStoriesFile, 'utf8'));
          deletedIds = deletedData.deletedIds || [];
        } catch (error) {
          console.warn('[Proxy] Failed to read deleted stories file:', error);
        }
      }

      if (fs.existsSync(storiesDir)) {
        const dirs = fs
          .readdirSync(storiesDir, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name);

        for (const dir of dirs) {
          const storyFile = path.join(storiesDir, dir, '08-final-story.json');
          if (!fs.existsSync(storyFile)) continue;
          try {
            const story = JSON.parse(fs.readFileSync(storyFile, 'utf8'));
            installedIds.add(story.id);
          } catch {}
        }
      }

      res.json({
        installedIds: Array.from(installedIds),
        deletedIds,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/rename-story', (req, res) => {
    const { storyId, newTitle } = req.body;
    if (!fs.existsSync(storiesDir)) return res.status(404).send('Not found');

    const dirs = fs
      .readdirSync(storiesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    let updated = 0;
    for (const dir of dirs) {
      const oldDirPath = path.join(storiesDir, dir);
      const storyFile = path.join(oldDirPath, '08-final-story.json');
      if (!fs.existsSync(storyFile)) continue;
      try {
        const story = JSON.parse(fs.readFileSync(storyFile, 'utf8'));
        if (story.id !== storyId) continue;

        story.title = newTitle;
        fs.writeFileSync(storyFile, JSON.stringify(story, null, 2), 'utf8');

        const manifestFile = path.join(oldDirPath, 'manifest.json');
        if (fs.existsSync(manifestFile)) {
          const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
          manifest.storyTitle = newTitle;
          fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');
        }

        const timestamp = dir.includes('_')
          ? dir.split('_').pop()
          : new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const newSlug = newTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50);
        const newDirName = `${newSlug}_${timestamp}`;
        const newDirPath = path.join(storiesDir, newDirName);

        if (oldDirPath !== newDirPath) {
          fs.renameSync(oldDirPath, newDirPath);
          console.log(`[Proxy] Renamed story directory: ${dir} -> ${newDirName}`);
        }

        updated += 1;
      } catch (error) {
        console.error(`[Proxy] Error renaming story ${storyId}:`, error);
      }
    }

    res.json({ success: updated > 0 });
  });
}

module.exports = {
  registerStoryMutationRoutes,
};
