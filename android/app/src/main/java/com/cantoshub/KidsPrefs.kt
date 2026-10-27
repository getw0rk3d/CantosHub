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
  private const val KEY_WALLET_STOPPED = "wallet_stopped"
  private const val KEY_TOOK_HOME = "took_home"
  private const val KEY_PIN_FAILS = "pin_fails"
  private const val KEY_PIN_WAIT_UNTIL = "pin_wait_until"
  private const val KEY_BAR_LOCKED = "bar_locked"

  // Wrong PINs: the first few are free (small kids mash keys), then the pad waits 30 s,
  // doubling each time up to 15 min. The phone's own lock still unlocks meanwhile.
  private const val FREE_TRIES = 4
  private const val FIRST_WAIT_MS = 30_000L
  private const val MAX_WAIT_MS = 15 * 60_000L

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
    sp(ctx).edit().putString(KEY_PIN_SALT, saltHex).putString(KEY_PIN_HASH, hash(saltHex, pin))
      .remove(KEY_PIN_FAILS).remove(KEY_PIN_WAIT_UNTIL).commit()
  }

  fun checkPin(ctx: Context, pin: String): Boolean {
    val salt = sp(ctx).getString(KEY_PIN_SALT, "") ?: return false
    val stored = sp(ctx).getString(KEY_PIN_HASH, "") ?: return false
    if (stored.isEmpty()) return false
    return MessageDigest.isEqual(stored.toByteArray(), hash(salt, pin).toByteArray())
  }

  /** How long the PIN pad still has to wait, 0 if it can be tried now. */
  fun pinWaitLeftMs(ctx: Context): Long {
    val left = sp(ctx).getLong(KEY_PIN_WAIT_UNTIL, 0L) - System.currentTimeMillis()
    return left.coerceIn(0L, MAX_WAIT_MS)   // clock moved back: never more than the longest wait
  }

  /** Count a wrong PIN; returns how long to wait before the next try (0 = none). */
  fun notePinFail(ctx: Context): Long {
    val fails = sp(ctx).getInt(KEY_PIN_FAILS, 0) + 1
    val over = fails - FREE_TRIES
    val wait = if (over <= 0) 0L else (FIRST_WAIT_MS shl (over - 1).coerceAtMost(5)).coerceAtMost(MAX_WAIT_MS)
    sp(ctx).edit().putInt(KEY_PIN_FAILS, fails).putLong(KEY_PIN_WAIT_UNTIL, System.currentTimeMillis() + wait).commit()
    return wait
  }

  fun clearPinFails(ctx: Context) = sp(ctx).edit().remove(KEY_PIN_FAILS).remove(KEY_PIN_WAIT_UNTIL).commit()

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

  /** Kids Mode stopped Samsung Wallet's swipe-up service; restart it when Kids Mode ends. */
  fun walletStopped(ctx: Context) = sp(ctx).getBoolean(KEY_WALLET_STOPPED, false)
  fun setWalletStopped(ctx: Context, v: Boolean) = sp(ctx).edit().putBoolean(KEY_WALLET_STOPPED, v).commit()

  /**
   * Kids Mode took the Home role through Android's prompt (no Shizuku). Android does not
   * hand it back when the kids Home switches off - with two launchers it asks "Select a Home
   * app" - so the app walks the parent through that once Kids Mode is unlocked.
   */
  fun tookHome(ctx: Context) = sp(ctx).getBoolean(KEY_TOOK_HOME, false)
  fun setTookHome(ctx: Context, v: Boolean) = sp(ctx).edit().putBoolean(KEY_TOOK_HOME, v).commit()

  /**
   * Kids lock switched the notification shade and Recents off through Shizuku. That lives in
   * system_server until it's switched back on (or the phone restarts), so if Shizuku stopped
   * during Kids Mode it is still owed after unlocking - see KidsService.releaseBar.
   */
  fun barLocked(ctx: Context) = sp(ctx).getBoolean(KEY_BAR_LOCKED, false)
  fun setBarLocked(ctx: Context, v: Boolean) = sp(ctx).edit().putBoolean(KEY_BAR_LOCKED, v).commit()

  fun systemAllowed(ctx: Context) = System.currentTimeMillis() < sp(ctx).getLong(KEY_SYSTEM_UNTIL, 0L)
}
