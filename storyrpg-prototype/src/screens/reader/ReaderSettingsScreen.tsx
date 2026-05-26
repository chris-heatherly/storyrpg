import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ChevronRight,
  Code,
  ExternalLink,
  Info,
  RefreshCw,
  Settings,
  Trash2,
  Type,
} from 'lucide-react-native';
import type { AuthUser } from '../../services/authSession';
import type { StoryCatalogEntry } from '../../types';
import { useSettingsStore, type FontSize } from '../../stores/settingsStore';
import { TERMINAL } from '../../theme';
import { APP_VERSION_LABEL } from '../../config/version';
import { canShowInternalAppLinks, getGeneratorAppUrl } from '../../config/appLinks';
import { ConfirmDialog, SegmentedControl, Toggle } from '../../components/ui';

interface ReaderSettingsScreenProps {
  stories: StoryCatalogEntry[];
  onBack: () => void;
  authUser?: AuthUser | null;
  onSignOut?: () => void;
  onDeleteStory?: (storyId: string) => void;
  onRefreshStories?: () => void;
  isRefreshing?: boolean;
}

const fontSizeOptions: Array<{ key: FontSize; label: string }> = [
  { key: 'small', label: 'SMALL' },
  { key: 'medium', label: 'MEDIUM' },
  { key: 'large', label: 'LARGE' },
];

export const ReaderSettingsScreen: React.FC<ReaderSettingsScreenProps> = ({
  stories,
  onBack,
  authUser,
  onSignOut,
  onDeleteStory,
  onRefreshStories,
  isRefreshing = false,
}) => {
  const fontSize = useSettingsStore((state) => state.fontSize);
  const setFontSize = useSettingsStore((state) => state.setFontSize);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const setDeveloperMode = useSettingsStore((state) => state.setDeveloperMode);
  const preferVideo = useSettingsStore((state) => state.preferVideo);
  const setPreferVideo = useSettingsStore((state) => state.setPreferVideo);
  const fonts = useSettingsStore((state) => state.getFontSizes());
  const [storyPendingDelete, setStoryPendingDelete] = useState<StoryCatalogEntry | null>(null);

  const generatorUrl = getGeneratorAppUrl();
  const showGeneratorLink = canShowInternalAppLinks(developerMode, generatorUrl);
  const sortedStories = useMemo(
    () => [...stories].sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [stories],
  );

  const confirmDelete = () => {
    if (storyPendingDelete) {
      onDeleteStory?.(storyPendingDelete.id);
    }
    setStoryPendingDelete(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={onBack}>
          <ChevronRight size={20} color={TERMINAL.colors.muted} style={{ transform: [{ rotate: '180deg' }] }} />
          <Text style={styles.headerButtonText}>BACK</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>READER SETTINGS</Text>
        <View style={{ width: 68 }} />
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentPadding}
      >
        <Section
          icon={<Type size={18} color={TERMINAL.colors.primary} />}
          title="DISPLAY"
          description="Reader presentation preferences"
        >
          <SegmentedControl
            ariaLabel="Font size"
            options={fontSizeOptions.map((option) => ({ value: option.key, label: option.label }))}
            value={fontSize}
            onChange={setFontSize}
            testID="reader-settings-font-size"
          />
          <View style={styles.previewBox}>
            <Text style={[styles.previewText, { fontSize: fonts.base }]}>
              The quick brown fox jumps over the lazy dog.
            </Text>
          </View>
          <View style={styles.divider} />
          <Toggle
            value={preferVideo}
            onValueChange={() => setPreferVideo(!preferVideo)}
            label="PREFER VIDEO"
            helperText={preferVideo ? 'Show animated clips when available' : 'Show still images first'}
            testID="reader-settings-prefer-video"
          />
        </Section>

        <Section
          icon={<Code size={18} color={developerMode ? TERMINAL.colors.cyan : TERMINAL.colors.muted} />}
          title="DEVELOPER MODE"
          description="Internal reader diagnostics and cross-app links"
        >
          <Toggle
            value={developerMode}
            onValueChange={() => setDeveloperMode(!developerMode)}
            label="DEVELOPER MODE"
            helperText="Shows hidden reader diagnostics and internal links"
            testID="reader-settings-developer-mode"
          />
          {showGeneratorLink ? (
            <TouchableOpacity
              style={styles.externalLinkButton}
              onPress={() => { void Linking.openURL(generatorUrl!); }}
            >
              <ExternalLink size={16} color={TERMINAL.colors.amber} />
              <Text style={styles.externalLinkText}>OPEN GENERATOR</Text>
            </TouchableOpacity>
          ) : null}
        </Section>

        <Section
          icon={<RefreshCw size={18} color={TERMINAL.colors.cyan} />}
          title="STORY LIBRARY"
          description="Reader-visible chronicle content"
          right={onRefreshStories ? (
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={onRefreshStories}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color={TERMINAL.colors.cyan} />
              ) : (
                <RefreshCw size={12} color={TERMINAL.colors.cyan} />
              )}
              <Text style={styles.refreshText}>{isRefreshing ? 'REFRESHING' : 'REFRESH'}</Text>
            </TouchableOpacity>
          ) : null}
        >
          {sortedStories.length === 0 ? (
            <Text style={styles.emptyText}>NO CHRONICLES DETECTED</Text>
          ) : (
            <View style={styles.storyList}>
              {sortedStories.map((story) => (
                <View key={story.id} style={styles.storyRow}>
                  <View style={styles.storyInfo}>
                    <Text style={styles.storyTitle}>{(story.title || 'Untitled').toUpperCase()}</Text>
                    <Text style={styles.storyMeta}>
                      {(story.genre || 'unknown').toUpperCase()} • {story.episodeCount || story.episodes.length || 0} EPISODES
                    </Text>
                  </View>
                  {onDeleteStory && story.isBuiltIn !== true ? (
                    <TouchableOpacity
                      style={styles.iconButtonDanger}
                      onPress={() => setStoryPendingDelete(story)}
                      accessibilityLabel={`Delete ${story.title}`}
                    >
                      <Trash2 size={16} color={TERMINAL.colors.error} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </Section>

        <Section
          icon={<Info size={18} color={TERMINAL.colors.muted} />}
          title="SYSTEM"
        >
          {authUser ? (
            <InfoRow
              label="SIGNED IN"
              value={(authUser.displayName || authUser.email || authUser.id).toUpperCase()}
            />
          ) : null}
          <InfoRow label="APPLICATION" value="STORYRPG READER" />
          <InfoRow label="VERSION" value={APP_VERSION_LABEL} />
          <InfoRow label="DEPLOYMENT" value="READER + CONTENT" />
          {onSignOut ? (
            <TouchableOpacity style={styles.signOutButton} onPress={onSignOut}>
              <Text style={styles.signOutButtonText}>SIGN OUT</Text>
            </TouchableOpacity>
          ) : null}
        </Section>
      </ScrollView>

      <ConfirmDialog
        visible={storyPendingDelete !== null}
        title="Delete chronicle?"
        message={storyPendingDelete
          ? `Are you sure you want to delete "${storyPendingDelete.title || 'Untitled'}"?`
          : 'Are you sure you want to delete this chronicle?'}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setStoryPendingDelete(null)}
        testID="reader-delete-story-dialog"
      />
    </SafeAreaView>
  );
};

interface SectionProps {
  children: React.ReactNode;
  description?: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  title: string;
}

function Section({ children, description, icon, right, title }: SectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionHeaderRight}>{right}</View>
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
  sectionHeaderRight: { marginLeft: 'auto' },
  sectionTitle: { color: 'white', fontSize: 13, fontWeight: '900', letterSpacing: 1.4 },
  sectionDesc: { color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 12 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 16,
  },
  previewBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.24)',
    borderRadius: 6,
  },
  previewText: { color: TERMINAL.colors.textBody, lineHeight: 22 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 14 },
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
  refreshButton: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  refreshText: { color: TERMINAL.colors.cyan, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  emptyText: { color: TERMINAL.colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  storyList: { gap: 10 },
  storyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  storyInfo: { flex: 1, minWidth: 0 },
  storyTitle: { color: TERMINAL.colors.textBody, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  storyMeta: { color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '700', marginTop: 4 },
  iconButtonDanger: { padding: 8, borderRadius: 6, backgroundColor: 'rgba(239,68,68,0.1)' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 7 },
  infoLabel: { color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  infoValue: { color: TERMINAL.colors.textBody, fontSize: 11, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  signOutButton: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  signOutButtonText: {
    color: TERMINAL.colors.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
});
