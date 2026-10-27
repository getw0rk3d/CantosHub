package com.cantoshub

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.provider.Telephony
import android.telecom.TelecomManager
import org.json.JSONObject

/**
 * Pro-tier tweaks that need shell privilege (delivered via Shizuku, no root):
 *  - resolution + density downscale (`wm size` / `wm density`) for GPU-bound games
 *  - freezing user-chosen background apps (`pm suspend` / `pm unsuspend`)
 *
 * Before downscaling we remember the *current* size/density — including an override
 * the user already had (e.g. Samsung's FHD+ setting) — and restore exactly that.
 * `wm size reset` would instead jump to the panel's full native resolution.
 *
 * The restore record is only cleared once the restore commands actually ran; if
 * Shizuku isn't running (it doesn't survive a reboot) the record is kept and
 * [revert] is retried on the next app start / boost stop, or when Shizuku is back.
 *
 * [apply] and [revert] each run as one job on Shizuku's queue (ShizukuManager.submit), in the
 * order they were called.
 */
object ShizukuActions {
  private const val PREFS = "cantoshub_shizuku"
  private const val KEY_SUSPENDED = "suspended"
  private const val KEY_RES_CHANGED = "res_changed"
  private const val KEY_PREV_SIZE = "prev_size" // "1080x2340", or "" = no override before
  private const val KEY_PREV_DENSITY = "prev_density" // "450", or "" = no override before

  /**
   * Packages a boost never freezes. With Settings or Shizuku frozen, Shizuku can't be started
   * again (it needs Settings > Wireless debugging and its own app), so nothing frozen could be
   * unfrozen on the phone; the rest would break calls, texts, typing, Home or the stores.
   */
  private val NEVER_FREEZE = setOf(
    "moe.shizuku.privileged.api",
    "com.android.settings",
    "com.android.systemui",
    "com.android.phone",
    "com.android.vending",
    "com.google.android.gms",
    "com.sec.android.app.samsungapps",
    "com.sec.android.app.launcher",
    "com.google.android.apps.nexuslauncher",
    "com.samsung.android.dialer",
    "com.google.android.dialer",
    "com.samsung.android.messaging",
    "com.google.android.apps.messaging",
    "com.samsung.android.honeyboard",
    "com.google.android.inputmethod.latin",
  )

  /** [NEVER_FREEZE] plus this phone's own Home, dialer, SMS app and keyboard, and CantosHub. */
  fun neverFreeze(ctx: Context): Set<String> {
    val out = HashSet(NEVER_FREEZE)
    out.add(ctx.packageName)
    try {
      val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
      ctx.packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName?.let { out.add(it) }
    } catch (e: Exception) {
    }
    try {
      (ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager).defaultDialerPackage?.let { out.add(it) }
    } catch (e: Exception) {
    }
    try {
      Telephony.Sms.getDefaultSmsPackage(ctx)?.let { out.add(it) }
    } catch (e: Exception) {
    }
    try {
      Settings.Secure.getString(ctx.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
        ?.substringBefore('/')?.takeIf { it.isNotEmpty() }?.let { out.add(it) }
    } catch (e: Exception) {
    }
    return out
  }

  fun apply(ctx: Context, profile: JSONObject, cb: (Boolean) -> Unit) =
    ShizukuManager.submit(ctx, { sh -> sh != null && applyNow(ctx, sh, profile) }, cb)

  fun revert(ctx: Context, cb: (Boolean) -> Unit) =
    ShizukuManager.submit(ctx, { sh -> revertNow(ctx, sh) }, cb)

  private fun applyNow(ctx: Context, sh: ShizukuManager.Shell, profile: JSONObject): Boolean {
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val scale = profile.optDouble("resolutionScale", 1.0)
    val game = profile.optString("packageName", "")

    // The game itself can't be left frozen by another profile's record: let it run.
    val held = suspendedList(ctx)
    if (game.isNotEmpty() && game in held && sh.exec(listOf("pm", "unsuspend", game)) != null) {
      saveSuspended(ctx, held - game)
    }

    // 1) Freeze (suspend) chosen background apps — never the game being boosted. Recorded
    // first, so they're unfrozen even if we die right after.
    val blocked = neverFreeze(ctx)
    val toFreeze = jsonStrings(profile.optJSONArray("freezeApps")).filter { it != game && it !in blocked }
    if (toFreeze.isNotEmpty()) {
      saveSuspended(ctx, (suspendedList(ctx) + toFreeze).distinct())
      sh.exec(listOf("pm", "suspend") + toFreeze)
    }

    // 2) Resolution + density downscale, relative to what's on screen now.
    if (scale !in 0.5..0.99) return true
    // Already downscaled by an earlier boost that wasn't reverted yet — don't stack.
    if (sp.getBoolean(KEY_RES_CHANGED, false)) return true
    val sizeOut = sh.exec(listOf("wm", "size"))
    val override = parseSize(sizeOut, "Override size")
    val (w, h) = override ?: parseSize(sizeOut, "Physical size") ?: return true
    if (w <= 0 || h <= 0) return true
    val densOut = sh.exec(listOf("wm", "density"))
    val overD = parseDensity(densOut, "Override density")
    val d = overD ?: parseDensity(densOut, "Physical density") ?: 0
    sp.edit()
      .putBoolean(KEY_RES_CHANGED, true)
      .putString(KEY_PREV_SIZE, override?.let { "${it.first}x${it.second}" } ?: "")
      .putString(KEY_PREV_DENSITY, overD?.toString() ?: "")
      .commit()
    sh.exec(listOf("wm", "size", "${(w * scale).toInt()}x${(h * scale).toInt()}"))
    if (d > 0) sh.exec(listOf("wm", "density", "${(d * scale).toInt()}"))
    return true
  }

  private fun revertNow(ctx: Context, sh: ShizukuManager.Shell?): Boolean {
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val suspended = suspendedList(ctx)
    val resChanged = sp.getBoolean(KEY_RES_CHANGED, false)
    if (suspended.isEmpty() && !resChanged) return true
    if (sh == null) return false // keep the record; retried later when Shizuku is back

    var ok = true
    if (resChanged) {
      val prevSize = sp.getString(KEY_PREV_SIZE, "") ?: ""
      val prevDensity = sp.getString(KEY_PREV_DENSITY, "") ?: ""
      val a = sh.exec(if (prevSize.isNotEmpty()) listOf("wm", "size", prevSize) else listOf("wm", "size", "reset"))
      val b = sh.exec(if (prevDensity.isNotEmpty()) listOf("wm", "density", prevDensity) else listOf("wm", "density", "reset"))
      if (a != null && b != null) {
        sp.edit().remove(KEY_RES_CHANGED).remove(KEY_PREV_SIZE).remove(KEY_PREV_DENSITY).commit()
      } else {
        ok = false
      }
    }
    if (suspended.isNotEmpty()) {
      if (sh.exec(listOf("pm", "unsuspend") + suspended) != null) {
        saveSuspended(ctx, suspendedList(ctx) - suspended.toSet()) // only what we just unfroze
      } else {
        ok = false
      }
    }
    return ok
  }

  /** What a boost changed that still needs Shizuku to undo: (frozen app count, resolution lowered). */
  fun pending(ctx: Context): Pair<Int, Boolean> =
    suspendedList(ctx).size to ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_RES_CHANGED, false)

  private fun suspendedList(ctx: Context): List<String> =
    (ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SUSPENDED, "") ?: "")
      .split(",")
      .filter { it.isNotBlank() }

  private fun saveSuspended(ctx: Context, pkgs: List<String>) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_SUSPENDED, pkgs.joinToString(","))
      .commit()
  }

  private fun jsonStrings(arr: org.json.JSONArray?): List<String> {
    if (arr == null) return emptyList()
    val out = ArrayList<String>(arr.length())
    for (i in 0 until arr.length()) {
      val s = arr.optString(i)
      if (s.isNotBlank()) out.add(s)
    }
    return out
  }

  /** Parses e.g. "Physical size: 1440x3120" / "Override size: 1080x2340" from `wm size`. */
  private fun parseSize(out: String?, label: String): Pair<Int, Int>? {
    if (out == null) return null
    val m = Regex("$label:\\s*(\\d+)x(\\d+)").find(out) ?: return null
    val w = m.groupValues[1].toIntOrNull() ?: return null
    val h = m.groupValues[2].toIntOrNull() ?: return null
    return w to h
  }

  /** Parses e.g. "Physical density: 600" / "Override density: 450" from `wm density`. */
  private fun parseDensity(out: String?, label: String): Int? {
    if (out == null) return null
    return Regex("$label:\\s*(\\d+)").find(out)?.groupValues?.get(1)?.toIntOrNull()
  }
}
