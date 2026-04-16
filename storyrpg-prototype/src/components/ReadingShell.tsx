import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  Animated,
  Platform,
} from 'react-native';
import { sharedStyles, TERMINAL } from '../theme';

interface ReadingShellProps {
  /** Background image URL. Ignored if videoUrl is preferred and available (web only). */
  imageUrl?: string | null;
  /** Optional video URL — shown on web when preferVideo is true and allowVideoPlayback is true. */
  videoUrl?: string | null;
  preferVideo?: boolean;
  allowVideoPlayback?: boolean;
  /** Animated value for the outer container opacity (e.g. crossfade transitions) */
  fadeAnim?: Animated.Value;
  /** Animated value for container slide (translateX). Used alongside or instead of shakeAnim. */
  slideAnim?: Animated.Value;
  /** Animated value for a short horizontal shake (translateX). Takes precedence over slideAnim. */
  shakeAnim?: Animated.Value;
  /** Animated value for image fade-in */
  imageOpacity?: Animated.Value;
  /**
   * Chrome rendered above the gradient overlay: progress bar, encounter clocks,
   * storylet tone dot, etc. Only one top-chrome element should be rendered at a time.
   */
  chromeTop?: React.ReactNode;
  /** Chrome pinned to the bottom of the reader: toasts, butterfly banners, etc. */
  chromeBottom?: React.ReactNode;
  /** Full-viewport vignette effects (stat check flash, pre-choice glow, outcome tint). */
  vignette?: React.ReactNode;
  /** Additional absolute-positioned overlays rendered above vignette. */
  overlays?: React.ReactNode;
  /**
   * Extra content rendered above the gradient but behind the scroll area —
   * e.g. dev-mode FileText buttons attached to the image.
   */
  imageExtras?: React.ReactNode;
  /** Show the STORYRPG watermark when no image/video is available. */
  placeholderWatermark?: boolean;
  /** Content rendered inside the scrollable area */
  children: React.ReactNode;
  /** Ref forwarded to the inner ScrollView */
  scrollViewRef?: React.RefObject<ScrollView>;
  onImageLoad?: () => void;
  onImageError?: (event: any) => void;
}

export const ReadingShell: React.FC<ReadingShellProps> = ({
  imageUrl,
  videoUrl,
  preferVideo,
  allowVideoPlayback,
  fadeAnim,
  slideAnim,
  shakeAnim,
  imageOpacity,
  chromeTop,
  chromeBottom,
  vignette,
  overlays,
  imageExtras,
  placeholderWatermark,
  children,
  scrollViewRef,
  onImageLoad,
  onImageError,
}) => {
  // shakeAnim takes precedence over slideAnim — slideAnim is for scene transitions,
  // shakeAnim is for in-mode shake feedback. Only one should be set per container.
  const translate = shakeAnim || slideAnim;
  const containerStyle = [
    styles.container,
    fadeAnim ? { opacity: fadeAnim } : undefined,
    translate ? { transform: [{ translateX: translate }] } : undefined,
  ];

  // Force opacity 1 on web to avoid RN-Web's CSS fade getting stuck when the
  // image loads while a parent is transitioning.
  const imageStyle = [
    styles.fullBleedImage,
    Platform.OS === 'web' && { opacity: 1 },
  ];

  const showVideo = Boolean(
    videoUrl && Platform.OS === 'web' && preferVideo && allowVideoPlayback
  );

  return (
    <Animated.View style={containerStyle}>
      {vignette}

      <Animated.View
        style={[styles.imageContainer, imageOpacity ? { opacity: imageOpacity } : undefined]}
      >
        {showVideo ? (
          // @ts-ignore react-native-web accepts raw video elements
          <video
            src={videoUrl || undefined}
            autoPlay
            loop
            muted
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              position: 'absolute' as any,
              top: 0,
              left: 0,
            }}
          />
        ) : imageUrl ? (
          <Image
            source={{ uri: imageUrl, headers: { Accept: 'image/*' } }}
            style={imageStyle as any}
            resizeMode="cover"
            crossOrigin="anonymous"
            onLoad={onImageLoad}
            onError={onImageError}
          />
        ) : (
          <View style={styles.placeholderBackground}>
            {placeholderWatermark && (
              <View style={styles.watermarkWrap}>
                <Text style={styles.watermarkText}>STORYRPG</Text>
              </View>
            )}
          </View>
        )}
        <View style={sharedStyles.gradientOverlay} />
        {imageExtras}
      </Animated.View>

      {chromeTop}

      <View style={sharedStyles.uiOverlay}>
        <ScrollView
          ref={scrollViewRef as any}
          style={sharedStyles.contentScrollView}
          contentContainerStyle={sharedStyles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {chromeBottom}
      </View>

      {overlays}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  imageContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  fullBleedImage: {
    width: '100%',
    height: '100%',
  },
  placeholderBackground: {
    flex: 1,
    backgroundColor: TERMINAL.colors.bgHighlight,
  },
  watermarkWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watermarkText: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 24,
    fontWeight: '900',
  },
});
