/** An installed app's launcher icon (cached), with a colored-letter fallback. */
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { CantosHub } from '../native/CantosHub';

const AVATAR_COLORS = ['#00E5A0', '#3B82F6', '#FFB020', '#FF4D67', '#A78BFA', '#22D3EE'];

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 1000000007;
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Cache icons across renders/tabs so we fetch each app's icon at most once.
const iconCache = new Map<string, string | null>();

export function AppIcon({
  packageName,
  label,
  size = 46,
}: {
  packageName: string;
  label: string;
  size?: number;
}) {
  const [uri, setUri] = useState<string | null>(iconCache.get(packageName) ?? null);

  useEffect(() => {
    if (iconCache.has(packageName)) {
      setUri(iconCache.get(packageName) ?? null);
      return;
    }
    let cancelled = false;
    CantosHub.getAppIcon(packageName).then(u => {
      iconCache.set(packageName, u);
      if (!cancelled) setUri(u);
    });
    return () => {
      cancelled = true;
    };
  }, [packageName]);

  const box = { width: size, height: size, borderRadius: size * 0.26 };
  if (uri) {
    return <Image source={{ uri }} style={box} resizeMode="cover" />;
  }
  return (
    <View style={[styles.fallback, box, { backgroundColor: avatarColor(packageName) }]}>
      <Text style={[styles.letter, { fontSize: size * 0.46 }]}>{label.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: '#06140F', fontWeight: '900' },
});
