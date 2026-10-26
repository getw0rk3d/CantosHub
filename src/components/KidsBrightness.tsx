/**
 * Brightness on the kids screen. Kids lock closes the notification shade (on purpose), and
 * the shade held the only brightness slider, so the screen stayed too bright or too dim
 * while Kids Mode was on. A sun button opens five big steps (dim → bright) and Auto - easy
 * for small fingers, no slider to fiddle with. Needs "Modify system settings" (already
 * granted for boosting); if it isn't, the row says to ask a grown-up.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CantosHub } from '../native/CantosHub';

const LEVELS = [15, 50, 100, 170, 255];
const CLOSE_AFTER_MS = 6000;   // time to decide, for small kids

export function KidsBrightnessButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.btn, open && styles.btnOn]}
      accessibilityLabel="Screen brightness"
      hitSlop={6}>
      <Text style={styles.btnGlyph}>☀️</Text>
    </Pressable>
  );
}

export function KidsBrightnessRow({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [state, setState] = useState<{ level: number; auto: boolean; canWrite: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armClose = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(onClose, CLOSE_AFTER_MS);
  }, [onClose]);

  useEffect(() => {
    if (!visible) return;
    CantosHub.getScreenBrightness().then(setState).catch(() => {});
    armClose();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [visible, armClose]);

  if (!visible || !state) return null;
  if (!state.canWrite) {
    return (
      <View style={styles.row}>
        <Text style={styles.note}>Ask a grown-up to allow “Modify system settings” for CantosHub.</Text>
      </View>
    );
  }

  // The step closest to the current manual level is highlighted.
  const nearest = LEVELS.reduce((b, l) => (Math.abs(l - state.level) < Math.abs(b - state.level) ? l : b), LEVELS[0]);

  const pick = async (level: number, auto: boolean) => {
    setState(s => (s ? { ...s, level: auto ? s.level : level, auto } : s));
    await CantosHub.setScreenBrightness(level, auto);
    armClose();
  };

  return (
    <View style={styles.row}>
      {LEVELS.map((l, i) => {
        const on = !state.auto && l === nearest;
        const size = 18 + i * 5;      // 18..38: grows left to right but stays inside its circle
        return (
          <Pressable
            key={l}
            onPress={() => pick(l, false)}
            style={[styles.step, on && styles.stepOn]}
            accessibilityLabel={`Brightness ${i + 1} of ${LEVELS.length}`}>
            <Text style={[styles.sun, { fontSize: size, opacity: 0.45 + i * 0.13 }]}>☀️</Text>
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => pick(state.level, true)}
        style={[styles.auto, state.auto && styles.stepOn]}
        accessibilityLabel="Automatic brightness">
        <Text style={[styles.autoText, state.auto && styles.autoTextOn]}>Auto</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  btnOn: { backgroundColor: 'rgba(255,212,59,0.25)' },
  btnGlyph: { fontSize: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 10,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  step: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  stepOn: { backgroundColor: 'rgba(255,212,59,0.3)', borderWidth: 2, borderColor: '#FFD43B' },
  sun: { textAlign: 'center' },
  auto: { paddingHorizontal: 14, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  autoText: { color: '#C9C3FF', fontSize: 16, fontWeight: '800' },
  autoTextOn: { color: '#FFFFFF' },
  note: { color: '#C9C3FF', fontSize: 14, flex: 1, textAlign: 'center' },
});
