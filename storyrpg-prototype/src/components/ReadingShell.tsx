import React from 'react';
import {
  View,
  Image,
  StyleSheet,
  ScrollView,
  Animated,
  Platform,
} from 'react-native';
import { sharedStyles, SPACING } from '../theme';

interface ReadingShellProps {
  imageUrl?: string | null;
  /** Animated value for the outer container opacity (e.g. crossfade transitions) */
  fadeAnim?: Animated.Value;
  /** Animated value for container slide/shake (translateX) */
  slideAnim?: Animated.Value;
  /** Animated value for image fade-in */
  imageOpacity?: Animated.Value;
  /** Content rendered above the gradient (e.g. encounter clocks) */
  header?: React.ReactNode;
  /** Content rendered inside the scrollable area */
  children: React.ReactNode;
  /** Ref forwarded to the inner ScrollView */
  scrollViewRef?: React.RefObject<ScrollView>;
  /** Overlay elements rendered above everything (e.g. StatCheckOverlay) */
  overlays?: React.ReactNode;
}

export const ReadingShell: React.FC<ReadingShellProps> = ({
  imageUrl,
  fadeAnim,
  slideAnim,
  imageOpacity,
  header,
  children,
  scrollViewRef,
  overlays,
}) => {
  const containerStyle = [
    styles.container,
    fadeAnim ? { opacity: fadeAnim } : undefined,
    slideAnim ? { transform: [{ translateX: slideAnim }] } : undefined,
  ];

  const imageStyle = [
    styles.fullBleedImage,
  ];

  return (
    <Animated.View style={containerStyle}>
      {overlays}
      <Animated.View style={[styles.imageContainer, imageOpacity ? { opacity: imageOpacity } : undefined]}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl, headers: { 'Accept': 'image/*' } }}
            style={imageStyle}
            resizeMode="cover"
            crossOrigin="anonymous"
          />
        ) : (
          <View style={styles.placeholderBackground} />
        )}
        <View style={sharedStyles.gradientOverlay} />
      </Animated.View>

      {header}

      <View style={sharedStyles.uiOverlay}>
        <ScrollView
          ref={scrollViewRef as any}
          style={sharedStyles.contentScrollView}
          contentContainerStyle={sharedStyles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
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
    backgroundColor: '#0f1115',
  },
});
