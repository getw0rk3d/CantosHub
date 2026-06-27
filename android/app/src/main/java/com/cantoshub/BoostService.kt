package com.cantoshub

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import org.json.JSONObject

/**
 * Foreground service that holds a boost active. This is the legitimate,
 * owner-visible way to "run in the background": a persistent notification +
 * START_STICKY. While alive it applies the profile's tweaks and restores the
 * originals when stopped. It is also where Phase 1+ will watch the foreground
 * game (UsageStats) and auto-apply per-game profiles.
 */
class BoostService : Service() {
  companion object {
    const val ACTION_START = "com.cantoshub.action.START"
    const val ACTION_STOP = "com.cantoshub.action.STOP"
    const val EXTRA_PROFILE = "profile"
    private const val CHANNEL_ID = "cantoshub_boost"
    private const val NOTIF_ID = 7341

    @Volatile
    var isRunning = false
      private set
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopBoost()
        return START_NOT_STICKY
      }
      else -> startBoost(intent?.getStringExtra(EXTRA_PROFILE) ?: "{}")
    }
    return START_STICKY
  }

  private fun startBoost(profileJson: String) {
    createChannel()
    val profile = try { JSONObject(profileJson) } catch (e: Exception) { JSONObject() }
    startForegroundCompat(buildNotification(profile.optString("name", "Boost")))
    isRunning = true
    try { BoostActions.applyProfile(this, profile) } catch (e: Exception) { }
  }

  private fun stopBoost() {
    try { BoostActions.revert(this) } catch (e: Exception) { }
    isRunning = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    if (isRunning) {
      try { BoostActions.revert(this) } catch (e: Exception) { }
      isRunning = false
    }
    super.onDestroy()
  }

  private fun startForegroundCompat(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIF_ID, notification)
    }
  }

  private fun buildNotification(profileName: String): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("CantosHub boost active")
      .setContentText("Profile: $profileName")
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setOngoing(true)
      .build()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL_ID) == null) {
        val channel = NotificationChannel(
          CHANNEL_ID,
          "Game Boost",
          NotificationManager.IMPORTANCE_LOW,
        )
        channel.description = "Shows while a boost profile is active"
        nm.createNotificationChannel(channel)
      }
    }
  }
}
