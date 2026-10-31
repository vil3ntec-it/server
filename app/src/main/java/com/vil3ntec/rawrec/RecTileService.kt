package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** Quick Settings tile: tap to stop while recording, or open RawRec and start. */
class RecTileService : TileService() {

    override fun attachBaseContext(newBase: android.content.Context) = super.attachBaseContext(AppLang.wrap(newBase))

    override fun onStartListening() {
        super.onStartListening()
        val t = qsTile ?: return
        val rec = RecordService.isRecording
        t.state = if (rec) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        t.label = getString(if (rec) R.string.tile_stop else R.string.app_name)
        if (Build.VERSION.SDK_INT >= 29) t.subtitle = getString(if (rec) R.string.tile_sub_rec else R.string.tile_sub_idle)
        t.updateTile()
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        super.onClick()
        if (RecordService.isRecording) {
            stopRecording(RecordService.SRC_TILE)
            return
        }
        val i = Intent(this, MainActivity::class.java)
            .putExtra("autostart", true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(
                PendingIntent.getActivity(this, 5, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            )
        } else {
            @Suppress("DEPRECATION") startActivityAndCollapse(i)
        }
    }
}
