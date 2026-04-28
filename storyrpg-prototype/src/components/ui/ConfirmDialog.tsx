import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { TERMINAL, RADIUS, withAlpha } from '../../theme';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
  testID,
}) => {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop} testID={testID}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.dialog} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          {!!message && <Text style={styles.message}>{message}</Text>}
          <View style={styles.buttons}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.button, styles.cancelButton, pressed && styles.buttonPressed]}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
            >
              <Text style={styles.cancelText}>{cancelLabel.toUpperCase()}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.button,
                destructive ? styles.destructiveButton : styles.confirmButton,
                pressed && styles.buttonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
            >
              <Text style={destructive ? styles.destructiveText : styles.confirmText}>
                {confirmLabel.toUpperCase()}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: TERMINAL.colors.bgHighlight,
    borderWidth: 1,
    borderColor: withAlpha('#ffffff', 0.15),
    borderRadius: RADIUS.button,
    padding: 24,
    gap: 12,
    ...Platform.select({
      web: {
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)' as any,
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
      },
    }),
  },
  title: {
    color: TERMINAL.colors.textStrong,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  message: {
    color: TERMINAL.colors.textBody,
    fontSize: 13,
    lineHeight: 19,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: RADIUS.small,
    borderWidth: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  cancelButton: {
    borderColor: withAlpha('#ffffff', 0.2),
    backgroundColor: withAlpha('#ffffff', 0.04),
  },
  cancelText: {
    color: TERMINAL.colors.textLight,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  confirmButton: {
    borderColor: withAlpha(TERMINAL.colors.primary, 0.5),
    backgroundColor: withAlpha(TERMINAL.colors.primary, 0.25),
  },
  confirmText: {
    color: TERMINAL.colors.primaryLight,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  destructiveButton: {
    borderColor: withAlpha(TERMINAL.colors.error, 0.55),
    backgroundColor: withAlpha(TERMINAL.colors.error, 0.25),
  },
  destructiveText: {
    color: TERMINAL.colors.error,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
});
