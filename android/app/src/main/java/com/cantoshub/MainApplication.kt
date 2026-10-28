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
    // Shizuku came back (or was already running), or the built-in connection is up.
    try {
      Shizuku.addBinderReceivedListenerSticky { onShellReady(this) }
    } catch (e: Exception) { }
    if (AdbShell.isPaired(this)) {
      AdbShell.connectAsync(this, force = true) { onShellReady(this) }
      watchWifi()
    }
  }

  /**
   * Wireless debugging switches itself off when Wi-Fi drops; when Wi-Fi is back (and the
   * app is alive) CantosHub switches it on again and reconnects.
   */
  private fun watchWifi() {
    try {
      val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
      cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
          if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !AdbShell.isConnected()) {
            AdbShell.connectAsync(this@MainApplication) { onShellReady(this@MainApplication) }
          }
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
      BoostService.undoLeftovers(ctx)
      KidsService.instance?.reapplyLock()
    }
  }
}
