const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.resolve(__dirname, '..', '.generator-settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
  } catch (err) {
    console.warn('[GeneratorSettings] Failed to load:', err.message);
  }
  return {};
}

function saveSettings(data) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.warn('[GeneratorSettings] Failed to save:', err.message);
    return false;
  }
}

function registerGeneratorSettingsRoutes(app) {
  app.get('/generator-settings', (_req, res) => {
    try {
      const settings = loadSettings();
      res.json(settings);
    } catch (err) {
      console.error('[GeneratorSettings] Load error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/generator-settings', (req, res) => {
    try {
      const settings = req.body;
      if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ error: 'Body must be a JSON object' });
      }
      const ok = saveSettings(settings);
      if (!ok) {
        return res.status(500).json({ error: 'Failed to write settings file' });
      }
      console.log('[GeneratorSettings] Saved full settings');
      res.json({ ok: true });
    } catch (err) {
      console.error('[GeneratorSettings] Save error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/generator-settings', (req, res) => {
    try {
      const patch = req.body;
      if (!patch || typeof patch !== 'object') {
        return res.status(400).json({ error: 'Body must be a JSON object' });
      }
      const current = loadSettings();
      const merged = { ...current, ...patch };
      const ok = saveSettings(merged);
      if (!ok) {
        return res.status(500).json({ error: 'Failed to write settings file' });
      }
      console.log('[GeneratorSettings] Patched settings:', Object.keys(patch).join(', '));
      res.json({ ok: true, settings: merged });
    } catch (err) {
      console.error('[GeneratorSettings] Patch error:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerGeneratorSettingsRoutes };
