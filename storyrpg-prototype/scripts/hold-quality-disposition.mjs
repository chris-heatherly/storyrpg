import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { readQualityDisposition } = require('../proxy/qualityDisposition.js');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const runDir = arg('--run');
const heldBy = arg('--held-by');
const reason = arg('--reason');
const supersededBy = arg('--superseded-by');
if (!runDir || !heldBy || !reason || reason.trim().length < 10) {
  console.error('Usage: npm run quality:hold -- --run <run-dir> --held-by <identity> --reason <10+ character reason> [--superseded-by <run-dir>]');
  process.exit(1);
}
if (path.basename(runDir) !== runDir || (supersededBy && path.basename(supersededBy) !== supersededBy)) {
  console.error('--run and --superseded-by must be generated-stories directory names, not paths');
  process.exit(1);
}

const storyDir = path.resolve(process.cwd(), 'generated-stories', runDir);
if (!fs.existsSync(storyDir) || !fs.statSync(storyDir).isDirectory()) {
  console.error(`Generated story directory not found: ${storyDir}`);
  process.exit(1);
}

const target = path.join(storyDir, 'quality-disposition.json');
const previous = readQualityDisposition(storyDir) || {
  version: 1,
  status: 'promoted',
  band: 'ship',
  eligibleForReader: true,
  reasonCodes: [],
  capIds: [],
  blockingCapCount: 0,
  qaEvidenceStale: false,
  createdAt: '',
};
const priorText = fs.existsSync(target)
  ? fs.readFileSync(target, 'utf8')
  : JSON.stringify(previous);
const heldAt = new Date().toISOString();
const next = {
  ...previous,
  version: 1,
  status: 'held',
  eligibleForReader: false,
  reasonCodes: [...new Set([...(previous.reasonCodes || []), 'audited_manual_hold'])],
  createdAt: previous.createdAt || heldAt,
  legacyDerived: false,
  hold: {
    heldBy: heldBy.trim(),
    heldAt,
    reason: reason.trim(),
    ...(supersededBy ? { supersededBy } : {}),
  },
};
delete next.override;

const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
fs.renameSync(tmp, target);
fs.appendFileSync(path.join(storyDir, 'quality-hold-audit.jsonl'), `${JSON.stringify({
  version: 1,
  runDir,
  heldBy: heldBy.trim(),
  heldAt,
  reason: reason.trim(),
  supersededBy: supersededBy || undefined,
  priorDispositionHash: crypto.createHash('sha256').update(priorText).digest('hex'),
})}\n`, 'utf8');
console.log(`Quality hold recorded for ${runDir} by ${heldBy.trim()}`);
