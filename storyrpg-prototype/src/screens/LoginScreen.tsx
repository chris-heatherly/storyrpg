import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Modal,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { ChevronRight, LogIn, Shield } from 'lucide-react-native';
import { TERMINAL } from '../theme';
import { PROXY_CONFIG } from '../config/endpoints';
import { fetchAuthMe, fetchAuthProviders, type AuthUser } from '../services/authSession';

export interface LoginScreenProps {
  onBack: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onBack }) => {
  const [providers, setProviders] = useState<{ google: boolean; discord: boolean } | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    if (Platform.OS !== 'web') {
      setLoading(false);
      setProviders(null);
      setUser(null);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const [p, me] = await Promise.all([fetchAuthProviders(), fetchAuthMe()]);
      setProviders(p);
      setUser(me.user);
    } catch (e) {
      console.warn('[LoginScreen]', e);
      setError('Could not reach the proxy or auth is not configured.');
      setProviders(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startGoogle = () => {
    setPickerOpen(false);
    if (typeof window !== 'undefined') {
      window.location.assign(PROXY_CONFIG.authGoogle);
    }
  };

  const startDiscord = () => {
    setPickerOpen(false);
    if (typeof window !== 'undefined') {
      window.location.assign(PROXY_CONFIG.authDiscord);
    }
  };

  const hasAnyProvider = Boolean(providers?.google || providers?.discord);

  if (Platform.OS !== 'web') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={onBack}>
            <ChevronRight size={20} color={TERMINAL.colors.muted} style={{ transform: [{ rotate: '180deg' }] }} />
            <Text style={styles.headerButtonText}>BACK</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>SIGN IN</Text>
          <View style={{ width: 72 }} />
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Shield size={40} color={TERMINAL.colors.muted} style={{ alignSelf: 'center', marginBottom: 16 }} />
          <Text style={styles.lead}>
            Google and Discord sign-in run in the browser against the StoryRPG proxy. Use the web build
            (npm run web) with the proxy on port 3001 to sign in.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onBack}>
            <Text style={styles.primaryButtonText}>RETURN TO LIBRARY</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={onBack}>
          <ChevronRight size={20} color={TERMINAL.colors.muted} style={{ transform: [{ rotate: '180deg' }] }} />
          <Text style={styles.headerButtonText}>BACK</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>SIGN IN</Text>
        <View style={{ width: 72 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.logoRow}>
          <View style={styles.logoIcon}>
            <LogIn size={22} color="white" />
          </View>
          <Text style={styles.logoText}>
            STORY<Text style={{ color: TERMINAL.colors.primary }}>RPG</Text>
          </Text>
        </View>

        <Text style={styles.systemStatus}>AUTHENTICATION GATEWAY</Text>

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

        {!loading && user ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>SIGNED IN</Text>
            <Text style={styles.cardLine}>{user.displayName || user.email || user.id}</Text>
            <Text style={styles.muted}>{user.provider.toUpperCase()}</Text>
            <TouchableOpacity style={[styles.primaryButton, { marginTop: 16 }]} onPress={onBack}>
              <Text style={styles.primaryButtonText}>CONTINUE TO LIBRARY</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !user && !error ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>ACCOUNT</Text>
            <Text style={styles.muted}>
              {hasAnyProvider
                ? 'Choose Google or Discord. You will be redirected to the proxy to complete sign-in.'
                : 'Configure GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and/or DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET on the proxy, then refresh.'}
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { marginTop: 20 }]}
              onPress={() => (hasAnyProvider ? setPickerOpen(true) : load())}
              disabled={!hasAnyProvider && providers === null}
            >
              <Text style={styles.primaryButtonText}>{hasAnyProvider ? 'SIGN IN' : 'REFRESH'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondaryButton, { marginTop: 12 }]} onPress={onBack}>
              <Text style={styles.secondaryButtonText}>CONTINUE WITHOUT ACCOUNT</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>CHOOSE PROVIDER</Text>
            {providers?.google ? (
              <TouchableOpacity style={[styles.modalChoice, styles.modalChoicePrimary]} onPress={startGoogle}>
                <Text style={styles.modalChoiceTextPrimary}>GOOGLE</Text>
              </TouchableOpacity>
            ) : null}
            {providers?.discord ? (
              <TouchableOpacity style={styles.modalChoice} onPress={startDiscord}>
                <Text style={styles.modalChoiceText}>DISCORD</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setPickerOpen(false)}>
              <Text style={styles.modalCancelText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TERMINAL.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: 72,
  },
  headerButtonText: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  headerTitle: {
    color: 'white',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  body: {
    padding: 24,
    paddingBottom: 48,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
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
  },
  card: {
    backgroundColor: '#1e2229',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 2,
    marginBottom: 8,
  },
  cardLine: {
    fontSize: 16,
    fontWeight: '800',
    color: 'white',
    marginBottom: 4,
  },
  muted: {
    fontSize: 12,
    color: TERMINAL.colors.muted,
    lineHeight: 18,
  },
  errorText: {
    fontSize: 12,
    color: TERMINAL.colors.error,
    marginBottom: 12,
  },
  lead: {
    fontSize: 14,
    color: TERMINAL.colors.muted,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1a1d24',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 2,
    marginBottom: 20,
    textAlign: 'center',
  },
  modalChoice: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  modalChoicePrimary: {
    backgroundColor: 'rgba(59, 130, 246, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.45)',
  },
  modalChoiceText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  modalChoiceTextPrimary: {
    color: TERMINAL.colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  modalCancel: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelText: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
