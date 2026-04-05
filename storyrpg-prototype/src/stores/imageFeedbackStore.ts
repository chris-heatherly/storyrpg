/**
 * Image Feedback Store
 *
 * Tracks user feedback on generated images (thumbs up/down, notes).
 * This data can be used to:
 * 1. Regenerate rejected images with feedback-informed prompts
 * 2. Learn preferences over time to improve future generations
 * 3. Provide analytics on image generation quality
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const FEEDBACK_STORAGE_KEY = '@storyrpg_image_feedback';

export type FeedbackRating = 'positive' | 'negative';

// Basic feedback categories
export type BasicFeedbackReason = 
  | 'wrong_style'
  | 'wrong_character'
  | 'wrong_mood'
  | 'wrong_setting'
  | 'poor_quality'
  | 'doesnt_match_text'
  | 'other';

// Visual storytelling feedback categories (aligned with QA system)
export type VisualStorytellingReason =
  // Camera & Composition
  | 'wrong_shot_type'      // Shot too close/far for the beat
  | 'wrong_camera_angle'   // Angle doesn't match mood/power dynamic
  | 'flat_staging'         // Characters lined up perpendicular to camera
  | 'poor_eye_flow'        // Composition doesn't guide the eye
  // Silhouette & Pose
  | 'silhouette_unclear'   // Can't identify action/characters in black fill
  | 'pose_static'          // Arms at sides, no line of action
  | 'merging_issues'       // Characters/limbs/weapons overlap in silhouette
  // Expression & Body Language
  | 'expression_wrong'     // Face doesn't match intended emotion
  | 'body_language_off'    // Posture/gesture contradicts intent
  // Impact & Action
  | 'impact_not_dominant'  // Focal action isn't the clearest/largest
  | 'foreshortening_needed' // Action toward camera should pop more
  // Lighting & Color
  | 'lighting_mismatch'    // Light direction/quality wrong for mood
  | 'color_palette_wrong'  // Colors don't match emotional arc
  // Spatial
  | 'perspective_wrong'    // Vanishing points inconsistent or wrong type
  | 'depth_lacking'        // Scene feels flat, no foreground/background
  // Texture
  | 'texture_obscures_silhouette' // Too much texture hides character edges
  | 'texture_mood_mismatch';      // Surface treatment wrong for scene mood

export type FeedbackReason = BasicFeedbackReason | VisualStorytellingReason;

// Category groupings for UI display
export const FEEDBACK_CATEGORIES = {
  basic: {
    label: 'BASIC',
    reasons: ['wrong_style', 'wrong_character', 'wrong_mood', 'wrong_setting', 'poor_quality', 'doesnt_match_text', 'other'] as FeedbackReason[]
  },
  camera: {
    label: 'CAMERA & COMPOSITION',
    reasons: ['wrong_shot_type', 'wrong_camera_angle', 'flat_staging', 'poor_eye_flow'] as FeedbackReason[]
  },
  silhouette: {
    label: 'SILHOUETTE & POSE',
    reasons: ['silhouette_unclear', 'pose_static', 'merging_issues'] as FeedbackReason[]
  },
  expression: {
    label: 'EXPRESSION & BODY',
    reasons: ['expression_wrong', 'body_language_off'] as FeedbackReason[]
  },
  impact: {
    label: 'IMPACT & ACTION',
    reasons: ['impact_not_dominant', 'foreshortening_needed'] as FeedbackReason[]
  },
  lighting: {
    label: 'LIGHTING & COLOR',
    reasons: ['lighting_mismatch', 'color_palette_wrong'] as FeedbackReason[]
  },
  spatial: {
    label: 'SPATIAL & DEPTH',
    reasons: ['perspective_wrong', 'depth_lacking'] as FeedbackReason[]
  },
  texture: {
    label: 'TEXTURE',
    reasons: ['texture_obscures_silhouette', 'texture_mood_mismatch'] as FeedbackReason[]
  }
} as const;

// Human-readable labels for all reasons
export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  // Basic
  wrong_style: 'Wrong art style',
  wrong_character: 'Wrong character',
  wrong_mood: 'Wrong mood',
  wrong_setting: 'Wrong setting',
  poor_quality: 'Poor quality',
  doesnt_match_text: "Doesn't match text",
  other: 'Other',
  // Camera
  wrong_shot_type: 'Shot too close/far',
  wrong_camera_angle: 'Wrong camera angle',
  flat_staging: 'Flat staging',
  poor_eye_flow: 'Poor composition flow',
  // Silhouette
  silhouette_unclear: 'Unclear silhouette',
  pose_static: 'Static pose',
  merging_issues: 'Elements merging',
  // Expression
  expression_wrong: 'Wrong expression',
  body_language_off: 'Body language off',
  // Impact
  impact_not_dominant: 'Impact not clear',
  foreshortening_needed: 'Needs foreshortening',
  // Lighting
  lighting_mismatch: 'Wrong lighting',
  color_palette_wrong: 'Wrong colors',
  // Spatial
  perspective_wrong: 'Wrong perspective',
  depth_lacking: 'Scene feels flat',
  // Texture
  texture_obscures_silhouette: 'Texture hides silhouette',
  texture_mood_mismatch: 'Texture mood mismatch'
};

export interface ImageFeedback {
  id: string;
  storyId: string;
  episodeId?: string;
  sceneId?: string;
  beatId?: string;
  imageUrl: string;
  originalPrompt?: string;
  rating: FeedbackRating;
  reasons?: FeedbackReason[];
  notes?: string;
  timestamp: string;
  regenerated?: boolean;
  regeneratedImageUrl?: string;
}

export interface FeedbackSummary {
  totalFeedback: number;
  positiveCount: number;
  negativeCount: number;
  topIssues: { reason: FeedbackReason; count: number }[];
  recentFeedback: ImageFeedback[];
}

interface ImageFeedbackStore {
  feedback: ImageFeedback[];
  isLoaded: boolean;

  // Actions
  loadFeedback: () => Promise<void>;
  addFeedback: (feedback: Omit<ImageFeedback, 'id' | 'timestamp'>) => Promise<ImageFeedback>;
  updateFeedback: (id: string, updates: Partial<ImageFeedback>) => Promise<void>;
  removeFeedback: (id: string) => Promise<void>;
  clearAllFeedback: () => Promise<void>;
  
  // Queries
  getFeedbackForImage: (imageUrl: string) => ImageFeedback | undefined;
  getFeedbackForStory: (storyId: string) => ImageFeedback[];
  getFeedbackSummary: () => FeedbackSummary;
  getPreferenceSummary: () => string; // Human-readable summary for prompting
}

const getProxyHost = () => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `http://${window.location.hostname || 'localhost'}:3001`;
  }
  return 'http://localhost:3001';
};

export const useImageFeedbackStore = create<ImageFeedbackStore>((set, get) => ({
  feedback: [],
  isLoaded: false,

  loadFeedback: async () => {
    try {
      const stored = await AsyncStorage.getItem(FEEDBACK_STORAGE_KEY);
      let feedback: ImageFeedback[] = [];
      
      if (stored) {
        try {
          feedback = JSON.parse(stored);
        } catch (e) {
          console.warn('[ImageFeedbackStore] Failed to parse stored feedback');
        }
      }

      // Also try to sync with server (for persistence across devices/sessions)
      if (Platform.OS === 'web') {
        try {
          const response = await fetch(`${getProxyHost()}/image-feedback`);
          if (response.ok) {
            const serverFeedback = await response.json();
            // Merge: prefer newer entries
            const feedbackMap = new Map<string, ImageFeedback>();
            feedback.forEach(f => feedbackMap.set(f.id, f));
            serverFeedback.forEach((f: ImageFeedback) => {
              const existing = feedbackMap.get(f.id);
              if (!existing || new Date(f.timestamp) > new Date(existing.timestamp)) {
                feedbackMap.set(f.id, f);
              }
            });
            feedback = Array.from(feedbackMap.values());
          }
        } catch (e) {
          console.warn('[ImageFeedbackStore] Failed to fetch server feedback');
        }
      }

      // Sort by timestamp (newest first)
      feedback.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      set({ feedback, isLoaded: true });
      
      // Persist merged state
      await AsyncStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(feedback));
    } catch (e) {
      console.error('[ImageFeedbackStore] Failed to load feedback:', e);
      set({ isLoaded: true });
    }
  },

  addFeedback: async (feedbackData) => {
    const newFeedback: ImageFeedback = {
      ...feedbackData,
      id: `fb-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      timestamp: new Date().toISOString(),
    };

    set(state => ({
      feedback: [newFeedback, ...state.feedback],
    }));

    // Persist locally
    const { feedback } = get();
    await AsyncStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(feedback));

    // Sync to server
    if (Platform.OS === 'web') {
      try {
        await fetch(`${getProxyHost()}/image-feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newFeedback),
        });
      } catch (e) {
        console.warn('[ImageFeedbackStore] Failed to sync feedback to server');
      }
    }

    return newFeedback;
  },

  updateFeedback: async (id, updates) => {
    set(state => ({
      feedback: state.feedback.map(f =>
        f.id === id ? { ...f, ...updates } : f
      ),
    }));

    // Persist locally
    const { feedback } = get();
    await AsyncStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(feedback));

    // Sync to server
    if (Platform.OS === 'web') {
      try {
        await fetch(`${getProxyHost()}/image-feedback/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
      } catch (e) {
        console.warn('[ImageFeedbackStore] Failed to sync feedback update to server');
      }
    }
  },

  removeFeedback: async (id) => {
    set(state => ({
      feedback: state.feedback.filter(f => f.id !== id),
    }));

    // Persist locally
    const { feedback } = get();
    await AsyncStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(feedback));

    // Sync to server
    if (Platform.OS === 'web') {
      try {
        await fetch(`${getProxyHost()}/image-feedback/${id}`, {
          method: 'DELETE',
        });
      } catch (e) {
        console.warn('[ImageFeedbackStore] Failed to delete feedback from server');
      }
    }
  },

  clearAllFeedback: async () => {
    set({ feedback: [] });
    await AsyncStorage.removeItem(FEEDBACK_STORAGE_KEY);
  },

  getFeedbackForImage: (imageUrl) => {
    return get().feedback.find(f => f.imageUrl === imageUrl);
  },

  getFeedbackForStory: (storyId) => {
    return get().feedback.filter(f => f.storyId === storyId);
  },

  getFeedbackSummary: () => {
    const { feedback } = get();
    const positiveCount = feedback.filter(f => f.rating === 'positive').length;
    const negativeCount = feedback.filter(f => f.rating === 'negative').length;

    // Count reasons
    const reasonCounts = new Map<FeedbackReason, number>();
    feedback.forEach(f => {
      f.reasons?.forEach(reason => {
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      });
    });

    const topIssues = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalFeedback: feedback.length,
      positiveCount,
      negativeCount,
      topIssues,
      recentFeedback: feedback.slice(0, 10),
    };
  },

  getPreferenceSummary: () => {
    const summary = get().getFeedbackSummary();
    
    if (summary.totalFeedback === 0) {
      return '';
    }

    const parts: string[] = [];
    
    // Overall sentiment
    const approvalRate = summary.positiveCount / summary.totalFeedback;
    if (approvalRate < 0.5) {
      parts.push(`User has rejected ${summary.negativeCount} of ${summary.totalFeedback} images.`);
    }

    // Common issues - use the labels from FEEDBACK_REASON_LABELS
    if (summary.topIssues.length > 0) {
      const topIssueTexts = summary.topIssues
        .slice(0, 3)
        .map(i => FEEDBACK_REASON_LABELS[i.reason] || i.reason);
      
      if (topIssueTexts.length > 0) {
        parts.push(`Common issues: ${topIssueTexts.join(', ')}.`);
      }
    }

    // Recent negative feedback notes
    const recentNegative = summary.recentFeedback
      .filter(f => f.rating === 'negative' && f.notes)
      .slice(0, 3);
    
    if (recentNegative.length > 0) {
      parts.push(`Recent user feedback: "${recentNegative.map(f => f.notes).join('", "')}".`);
    }

    return parts.join(' ');
  },
}));
