import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { TERMINAL } from '../theme/terminal';

export interface DropdownOption {
  value: string;
  label: string;
  subtitle?: string;
  description?: string;
  price?: string;
}

interface Props {
  options: DropdownOption[];
  value: string;
  onSelect: (value: string) => void;
  placeholder?: string;
}

export function ModelDropdown({ options, value, onSelect, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);

  const selected = options.find(o => o.value === value);
  const displayLabel = selected?.label || placeholder || 'Select…';

  const handleSelect = useCallback((optValue: string) => {
    onSelect(optValue);
    setOpen(false);
  }, [onSelect]);

  const renderItem = useCallback(({ item }: { item: DropdownOption }) => {
    const active = item.value === value;
    return (
      <TouchableOpacity
        style={[styles.option, active && styles.optionActive]}
        onPress={() => handleSelect(item.value)}
        activeOpacity={0.7}
      >
        <View style={styles.optionContent}>
          <Text style={[styles.optionLabel, active && styles.optionLabelActive]} numberOfLines={1}>
            {item.label}
            {item.price ? <Text style={styles.optionPrice}> {item.price}</Text> : null}
          </Text>
          {item.description ? (
            <Text style={styles.optionDescription} numberOfLines={1}>{item.description}</Text>
          ) : (
            <Text style={[styles.optionSubtitle, active && styles.optionSubtitleActive]} numberOfLines={1}>
              {item.subtitle || item.value}
            </Text>
          )}
        </View>
        {active && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>
    );
  }, [value, handleSelect]);

  const keyExtractor = useCallback((item: DropdownOption) => item.value, []);

  return (
    <View ref={anchorRef}>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <View style={styles.triggerContent}>
          <Text style={styles.triggerLabel} numberOfLines={1}>{displayLabel}</Text>
          <Text style={styles.triggerValue} numberOfLines={1}>
            {selected?.value || ''}
          </Text>
        </View>
        <ChevronDown size={14} color={TERMINAL.colors.muted} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <FlatList
              data={options}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              style={styles.list}
              showsVerticalScrollIndicator={false}
              initialNumToRender={20}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16191f',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  triggerContent: {
    flex: 1,
    marginRight: 8,
  },
  triggerLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: 'white',
    letterSpacing: 0.3,
  },
  triggerValue: {
    fontSize: 9,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: TERMINAL.colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    maxHeight: '60%',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  list: {
    paddingHorizontal: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginVertical: 1,
  },
  optionActive: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  optionContent: {
    flex: 1,
    marginRight: 8,
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: TERMINAL.colors.textBody,
    letterSpacing: 0.3,
  },
  optionLabelActive: {
    color: 'white',
  },
  optionPrice: {
    fontSize: 11,
    fontWeight: '600',
    color: TERMINAL.colors.muted,
  },
  optionSubtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.2)',
    marginTop: 2,
  },
  optionSubtitleActive: {
    color: TERMINAL.colors.muted,
  },
  optionDescription: {
    fontSize: 10,
    fontWeight: '600',
    color: TERMINAL.colors.muted,
    marginTop: 2,
  },
  checkmark: {
    fontSize: 14,
    color: TERMINAL.colors.primary,
    fontWeight: '800',
  },
});
