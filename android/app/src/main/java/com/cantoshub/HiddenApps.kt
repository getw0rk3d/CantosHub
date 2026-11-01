package com.cantoshub

import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent

/**
 * Games CantosHub hid from the phone (PRO: pm disable-user), so they live only in CantosHub.
 * Opening one from CantosHub switches it back on for that session ("out"); it's hidden again
 * once it has closed - checked when CantosHub comes back, never while the game still runs
 * (switching it off would kill it).
 */
object HiddenApps {
  private const val PREFS = "cantoshub_hidden"
  private const val KEY_HIDDEN = "hidden"
  private const val KEY_OUT = "out"
  private val SAFE_PKG = Regex("^[A-Za-z0-9_.]+$") // package names go into shell scripts

  // A game used this recently is left alone: coming back to CantosHub mid-game is common, and
  // each check connects (the built-in connection pops Android's alert).
  private const val QUIET_MS = 10 * 60_000L

  private fun sp(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun read(ctx: Context, key: String): Set<String> =
    (sp(ctx).getString(key, "") ?: "").split(",").filter { it.isNotBlank() }.toSet()

  private fun write(ctx: Context, key: String, pkgs: Set<String>) =
    sp(ctx).edit().putString(key, pkgs.joinToString(",")).commit()

  fun hidden(ctx: Context) = read(ctx, KEY_HIDDEN)
  fun out(ctx: Context) = read(ctx, KEY_OUT)

  /** Games hidden before CantosHub kept this list (the app's saved list knows them). */
  fun remember(ctx: Context, pkgs: Collection<String>) {
    val add = pkgs.filter { SAFE_PKG.matches(it) }.toSet() - hidden(ctx)
    if (add.isNotEmpty()) write(ctx, KEY_HIDDEN, hidden(ctx) + add)
  }

  /** No longer hidden: switched back on outside CantosHub (its App info Enable button). */
  fun forget(ctx: Context, pkgs: Collection<String>) {
    write(ctx, KEY_HIDDEN, hidden(ctx) - pkgs.toSet())
    write(ctx, KEY_OUT, out(ctx) - pkgs.toSet())
  }

  /** Hide [pkgs] from the phone; [cb] gets the ones that are hidden now. */
  fun hide(ctx: Context, pkgs: Collection<String>, cb: (List<String>) -> Unit) =
    run(ctx, pkgs, { p -> "pm disable-user --user 0 $p" }, cb) { done ->
      write(ctx, KEY_HIDDEN, hidden(ctx) + done)
      write(ctx, KEY_OUT, out(ctx) - done.toSet())
    }

  /** Show [pkgs] on the phone again for good; [cb] gets the ones that are back. */
  fun show(ctx: Context, pkgs: Collection<String>, cb: (List<String>) -> Unit) =
    run(ctx, pkgs, { p -> "pm enable $p" }, cb) { done -> forget(ctx, done) }

  private fun run(
    ctx: Context,
    pkgs: Collection<String>,
    cmd: (String) -> String,
    cb: (List<String>) -> Unit,
    save: (List<String>) -> Unit,
  ) {
    val list = pkgs.filter { SAFE_PKG.matches(it) && it != ctx.packageName }.distinct()
    if (list.isEmpty() || !ShizukuManager.hasPermission()) {
      cb(emptyList())
      return
    }
    // One script for all of them: one shell round trip however many games.
    val script = list.joinToString("; ") { p -> "${cmd(p)} >/dev/null 2>&1 && echo \"OK $p\"" }
    ShizukuManager.exec(ctx, listOf("sh", "-c", "$script; true")) { res ->
      val done = okLines(res, list)
      save(done)
      cb(done)
    }
  }

  private fun okLines(out: String?, asked: List<String>): List<String> =
    out.orEmpty().lines().map { it.removePrefix("ERR: ").trim() }
      .filter { it.startsWith("OK ") }.map { it.removePrefix("OK ") }.filter { it in asked }

  /**
   * Open [pkg]. A game CantosHub hid is switched on first (PRO). [cb] gets false when it
   * couldn't be opened (hidden and no shell now, or not installed).
   */
  fun launch(ctx: Context, pkg: String, cb: (Boolean) -> Unit) {
    if (start(ctx, pkg)) {
      cb(true)
      return
    }
    if (pkg !in hidden(ctx) || !SAFE_PKG.matches(pkg) || !ShizukuManager.hasPermission()) {
      cb(false)
      return
    }
    ShizukuManager.exec(ctx, listOf("pm", "enable", pkg)) { res ->
      val on = res != null && !res.startsWith("ERR")
      if (on) write(ctx, KEY_OUT, out(ctx) + pkg)
      cb(on && start(ctx, pkg))
    }
  }

  private fun start(ctx: Context, pkg: String): Boolean = try {
    val i = ctx.packageManager.getLaunchIntentForPackage(pkg)
    if (i == null) false else {
      ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    }
  } catch (e: Exception) {
    false
  }

  /** Hide again the games opened from CantosHub that have closed since (see QUIET_MS). */
  fun rehideClosed(ctx: Context) {
    val open = out(ctx)
    if (open.isEmpty()) return // the usual case: nothing to check, nothing to read
    val now = System.currentTimeMillis()
    val used = lastUsed(ctx, now)
    val due = open.filter { SAFE_PKG.matches(it) && now - (used[it] ?: 0L) > QUIET_MS }
    if (due.isEmpty() || !ShizukuManager.canRun()) return
    val script = due.joinToString("; ") { p ->
      "pidof $p >/dev/null || { pm disable-user --user 0 $p >/dev/null 2>&1 && echo \"OK $p\"; }"
    }
    ShizukuManager.exec(ctx, listOf("sh", "-c", "$script; true")) { res ->
      val done = okLines(res, due)
      if (done.isNotEmpty()) write(ctx, KEY_OUT, out(ctx) - done.toSet())
    }
  }

  private fun lastUsed(ctx: Context, now: Long): Map<String, Long> = try {
    val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    usm.queryAndAggregateUsageStats(now - QUIET_MS, now).mapValues { it.value.lastTimeUsed }
  } catch (e: Exception) {
    emptyMap()
  }
}
