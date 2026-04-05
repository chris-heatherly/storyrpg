import { rm } from 'node:fs/promises';
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
];

for (const relativePath of targets) {
  const fullPath = path.join(projectRoot, relativePath);
  try {
    await rm(fullPath, { recursive: true, force: true });
    console.log(`removed ${relativePath}`);
  } catch (error) {
    console.warn(`failed to remove ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
