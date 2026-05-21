const { Pool } = require('pg');

let pool = null;

function getDatabaseUrl() {
  return (process.env.DATABASE_URL || '').trim();
}

function requireDatabaseUrl() {
  const url = getDatabaseUrl();
  if (!url) {
    const err = new Error('DATABASE_URL is not set');
    err.code = 'NO_DATABASE_URL';
    throw err;
  }
  return url;
}

function getPool() {
  if (pool) return pool;
  const connectionString = requireDatabaseUrl();
  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });
  return pool;
}

async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

module.exports = {
  getPool,
  getDatabaseUrl,
  requireDatabaseUrl,
  closePool,
};
