import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const entry = path.join(root, 'apps/reader/ReaderApp.tsx');

const forbiddenPathParts = [
  'src/ai-agents/',
  'src/screens/GeneratorScreen',
  'src/screens/generator/',
  'src/stores/generationJobStore',
  'src/stores/imageJobStore',
  'src/stores/videoJobStore',
  'src/stores/seasonPlanStore',
  'src/hooks/useGeneratorRunner',
  'src/config/generatorLlmOptions',
];

const forbiddenBundleStrings = [
  'FullStoryPipeline',
  'GeneratorScreen',
  'ANTHROPIC_API_KEY',
  'STABLE_DIFFUSION',
  'LORA_TRAINER',
  'COGNEE_BASE_URL',
  'COGNEE_API_KEY',
  'STORYRPG_MEMORY_PROVIDER',
  'pipelineMemory',
  'AgentMemoryContextBuilder',
  'ValidatorEvidenceService',
  'ArtifactMemoryService',
  'ArtifactContextResolver',
  'FactMemoryService',
  'MemoryQueryPlanner',
  'PipelineFactRecord',
  'GENERATION PROJECTS',
];

// When set, a missing dist-reader is a FAILURE rather than a silent skip, so
// the bundle secret-scan can never be quietly bypassed. Use the strict script
// (`npm run verify:reader`) or CI, which build dist-reader first.
const requireBundle =
  process.argv.includes('--require-bundle') || process.env.READER_BOUNDARY_REQUIRE_BUNDLE === '1';

// Provider API-key value patterns that must never appear in the public bundle,
// even if the *name* of the env var doesn't. See docs/PROJECT_AUDIT_2026-05-28.md L3.
const secretValuePatterns = [
  { label: 'Google API key (AIza…)', re: /AIza[0-9A-Za-z_\-]{35}/g },
  { label: 'OpenAI key (sk-…)', re: /\bsk-[A-Za-z0-9_\-]{20,}\b/g },
  { label: 'Anthropic key (sk-ant-…)', re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g },
];

// Literal secret values pulled from the environment + .env, so a key that gets
// inlined at build time is caught regardless of the surrounding variable name.
function collectSecretValues() {
  const values = new Set();
  const consider = (name, value) => {
    if (!value || value.length < 12) return;
    // PostHog publishable/client keys (phc_/phx_) and POSTHOG_HOST are designed
    // to ship in the client bundle — they are not secrets.
    if (/POSTHOG/i.test(name) || /^ph[cx]_/.test(value)) return;
    if (/(KEY|TOKEN|SECRET|PASSWORD)/i.test(name)) values.add(value);
  };
  for (const [name, value] of Object.entries(process.env)) consider(name, value);
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      consider(m[1], m[2].replace(/^['"]|['"]$/g, ''));
    }
  }
  return [...values];
}

function redact(value) {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}

const importRe = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const sideEffectImportRe = /import\s+['"]([^'"]+)['"]/g;
// Dynamic import()/require() with a string literal — a lazy
// `await import('../../ai-agents/…')` must not escape the walk.
const dynamicImportRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function existsAsFile(base) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function resolveImport(fromFile, specifier) {
  if (specifier === '@storyrpg/app-entry') return entry;
  if (specifier.startsWith('.')) {
    return existsAsFile(path.resolve(path.dirname(fromFile), specifier));
  }
  return null;
}

function readImports(file) {
  const source = fs.readFileSync(file, 'utf8');
  const imports = new Set();
  for (const re of [importRe, sideEffectImportRe, dynamicImportRe, requireRe]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source))) {
      imports.add(match[1]);
    }
  }
  return [...imports];
}

const seen = new Set();
const stack = [entry];
const violations = [];

while (stack.length > 0) {
  const file = stack.pop();
  if (!file || seen.has(file)) continue;
  seen.add(file);

  const rel = toPosix(path.relative(root, file));
  for (const forbidden of forbiddenPathParts) {
    if (rel.includes(forbidden)) {
      violations.push(`Reader graph reaches forbidden module: ${rel}`);
    }
  }

  for (const specifier of readImports(file)) {
    const resolved = resolveImport(file, specifier);
    if (resolved) stack.push(resolved);
  }
}

const distReader = path.join(root, 'dist-reader');
if (fs.existsSync(distReader)) {
  const secretValues = collectSecretValues();
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        walk(abs);
      } else if (/\.(js|html|json|map|txt)$/i.test(name)) {
        files.push(abs);
      }
    }
  };
  walk(distReader);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const relFile = toPosix(path.relative(root, file));
    // Generator-code strings are only a violation in the built APP bundle, not
    // in generated story packages under reader-content/ (those are data and may
    // legitimately reference pipeline metadata by name).
    const isGeneratedContent = relFile.includes('/reader-content/');
    if (!isGeneratedContent) {
      for (const token of forbiddenBundleStrings) {
        if (source.includes(token)) {
          violations.push(`Reader export contains forbidden string "${token}" in ${relFile}`);
        }
      }
    }
    // Literal secret values inlined at build time.
    for (const value of secretValues) {
      if (source.includes(value)) {
        violations.push(`Reader export leaks a secret value ${redact(value)} in ${relFile}`);
      }
    }
    // Generic provider-key shapes (catches keys not present in .env).
    for (const { label, re } of secretValuePatterns) {
      re.lastIndex = 0;
      if (re.test(source)) {
        violations.push(`Reader export contains a ${label} in ${relFile}`);
      }
    }
  }
  console.log(`Reader bundle scanned (${files.length} files, ${secretValues.length} secret value(s) checked).`);
} else if (requireBundle) {
  violations.push(
    'dist-reader/ is missing but --require-bundle was set. Run `npm run reader:export` first so the bundle secret-scan can run.',
  );
} else {
  console.warn(
    'Note: dist-reader/ not found — skipping bundle secret-scan (import-graph check still ran). ' +
      'Use `npm run verify:reader` for the full check.',
  );
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log(`Reader boundary clean (${seen.size} files checked).`);
