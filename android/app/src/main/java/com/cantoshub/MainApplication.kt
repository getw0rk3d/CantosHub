package com.cantoshub

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import rikka.shizuku.Shizuku

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(CantosHubPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    AdbShell.init(this)
    // Shizuku came back (or was already running).
    try {
      Shizuku.addBinderReceivedListenerSticky { onShellReady(this) }
    } catch (e: Exception) { }
    // The built-in connection isn't opened here: it connects only when a command needs it
    // (each connection pops Android's "Wireless debugging connected" alert). Only work that's
    // owed - a stuck top bar, a boost's leftovers - runs now, and that connects by itself.
    if (AdbShell.isPaired(this)) onShellReady(this)
    watchWifi()
  }

  /**
   * Wireless debugging switches itself off when Wi-Fi drops. When Wi-Fi comes back, catch up
   * on owed work only - not a reconnect on every Wi-Fi blip (mesh roaming made the alert pop
   * again and again).
   */
  private fun watchWifi() {
    try {
      val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
      cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
        private var onWifi = AdbShell.onWifi(this@MainApplication)

        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
          val wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
          val paired = AdbShell.isPaired(this@MainApplication)
          if (paired && wifi && !onWifi) onShellReady(this@MainApplication)
          if (paired && wifi != onWifi) AdbShell.onChange?.invoke() // the app's PRO status follows
          onWifi = wifi
        }

        override fun onLost(network: Network) {
          if (onWifi) AdbShell.onChange?.invoke()
          onWifi = false
        }
      })
    } catch (e: Exception) { }
  }

  companion object {
    /**
     * A shell is available again (Shizuku or built-in): give back a top bar Kids lock left
     * off, undo frozen apps / lowered resolution a boost left, and lock the bar again if
     * Kids Mode is on.
     */
    fun onShellReady(ctx: Context) {
      KidsService.releaseBar(ctx)
      KidsService.restorePip(ctx)
      BoostService.undoLeftovers(ctx)
      KidsService.instance?.reapplyLock()
      HiddenApps.rehideClosed(ctx)
    }
  }
}
