/**
 * Release notes shown in the "What's new" dialog after an update installs.
 * Keyed by versionName. Bundled in-app so it works offline and always matches
 * the installed build.
 */
export const CHANGELOG: Record<string, string> = {
  '1.0.5':
    '• Auto Free RAM when a game launches in Auto mode\n• Wi-Fi low-latency lock during boost — steadier online play\n• Access tab now refreshes itself after you grant a permission',
  '1.0.4':
    '• Free RAM — kill background apps for more headroom (no root)\n• Clear cache (system-wide with Shizuku)\n• Per-game stats — boost count and average FPS in the Games tab\n• "What\'s new" after an update',
  '1.0.3': '• New CantosHub app icon & branding',
  '1.0.2':
    '• In-app updater — installs new releases in place\n• Live FPS in the overlay (Shizuku)',
  '1.0.1': '• Real app icons in the Games library',
};
