package com.cantoshub

import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Quick Settings tile: one tap toggles a boost using the favorite profile —
 * no need to open the app. Reflects whether a boost is currently running.
 */
class BoostTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    render(BoostService.isRunning)
  }

  override fun onClick() {
    super.onClick()
    val starting = !BoostService.isRunning
    val intent = Intent(this, BoostService::class.java)
    if (starting) {
      intent.action = BoostService.ACTION_START
      intent.putExtra(BoostService.EXTRA_PROFILE, QuickPrefs.getFavorite(this))
      intent.putExtra(BoostService.EXTRA_FREERAM, true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        startForegroundService(intent)
      } else {
        startService(intent)
      }
    } else {
      intent.action = BoostService.ACTION_STOP
      startService(intent)
    }
    render(starting) // optimistic; corrected on next onStartListening
  }

  private fun render(active: Boolean) {
    val tile = qsTile ?: return
    tile.state = if (active) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    tile.label = "Game Boost"
    tile.updateTile()
  }
}
