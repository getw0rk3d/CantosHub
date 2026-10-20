package com.cantoshub

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Kids Mode settings: the allowed apps, the parent PIN (salted SHA-256, never stored
 * in plain text), whether Kids Mode is active, and what we changed so it can be undone.
 */
object KidsPrefs {
  private const val PREFS = "cantoshub_kids"
  private const val KEY_ACTIVE = "active"
  private const val KEY_ALLOWED = "allowed"
  private const val KEY_PIN_HASH = "pin_hash"
  private const val KEY_PIN_SALT = "pin_salt"
  private const val KEY_PREV_HOME = "prev_home"
  private const val KEY_SYSTEM_UNTIL = "system_until"

  private fun sp(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun isActive(ctx: Context) = sp(ctx).getBoolean(KEY_ACTIVE, false)
  fun setActive(ctx: Context, v: Boolean) = sp(ctx).edit().putBoolean(KEY_ACTIVE, v).commit()

  fun allowed(ctx: Context): Set<String> =
    (sp(ctx).getString(KEY_ALLOWED, "") ?: "").split(",").filter { it.isNotBlank() }.toSet()

  fun setAllowed(ctx: Context, pkgs: List<String>) =
    sp(ctx).edit().putString(KEY_ALLOWED, pkgs.filter { it.isNotBlank() }.distinct().joinToString(",")).commit()

  fun hasPin(ctx: Context) = !sp(ctx).getString(KEY_PIN_HASH, "").isNullOrEmpty()

  fun setPin(ctx: Context, pin: String) {
    val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val saltHex = salt.joinToString("") { "%02x".format(it) }
    sp(ctx).edit().putString(KEY_PIN_SALT, saltHex).putString(KEY_PIN_HASH, hash(saltHex, pin)).commit()
  }

  fun checkPin(ctx: Context, pin: String): Boolean {
    val salt = sp(ctx).getString(KEY_PIN_SALT, "") ?: return false
    val stored = sp(ctx).getString(KEY_PIN_HASH, "") ?: return false
    if (stored.isEmpty()) return false
    return MessageDigest.isEqual(stored.toByteArray(), hash(salt, pin).toByteArray())
  }

  private fun hash(salt: String, pin: String): String =
    MessageDigest.getInstance("SHA-256").digest("$salt:$pin".toByteArray())
      .joinToString("") { "%02x".format(it) }

  /** Previous default Home ("pkg/.Activity") to give back when Kids Mode ends (Shizuku path). */
  fun prevHome(ctx: Context): String = sp(ctx).getString(KEY_PREV_HOME, "") ?: ""
  fun setPrevHome(ctx: Context, v: String) = sp(ctx).edit().putString(KEY_PREV_HOME, v).commit()

  /**
   * Briefly let system screens through the lock (e.g. the phone's own PIN / fingerprint
   * screen used as the "forgot Kids PIN" fallback).
   */
  fun allowSystemFor(ctx: Context, ms: Long) =
    sp(ctx).edit().putLong(KEY_SYSTEM_UNTIL, System.currentTimeMillis() + ms).commit()

  fun systemAllowed(ctx: Context) = System.currentTimeMillis() < sp(ctx).getLong(KEY_SYSTEM_UNTIL, 0L)
}
