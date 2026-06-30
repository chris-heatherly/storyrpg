const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const OAuth2Strategy = require('passport-oauth2');
const LocalStrategy = require('passport-local').Strategy;
const connectPgSimple = require('connect-pg-simple');
const { getPool, getDatabaseUrl } = require('./db/pool');
const {
  createLocalUser,
  verifyLocalUser,
  findOrCreateOAuthUser,
  findUserById,
} = require('./authUserStore');

/**
 * Discord OAuth2 (authorize + token + @me profile).
 * Uses passport-oauth2 instead of a third-party wrapper.
 */
class DiscordOAuth2Strategy extends OAuth2Strategy {
  constructor(options, verify) {
    super(
      {
        authorizationURL: 'https://discord.com/oauth2/authorize',
        tokenURL: 'https://discord.com/api/oauth2/token',
        clientID: options.clientID,
        clientSecret: options.clientSecret,
        callbackURL: options.callbackURL,
        scope: options.scope || ['identify', 'email'],
        state: options.state !== false,
        customHeaders: options.customHeaders,
      },
      verify,
    );
    this.name = 'discord';
  }

  userProfile(accessToken, done) {
    this._oauth2.get('https://discord.com/api/users/@me', accessToken, (err, body) => {
      if (err) return done(err);
      try {
        const json = JSON.parse(body);
        done(null, {
          id: json.id,
          username: json.username,
          globalName: json.global_name,
          email: json.email,
          avatar: json.avatar,
        });
      } catch (e) {
        done(e);
      }
    });
  }
}

function resolveSessionSecret() {
  const secret = (process.env.SESSION_SECRET || '').trim();
  if (secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[Auth] SESSION_SECRET is missing or too short; set a strong secret (16+ chars). Using insecure fallback.',
    );
  } else {
    console.warn('[Auth] SESSION_SECRET not set; using dev fallback (sessions reset if the server restarts).');
  }
  return 'storyrpg-dev-session-secret-min-16';
}

function getAuthBaseUrl(port) {
  const raw = (process.env.AUTH_BASE_URL || '').trim().replace(/\/+$/, '');
  if (raw) return raw;
  return `http://localhost:${port}`;
}

function getSuccessRedirect() {
  const configured = (process.env.AUTH_SUCCESS_REDIRECT || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return 'http://localhost:8081/?afterAuth=home';
}

function getFailureRedirect() {
  return (process.env.AUTH_FAILURE_REDIRECT || 'http://localhost:8081/?auth=error').trim();
}

function buildPublicUser(user) {
  if (!user) return null;
  return {
    provider: user.provider,
    id: user.id,
    email: user.email || null,
    displayName: user.displayName || null,
    picture: user.picture || null,
    role: user.role || 'user',
  };
}

function isLocalAuthEnabled() {
  return process.env.AUTH_LOCAL_ENABLED !== '0';
}

function isRegistrationEnabled() {
  return process.env.AUTH_ALLOW_REGISTRATION !== '0';
}

function loginUser(req, user, res) {
  req.login(user, (loginErr) => {
    if (loginErr) {
      console.error('[Auth] Session login error:', loginErr);
      return res.status(500).json({ error: 'Could not start session' });
    }
    return res.json({ user: buildPublicUser(user) });
  });
}

function registerAuthUnavailable(app) {
  const message = { error: 'Auth requires DATABASE_URL and applied migrations (npm run db:migrate)' };
  app.get('/auth/providers', (_req, res) => res.status(503).json(message));
  app.get('/auth/me', (_req, res) => res.status(503).json({ user: null, ...message }));
  app.post('/auth/login', (_req, res) => res.status(503).json(message));
  app.post('/auth/register', (_req, res) => res.status(503).json(message));
  app.get('/auth/google', (_req, res) => res.status(503).json(message));
  app.get('/auth/discord', (_req, res) => res.status(503).json(message));
  app.post('/auth/logout', (_req, res) => res.status(503).json(message));
}

function registerAuthRoutes(app, { port }) {
  if (!getDatabaseUrl()) {
    console.error('[Auth] DATABASE_URL is not set — auth routes disabled');
    registerAuthUnavailable(app);
    return;
  }

  let pool;
  try {
    pool = getPool();
  } catch (err) {
    console.error('[Auth] Database pool failed:', err.message);
    registerAuthUnavailable(app);
    return;
  }

  const PgSession = connectPgSimple(session);
  const sessionStore = new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: false,
  });

  const authBase = getAuthBaseUrl(port);
  const googleClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const googleClientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const discordClientId = (process.env.DISCORD_CLIENT_ID || '').trim();
  const discordClientSecret = (process.env.DISCORD_CLIENT_SECRET || '').trim();

  const googleCallbackURL = (process.env.GOOGLE_CALLBACK_URL || `${authBase}/auth/google/callback`).trim();
  const discordCallbackURL = (process.env.DISCORD_CALLBACK_URL || `${authBase}/auth/discord/callback`).trim();

  const sessionMiddleware = session({
    name: 'storyrpg.sid',
    secret: resolveSessionSecret(),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: process.env.SESSION_COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production',
      sameSite: process.env.SESSION_COOKIE_SAMESITE === 'none' ? 'none' : 'lax',
    },
  });

  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await findUserById(id);
      done(null, user || false);
    } catch (err) {
      done(err);
    }
  });

  if (isLocalAuthEnabled()) {
    passport.use(
      new LocalStrategy(
        {
          usernameField: 'email',
          passwordField: 'password',
        },
        async (email, password, done) => {
          try {
            const user = await verifyLocalUser(email, password);
            if (!user) {
              return done(null, false, { message: 'Invalid email or password' });
            }
            return done(null, user);
          } catch (err) {
            return done(err);
          }
        },
      ),
    );
  }

  if (googleClientId && googleClientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL: googleCallbackURL,
          scope: ['profile', 'email'],
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const user = await findOrCreateOAuthUser({
              provider: 'google',
              providerId: profile.id,
              email: profile.emails && profile.emails[0] ? profile.emails[0].value : null,
              displayName: profile.displayName || (profile.name && profile.name.givenName) || 'Player',
              picture: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
            });
            done(null, user);
          } catch (err) {
            done(err);
          }
        },
      ),
    );
  }

  if (discordClientId && discordClientSecret) {
    passport.use(
      'discord',
      new DiscordOAuth2Strategy(
        {
          clientID: discordClientId,
          clientSecret: discordClientSecret,
          callbackURL: discordCallbackURL,
          scope: ['identify', 'email'],
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const displayName = profile.globalName || profile.username || 'Player';
            const picture =
              profile.avatar && profile.id
                ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128`
                : null;
            const user = await findOrCreateOAuthUser({
              provider: 'discord',
              providerId: profile.id,
              email: profile.email || null,
              displayName,
              picture,
            });
            done(null, user);
          } catch (err) {
            done(err);
          }
        },
      ),
    );
  }

  console.log('[Auth] Passport + Postgres users and sessions enabled');

  app.get('/auth/providers', (req, res) => {
    res.json({
      google: Boolean(googleClientId && googleClientSecret),
      discord: Boolean(discordClientId && discordClientSecret),
      local: isLocalAuthEnabled(),
      registration: isLocalAuthEnabled() && isRegistrationEnabled(),
    });
  });

  app.get('/auth/me', (req, res) => {
    if (!req.user) {
      return res.status(401).json({ user: null });
    }
    res.json({ user: buildPublicUser(req.user) });
  });

  if (isLocalAuthEnabled()) {
    app.post('/auth/register', async (req, res) => {
      if (!isRegistrationEnabled()) {
        return res.status(403).json({ error: 'Registration is disabled' });
      }
      const email = req.body?.email;
      const password = req.body?.password;
      const displayName = req.body?.displayName;
      try {
        const user = await createLocalUser({ email, password, displayName });
        return loginUser(req, user, res);
      } catch (err) {
        if (err.code === 'EMAIL_EXISTS') {
          return res.status(409).json({ error: err.message });
        }
        if (err.code === 'INVALID_EMAIL' || err.code === 'INVALID_PASSWORD') {
          return res.status(400).json({ error: err.message });
        }
        console.error('[Auth] Register error:', err);
        return res.status(500).json({ error: 'Registration failed' });
      }
    });

    app.post('/auth/login', (req, res, next) => {
      passport.authenticate('local', (err, user, info) => {
        if (err) {
          console.error('[Auth] Login error:', err);
          return res.status(500).json({ error: 'Login failed' });
        }
        if (!user) {
          return res.status(401).json({ error: info?.message || 'Invalid email or password' });
        }
        return loginUser(req, user, res);
      })(req, res, next);
    });
  }

  app.get('/auth/google', (req, res, next) => {
    if (!googleClientId || !googleClientSecret) {
      return res.status(503).json({ error: 'Google sign-in is not configured' });
    }
    passport.authenticate('google', { session: true })(req, res, next);
  });

  app.get(
    '/auth/google/callback',
    passport.authenticate('google', {
      failureRedirect: getFailureRedirect(),
      session: true,
    }),
    (req, res) => {
      res.redirect(getSuccessRedirect());
    },
  );

  app.get('/auth/discord', (req, res, next) => {
    if (!discordClientId || !discordClientSecret) {
      return res.status(503).json({ error: 'Discord sign-in is not configured' });
    }
    passport.authenticate('discord', { session: true })(req, res, next);
  });

  app.get(
    '/auth/discord/callback',
    passport.authenticate('discord', {
      failureRedirect: getFailureRedirect(),
      session: true,
    }),
    (req, res) => {
      res.redirect(getSuccessRedirect());
    },
  );

  app.post('/auth/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error('[Auth] Logout error:', err);
        return res.status(500).json({ error: 'Logout failed' });
      }
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error('[Auth] Session destroy error:', destroyErr);
          return res.status(500).json({ error: 'Session destroy failed' });
        }
        res.clearCookie('storyrpg.sid', { path: '/' });
        return res.json({ success: true });
      });
    });
  });
}

module.exports = {
  registerAuthRoutes,
};
