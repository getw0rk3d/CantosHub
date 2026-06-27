package com.cantoshub

import android.content.Context
import org.json.JSONObject

/**
 * Pro-tier tweaks that need shell privilege (delivered via Shizuku, no root):
 *  - resolution + density downscale (`wm size` / `wm density`) for GPU-bound games
 *  - freezing user-chosen background apps (`pm suspend` / `pm unsuspend`)
 *
 * Resolution reverts with `wm size reset` / `wm density reset`, so we only need
 * to remember which apps we suspended.
 */
object ShizukuActions {
  private const val PREFS = "cantoshub_shizuku"
  private const val KEY_SUSPENDED = "suspended"
  private const val KEY_RES_CHANGED = "res_changed"

  fun apply(ctx: Context, profile: JSONObject, cb: (Boolean) -> Unit) {
    val scale = profile.optDouble("resolutionScale", 1.0)
    val freeze = jsonStrings(profile.optJSONArray("freezeApps"))

    // 1) Freeze (suspend) chosen background apps.
    if (freeze.isNotEmpty()) {
      saveSuspended(ctx, freeze)
      ShizukuManager.exec(ctx, listOf("pm", "suspend") + freeze) { }
    }

    // 2) Resolution + density downscale.
    if (scale in 0.5..0.99) {
      ShizukuManager.exec(ctx, listOf("wm", "size")) { sizeOut ->
        val (w, h) = parsePhysicalSize(sizeOut)
        if (w > 0 && h > 0) {
          val nw = (w * scale).toInt()
          val nh = (h * scale).toInt()
          ShizukuManager.exec(ctx, listOf("wm", "size", "${nw}x${nh}")) {
            setResChanged(ctx, true)
            ShizukuManager.exec(ctx, listOf("wm", "density")) { densOut ->
              val d = parsePhysicalDensity(densOut)
              if (d > 0) {
                ShizukuManager.exec(ctx, listOf("wm", "density", "${(d * scale).toInt()}")) {
                  cb(true)
                }
              } else {
                cb(true)
              }
            }
          }
        } else {
          cb(true)
        }
      }
    } else {
      cb(true)
    }
  }

  fun revert(ctx: Context, cb: (Boolean) -> Unit) {
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val suspended = (sp.getString(KEY_SUSPENDED, "") ?: "")
      .split(",")
      .filter { it.isNotBlank() }
    val resChanged = sp.getBoolean(KEY_RES_CHANGED, false)

    val finish = {
      sp.edit().clear().apply()
      cb(true)
    }

    val unsuspendThenFinish = {
      if (suspended.isNotEmpty()) {
        ShizukuManager.exec(ctx, listOf("pm", "unsuspend") + suspended) { finish() }
      } else {
        finish()
      }
    }

    if (resChanged) {
      ShizukuManager.exec(ctx, listOf("wm", "size", "reset")) {
        ShizukuManager.exec(ctx, listOf("wm", "density", "reset")) { unsuspendThenFinish() }
      }
    } else {
      unsuspendThenFinish()
    }
  }

  private fun saveSuspended(ctx: Context, pkgs: List<String>) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_SUSPENDED, pkgs.joinToString(","))
      .apply()
  }

  private fun setResChanged(ctx: Context, changed: Boolean) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_RES_CHANGED, changed)
      .apply()
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

  /** Parses "Physical size: 1080x2400" from `wm size` output. */
  private fun parsePhysicalSize(out: String?): Pair<Int, Int> {
    if (out == null) return 0 to 0
    val m = Regex("Physical size:\\s*(\\d+)x(\\d+)").find(out) ?: return 0 to 0
    return (m.groupValues[1].toIntOrNull() ?: 0) to (m.groupValues[2].toIntOrNull() ?: 0)
  }

  /** Parses "Physical density: 420" from `wm density` output. */
  private fun parsePhysicalDensity(out: String?): Int {
    if (out == null) return 0
    val m = Regex("Physical density:\\s*(\\d+)").find(out) ?: return 0
    return m.groupValues[1].toIntOrNull() ?: 0
  }
}
