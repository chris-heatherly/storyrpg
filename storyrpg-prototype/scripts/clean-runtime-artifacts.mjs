import { rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const targets = [
  '.generation-jobs.json',
  '.worker-jobs.json',
  '.worker-checkpoints.json',
  '.worker-dead-letter.json',
  '.worker-results',
  '.worker-checkpoint-outputs',
  '.ref-images',
  '.image-feedback.json',
  '.model-cache.json',
  '.generator-settings.json',
];

// Sweep glob-style runtime artifacts that have variable suffixes
// (job-state backups, codex web dev-server logs/pids). See L2 in
// docs/PROJECT_AUDIT_2026-05-28.md.
try {
  const entries = await readdir(projectRoot);
  for (const name of entries) {
    if (name.includes('.backup-') || name.startsWith('.codex-expo-web.')) {
      targets.push(name);
    }
  }
} catch (error) {
  console.warn(`failed to scan for backup artifacts: ${error instanceof Error ? error.message : String(error)}`);
}

for (const relativePath of targets) {
  const fullPath = path.join(projectRoot, relativePath);
  try {
    await rm(fullPath, { recursive: true, force: true });
    console.log(`removed ${relativePath}`);
  } catch (error) {
    console.warn(`failed to remove ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
