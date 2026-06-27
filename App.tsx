/**
 * CantosHub — standalone, no-root game boost hub.
 * Phase 0: permission-driven boost (DND / refresh rate / brightness / keep-awake)
 * orchestrated by a foreground service. No root, ever.
 *
 * @format
 */
import React, { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import DashboardScreen from './src/screens/DashboardScreen';
import PermissionsScreen from './src/screens/PermissionsScreen';
import ProfilesScreen from './src/screens/ProfilesScreen';
import { StoreProvider } from './src/state/store';
import { colors } from './src/theme';

type Tab = 'dashboard' | 'profiles' | 'permissions';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'dashboard', label: 'Boost', icon: '⚡' },
  { key: 'profiles', label: 'Profiles', icon: '🎮' },
  { key: 'permissions', label: 'Access', icon: '🔓' },
];

function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <View style={styles.body}>
            {tab === 'dashboard' && (
              <DashboardScreen onGoPermissions={() => setTab('permissions')} />
            )}
            {tab === 'profiles' && <ProfilesScreen />}
            {tab === 'permissions' && <PermissionsScreen />}
          </View>

          <View style={styles.tabBar}>
            {TABS.map(t => {
              const active = t.key === tab;
              return (
                <Pressable
                  key={t.key}
                  style={styles.tab}
                  onPress={() => setTab(t.key)}
                  android_ripple={{ color: colors.border, borderless: true }}>
                  <Text style={[styles.tabIcon, active && styles.tabIconActive]}>
                    {t.icon}
                  </Text>
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </SafeAreaView>
      </StoreProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 8,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  tabIcon: { fontSize: 20, opacity: 0.5 },
  tabIconActive: { opacity: 1 },
  tabLabel: { color: colors.textDim, fontSize: 11, marginTop: 2, fontWeight: '600' },
  tabLabelActive: { color: colors.accent },
});

export default App;
