package com.cantoshub

import android.content.Context
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
 * [revert] is retried on the next app start / boost stop.
 */
object ShizukuActions {
  private const val PREFS = "cantoshub_shizuku"
  private const val KEY_SUSPENDED = "suspended"
  private const val KEY_RES_CHANGED = "res_changed"
  private const val KEY_PREV_SIZE = "prev_size" // "1080x2340", or "" = no override before
  private const val KEY_PREV_DENSITY = "prev_density" // "450", or "" = no override before

  fun apply(ctx: Context, profile: JSONObject, cb: (Boolean) -> Unit) {
    val scale = profile.optDouble("resolutionScale", 1.0)
    val freeze = jsonStrings(profile.optJSONArray("freezeApps"))

    // 1) Freeze (suspend) chosen background apps — never the game being boosted.
    val game = profile.optString("packageName", "")
    val toFreeze = freeze.filter { it != game && it != ctx.packageName }
    if (toFreeze.isNotEmpty()) {
      val already = suspendedList(ctx)
      saveSuspended(ctx, (already + toFreeze).distinct())
      ShizukuManager.exec(ctx, listOf("pm", "suspend") + toFreeze) { }
    }

    // 2) Resolution + density downscale, relative to what's on screen now.
    if (scale !in 0.5..0.99) {
      cb(true)
      return
    }
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (sp.getBoolean(KEY_RES_CHANGED, false)) {
      // Already downscaled by an earlier boost that wasn't reverted yet — don't stack.
      cb(true)
      return
    }
    ShizukuManager.exec(ctx, listOf("wm", "size")) { sizeOut ->
      val physical = parseSize(sizeOut, "Physical size")
      val override = parseSize(sizeOut, "Override size")
      val (w, h) = override ?: physical ?: (0 to 0)
      if (w <= 0 || h <= 0) {
        cb(true)
        return@exec
      }
      ShizukuManager.exec(ctx, listOf("wm", "density")) { densOut ->
        val physD = parseDensity(densOut, "Physical density")
        val overD = parseDensity(densOut, "Override density")
        val d = overD ?: physD ?: 0
        sp.edit()
          .putBoolean(KEY_RES_CHANGED, true)
          .putString(KEY_PREV_SIZE, override?.let { "${it.first}x${it.second}" } ?: "")
          .putString(KEY_PREV_DENSITY, overD?.toString() ?: "")
          .commit()
        ShizukuManager.exec(ctx, listOf("wm", "size", "${(w * scale).toInt()}x${(h * scale).toInt()}")) {
          if (d > 0) {
            ShizukuManager.exec(ctx, listOf("wm", "density", "${(d * scale).toInt()}")) { cb(true) }
          } else {
            cb(true)
          }
        }
      }
    }
  }

  fun revert(ctx: Context, cb: (Boolean) -> Unit) {
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val suspended = suspendedList(ctx)
    val resChanged = sp.getBoolean(KEY_RES_CHANGED, false)
    if (suspended.isEmpty() && !resChanged) {
      cb(true)
      return
    }
    if (!ShizukuManager.hasPermission()) {
      cb(false) // keep the record; retried later when Shizuku is back
      return
    }
    val prevSize = sp.getString(KEY_PREV_SIZE, "") ?: ""
    val prevDensity = sp.getString(KEY_PREV_DENSITY, "") ?: ""

    val unsuspend = { done: (Boolean) -> Unit ->
      if (suspended.isNotEmpty()) {
        ShizukuManager.exec(ctx, listOf("pm", "unsuspend") + suspended) { out -> done(out != null) }
      } else {
        done(true)
      }
    }
    val restoreRes = { done: (Boolean) -> Unit ->
      if (!resChanged) {
        done(true)
      } else {
        val sizeCmd = if (prevSize.isNotEmpty()) listOf("wm", "size", prevSize) else listOf("wm", "size", "reset")
        val densCmd = if (prevDensity.isNotEmpty()) listOf("wm", "density", prevDensity) else listOf("wm", "density", "reset")
        ShizukuManager.exec(ctx, sizeCmd) { a ->
          ShizukuManager.exec(ctx, densCmd) { b -> done(a != null && b != null) }
        }
      }
    }
    restoreRes { resOk ->
      unsuspend { susOk ->
        val e = sp.edit()
        if (resOk) e.remove(KEY_RES_CHANGED).remove(KEY_PREV_SIZE).remove(KEY_PREV_DENSITY)
        if (susOk) e.remove(KEY_SUSPENDED)
        e.commit()
        cb(resOk && susOk)
      }
    }
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
