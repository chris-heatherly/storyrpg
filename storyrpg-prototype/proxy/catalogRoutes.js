function registerCatalogRoutes(app, {
  listLatestStoryRecords,
  getStoryRecord,
  createStoryCatalogEntry,
  createFullStoryResponse,
}) {
  app.get('/', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/list-stories', async (req, res) => {
    try {
      const result = await listLatestStoryRecords({
        includeInvalid: true,
        includeHeld: req.query.includeHeld === '1',
      });
      const valid = Array.isArray(result) ? result : result.valid;
      const invalid = Array.isArray(result) ? [] : (result.invalid || []);

      // Surface broken stories to the UI as an `invalid` array; they
      // render in the library with an error card instead of being
      // silently swallowed. Query `?strict=1` to get just the valid
      // list (useful for scripts that don't care about broken dirs).
      if (req.query.strict === '1') {
        return res.json(valid.map((record) => createStoryCatalogEntry(record, req)));
      }
      res.json({
        stories: valid.map((record) => createStoryCatalogEntry(record, req)),
        invalid: invalid.map((record) => ({
          dirName: record.dirName,
          primaryFilename: record.primaryFilename,
          error: record.error,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  app.get('/stories/:storyId', async (req, res) => {
    try {
      const { storyId } = req.params;
      const result = await listLatestStoryRecords({
        includeInvalid: true,
        includeHeld: req.query.includeHeld === '1',
      });
      const valid = Array.isArray(result) ? result : result.valid;
      const record = valid.find(
        (candidate) => candidate.pkg?.storyId === storyId || candidate.story?.id === storyId,
      );
      if (!record) {
        return res.status(404).json({ error: 'Story not found' });
      }
      res.json(await createFullStoryResponse(record, req));
    } catch (error) {
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  app.get('/story-runs/:runId', async (req, res) => {
    try {
      const { runId } = req.params;
      if (!/^[a-zA-Z0-9._-]+$/.test(runId)) {
        return res.status(400).json({ error: 'Invalid story run id' });
      }
      const record = getStoryRecord(runId);
      if (!record) return res.status(404).json({ error: 'Story run not found' });
      if (record.error) return res.status(409).json({ error: 'Story run package is invalid', details: record.error });
      return res.json(await createFullStoryResponse(record, req));
    } catch (error) {
      return res.status(500).json({ error: error.message, stack: error.stack });
    }
  });
}

module.exports = {
  registerCatalogRoutes,
};
