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
  'GENERATION PROJECTS',
];

const importRe = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const sideEffectImportRe = /import\s+['"]([^'"]+)['"]/g;

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
  for (const re of [importRe, sideEffectImportRe]) {
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
    for (const token of forbiddenBundleStrings) {
      if (source.includes(token)) {
        violations.push(`Reader export contains forbidden string "${token}" in ${toPosix(path.relative(root, file))}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log(`Reader boundary clean (${seen.size} files checked).`);
