function registerCatalogRoutes(app, { listLatestStoryRecords, createStoryCatalogEntry, createFullStoryResponse }) {
  app.get('/', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/list-stories', (req, res) => {
    try {
      const records = listLatestStoryRecords();
      res.json(records.map((record) => createStoryCatalogEntry(record, req)));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/stories/:storyId', (req, res) => {
    try {
      const { storyId } = req.params;
      const record = listLatestStoryRecords().find((candidate) => candidate.story.id === storyId);
      if (!record) {
        return res.status(404).json({ error: 'Story not found' });
      }
      res.json(createFullStoryResponse(record, req));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = {
  registerCatalogRoutes,
};
