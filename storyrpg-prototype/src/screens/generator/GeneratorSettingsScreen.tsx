import React, { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AlertCircle, CheckCircle2, ChevronRight, Code, ExternalLink, Info, RefreshCw, Settings } from 'lucide-react-native';
import { useGeneratorSettingsStore } from '../../stores/generatorSettingsStore';
import { TERMINAL } from '../../theme';
import { APP_VERSION_LABEL } from '../../config/version';
import { canShowInternalAppLinks, getReaderAppUrl } from '../../config/appLinks';
import { PROXY_CONFIG } from '../../config/endpoints';
import { Toggle } from '../../components/ui';

interface GeneratorSettingsScreenProps {
  onBack: () => void;
}

type ArtifactStatus = 'clean' | 'stale' | 'invalid' | 'blocked';

type ArtifactEpisodeHealth = {
  episodeNumber: number;
  status: ArtifactStatus;
  artifactCount: number;
  statusCounts?: Record<string, number>;
  reports?: Array<{ kind?: string; status: ArtifactStatus; reasons?: string[] }>;
};

type ArtifactRunHealth = {
  runId: string;
  status: ArtifactStatus;
  globals: { status: ArtifactStatus; artifactCount: number };
  episodes: ArtifactEpisodeHealth[];
};

export const GeneratorSettingsScreen: React.FC<GeneratorSettingsScreenProps> = ({ onBack }) => {
  const developerMode = useGeneratorSettingsStore((state) => state.developerMode);
  const setDeveloperMode = useGeneratorSettingsStore((state) => state.setDeveloperMode);
  const readerUrl = getReaderAppUrl();
  const showReaderLink = canShowInternalAppLinks(developerMode, readerUrl);
  const [artifactRuns, setArtifactRuns] = useState<ArtifactRunHealth[]>([]);
  const [artifactHealthLoading, setArtifactHealthLoading] = useState(false);
  const [artifactHealthError, setArtifactHealthError] = useState<string | null>(null);

  const loadArtifactHealth = useCallback(async () => {
    setArtifactHealthLoading(true);
    setArtifactHealthError(null);
    try {
      const response = await fetch(PROXY_CONFIG.artifactHealth);
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Artifact health request failed (${response.status})`);
      }
      setArtifactRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch (error) {
      setArtifactHealthError(error instanceof Error ? error.message : String(error));
    } finally {
      setArtifactHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (developerMode) {
      void loadArtifactHealth();
    }
  }, [developerMode, loadArtifactHealth]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={onBack}>
          <ChevronRight size={20} color={TERMINAL.colors.muted} style={{ transform: [{ rotate: '180deg' }] }} />
          <Text style={styles.headerButtonText}>BACK</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>GENERATOR SETTINGS</Text>
        <View style={{ width: 68 }} />
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentPadding}
      >
        <Section
          icon={<Code size={18} color={developerMode ? TERMINAL.colors.cyan : TERMINAL.colors.muted} />}
          title="DEVELOPER MODE"
          description="Internal generator diagnostics and reader handoff"
        >
          <Toggle
            value={developerMode}
            onValueChange={() => setDeveloperMode(!developerMode)}
            label="DEVELOPER MODE"
            helperText="Shows internal generator controls and cross-app links"
            testID="generator-settings-developer-mode"
          />
          {showReaderLink ? (
            <TouchableOpacity
              style={styles.externalLinkButton}
              onPress={() => { void Linking.openURL(readerUrl!); }}
            >
              <ExternalLink size={16} color={TERMINAL.colors.amber} />
              <Text style={styles.externalLinkText}>OPEN READER</Text>
            </TouchableOpacity>
          ) : null}
        </Section>

        <Section
          icon={<Settings size={18} color={TERMINAL.colors.primary} />}
          title="GENERATION CONTROLS"
          description="Provider, model, image, audio, job, and season settings live on the generator workspace"
        >
          <Text style={styles.bodyText}>
            The generation workspace owns API credentials, provider settings, advanced image/audio controls, job history,
            season continuation, and artifact maintenance. These controls are intentionally absent from the public reader
            settings bundle.
          </Text>
        </Section>

        {developerMode ? (
          <Section
            icon={<ArtifactStatusIcon status={rollupRuns(artifactRuns)} />}
            title="ARTIFACT HEALTH"
            description="Current resumable pipeline artifact graph"
          >
            <View style={styles.artifactToolbar}>
              <Text style={styles.bodyText}>
                {artifactHealthLoading
                  ? 'Scanning generated story artifacts...'
                  : artifactRuns.length > 0
                    ? `${artifactRuns.length} run${artifactRuns.length === 1 ? '' : 's'} with artifact metadata`
                    : 'No artifact metadata found yet'}
              </Text>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => { void loadArtifactHealth(); }}
                disabled={artifactHealthLoading}
                accessibilityLabel="Refresh artifact health"
              >
                <RefreshCw size={16} color={TERMINAL.colors.cyan} />
              </TouchableOpacity>
            </View>
            {artifactHealthError ? <Text style={styles.errorText}>{artifactHealthError}</Text> : null}
            {artifactRuns.slice(0, 6).map((run) => (
              <View key={run.runId} style={styles.artifactRun}>
                <View style={styles.artifactRunHeader}>
                  <ArtifactStatusIcon status={run.status} />
                  <Text style={styles.artifactRunTitle} numberOfLines={1}>{run.runId}</Text>
                  <Text style={[styles.artifactStatus, { color: artifactStatusColor(run.status) }]}>
                    {run.status.toUpperCase()}
                  </Text>
                </View>
                <InfoRow label="GLOBAL" value={`${run.globals.status.toUpperCase()} / ${run.globals.artifactCount} artifacts`} />
                {run.episodes.slice(0, 8).map((episode) => (
                  <View key={episode.episodeNumber} style={styles.artifactEpisodeRow}>
                    <Text style={styles.artifactEpisodeLabel}>EP {episode.episodeNumber}</Text>
                    <Text style={[styles.artifactStatus, { color: artifactStatusColor(episode.status) }]}>
                      {episode.status.toUpperCase()}
                    </Text>
                    <Text style={styles.artifactEpisodeMeta}>
                      {episode.artifactCount} artifacts
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </Section>
        ) : null}

        <Section
          icon={<Info size={18} color={TERMINAL.colors.muted} />}
          title="SYSTEM"
        >
          <InfoRow label="APPLICATION" value="STORYRPG GENERATOR" />
          <InfoRow label="VERSION" value={APP_VERSION_LABEL} />
          <InfoRow label="DEPLOYMENT" value="INTERNAL / LOCAL" />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
};

interface SectionProps {
  children: React.ReactNode;
  description?: string;
  icon: React.ReactNode;
  title: string;
}

function Section({ children, description, icon, title }: SectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {description ? <Text style={styles.sectionDesc}>{description.toUpperCase()}</Text> : null}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function ArtifactStatusIcon({ status }: { status: ArtifactStatus }) {
  const color = artifactStatusColor(status);
  if (status === 'clean') return <CheckCircle2 size={18} color={color} />;
  return <AlertCircle size={18} color={color} />;
}

function artifactStatusColor(status: ArtifactStatus): string {
  switch (status) {
    case 'clean':
      return TERMINAL.colors.success;
    case 'stale':
      return TERMINAL.colors.amber;
    case 'invalid':
    case 'blocked':
      return TERMINAL.colors.error;
    default:
      return TERMINAL.colors.muted;
  }
}

function rollupRuns(runs: ArtifactRunHealth[]): ArtifactStatus {
  if (runs.some((run) => run.status === 'blocked')) return 'blocked';
  if (runs.some((run) => run.status === 'invalid')) return 'invalid';
  if (runs.some((run) => run.status === 'stale')) return 'stale';
  return 'clean';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: TERMINAL.colors.bg },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerButton: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  headerButtonText: { color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  headerTitle: { color: 'white', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  content: { flex: 1 },
  contentPadding: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  sectionTitle: { color: 'white', fontSize: 13, fontWeight: '900', letterSpacing: 1.4 },
  sectionDesc: { color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 12 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 16,
  },
  externalLinkButton: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(245,158,11,0.12)',
  },
  externalLinkText: { color: TERMINAL.colors.amber, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,211,238,0.10)',
  },
  bodyText: { color: TERMINAL.colors.textBody, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  errorText: { color: TERMINAL.colors.error, fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 10 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 7 },
  infoLabel: { color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  infoValue: { color: TERMINAL.colors.textBody, fontSize: 11, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  artifactToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  artifactRun: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  artifactRunHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  artifactRunTitle: { color: 'white', fontSize: 12, fontWeight: '900', flex: 1 },
  artifactStatus: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  artifactEpisodeRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  artifactEpisodeLabel: { color: TERMINAL.colors.textBody, fontSize: 10, fontWeight: '900', width: 42 },
  artifactEpisodeMeta: { color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '800', marginLeft: 'auto' },
});
