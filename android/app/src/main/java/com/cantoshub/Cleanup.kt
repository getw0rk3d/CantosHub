package com.cantoshub

import android.app.ActivityManager
import android.content.Context
import android.content.Intent

/**
 * Shared no-root RAM cleanup: kills killable background processes of user apps
 * (KILL_BACKGROUND_PROCESSES). Used both by the manual "Free RAM" button and by
 * the boost service when a game launches in Auto mode.
 */
object Cleanup {
  /** Returns how many packages we asked the system to kill. Excludes us + [excludePkg]. */
  fun killBackground(ctx: Context, excludePkg: String?): Int {
    val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val mine = ctx.packageName
    val pm = ctx.packageManager
    val launchable = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val seen = HashSet<String>()
    var n = 0
    for (ri in pm.queryIntentActivities(launchable, 0)) {
      val p = ri.activityInfo.packageName
      if (p == mine || p == excludePkg || !seen.add(p)) continue
      try {
        am.killBackgroundProcesses(p)
        n++
      } catch (e: Exception) {
      }
    }
    return n
  }
}
