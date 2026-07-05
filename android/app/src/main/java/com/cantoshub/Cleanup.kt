package com.cantoshub

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.media.AudioManager

/**
 * Shared no-root RAM cleanup: kills killable background processes of user apps
 * (KILL_BACKGROUND_PROCESSES). Used both by the manual "Free RAM" button and by
 * the boost service when a game launches in Auto mode.
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
    val pm = ctx.packageManager
    val launchable = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val seen = HashSet<String>()
    var n = 0
    for (ri in pm.queryIntentActivities(launchable, 0)) {
      val p = ri.activityInfo.packageName
      if (p == mine || p == excludePkg || !seen.add(p)) continue
      if (callCritical.any { p.contains(it) }) continue
      try {
        am.killBackgroundProcesses(p)
        n++
      } catch (e: Exception) {
      }
    }
    return n
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
