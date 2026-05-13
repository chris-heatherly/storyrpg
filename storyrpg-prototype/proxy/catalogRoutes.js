function registerCatalogRoutes(app, { listLatestStoryRecords, createStoryCatalogEntry, createFullStoryResponse }) {
  app.get('/', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/list-stories', async (req, res) => {
    try {
      const result = await listLatestStoryRecords({ includeInvalid: true });
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
      const result = await listLatestStoryRecords({ includeInvalid: true });
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
}

module.exports = {
  registerCatalogRoutes,
};
