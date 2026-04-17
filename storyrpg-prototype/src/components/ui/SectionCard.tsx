import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { TERMINAL, RADIUS, withAlpha } from '../../theme';

interface SectionCardProps {
  title?: string;
  eyebrow?: string;
  description?: string;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  eyebrow,
  description,
  trailing,
  children,
  style,
  contentStyle,
  testID,
}) => {
  const showHeader = !!title || !!eyebrow || !!trailing;
  return (
    <View style={[styles.card, style]} testID={testID}>
      {showHeader && (
        <View style={styles.header}>
          <View style={styles.headerText}>
            {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
            {!!title && <Text style={styles.title}>{title}</Text>}
            {!!description && <Text style={styles.description}>{description}</Text>}
          </View>
          {!!trailing && <View style={styles.trailing}>{trailing}</View>}
        </View>
      )}
      {!!children && <View style={[styles.content, contentStyle]}>{children}</View>}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: withAlpha('#ffffff', 0.1),
    backgroundColor: withAlpha('#ffffff', 0.03),
    borderRadius: RADIUS.button,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  trailing: {
    alignItems: 'flex-end',
  },
  eyebrow: {
    color: TERMINAL.colors.primaryLight,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    color: TERMINAL.colors.textStrong,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  description: {
    color: TERMINAL.colors.mutedLight,
    fontSize: 12,
    lineHeight: 17,
  },
  content: {
    gap: 8,
  },
});
