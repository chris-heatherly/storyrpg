const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const OAuth2Strategy = require('passport-oauth2');

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
  // Query lets the SPA clear the URL and stay on the library after OAuth (see App.tsx).
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
  };
}

function registerAuthRoutes(app, { port }) {
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
    done(null, user);
  });
  passport.deserializeUser((user, done) => {
    done(null, user);
  });

  if (googleClientId && googleClientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL: googleCallbackURL,
          scope: ['profile', 'email'],
        },
        (accessToken, refreshToken, profile, done) => {
          const user = {
            provider: 'google',
            id: profile.id,
            email: profile.emails && profile.emails[0] ? profile.emails[0].value : null,
            displayName: profile.displayName || (profile.name && profile.name.givenName) || 'Player',
            picture: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
          };
          done(null, user);
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
        (accessToken, refreshToken, profile, done) => {
          const displayName = profile.globalName || profile.username || 'Player';
          const picture =
            profile.avatar && profile.id
              ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128`
              : null;
          const user = {
            provider: 'discord',
            id: profile.id,
            email: profile.email || null,
            displayName,
            picture,
          };
          done(null, user);
        },
      ),
    );
  }

  app.get('/auth/providers', (req, res) => {
    res.json({
      google: Boolean(googleClientId && googleClientSecret),
      discord: Boolean(discordClientId && discordClientSecret),
    });
  });

  app.get('/auth/me', (req, res) => {
    if (!req.user) {
      return res.status(401).json({ user: null });
    }
    res.json({ user: buildPublicUser(req.user) });
  });

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
