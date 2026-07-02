const fs = require('fs');
const path = require('path');

const { sanitizeJobState } = require('./sanitizeJobState');

function resolveSettingsFile(options = {}) {
  return options.settingsFile || path.resolve(__dirname, '..', '.generator-settings.json');
}

// Writes accept only plain-object settings and drop values the redacted GET
// produced, so a client that round-trips GET → edit → POST can never overwrite
// a stored secret with the literal string "[redacted]".
function stripRedactedValues(value) {
  if (Array.isArray(value)) return value.map(stripRedactedValues);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === '[redacted]') continue;
    out[key] = stripRedactedValues(child);
  }
  return out;
}

function loadSettings(settingsFile) {
  try {
    if (fs.existsSync(settingsFile)) {
      return JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    }
  } catch (err) {
    console.warn('[GeneratorSettings] Failed to load:', err.message);
  }
  return {};
}

function saveSettings(settingsFile, data) {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.warn('[GeneratorSettings] Failed to save:', err.message);
    return false;
  }
}

function registerGeneratorSettingsRoutes(app, options = {}) {
  const settingsFile = resolveSettingsFile(options);

  app.get('/generator-settings', (_req, res) => {
    try {
      const settings = loadSettings(settingsFile);
      // Redact key/token/secret-shaped values on the way out — this endpoint is
      // a GET and may be reachable without auth on a misconfigured exposure.
      res.json(sanitizeJobState(settings));
    } catch (err) {
      console.error('[GeneratorSettings] Load error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/generator-settings', (req, res) => {
    try {
      const settings = req.body;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return res.status(400).json({ error: 'Body must be a JSON object' });
      }
      const ok = saveSettings(settingsFile, stripRedactedValues(settings));
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
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return res.status(400).json({ error: 'Body must be a JSON object' });
      }
      const current = loadSettings(settingsFile);
      const merged = { ...current, ...stripRedactedValues(patch) };
      const ok = saveSettings(settingsFile, merged);
      if (!ok) {
        return res.status(500).json({ error: 'Failed to write settings file' });
      }
      console.log('[GeneratorSettings] Patched settings:', Object.keys(patch).join(', '));
      res.json({ ok: true, settings: sanitizeJobState(merged) });
    } catch (err) {
      console.error('[GeneratorSettings] Patch error:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerGeneratorSettingsRoutes };
