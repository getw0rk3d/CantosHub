package com.cantoshub

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView

/**
 * A tiny always-on-top HUD (battery / thermal / RAM / profile) drawn over games
 * via SYSTEM_ALERT_WINDOW. Owner-granted overlay permission, no root. WindowManager
 * touches must happen on the main thread, so everything is posted there.
 */
class OverlayHud(private val ctx: Context) {
  private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val main = Handler(Looper.getMainLooper())
  private var view: TextView? = null

  fun show() {
    main.post {
      if (view != null || !Settings.canDrawOverlays(ctx)) return@post
      val tv = TextView(ctx).apply {
        setBackgroundColor(Color.argb(170, 0, 0, 0))
        setTextColor(Color.parseColor("#00E5A0"))
        textSize = 11f
        setPadding(20, 10, 20, 10)
        text = "CantosHub"
      }
      val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION")
        WindowManager.LayoutParams.TYPE_PHONE
      }
      val lp = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        type,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
          WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
      )
      lp.gravity = Gravity.TOP or Gravity.START
      lp.x = 24
      lp.y = 120
      try {
        wm.addView(tv, lp)
        view = tv
      } catch (e: Exception) {
        view = null
      }
    }
  }

  fun update(text: String) {
    main.post { view?.text = text }
  }

  fun hide() {
    main.post {
      view?.let {
        try {
          wm.removeView(it)
        } catch (e: Exception) {
        }
      }
      view = null
    }
  }
}
