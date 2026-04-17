/**
 * POST /memories/operation — Proxied memory operations for the web runtime.
 *
 * All paths are sandboxed under `memoryRoot`; any attempt to escape via
 * `..` or absolute paths is rejected with a "Path traversal blocked" error.
 */

const fs = require('fs');
const path = require('path');

function registerMemoryRoutes(app, { memoryRoot }) {
  if (!memoryRoot) {
    throw new Error('registerMemoryRoutes requires memoryRoot');
  }

  function assertSafeMemoryPath(requested) {
    const resolved = path.resolve(memoryRoot, String(requested || '').replace(/^\/memories\/?/, ''));
    if (!resolved.startsWith(path.resolve(memoryRoot))) {
      throw new Error(`Path traversal blocked: ${requested}`);
    }
    return resolved;
  }

  app.post('/memories/operation', async (req, res) => {
    const {
      command, path: memPath, view_range, file_text, old_str, new_str,
      insert_line, insert_text, old_path, new_path,
    } = req.body || {};

    if (!command) return res.status(400).json({ error: 'Missing command' });

    try {
      let result;
      switch (command) {
        case 'view': {
          if (!memPath) return res.status(400).json({ error: 'Missing path' });
          const resolved = assertSafeMemoryPath(memPath);
          let stat;
          try { stat = fs.statSync(resolved); } catch {
            return res.json({ result: `The path ${memPath} does not exist.` });
          }
          if (stat.isDirectory()) {
            const entries = fs.readdirSync(resolved).filter((e) => !e.startsWith('.'));
            result = `Directory listing of ${memPath}:\n${entries.join('\n')}`;
          } else {
            const content = fs.readFileSync(resolved, 'utf8');
            const lines = content.split('\n');
            let start = 1; let end = lines.length;
            if (view_range) {
              start = Math.max(1, view_range[0]);
              end = Math.min(lines.length, view_range[1]);
            }
            const numbered = lines.slice(start - 1, end)
              .map((line, i) => `${String(start + i).padStart(6)}\t${line}`)
              .join('\n');
            result = `Content of ${memPath}:\n${numbered}`;
          }
          break;
        }
        case 'create': {
          if (!memPath || file_text === undefined) return res.status(400).json({ error: 'Missing path or file_text' });
          const resolved = assertSafeMemoryPath(memPath);
          if (fs.existsSync(resolved)) {
            result = `Error: File ${memPath} already exists`;
          } else {
            fs.mkdirSync(path.dirname(resolved), { recursive: true });
            fs.writeFileSync(resolved, file_text, 'utf8');
            result = `File created successfully at: ${memPath}`;
          }
          break;
        }
        case 'str_replace': {
          if (!memPath || !old_str || new_str === undefined) return res.status(400).json({ error: 'Missing path, old_str or new_str' });
          const resolved = assertSafeMemoryPath(memPath);
          if (!fs.existsSync(resolved)) {
            result = `Error: The path ${memPath} does not exist.`;
            break;
          }
          let content = fs.readFileSync(resolved, 'utf8');
          const idx = content.indexOf(old_str);
          if (idx === -1) {
            result = `No replacement performed, old_str not found in ${memPath}.`;
          } else if (content.indexOf(old_str, idx + 1) !== -1) {
            result = `No replacement performed. Multiple occurrences of old_str in ${memPath}.`;
          } else {
            content = content.replace(old_str, new_str);
            fs.writeFileSync(resolved, content, 'utf8');
            result = `File ${memPath} has been edited.`;
          }
          break;
        }
        case 'insert': {
          if (!memPath || insert_line === undefined || !insert_text) return res.status(400).json({ error: 'Missing parameters' });
          const resolved = assertSafeMemoryPath(memPath);
          if (!fs.existsSync(resolved)) {
            result = `Error: The path ${memPath} does not exist`;
            break;
          }
          const lines = fs.readFileSync(resolved, 'utf8').split('\n');
          const newLines = insert_text.split('\n');
          lines.splice(insert_line, 0, ...newLines);
          fs.writeFileSync(resolved, lines.join('\n'), 'utf8');
          result = `File ${memPath} has been edited.`;
          break;
        }
        case 'delete': {
          if (!memPath) return res.status(400).json({ error: 'Missing path' });
          const resolved = assertSafeMemoryPath(memPath);
          if (!fs.existsSync(resolved)) {
            result = `Error: The path ${memPath} does not exist`;
            break;
          }
          const stat = fs.statSync(resolved);
          if (stat.isDirectory()) {
            fs.rmSync(resolved, { recursive: true });
          } else {
            fs.unlinkSync(resolved);
          }
          result = `Successfully deleted ${memPath}`;
          break;
        }
        case 'rename': {
          if (!old_path || !new_path) return res.status(400).json({ error: 'Missing old_path or new_path' });
          const resolvedOld = assertSafeMemoryPath(old_path);
          const resolvedNew = assertSafeMemoryPath(new_path);
          if (!fs.existsSync(resolvedOld)) {
            result = `Error: The path ${old_path} does not exist`;
            break;
          }
          if (fs.existsSync(resolvedNew)) {
            result = `Error: The destination ${new_path} already exists`;
            break;
          }
          fs.mkdirSync(path.dirname(resolvedNew), { recursive: true });
          fs.renameSync(resolvedOld, resolvedNew);
          result = `Successfully renamed ${old_path} to ${new_path}`;
          break;
        }
        default:
          return res.status(400).json({ error: `Unknown command: ${command}` });
      }
      res.json({ result });
    } catch (err) {
      console.error('[Memory] Operation error:', err);
      res.status(500).json({ error: err.message || 'Memory operation failed' });
    }
  });
}

module.exports = { registerMemoryRoutes };
