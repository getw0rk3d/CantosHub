/** Full-screen 4-digit PIN keypad (modal). Calls onComplete once 4 digits are entered. */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function PinPad({
  visible,
  title,
  subtitle,
  error,
  onComplete,
  onCancel,
  footer,
  disabled,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  error?: string | null;
  onComplete: (pin: string) => void;
  onCancel: () => void;
  footer?: React.ReactNode;
  /** Keys do nothing (e.g. waiting after too many wrong PINs). */
  disabled?: boolean;
}) {
  const [pin, setPin] = useState('');

  // Clear the dots whenever the pad opens, shows an error, or moves to the next step
  // (e.g. "New PIN" -> "Confirm PIN").
  useEffect(() => {
    setPin('');
  }, [visible, error, title]);

  const press = (k: string) => {
    if (k === '⌫') {
      setPin(p => p.slice(0, -1));
      return;
    }
    if (!k || disabled || pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    // Clear here too: a second wrong PIN shows the same error text, so the effect above
    // doesn't run and the pad sat full, ignoring every key.
    if (next.length === 4) {
      setTimeout(() => {
        setPin('');
        onComplete(next);
      }, 120);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}
          <View style={styles.dots}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotOn]} />
            ))}
          </View>
          <Text style={styles.error}>{error ?? ' '}</Text>
          <View style={[styles.grid, disabled && styles.gridOff]}>
            {KEYS.map((k, i) => (
              <Pressable
                key={i}
                onPress={() => press(k)}
                disabled={!k}
                accessibilityLabel={k === '⌫' ? 'Delete' : k || undefined}
                style={({ pressed }) => [styles.key, !k && styles.keyBlank, pressed && !!k && styles.keyPressed]}>
                <Text style={styles.keyText}>{k}</Text>
              </Pressable>
            ))}
          </View>
          {footer}
          <Pressable onPress={onCancel} style={styles.cancel} hitSlop={8}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: spacing.xl },
  card: { backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, alignItems: 'center' },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 6, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 16, marginTop: spacing.xl },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.textDim },
  dotOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.md, minHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 252, marginTop: spacing.sm },
  gridOff: { opacity: 0.35 },
  key: { width: 76, height: 64, margin: 4, borderRadius: 16, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  keyBlank: { backgroundColor: 'transparent' },
  keyPressed: { backgroundColor: colors.border },
  keyText: { color: colors.text, fontSize: 24, fontWeight: '700' },
  cancel: { marginTop: spacing.lg },
  cancelText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
});
