package com.cantoshub

import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.Settings
import io.github.muntashirakon.adb.AbsAdbConnectionManager
import io.github.muntashirakon.adb.AdbPairingRequiredException
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.cert.Certificate
import java.security.cert.CertificateFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * CantosHub's own shell, without the Shizuku app: it pairs once with the phone's Wireless
 * debugging (Developer options) and then talks to the phone's own adbd over TLS, running
 * commands as "shell" - the same level Shizuku gives. Pairing happens in AdbPairingService.
 *
 * After the first connection CantosHub grants itself WRITE_SECURE_SETTINGS, so after a
 * restart (or when Wi-Fi comes back) it can switch Wireless debugging on again by itself and
 * reconnect - no taps, no new pairing. Wireless debugging itself still needs Wi-Fi.
 *
 * Built on libadb-android (MuntashirAkon, used under its Apache-2.0 option).
 */
object AdbShell {
  private const val PREFS = "cantoshub_adb"
  private const val KEY_PAIRED = "paired"
  private const val EXIT_MARK = "__CANTOSHUB_EXIT="
  private const val RETRY_AFTER_MS = 30_000L

  private val lock = Any()
  private var manager: Manager? = null
  @Volatile private var lastTry = 0L

  /** Told when the connection comes or goes (the app refreshes its PRO status). */
  @Volatile var onChange: (() -> Unit)? = null

  private class Manager(ctx: Context) : AbsAdbConnectionManager() {
    private val key: PrivateKey
    private val cert: Certificate

    init {
      setApi(Build.VERSION.SDK_INT)
      setTimeout(10, TimeUnit.SECONDS)
      setThrowOnUnauthorised(true) // never sit waiting for an "Allow USB debugging?" prompt
      val (k, c) = loadOrCreateIdentity(ctx)
      key = k
      cert = c
    }

    override fun getPrivateKey(): PrivateKey = key
    override fun getCertificate(): Certificate = cert
    override fun getDeviceName(): String = "CantosHub"
  }

  private fun sp(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun manager(ctx: Context): Manager = synchronized(lock) {
    manager ?: Manager(ctx.applicationContext).also { manager = it }
  }

  fun isPaired(ctx: Context) = sp(ctx).getBoolean(KEY_PAIRED, false)

  fun isConnected(): Boolean = try {
    synchronized(lock) { manager }?.isConnected == true
  } catch (e: Exception) {
    false
  }

  /** Developer options are on (Wireless debugging lives there). */
  fun devOptionsOn(ctx: Context) =
    Settings.Global.getInt(ctx.contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1

  fun wirelessOn(ctx: Context) = Settings.Global.getInt(ctx.contentResolver, "adb_wifi_enabled", 0) == 1

  fun onWifi(ctx: Context): Boolean = try {
    val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    cm.getNetworkCapabilities(cm.activeNetwork)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
  } catch (e: Exception) {
    false
  }

  /** CantosHub may switch Wireless debugging on itself (granted once over the connection). */
  fun canAutoStart(ctx: Context) =
    ctx.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == PackageManager.PERMISSION_GRANTED

  /** Blocking: pair with the code shown under "Pair device with pairing code". */
  fun pair(ctx: Context, host: String, port: Int, code: String): Boolean {
    return try {
      val ok = manager(ctx).pair(host, port, code)
      if (ok) sp(ctx).edit().putBoolean(KEY_PAIRED, true).commit()
      ok
    } catch (e: Exception) {
      false
    }
  }

  /**
   * Blocking: connect if paired and not connected yet. Switches Wireless debugging on first
   * when it's off and CantosHub may (Wi-Fi only). Tries at most every 30 s unless [force].
   */
  fun connect(ctx: Context, force: Boolean = false, timeoutMs: Long = 8_000): Boolean {
    if (isConnected()) return true
    if (!isPaired(ctx)) return false
    val now = System.currentTimeMillis()
    if (!force && now - lastTry < RETRY_AFTER_MS) return false
    lastTry = now
    if (!wirelessOn(ctx)) {
      if (!canAutoStart(ctx) || !onWifi(ctx)) return false
      try {
        Settings.Global.putInt(ctx.contentResolver, "adb_wifi_enabled", 1)
        Thread.sleep(1_500) // adbd announces its port shortly after
      } catch (e: Exception) {
        return false
      }
    }
    val ok = try {
      manager(ctx).connectTls(ctx, timeoutMs)
    } catch (e: AdbPairingRequiredException) {
      // The phone forgot us ("Forget all devices" / revoke): pair again.
      sp(ctx).edit().putBoolean(KEY_PAIRED, false).commit()
      false
    } catch (e: Exception) {
      false
    }
    if (ok) {
      // So next time (a restart, Wi-Fi back) CantosHub can switch Wireless debugging on itself.
      if (!canAutoStart(ctx)) exec(ctx, listOf("pm", "grant", ctx.packageName, "android.permission.WRITE_SECURE_SETTINGS"))
      onChange?.invoke()
    }
    return ok
  }

  /** Connect in the background (app start, boot, Wi-Fi back), then let the app catch up. */
  fun connectAsync(ctx: Context, force: Boolean = false, then: (() -> Unit)? = null) {
    val app = ctx.applicationContext
    Thread {
      if (connect(app, force)) then?.invoke()
    }.apply { isDaemon = true }.start()
  }

  fun disconnect() {
    try {
      synchronized(lock) { manager }?.disconnect()
    } catch (e: Exception) {
    }
    onChange?.invoke()
  }

  /**
   * Blocking: run [command] as shell. Output (stdout + stderr) like the Shizuku service,
   * with "ERR: " in front when it exits non-zero; null when there's no connection.
   */
  fun exec(ctx: Context, command: List<String>): String? {
    if (!isConnected()) return null
    val line = command.joinToString(" ") { quote(it) } + "; echo \"$EXIT_MARK\$?\""
    return try {
      val text = manager(ctx).openStream("shell:$line").use { stream ->
        val buf = ByteArrayOutputStream()
        stream.openInputStream().use { it.copyTo(buf) }
        buf.toString("UTF-8")
      }
      val at = text.lastIndexOf(EXIT_MARK)
      if (at < 0) return text.trim()
      val code = text.substring(at + EXIT_MARK.length).trim().toIntOrNull() ?: 0
      val out = text.substring(0, at).trim()
      if (code != 0) "ERR: $out" else out
    } catch (e: Exception) {
      // The connection broke (Wireless debugging off, Wi-Fi gone): reconnect next time.
      if (!isConnected()) onChange?.invoke()
      null
    }
  }

  private fun quote(s: String) = "'" + s.replace("'", "'\\''") + "'"

  // --- Identity: an RSA key and a self-signed certificate, made once and kept private ---

  private fun loadOrCreateIdentity(ctx: Context): Pair<PrivateKey, Certificate> {
    val dir = File(ctx.filesDir, "adb").apply { mkdirs() }
    val keyFile = File(dir, "key.pk8")
    val certFile = File(dir, "cert.der")
    if (keyFile.exists() && certFile.exists()) {
      try {
        val key = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(keyFile.readBytes()))
        val cert = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(certFile.readBytes()))
        return key to cert
      } catch (e: Exception) {
        // Damaged: make a new identity (pairing again is needed).
        sp(ctx).edit().putBoolean(KEY_PAIRED, false).commit()
      }
    }
    val kp = KeyPairGenerator.getInstance("RSA").apply { initialize(2048, SecureRandom()) }.generateKeyPair()
    val der = selfSignedCert(kp)
    keyFile.writeBytes(kp.private.encoded)
    certFile.writeBytes(der)
    return kp.private to CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der))
  }

  /** A minimal self-signed X.509 v3 certificate (DER), SHA256withRSA, "CN=CantosHub". */
  private fun selfSignedCert(kp: java.security.KeyPair): ByteArray {
    val sha256Rsa = byteArrayOf(0x06, 0x09, 0x2A, 0x86.toByte(), 0x48, 0x86.toByte(), 0xF7.toByte(), 0x0D, 0x01, 0x01, 0x0B)
    val algId = seq(sha256Rsa, byteArrayOf(0x05, 0x00))
    val cn = byteArrayOf(0x06, 0x03, 0x55, 0x04, 0x03)
    val name = seq(tlv(0x31, seq(cn, tlv(0x0C, "CantosHub".toByteArray()))))
    val fmt = SimpleDateFormat("yyMMddHHmmss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    val from = Date(System.currentTimeMillis() - 24L * 3600 * 1000)
    val to = fmt.parse("491231235959Z") ?: Date()
    val validity = seq(tlv(0x17, fmt.format(from).toByteArray()), tlv(0x17, fmt.format(to).toByteArray()))
    val serial = tlv(0x02, BigInteger(63, SecureRandom()).add(BigInteger.ONE).toByteArray())
    val version = tlv(0xA0, tlv(0x02, byteArrayOf(0x02)))
    val tbs = seq(version, serial, algId, name, validity, name, kp.public.encoded)
    val sig = Signature.getInstance("SHA256withRSA").run {
      initSign(kp.private)
      update(tbs)
      sign()
    }
    return seq(tbs, algId, tlv(0x03, byteArrayOf(0x00) + sig))
  }

  private fun seq(vararg parts: ByteArray) = tlv(0x30, parts.fold(ByteArray(0)) { a, b -> a + b })

  private fun tlv(tag: Int, content: ByteArray): ByteArray {
    val n = content.size
    val len = when {
      n < 0x80 -> byteArrayOf(n.toByte())
      n < 0x100 -> byteArrayOf(0x81.toByte(), n.toByte())
      n < 0x10000 -> byteArrayOf(0x82.toByte(), (n shr 8).toByte(), n.toByte())
      else -> byteArrayOf(0x83.toByte(), (n shr 16).toByte(), (n shr 8).toByte(), n.toByte())
    }
    return byteArrayOf(tag.toByte()) + len + content
  }
}
