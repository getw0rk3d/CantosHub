package com.cantoshub

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle

/**
 * Invisible trampoline for adding apps to CantosHub quickly:
 * - Share from the Play Store / Galaxy Store ("Share" → CantosHub): the shared link
 *   names the app's package.
 * - The "Add game" app-icon shortcut: opens CantosHub's app picker.
 * It only records the request, then opens CantosHub, which shows the add prompt.
 */
class AddAppActivity : Activity() {
  companion object {
    const val ACTION_ADD_GAME = "com.cantoshub.ADD_GAME"
    private const val PREFS = "cantoshub_pending_add"
    private const val KEY_KIND = "kind"
    private const val KEY_TEXT = "text"

    // Package names in store links: play.google.com/...?id=PKG, galaxystore.samsung.com/detail/PKG,
    // apps.samsung.com/appquery/appDetail.as?appId=PKG, market://details?id=PKG
    private val LINK_PATTERNS = listOf(
      Regex("""[?&](?:id|appId)=([A-Za-z][\w]*(?:\.[\w]+)+)"""),
      Regex("""/detail/([A-Za-z][\w]*(?:\.[\w]+)+)"""),
    )

    fun packageFromText(text: String): String? =
      LINK_PATTERNS.firstNotNullOfOrNull { it.find(text)?.groupValues?.get(1) }

    /** The pending request ("share" + text, or "pick"), cleared once read. */
    fun take(ctx: Context): Pair<String, String>? {
      val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val kind = sp.getString(KEY_KIND, null) ?: return null
      val text = sp.getString(KEY_TEXT, "") ?: ""
      sp.edit().clear().commit()
      return kind to text
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    when (intent?.action) {
      Intent.ACTION_SEND -> {
        val text = listOfNotNull(
          intent.getStringExtra(Intent.EXTRA_TEXT),
          intent.getStringExtra(Intent.EXTRA_SUBJECT),
        ).joinToString(" ")
        sp.putString(KEY_KIND, "share").putString(KEY_TEXT, text)
      }
      ACTION_ADD_GAME -> sp.putString(KEY_KIND, "pick").putString(KEY_TEXT, "")
    }
    sp.commit()
    try {
      startActivity(
        Intent(this, MainActivity::class.java)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
      )
    } catch (e: Exception) {
    }
    finish()
  }
}
