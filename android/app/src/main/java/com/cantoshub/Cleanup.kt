package com.cantoshub

import android.app.ActivityManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.media.AudioManager

/**
 * Shared no-root RAM cleanup: kills killable background processes of user apps
 * (KILL_BACKGROUND_PROCESSES). Used by the manual "Free RAM" button and by the
 * boost service when a game launches in Auto mode.
 */
object Cleanup {
  // Never kill these — killing the dialer/telecom mid-call (or right as a call
  // ends) can leave the audio mode stuck and mute game audio.
  private val callCritical = listOf("dialer", "incallui", "telecom", "telephony", ".phone")

  /** True if [pkg] looks like a dialer / in-call / telecom app (used to detect the ring window). */
  fun isCallApp(pkg: String?): Boolean = pkg != null && callCritical.any { pkg.contains(it) }

  /** Returns how many packages we asked the system to kill. Excludes us + [excludePkg]. */
  fun killBackground(ctx: Context, excludePkg: String?): Int {
    if (isCallActive(ctx)) return 0 // don't churn processes during a call
    val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val mine = ctx.packageName
    // Only target recently-used apps — they're the ones likely to still have a live
    // background process. Apps idle for hours are already reclaimed by the OS, so
    // killing them is a wasted binder round-trip. This turns a ~150-app kill storm
    // (which contended with the game's launch) into a handful of targeted kills.
    // Falls back to all launchable apps if Usage Access isn't granted.
    val targets = recentlyUsedPackages(ctx).ifEmpty { launchablePackages(ctx) }
    var n = 0
    for (p in targets) {
      if (p == mine || p == excludePkg) continue
      if (callCritical.any { p.contains(it) }) continue
      try {
        am.killBackgroundProcesses(p)
        n++
      } catch (e: Exception) {
      }
    }
    return n
  }

  private fun recentlyUsedPackages(ctx: Context): Set<String> {
    return try {
      val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val now = System.currentTimeMillis()
      val since = now - 12L * 60 * 60 * 1000 // last 12h
      val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_BEST, since, now) ?: return emptySet()
      val set = HashSet<String>()
      for (s in stats) {
        if (s.lastTimeUsed >= since) set.add(s.packageName)
      }
      set
    } catch (e: Exception) {
      emptySet()
    }
  }

  private fun launchablePackages(ctx: Context): Set<String> {
    val pm = ctx.packageManager
    val launchable = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val set = HashSet<String>()
    for (ri in pm.queryIntentActivities(launchable, 0)) {
      set.add(ri.activityInfo.packageName)
    }
    return set
  }

  private fun isCallActive(ctx: Context): Boolean {
    return try {
      val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      when (am.mode) {
        AudioManager.MODE_IN_CALL,
        AudioManager.MODE_IN_COMMUNICATION,
        AudioManager.MODE_RINGTONE,
        -> true
        else -> false
      }
    } catch (e: Exception) {
      false
    }
  }
}
