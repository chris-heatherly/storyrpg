import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const runDir = arg('--run');
const approvedBy = arg('--approved-by');
const reason = arg('--reason');
if (!runDir || !approvedBy || !reason || reason.trim().length < 10) {
  console.error('Usage: npm run quality:override -- --run <run-dir> --approved-by <identity> --reason <10+ character reason>');
  process.exit(1);
}
if (path.basename(runDir) !== runDir) {
  console.error('--run must be a generated-stories directory name, not a path');
  process.exit(1);
}

const storyDir = path.resolve(process.cwd(), 'generated-stories', runDir);
const target = path.join(storyDir, 'quality-disposition.json');
if (!fs.existsSync(target)) {
  console.error(`Quality disposition not found: ${target}`);
  process.exit(1);
}

const previousText = fs.readFileSync(target, 'utf8');
const disposition = JSON.parse(previousText);
if (disposition?.version !== 1) {
  console.error('Unsupported quality disposition version');
  process.exit(1);
}

const approvedAt = new Date().toISOString();
const next = {
  ...disposition,
  override: { approvedBy: approvedBy.trim(), approvedAt, reason: reason.trim() },
};
const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
fs.renameSync(tmp, target);
fs.appendFileSync(path.join(storyDir, 'quality-override-audit.jsonl'), `${JSON.stringify({
  version: 1,
  runDir,
  approvedBy: approvedBy.trim(),
  approvedAt,
  reason: reason.trim(),
  priorDispositionHash: crypto.createHash('sha256').update(previousText).digest('hex'),
})}\n`, 'utf8');
console.log(`Quality override recorded for ${runDir} by ${approvedBy.trim()}`);
