function registerCatalogRoutes(app, { listLatestStoryRecords, createStoryCatalogEntry, createFullStoryResponse }) {
  app.get('/', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/list-stories', (req, res) => {
    try {
      const { valid, invalid } = listLatestStoryRecords({ includeInvalid: true });
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

  app.get('/stories/:storyId', (req, res) => {
    try {
      const { storyId } = req.params;
      const { valid } = listLatestStoryRecords({ includeInvalid: true });
      const record = valid.find((candidate) => candidate.pkg?.storyId === storyId);
      if (!record) {
        return res.status(404).json({ error: 'Story not found' });
      }
      res.json(createFullStoryResponse(record, req));
    } catch (error) {
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });
}

module.exports = {
  registerCatalogRoutes,
};
