/**
 * CantosHub — standalone, no-root game boost hub.
 * Permission-driven boost (DND / refresh / brightness / keep-awake) orchestrated
 * by a foreground service, with an optional Shizuku Pro tier. No root, ever.
 *
 * @format
 */
import React, { useState } from 'react';
import { Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import DashboardScreen from './src/screens/DashboardScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import PermissionsScreen from './src/screens/PermissionsScreen';
import ProfilesScreen from './src/screens/ProfilesScreen';
import { StoreProvider, useStore } from './src/state/store';
import { colors } from './src/theme';

type Tab = 'dashboard' | 'games' | 'profiles' | 'permissions';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'dashboard', label: 'Boost', icon: '⚡' },
  { key: 'games', label: 'Games', icon: '🕹️' },
  { key: 'profiles', label: 'Profiles', icon: '🎮' },
  { key: 'permissions', label: 'Access', icon: '🔓' },
];

function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <AppShell />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.body}>
          {tab === 'dashboard' && (
            <DashboardScreen onGoPermissions={() => setTab('permissions')} />
          )}
          {tab === 'games' && <LibraryScreen onGoPermissions={() => setTab('permissions')} />}
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
                <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{t.icon}</Text>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
      <WhatsNewModal />
    </>
  );
}

function WhatsNewModal() {
  const { whatsNew, dismissWhatsNew } = useStore();
  return (
    <Modal
      visible={!!whatsNew}
      transparent
      animationType="fade"
      onRequestClose={dismissWhatsNew}>
      <View style={styles.wnBackdrop}>
        <View style={styles.wnCard}>
          <Text style={styles.wnEyebrow}>WHAT'S NEW</Text>
          <Text style={styles.wnVersion}>CantosHub v{whatsNew?.versionName}</Text>
          <Text style={styles.wnNotes}>{whatsNew?.notes}</Text>
          <Pressable
            style={styles.wnBtn}
            onPress={dismissWhatsNew}
            android_ripple={{ color: 'rgba(0,0,0,0.2)' }}>
            <Text style={styles.wnBtnText}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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

  wnBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  wnCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  wnEyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  wnVersion: { color: colors.text, fontSize: 20, fontWeight: '900', marginTop: 4 },
  wnNotes: { color: colors.textDim, fontSize: 14, lineHeight: 22, marginTop: 12 },
  wnBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  wnBtnText: { color: '#06140F', fontSize: 15, fontWeight: '800' },
});

export default App;
