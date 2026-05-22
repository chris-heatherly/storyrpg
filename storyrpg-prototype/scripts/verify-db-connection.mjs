#!/usr/bin/env node
/**
 * Verifies DATABASE_URL (Postgres). Requires Cloud SQL Auth Proxy when using 127.0.0.1.
 * Usage: node scripts/verify-db-connection.mjs
 * Loads storyrpg-prototype/.env via dotenv if DATABASE_URL is unset.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');

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
  console.error('FAIL: DATABASE_URL is not set (add it to .env)');
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error('FAIL: DATABASE_URL is not a valid URL');
  process.exit(1);
}

const host = parsed.hostname;
const port = parsed.port || '5432';
const db = parsed.pathname.replace(/^\//, '') || '(default)';
const user = decodeURIComponent(parsed.username || '');

console.log(`Connecting to ${user}@${host}:${port}/${db} …`);

const { default: pg } = await import('pg');
const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 10000,
});

try {
  await client.connect();
  const res = await client.query(
    'SELECT current_database() AS database, current_user AS user, NOW() AS server_time',
  );
  console.log('OK: Connected successfully');
  console.log(JSON.stringify(res.rows[0], null, 2));
  process.exit(0);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('FAIL:', msg);
  if (msg.includes('ECONNREFUSED') && (host === '127.0.0.1' || host === 'localhost')) {
    console.error(
      '\nHint: Start Cloud SQL Auth Proxy on this port, e.g.\n' +
        '  cloud-sql-proxy PROJECT:REGION:INSTANCE --port ' +
        port,
    );
  }
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
