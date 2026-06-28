#!/usr/bin/env npx ts-node --esm
/**
 * CLI: validate-assets
 *
 * Three layers of on-disk integrity per story directory:
 *   1. `manifest.json` exists, references `story.json`, and the
 *      bytes-on-disk match the manifest's sha256.
 *   2. `decodeStory(story.json)` parses cleanly; the package is valid
 *      at the declared schemaVersion.
 *   3. Every `AssetRef` in the package's `assets/` index resolves to a
 *      real file on disk whose sha256 matches the key.
 *
 * Legacy-only directories must be migrated before asset validation. The
 * validator no longer walks `08-final-story.json` as a runtime fallback.
 *
 * Usage:
 *   npm run validate:assets -- <story-dir-or-json>
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  decodeStory,
  StoryValidationError,
} from '../src/ai-agents/codec/storyCodec';
import {
  readManifest,
  verifyPrimaryFile,
  sha256OfFileSync,
} from '../src/ai-agents/codec/storyManifest';
import { pathForSha256 } from '../src/assets/assetResolver';

type Finding =
  | { severity: 'ok'; message: string }
  | { severity: 'warn'; message: string }
  | { severity: 'error'; message: string };

function reportLine(f: Finding): string {
  const tag = f.severity === 'ok' ? '[ok]  ' : f.severity === 'warn' ? '[warn]' : '[ERR] ';
  return `  ${tag} ${f.message}`;
}

async function validateStoryDir(storyDir: string): Promise<{ findings: Finding[]; hadError: boolean }> {
  const findings: Finding[] = [];
  let hadError = false;

  const validatePackageFile = (primaryAbs: string): boolean => {
    let pkg;
    try {
      const raw = JSON.parse(fs.readFileSync(primaryAbs, 'utf8'));
      pkg = decodeStory(raw);
      findings.push({
        severity: 'ok',
        message: `decodeStory: schemaVersion=${pkg.detectedSchemaVersion} → v${pkg.schemaVersion} (${Object.keys(pkg.assets).length} assets)`,
      });
    } catch (err) {
      const issues = err instanceof StoryValidationError
        ? err.issues.map((i) => `${i.path}: ${i.message}`).join('; ')
        : (err instanceof Error ? err.message : String(err));
      findings.push({ severity: 'error', message: `decodeStory failed: ${issues}` });
      return true;
    }

    const assetsRoot = path.join(storyDir, 'assets');
    let missing = 0;
    let hashMismatch = 0;
    let verified = 0;
    for (const [sha, ref] of Object.entries(pkg.assets)) {
      if (sha !== ref.sha256) {
        findings.push({
          severity: 'error',
          message: `assets["${sha}"].sha256 does not match its key (got ${ref.sha256})`,
        });
        hadError = true;
        continue;
      }
      const rel = pathForSha256(ref.sha256, ref.mimeType);
      const abs = path.join(assetsRoot, rel);
      if (!fs.existsSync(abs)) {
        findings.push({ severity: 'error', message: `missing asset file for ${sha.slice(0, 12)}...: ${rel}` });
        missing++;
        hadError = true;
        continue;
      }
      const { sha256: onDisk } = sha256OfFileSync(abs);
      if (onDisk !== sha) {
        findings.push({
          severity: 'error',
          message: `asset sha256 mismatch for ${rel} (manifest=${sha} disk=${onDisk})`,
        });
        hashMismatch++;
        hadError = true;
        continue;
      }
      verified++;
    }
    findings.push({
      severity: missing + hashMismatch > 0 ? 'error' : 'ok',
      message: `assets/: ${verified} verified, ${missing} missing, ${hashMismatch} hash-mismatch`,
    });

    return hadError;
  };

  const manifest = readManifest(storyDir);
  if (!manifest) {
    const packagedStory = path.join(storyDir, 'story.json');
    if (fs.existsSync(packagedStory)) {
      findings.push({
        severity: 'warn',
        message: 'codec manifest missing or shadowed by run manifest — validating story.json package directly',
      });
      return { findings, hadError: validatePackageFile(packagedStory) };
    }

    findings.push({
      severity: 'error',
      message: `manifest.json missing and no story.json package found in ${storyDir}; run scripts/migrate-stories.ts before validating assets`,
    });
    return { findings, hadError: true };
  }

  // 1. Manifest integrity
  let primaryAbs: string;
  try {
    primaryAbs = verifyPrimaryFile(storyDir, manifest);
    findings.push({
      severity: 'ok',
      message: `manifest.sha256 matches ${manifest.primaryStoryFile} (${manifest.files[manifest.primaryStoryFile].bytes} bytes)`,
    });
  } catch (err) {
    findings.push({
      severity: 'error',
      message: `manifest integrity failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { findings, hadError: true };
  }

  // 2. decodeStory passes
  hadError = validatePackageFile(primaryAbs);

  return { findings, hadError };
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: validate-assets <story-dir-or-json>');
    process.exit(1);
  }

  let storyDir = target;
  if (!fs.statSync(target).isDirectory()) {
    storyDir = path.dirname(target);
  }

  console.log(`Validating: ${storyDir}\n`);
  const { findings, hadError } = await validateStoryDir(storyDir);
  for (const f of findings) {
    console.log(reportLine(f));
  }

  if (hadError) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
