#!/usr/bin/env node
/**
 * Applies SQL files in proxy/db/migrations/ in lexical order.
 * Usage: npm run db:migrate  (requires DATABASE_URL and db:proxy if using 127.0.0.1)
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');
const migrationsDir = resolve(root, 'proxy/db/migrations');

function loadEnvFile() {
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const url = (process.env.DATABASE_URL || '').trim();
if (!url) {
  console.error('FAIL: DATABASE_URL is not set');
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.log('No migration files found.');
  process.exit(0);
}

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });

try {
  await client.connect();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    console.log(`Applying ${file}…`);
    await client.query(sql);
    console.log(`  OK`);
  }
  console.log('Migrations complete.');
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
