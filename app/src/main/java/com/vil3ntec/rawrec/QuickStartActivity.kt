package com.vil3ntec.rawrec

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings

/**
 * «ضبط» from the notification or the Quick Settings tile, **without leaving the game** (the owner:
 * «وسطِ بازی می‌رود توی برنامه، خب این چه کاری است»). An invisible activity: no window of its own,
 * only Android's own «start recording?» dialog over the game (Android asks before every recording;
 * no app can skip it). Then the recording starts and this activity is gone — the game stays in front.
 *
 * Whatever needs RawRec's screen (a permission still to grant, the very first start after an update)
 * goes the old way: RawRec opens and starts from there.
 */
class QuickStartActivity : Activity() {

    companion object {
        private const val REQ = 1
        fun intent(ctx: Context): Intent =
            Intent(ctx, QuickStartActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
    }

    private var cfg: RecordConfig? = null

    override fun attachBaseContext(newBase: Context) = super.attachBaseContext(AppLang.wrap(newBase))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) return   // the dialog's result comes to onActivityResult
        try { start() } catch (_: Throwable) { viaApp() }
    }

    private fun start() {
        if (RecordService.state != RecordService.State.IDLE) { finish(); return }
        IdleBubble.hide(this)
        val prefs = getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)
        // Settings not yet brought up to date by this version: RawRec does it on its first start.
        if (SafePrefs.int(prefs, "cfg_ver", 0) < 6) { viaApp(); return }
        val c = RecordConfig.saved(prefs)
        val missing = (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && !SafePrefs.bool(prefs, "asked_" + Manifest.permission.POST_NOTIFICATIONS, false)) ||
            (c.hasAudio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED && !SafePrefs.bool(prefs, "asked_" + Manifest.permission.RECORD_AUDIO, false)) ||
            (c.facecam > 0 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) ||
            (c.wantsOverlay && !Settings.canDrawOverlays(this))
        if (missing) { viaApp(); return }
        if (Storage.free(this) < Storage.RESERVE + 200L * 1024 * 1024) { viaApp(); return }
        // Always the whole screen from here, also with «حالتِ بازی»: Android's «one app» dialog is so
        // tall that on a landscape tablet its buttons end up under the navigation bar (the owner's
        // screenshot), and picking the app is three more taps in the middle of a game. The control
        // stays out of the video anyway («کنترل در ویدیو دیده نشود»).
        cfg = c.copy(gameMode = false)
        // «ضبطِ فوری»: the permission of the last recording is still held — no dialog at all.
        if (RecordService.instantReady) {
            startService(cfg!!, RESULT_OK, null)
            finish()
            @Suppress("DEPRECATION") overridePendingTransition(0, 0)
            return
        }
        val mpm = getSystemService(MediaProjectionManager::class.java) ?: run { viaApp(); return }
        // Android 14+: the short dialog — «لغو» / «شروع», one tap.
        val ask = if (Build.VERSION.SDK_INT >= 34) mpm.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        else mpm.createScreenCaptureIntent()
        @Suppress("DEPRECATION") startActivityForResult(ask, REQ)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ && resultCode == RESULT_OK && data != null) {
            try {
                val c = cfg ?: RecordConfig.saved(getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)).copy(gameMode = false)
                startService(c, resultCode, data)
            } catch (_: Throwable) {}
        } else IdleBubble.show(this)   // cancelled: the record button comes back
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    }

    private fun startService(c: RecordConfig, code: Int, data: Intent?) {
        val svc = Intent(this, RecordService::class.java).setAction(RecordService.ACTION_START)
        c.putInto(svc)
        svc.putExtra(RecordService.EXTRA_CODE, code)
        if (data != null) svc.putExtra(RecordService.EXTRA_DATA, data)
        startForegroundService(svc)
    }

    /** The old way: RawRec opens and starts the recording itself. */
    private fun viaApp() {
        try {
            startActivity(Intent(this, MainActivity::class.java).putExtra("autostart", true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        } catch (_: Throwable) {}
        finish()
    }
}
