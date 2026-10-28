package com.cantoshub

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import io.github.muntashirakon.adb.android.AdbMdns

/**
 * One-time pairing with Wireless debugging, while the parent is in Settings. Android shows
 * the 6-digit code in a dialog that closes as soon as you leave it, so the code is typed into
 * this notification's reply box instead (pull down the shade over the dialog). The pairing
 * port is found on the local network (mDNS) while that dialog is open.
 */
class AdbPairingService : Service() {
  companion object {
    const val ACTION_START = "com.cantoshub.adb.PAIR_START"
    const val ACTION_CODE = "com.cantoshub.adb.PAIR_CODE"
    const val ACTION_STOP = "com.cantoshub.adb.PAIR_STOP"
    private const val KEY_CODE = "code"
    private const val CHANNEL_ID = "cantoshub_pairing"
    private const val NOTIF_ID = 7343
    private const val GIVE_UP_MS = 10 * 60_000L

    /** For the app: idle, searching, ready (code can be typed), pairing, connected, failed. */
    @Volatile
    var state = "idle"
      private set

    fun start(ctx: Context) {
      val i = Intent(ctx, AdbPairingService::class.java).setAction(ACTION_START)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
    }

    fun stop(ctx: Context) {
      ctx.startService(Intent(ctx, AdbPairingService::class.java).setAction(ACTION_STOP))
    }
  }

  private val main = Handler(Looper.getMainLooper())
  private var mdns: AdbMdns? = null
  @Volatile private var host: String? = null
  @Volatile private var port = -1
  private val giveUp = Runnable { finish() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createChannel()
    when (intent?.action) {
      ACTION_STOP -> {
        startForegroundCompat(build("Stopping", "", false))
        finish()
      }
      ACTION_CODE -> {
        val code = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(KEY_CODE)?.toString()?.filter { it.isDigit() } ?: ""
        onCode(code)
      }
      else -> begin()
    }
    return START_NOT_STICKY
  }

  private fun begin() {
    state = "searching"
    startForegroundCompat(searching())
    mdns?.stop()
    mdns = AdbMdns(this, AdbMdns.SERVICE_TYPE_TLS_PAIRING) { address, p ->
      if (address != null && p > 0) {
        host = address.hostAddress
        port = p
        if (state == "searching" || state == "failed") {
          state = "ready"
          notifyNow(enterCode("Pairing code", "Type the 6-digit code shown under Pair device with pairing code."))
        }
      }
    }.also { it.start() }
    main.removeCallbacks(giveUp)
    main.postDelayed(giveUp, GIVE_UP_MS)
  }

  private fun onCode(code: String) {
    val h = host
    val p = port
    if (code.length != 6) {
      notifyNow(enterCode("Pairing code", "The code has 6 digits. Type it again."))
      return
    }
    if (h == null || p <= 0) {
      notifyNow(enterCode("Open the pairing code first", "In Wireless debugging tap Pair device with pairing code, then type the code here."))
      return
    }
    state = "pairing"
    notifyNow(build("Pairing…", "Connecting CantosHub to Wireless debugging", false))
    Thread {
      val paired = AdbShell.pair(this, h, p, code)
      if (!paired) {
        state = "failed"
        port = -1 // a wrong code closes that dialog; wait for the next one
        notifyNow(enterCode("That didn't work", "Tap Pair device with pairing code again for a new code, then type it here."))
        return@Thread
      }
      notifyNow(build("Paired", "Connecting…", false))
      val connected = AdbShell.connect(this, force = true, timeoutMs = 12_000)
      state = if (connected) "connected" else "failed"
      notifyNow(
        if (connected) {
          build("CantosHub is connected ✓", "PRO features are on. You can close Settings.", false)
        } else {
          build("Paired, not connected yet", "Keep Wireless debugging on and tap Reconnect in CantosHub.", false)
        },
      )
      main.postDelayed({ finish() }, if (connected) 5_000 else 15_000)
    }.apply { isDaemon = true }.start()
  }

  private fun finish() {
    main.removeCallbacks(giveUp)
    try {
      mdns?.stop()
    } catch (e: Exception) {
    }
    mdns = null
    if (state != "connected") state = "idle"
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    main.removeCallbacks(giveUp)
    try {
      mdns?.stop()
    } catch (e: Exception) {
    }
    super.onDestroy()
  }

  private fun searching() = build(
    "Pair CantosHub with Wireless debugging",
    "Turn on Wireless debugging, then tap Pair device with pairing code.",
    false,
  )

  private fun enterCode(title: String, text: String) = build(title, text, true)

  private fun build(title: String, text: String, withReply: Boolean): Notification {
    val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else @Suppress("DEPRECATION") Notification.Builder(this)
    b.setContentTitle(title)
      .setContentText(text)
      .setStyle(Notification.BigTextStyle().bigText(text))
      .setSmallIcon(R.drawable.ic_tile_boost)
      .setOngoing(true)
      .setOnlyAlertOnce(false)
    if (withReply) {
      val reply = PendingIntent.getService(
        this,
        11,
        Intent(this, AdbPairingService::class.java).setAction(ACTION_CODE),
        PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0),
      )
      val input = RemoteInput.Builder(KEY_CODE).setLabel("6-digit code").build()
      b.addAction(
        Notification.Action.Builder(null, "Enter code", reply).addRemoteInput(input).build(),
      )
    }
    val stopPi = PendingIntent.getService(
      this,
      12,
      Intent(this, AdbPairingService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    b.addAction(Notification.Action.Builder(null, "Cancel", stopPi).build())
    return b.build()
  }

  private fun notifyNow(n: Notification) {
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIF_ID, n)
  }

  private fun startForegroundCompat(n: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIF_ID, n)
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) == null) {
      // High importance: it pops up over Settings, where the code is.
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Wireless debugging pairing", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "The pairing code box while CantosHub pairs with Wireless debugging"
        },
      )
    }
  }
}
