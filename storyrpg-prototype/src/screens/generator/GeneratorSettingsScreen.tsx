import React from 'react';
import {
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronRight, Code, ExternalLink, Info, Settings } from 'lucide-react-native';
import { useGeneratorSettingsStore } from '../../stores/generatorSettingsStore';
import { TERMINAL } from '../../theme';
import { APP_VERSION_LABEL } from '../../config/version';
import { canShowInternalAppLinks, getReaderAppUrl } from '../../config/appLinks';
import { Toggle } from '../../components/ui';

interface GeneratorSettingsScreenProps {
  onBack: () => void;
}

export const GeneratorSettingsScreen: React.FC<GeneratorSettingsScreenProps> = ({ onBack }) => {
  const developerMode = useGeneratorSettingsStore((state) => state.developerMode);
  const setDeveloperMode = useGeneratorSettingsStore((state) => state.setDeveloperMode);
  const readerUrl = getReaderAppUrl();
  const showReaderLink = canShowInternalAppLinks(developerMode, readerUrl);

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
  bodyText: { color: TERMINAL.colors.textBody, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 7 },
  infoLabel: { color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  infoValue: { color: TERMINAL.colors.textBody, fontSize: 11, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
});
