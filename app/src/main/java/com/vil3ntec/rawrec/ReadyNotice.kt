package com.vil3ntec.rawrec

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon

/**
 * «اعلانِ ضبطِ سریع»: a small notification that stays in the shade while RawRec is idle, so a
 * recording can start at any moment (in a game too) without looking for the app. «ضبط» starts it
 * over the game (QuickStartActivity): only Android's own «start recording?» dialog appears.
 * Taken away while recording (the recording notification is there then) and put back after.
 */
object ReadyNotice {
    private const val CH = "ready"
    private const val ID = 3
    const val PREF = "c_ready"

    fun enabled(ctx: Context): Boolean =
        SafePrefs.bool(ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE), PREF, true)

    fun setEnabled(ctx: Context, on: Boolean) {
        ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE).edit().putBoolean(PREF, on).apply()
        if (on) show(ctx) else hide(ctx)
    }

    fun show(ctx: Context) {
        try {
            if (!enabled(ctx) || RecordService.state != RecordService.State.IDLE) return
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
            nm.createNotificationChannel(NotificationChannel(CH, ctx.getString(R.string.ch_ready), NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            })
            // Straight from the game: only Android's dialog appears over it (QuickStartActivity).
            val start = PendingIntent.getActivity(ctx, 11, QuickStartActivity.intent(ctx),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = Notification.Builder(ctx, CH)
                .setSmallIcon(R.drawable.eng_ic_rec)
                .setColor(ctx.getColor(R.color.eng_rec_red))
                .setContentTitle(ctx.getString(R.string.n_ready_title))
                .setContentText(ctx.getString(R.string.n_ready_text))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(start)
                .addAction(Notification.Action.Builder(Icon.createWithResource(ctx, R.drawable.eng_ic_rec), ctx.getString(R.string.n_record), start).build())
                .build()
            nm.notify(ID, n)
        } catch (_: Exception) {}
    }

    fun hide(ctx: Context) {
        try { ctx.getSystemService(NotificationManager::class.java)?.cancel(ID) } catch (_: Exception) {}
    }
}

/** After a restart of the phone or an update of RawRec the ready notification comes back by itself. */
class ReadyBootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> { ReadyNotice.show(ctx); IdleBubble.show(ctx) }
        }
    }
}
