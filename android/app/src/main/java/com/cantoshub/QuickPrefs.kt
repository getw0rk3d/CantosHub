package com.cantoshub

import android.content.Context

/** Stores the "favorite" profile JSON the Quick Settings tile boosts on tap. */
object QuickPrefs {
  private const val PREFS = "cantoshub_quick"
  private const val KEY_FAV = "fav"

  fun setFavorite(ctx: Context, json: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_FAV, json).apply()
  }

  fun getFavorite(ctx: Context): String =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_FAV, "{}") ?: "{}"
}
