import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Platform,
  Image,
  Dimensions,
} from 'react-native';
import {
  Play,
  Sword,
  BookOpen,
  Settings,
  ChevronRight,
  LogOut,
  RotateCcw,
  Sparkles,
} from 'lucide-react-native';
import { useGameActions, useGamePlayerState, useGameStoryState } from '../stores/gameStore';
import { StoryCatalogEntry } from '../types';
import { TERMINAL } from '../theme';
import { useSettingsStore } from '../stores/settingsStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

interface HomeScreenProps {
  stories: StoryCatalogEntry[];
  onStartStory: (storyId: string) => void;
  onContinueStory: () => void;
  onOpenSettings: () => void;
  onOpenGenerator?: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  stories,
  onStartStory,
  onContinueStory,
  onOpenSettings,
  onOpenGenerator,
}) => {
  const { player } = useGamePlayerState();
  const { currentStory } = useGameStoryState();
  const { resetGame } = useGameActions();
  const fonts = useSettingsStore((state) => state.getFontSizes());
  const [isWiping, setIsWiping] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // Placeholder image for when cover images fail to load
  const PLACEHOLDER_IMAGE = 'https://placehold.co/400x600/1a1a2e/94a3b8?text=Story';

  const hasSavedGame = currentStory !== null && player.currentEpisodeId !== null;

  const handleWipeCache = async () => {
    if (confirm('WIPE ALL CACHE? This will clear all generated stories and save data from browser storage.')) {
      setIsWiping(true);
      try {
        await AsyncStorage.clear();
        alert('Cache wiped. Restarting...');
        window.location.reload();
      } catch (e) {
        console.error(e);
      } finally {
        setIsWiping(false);
      }
    }
  };

  const handleStorySelect = (story: StoryCatalogEntry) => {
    // Stories have established protagonists — skip character creation, start directly
    onStartStory(story.id);
  };

  const handleNewGame = () => {
    resetGame();
  };

  // Main Home Screen
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <View style={styles.logoIcon}>
            <Sword size={20} color="white" />
          </View>
          <Text style={styles.logoText}>STORY<Text style={{ color: TERMINAL.colors.primary }}>RPG</Text></Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {onOpenGenerator && (
            <TouchableOpacity 
              style={[styles.headerIconButton, { flexDirection: 'row', gap: 6, backgroundColor: 'rgba(59, 130, 246, 0.15)', paddingHorizontal: 12, borderRadius: 8 }]} 
              onPress={onOpenGenerator}
            >
              <Sparkles size={16} color={TERMINAL.colors.primary} />
              <Text style={{ color: TERMINAL.colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>GENERATE</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.headerIconButton} onPress={onOpenSettings}>
            <Settings size={20} color={TERMINAL.colors.muted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentPadding}
      >
        <Text style={styles.systemStatus}>
          {stories.length} CHRONICLES AVAILABLE
        </Text>

        {/* Active Session */}
        {hasSavedGame && (
          <View style={styles.activeSession}>
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionLabel}>ACTIVE SESSION</Text>
              <Text style={styles.sessionTitle}>{(currentStory?.title || 'Untitled').toUpperCase()}</Text>
              <Text style={styles.sessionUser}>USER: {player.characterName}</Text>
            </View>
            <View style={styles.sessionActions}>
              <TouchableOpacity style={styles.resumeButton} onPress={onContinueStory}>
                <Play size={14} color="white" fill="white" />
                <Text style={styles.resumeButtonText}>RESUME</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.terminateButton} onPress={handleNewGame}>
                <LogOut size={14} color={TERMINAL.colors.muted} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Stories Grid */}
        <View style={styles.storiesGrid}>
          {stories.map((story, index) => (
            <TouchableOpacity
              key={story.id}
              style={styles.storyCard}
              onPress={() => handleStorySelect(story)}
              activeOpacity={0.8}
            >
              <Image
                source={{ 
                  uri: failedImages.has(story.id) 
                    ? PLACEHOLDER_IMAGE
                    : (story.coverImage && !story.coverImage.endsWith('.prompt.txt') && !story.coverImage.endsWith('.txt')) 
                      ? story.coverImage 
                      : PLACEHOLDER_IMAGE,
                  headers: { 'Accept': 'image/*' }
                }}
                style={styles.storyImage}
                resizeMode="cover"
                crossOrigin="anonymous"
                onLoad={() => console.log(`[HomeScreen] Story image loaded: ${story.coverImage}`)}
                onError={() => {
                  console.warn(`[HomeScreen] Story image failed, using placeholder: ${story.coverImage}`);
                  setFailedImages(prev => new Set(prev).add(story.id));
                }}
              />
              <View style={styles.storyOverlay}>
                <View style={styles.storyBadge}>
                  <Text style={styles.storyBadgeText}>{(story.genre || 'unknown').toUpperCase()}</Text>
                </View>
                <Text style={styles.storyCardTitle}>{(story.title || 'Untitled').toUpperCase()}</Text>
                <Text style={styles.storyCardMeta}>{story.episodeCount} EPISODES</Text>
                <View style={styles.playButtonMini}>
                  <Play size={12} color="white" fill="white" />
                  <Text style={styles.playButtonMiniText}>START</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}

          {/* Locked Slots */}
          <View style={styles.lockedCard}>
            <BookOpen size={24} color={TERMINAL.colors.bgHighlight} />
            <Text style={styles.lockedText}>LOCKED CHRONICLE</Text>
            <Text style={styles.lockedSubtext}>EXPANSION PENDING</Text>
          </View>
        </View>

        <Text style={styles.footerText}>
          STORYRPG MOBILE • ALPHA VER 1.0.0{'\n'}
          © 2024 STORYRPG SYSTEMS
        </Text>

        <TouchableOpacity 
          style={styles.wipeButton} 
          onPress={handleWipeCache}
          disabled={isWiping}
        >
          <RotateCcw size={12} color={TERMINAL.colors.error} />
          <Text style={styles.wipeButtonText}>
            {isWiping ? 'WIPING...' : 'WIPE STORAGE CACHE'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TERMINAL.colors.bg,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: TERMINAL.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 20,
    fontWeight: '900',
    color: 'white',
    letterSpacing: -0.5,
  },
  headerIconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
  },
  headerButtonText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  content: {
    flex: 1,
  },
  contentPadding: {
    padding: 20,
    paddingBottom: 40,
  },
  systemStatus: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 2,
    marginBottom: 20,
    textAlign: 'center',
  },
  activeSession: {
    backgroundColor: '#1e2229',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  sessionInfo: {
    flex: 1,
  },
  sessionLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 2,
    marginBottom: 4,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: 'white',
    marginBottom: 4,
  },
  sessionUser: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
    fontWeight: '700',
  },
  sessionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resumeButton: {
    backgroundColor: TERMINAL.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
  },
  resumeButtonText: {
    fontSize: 10,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  terminateButton: {
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
  },
  storiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  storyCard: {
    width: (width - 56) / 2,
    height: 240,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#1e2229',
  },
  storyImage: {
    width: '100%',
    height: '100%',
    opacity: 0.6,
  },
  storyOverlay: {
    ...StyleSheet.absoluteFillObject,
    padding: 16,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 17, 21, 0.4)',
  },
  storyBadge: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: TERMINAL.colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  storyBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  storyCardTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: 'white',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  storyCardMeta: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '700',
    marginBottom: 12,
  },
  playButtonMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playButtonMiniText: {
    fontSize: 10,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  lockedCard: {
    width: (width - 56) / 2,
    height: 240,
    borderRadius: 24,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  lockedText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.bgHighlight,
    letterSpacing: 1,
    marginTop: 12,
    textAlign: 'center',
  },
  lockedSubtext: {
    fontSize: 8,
    color: TERMINAL.colors.bgHighlight,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  creationHeader: {
    alignItems: 'center',
    marginBottom: 40,
  },
  creationIcon: {
    width: 64,
    height: 64,
    borderRadius: 24,
    backgroundColor: TERMINAL.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: TERMINAL.colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  creationTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
    marginBottom: 8,
  },
  creationSubtitle: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
    fontWeight: '700',
    letterSpacing: 1,
  },
  creationContent: {
    padding: 30,
  },
  inputSection: {
    marginBottom: 32,
  },
  label: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 2,
    marginBottom: 12,
  },
  inputWrapper: {
    borderBottomWidth: 2,
    borderBottomColor: TERMINAL.colors.bgHighlight,
    paddingBottom: 8,
  },
  input: {
    fontSize: 24,
    fontWeight: '900',
    color: 'white',
    padding: 0,
  },
  pronounOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  pronounOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    alignItems: 'center',
  },
  pronounOptionSelected: {
    borderColor: TERMINAL.colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  pronounText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  pronounTextSelected: {
    color: TERMINAL.colors.primary,
  },
  executeButton: {
    backgroundColor: TERMINAL.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 16,
    gap: 12,
    marginTop: 20,
  },
  executeButtonDisabled: {
    backgroundColor: '#1e293b',
    opacity: 0.5,
  },
  executeButtonText: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 2,
  },
  footerText: {
    fontSize: 9,
    color: TERMINAL.colors.muted,
    textAlign: 'center',
    marginTop: 40,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
  wipeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    marginTop: 10,
    marginBottom: 40,
    gap: 6,
  },
  wipeButtonText: {
    color: TERMINAL.colors.error,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
