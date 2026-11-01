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
        val prefs = getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)
        // Settings not yet brought up to date by this version: RawRec does it on its first start.
        if (SafePrefs.int(prefs, "cfg_ver", 0) < 4) { viaApp(); return }
        val c = RecordConfig.saved(prefs)
        val missing = (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && !SafePrefs.bool(prefs, "asked_" + Manifest.permission.POST_NOTIFICATIONS, false)) ||
            (c.hasAudio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED && !SafePrefs.bool(prefs, "asked_" + Manifest.permission.RECORD_AUDIO, false)) ||
            (c.facecam > 0 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) ||
            (c.wantsOverlay && !Settings.canDrawOverlays(this)) ||
            (c.gameMode && Build.VERSION.SDK_INT >= 34)   // «حالتِ بازی» explains what to pick in the dialog first
        if (missing) { viaApp(); return }
        if (Storage.free(this) < Storage.RESERVE + 200L * 1024 * 1024) { viaApp(); return }
        cfg = c
        val mpm = getSystemService(MediaProjectionManager::class.java) ?: run { viaApp(); return }
        // Android 14+: the whole screen straight away — one tap in the dialog instead of two.
        val ask = if (Build.VERSION.SDK_INT >= 34) mpm.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        else mpm.createScreenCaptureIntent()
        @Suppress("DEPRECATION") startActivityForResult(ask, REQ)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ && resultCode == RESULT_OK && data != null) {
            try {
                val c = cfg ?: RecordConfig.saved(getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE))
                val svc = Intent(this, RecordService::class.java).setAction(RecordService.ACTION_START)
                c.putInto(svc)
                svc.putExtra(RecordService.EXTRA_CODE, resultCode)
                svc.putExtra(RecordService.EXTRA_DATA, data)
                startForegroundService(svc)
            } catch (_: Throwable) {}
        }
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
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
