package com.cantoshub

import android.app.Application
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
    // Shizuku came back (or was already running): give back a top bar Kids lock left off, and
    // undo frozen apps / lowered resolution a boost left when Shizuku was gone.
    try {
      Shizuku.addBinderReceivedListenerSticky {
        KidsService.releaseBar(this)
        BoostService.undoLeftovers(this)
      }
    } catch (e: Exception) { }
  }
}
