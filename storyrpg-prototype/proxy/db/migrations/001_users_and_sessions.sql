-- StoryRPG auth: users + express-session store (connect-pg-simple)

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  provider VARCHAR(32) NOT NULL,
  provider_id TEXT NOT NULL,
  password_hash TEXT,
  display_name TEXT,
  picture TEXT,
  role VARCHAR(16) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_provider_provider_id_key UNIQUE (provider, provider_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users (LOWER(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

-- connect-pg-simple session table
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
