import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const violations = [];
const endpointLiteral = '/worker-jobs/start';
const endpointOwner = path.join('src', 'ai-agents', 'launch', 'WorkerJobClient.ts');
const boundaryChecker = path.join('scripts', 'check-generation-launch-boundary.mjs');

function walk(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('dist-')) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(absolute));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) output.push(absolute);
  }
  return output;
}

for (const base of ['src', 'scripts']) {
  for (const absolute of walk(path.join(root, base))) {
    const relative = path.relative(root, absolute);
    const source = fs.readFileSync(absolute, 'utf8');
    const isTest = /\.test\.[cm]?[jt]sx?$/.test(relative);
    if (source.includes(endpointLiteral) && !isTest && relative !== endpointOwner && relative !== boundaryChecker) {
      violations.push(`${relative}: direct worker start endpoint usage; use submitWorkerJob()`);
    }
    if (/^scripts\/run-.*worker\.ts$/.test(relative)) {
      for (const forbidden of ['/screens/', '/hooks/', '/config/modelFamilies', '/config/buildPipelineConfig']) {
        if (source.includes(forbidden)) {
          violations.push(`${relative}: imports private generator implementation ${forbidden}`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Generation launch boundary violations:\n${violations.map((item) => `- ${item}`).join('\n')}`);
  process.exit(1);
}
console.log('Generation launch boundary OK');
