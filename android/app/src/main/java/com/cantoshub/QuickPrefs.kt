package com.cantoshub

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * The app's boost settings as last saved - profiles, the active one, Auto mode, HUD, Free RAM -
 * mirrored here by the app (CantosHubModule.syncBoostSettings), so a home-screen shortcut or
 * the Quick tile boosts with today's profiles in the mode the app shows. They used to carry a
 * copy of the profile from the day they were made, and edits never reached them. Also keeps
 * the tile's favorite profile (by id).
 */
object QuickPrefs {
  private const val PREFS = "cantoshub_quick"
  private const val KEY_FAV = "fav" // a full copy (all the tile had before 1.3.5)
  private const val KEY_FAV_ID = "fav_id"
  private const val KEY_PROFILES = "profiles"
  private const val KEY_ACTIVE = "active_id"
  private const val KEY_AUTO = "auto"
  private const val KEY_OVERLAY = "overlay"
  private const val KEY_FREERAM = "freeram"

  private fun sp(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun saveSettings(ctx: Context, profilesJson: String, activeId: String, auto: Boolean, overlay: Boolean, freeRam: Boolean) {
    sp(ctx).edit()
      .putString(KEY_PROFILES, profilesJson)
      .putString(KEY_ACTIVE, activeId)
      .putBoolean(KEY_AUTO, auto)
      .putBoolean(KEY_OVERLAY, overlay)
      .putBoolean(KEY_FREERAM, freeRam)
      .apply()
  }

  fun profilesJson(ctx: Context): String = sp(ctx).getString(KEY_PROFILES, "[]") ?: "[]"
  fun autoMode(ctx: Context) = sp(ctx).getBoolean(KEY_AUTO, false)
  fun showOverlay(ctx: Context) = sp(ctx).getBoolean(KEY_OVERLAY, false)
  fun freeRam(ctx: Context) = sp(ctx).getBoolean(KEY_FREERAM, true)

  private fun profiles(ctx: Context): List<JSONObject> = try {
    val arr = JSONArray(profilesJson(ctx))
    (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
  } catch (e: Exception) {
    emptyList()
  }

  fun setFavorite(ctx: Context, profile: JSONObject) {
    sp(ctx).edit().putString(KEY_FAV_ID, profile.optString("id", "")).putString(KEY_FAV, profile.toString()).apply()
  }

  /** The tile's profile as it is today. */
  fun favorite(ctx: Context): JSONObject? =
    resolve(ctx, sp(ctx).getString(KEY_FAV_ID, null), sp(ctx).getString(KEY_FAV, null), null)

  /**
   * Today's version of profile [id]; if it was deleted, the profile bound to [game], else the
   * active one. [copy] (the profile a pre-1.3.5 shortcut carries) is used only until the app
   * has saved its profiles here once. Used for another game, the result is recorded against
   * [game] (session stats, never killed by its own Free RAM).
   */
  fun resolve(ctx: Context, id: String?, copy: String?, game: String?): JSONObject? {
    val old = try {
      copy?.let { JSONObject(it) }
    } catch (e: Exception) {
      null
    }
    val list = profiles(ctx)
    val want = id?.takeIf { it.isNotEmpty() } ?: old?.optString("id")
    val found = if (list.isEmpty()) {
      old
    } else {
      list.firstOrNull { it.optString("id") == want }
        ?: game?.let { g -> list.firstOrNull { it.optString("packageName") == g } }
        ?: list.firstOrNull { it.optString("id") == sp(ctx).getString(KEY_ACTIVE, "") }
        ?: list.first()
    } ?: return null
    if (game.isNullOrEmpty() || found.optString("packageName", "") == game) return found
    return JSONObject(found.toString()).put("packageName", game)
  }
}
