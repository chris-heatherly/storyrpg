const bcrypt = require('bcryptjs');
const { getPool } = require('./db/pool');

const BCRYPT_ROUNDS = 12;

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    email: row.email || null,
    displayName: row.display_name || null,
    picture: row.picture || null,
    role: row.role || 'user',
  };
}

async function findUserById(id) {
  const result = await getPool().query(
    `SELECT id, email, provider, provider_id, display_name, picture, role
     FROM users WHERE id = $1`,
    [id],
  );
  return rowToUser(result.rows[0]);
}

async function findUserByProvider(provider, providerId) {
  const result = await getPool().query(
    `SELECT id, email, provider, provider_id, display_name, picture, role
     FROM users WHERE provider = $1 AND provider_id = $2`,
    [provider, providerId],
  );
  return rowToUser(result.rows[0]);
}

async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const result = await getPool().query(
    `SELECT id, email, provider, provider_id, display_name, picture, role
     FROM users WHERE LOWER(email) = $1`,
    [normalized],
  );
  return rowToUser(result.rows[0]);
}

async function createLocalUser({ email, password, displayName }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    const err = new Error('Valid email is required');
    err.code = 'INVALID_EMAIL';
    throw err;
  }
  if (!password || String(password).length < 8) {
    const err = new Error('Password must be at least 8 characters');
    err.code = 'INVALID_PASSWORD';
    throw err;
  }

  const existing = await findUserByEmail(normalized);
  if (existing) {
    const err = new Error('An account with this email already exists');
    err.code = 'EMAIL_EXISTS';
    throw err;
  }

  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const display = (displayName || normalized.split('@')[0] || 'Player').trim().slice(0, 80);

  try {
    const result = await getPool().query(
      `INSERT INTO users (email, provider, provider_id, password_hash, display_name, picture, role)
       VALUES ($1, 'local', $1, $2, $3, NULL, 'user')
       RETURNING id, email, provider, provider_id, display_name, picture, role`,
      [normalized, passwordHash, display],
    );
    return rowToUser(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      const dup = new Error('An account with this email already exists');
      dup.code = 'EMAIL_EXISTS';
      throw dup;
    }
    throw err;
  }
}

async function verifyLocalUser(email, password) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const result = await getPool().query(
    `SELECT id, email, provider, provider_id, password_hash, display_name, picture, role
     FROM users WHERE provider = 'local' AND provider_id = $1`,
    [normalized],
  );
  const row = result.rows[0];
  if (!row || !row.password_hash) return null;

  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) return null;
  return rowToUser(row);
}

async function findOrCreateOAuthUser({ provider, providerId, email, displayName, picture }) {
  const pid = String(providerId || '').trim();
  if (!pid) {
    throw new Error('OAuth profile missing provider id');
  }

  let user = await findUserByProvider(provider, pid);
  if (user) {
    await getPool().query(
      `UPDATE users SET
         email = COALESCE($2, email),
         display_name = COALESCE($3, display_name),
         picture = COALESCE($4, picture),
         updated_at = NOW()
       WHERE id = $1`,
      [user.id, email ? normalizeEmail(email) : null, displayName, picture],
    );
    return findUserById(user.id);
  }

  const normalizedEmail = email ? normalizeEmail(email) : null;
  if (normalizedEmail) {
    const byEmail = await findUserByEmail(normalizedEmail);
    if (byEmail && byEmail.provider === 'local') {
      await getPool().query(
        `UPDATE users SET
           provider = $2,
           provider_id = $3,
           display_name = COALESCE($4, display_name),
           picture = COALESCE($5, picture),
           updated_at = NOW()
         WHERE id = $1`,
        [byEmail.id, provider, pid, displayName, picture],
      );
      return findUserById(byEmail.id);
    }
  }

  const result = await getPool().query(
    `INSERT INTO users (email, provider, provider_id, password_hash, display_name, picture, role)
     VALUES ($1, $2, $3, NULL, $4, $5, 'user')
     RETURNING id, email, provider, provider_id, display_name, picture, role`,
    [normalizedEmail, provider, pid, displayName || 'Player', picture],
  );
  return rowToUser(result.rows[0]);
}

module.exports = {
  findUserById,
  findUserByProvider,
  findUserByEmail,
  createLocalUser,
  verifyLocalUser,
  findOrCreateOAuthUser,
  rowToUser,
};
