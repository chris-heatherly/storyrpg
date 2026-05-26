import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from 'react-native';
import { LogIn } from 'lucide-react-native';
import { TERMINAL } from '../theme';
import { PROXY_CONFIG } from '../config/endpoints';
import {
  fetchAuthMe,
  fetchAuthProviders,
  postAuthLogin,
  postAuthRegister,
  type AuthProviders,
  type AuthUser,
} from '../services/authSession';

export interface LoginScreenProps {
  onAuthenticated: (user: AuthUser) => void;
  /** When false (default), dev bypass is never shown — required for the creator app. */
  allowDevBypass?: boolean;
}

const DEV_BYPASS_USER: AuthUser = {
  provider: 'dev',
  id: 'dev-bypass-user',
  email: 'dev@storyrpg.local',
  displayName: 'Dev User',
  picture: null,
  role: 'admin',
};

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onAuthenticated,
  allowDevBypass = false,
}) => {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [p, me] = await Promise.all([fetchAuthProviders(), fetchAuthMe()]);
      setProviders(p);
      if (me.user) {
        onAuthenticated(me.user);
        return;
      }
    } catch (e) {
      console.warn('[LoginScreen]', e);
      setError('Could not reach the proxy. Start it with npm run proxy (port 3001).');
      setProviders(null);
    } finally {
      setLoading(false);
    }
  }, [onAuthenticated]);

  useEffect(() => {
    load();
  }, [load]);

  const startGoogle = () => {
    if (typeof window !== 'undefined') {
      window.location.assign(PROXY_CONFIG.authGoogle);
    }
  };

  const startDiscord = () => {
    if (typeof window !== 'undefined') {
      window.location.assign(PROXY_CONFIG.authDiscord);
    }
  };

  const handleEmailSubmit = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Enter email and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result =
        mode === 'signup'
          ? await postAuthRegister(trimmedEmail, password, displayName)
          : await postAuthLogin(trimmedEmail, password);
      onAuthenticated(result.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDevBypass = () => {
    setError(null);
    onAuthenticated(DEV_BYPASS_USER);
  };

  const hasOAuth = Boolean(providers?.google || providers?.discord);
  const showLocal = providers?.local !== false;
  const canRegister = providers?.registration !== false;
  const showDevBypass = allowDevBypass && __DEV__;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.formColumn}>
          <View style={styles.logoRow}>
            <View style={styles.logoIcon}>
              <LogIn size={22} color="white" />
            </View>
            <Text style={styles.logoText}>
              STORY<Text style={{ color: TERMINAL.colors.primary }}>RPG</Text>
            </Text>
          </View>

          <Text style={styles.systemStatus}>SIGN IN REQUIRED</Text>

          {loading ? (
            <View style={styles.card}>
              <ActivityIndicator size="small" color={TERMINAL.colors.primary} />
              <Text style={[styles.muted, { marginTop: 12 }]}>CHECKING SESSION…</Text>
            </View>
          ) : null}

          {error ? (
            <View style={styles.card}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={load}>
                <Text style={styles.secondaryButtonText}>RETRY</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!loading ? (
            <>
              {showDevBypass ? (
                <View style={[styles.card, styles.devBypassCard]}>
                  <Text style={styles.cardTitle}>DEVELOPMENT</Text>
                  <Text style={[styles.muted, { marginBottom: 12 }]}>
                    Skip authentication for local development. This does not create a server session.
                  </Text>
                  <TouchableOpacity style={styles.devBypassButton} onPress={handleDevBypass}>
                    <Text style={styles.devBypassButtonText}>CONTINUE WITHOUT SIGNING IN</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {showLocal ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{mode === 'signin' ? 'EMAIL' : 'CREATE ACCOUNT'}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor={TERMINAL.colors.muted}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Password (8+ characters)"
                    placeholderTextColor={TERMINAL.colors.muted}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    textContentType={mode === 'signin' ? 'password' : 'newPassword'}
                  />
                  {mode === 'signup' ? (
                    <TextInput
                      style={styles.input}
                      placeholder="Display name (optional)"
                      placeholderTextColor={TERMINAL.colors.muted}
                      value={displayName}
                      onChangeText={setDisplayName}
                      autoCapitalize="words"
                    />
                  ) : null}
                  <TouchableOpacity
                    style={[styles.primaryButton, { marginTop: 12 }]}
                    onPress={handleEmailSubmit}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Text style={styles.primaryButtonText}>
                        {mode === 'signin' ? 'SIGN IN WITH EMAIL' : 'CREATE ACCOUNT'}
                      </Text>
                    )}
                  </TouchableOpacity>
                  {canRegister ? (
                    <TouchableOpacity
                      style={[styles.linkButton, { marginTop: 12 }]}
                      onPress={() => {
                        setMode(mode === 'signin' ? 'signup' : 'signin');
                        setError(null);
                      }}
                    >
                      <Text style={styles.linkButtonText}>
                        {mode === 'signin' ? 'NEED AN ACCOUNT? REGISTER' : 'ALREADY HAVE AN ACCOUNT? SIGN IN'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              {hasOAuth && Platform.OS === 'web' ? (
                <View style={[styles.card, styles.cardSpaced]}>
                  <Text style={styles.cardTitle}>OR CONTINUE WITH</Text>
                  {providers?.google ? (
                    <TouchableOpacity
                      style={[styles.oauthButton, styles.oauthButtonGoogle]}
                      onPress={startGoogle}
                    >
                      <Text style={styles.oauthButtonTextGoogle}>GOOGLE</Text>
                    </TouchableOpacity>
                  ) : null}
                  {providers?.discord ? (
                    <TouchableOpacity style={styles.oauthButton} onPress={startDiscord}>
                      <Text style={styles.oauthButtonText}>DISCORD</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              {Platform.OS !== 'web' && hasOAuth ? (
                <Text style={[styles.muted, styles.nativeOAuthNote]}>
                  Google and Discord sign-in are available in the web app. Use email and password here, or open the web
                  build.
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const cardWidth = Platform.OS === 'web' ? ('50%' as const) : ('100%' as const);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TERMINAL.colors.bg,
  },
  body: {
    padding: 24,
    paddingBottom: 48,
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  formColumn: {
    width: '100%',
    maxWidth: 1200,
    alignItems: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
    width: cardWidth,
  },
  logoIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 22,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 2,
  },
  systemStatus: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 24,
    width: cardWidth,
  },
  card: {
    width: cardWidth,
    minWidth: Platform.OS === 'web' ? 300 : undefined,
    maxWidth: Platform.OS === 'web' ? 520 : undefined,
    backgroundColor: '#1e2229',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardSpaced: {
    marginTop: 16,
  },
  devBypassCard: {
    marginBottom: 16,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 2,
    marginBottom: 12,
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: 'white',
    fontSize: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  muted: {
    fontSize: 12,
    color: TERMINAL.colors.muted,
    lineHeight: 18,
  },
  nativeOAuthNote: {
    marginTop: 16,
    textAlign: 'center',
    width: cardWidth,
  },
  errorText: {
    fontSize: 12,
    color: TERMINAL.colors.error,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: TERMINAL.colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  secondaryButton: {
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  secondaryButtonText: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  devBypassButton: {
    backgroundColor: 'rgba(245, 158, 11, 0.22)',
    borderColor: 'rgba(245, 158, 11, 0.5)',
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  devBypassButtonText: {
    color: TERMINAL.colors.amber,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  linkButtonText: {
    color: TERMINAL.colors.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  oauthButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  oauthButtonGoogle: {
    marginTop: 0,
    backgroundColor: 'rgba(59, 130, 246, 0.25)',
    borderColor: 'rgba(59, 130, 246, 0.45)',
  },
  oauthButtonText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  oauthButtonTextGoogle: {
    color: TERMINAL.colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
});
