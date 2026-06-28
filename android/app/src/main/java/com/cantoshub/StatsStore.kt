package com.cantoshub

import android.content.Context
import org.json.JSONObject

/**
 * Per-game stats persisted in SharedPreferences as a single JSON blob:
 *   { "<pkg>": { "sessions": N, "fpsSum": D, "fpsCount": N } }
 * Written by BoostService while boosting; read by the Games tab.
 */
object StatsStore {
  private const val PREFS = "cantoshub_stats"
  private const val KEY = "data"

  fun asJson(ctx: Context): String =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "{}") ?: "{}"

  @Synchronized
  fun recordSession(ctx: Context, pkg: String) {
    if (pkg.isBlank()) return
    update(ctx, pkg) { it.put("sessions", it.optInt("sessions", 0) + 1) }
  }

  @Synchronized
  fun recordFps(ctx: Context, pkg: String, fps: Int) {
    if (pkg.isBlank() || fps <= 0 || fps > 240) return
    update(ctx, pkg) {
      it.put("fpsSum", it.optDouble("fpsSum", 0.0) + fps)
      it.put("fpsCount", it.optInt("fpsCount", 0) + 1)
    }
  }

  private fun update(ctx: Context, pkg: String, fn: (JSONObject) -> Unit) {
    val root = try {
      JSONObject(asJson(ctx))
    } catch (e: Exception) {
      JSONObject()
    }
    val o = root.optJSONObject(pkg) ?: JSONObject()
    fn(o)
    root.put(pkg, o)
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, root.toString())
      .apply()
  }
}
