package com.vil3ntec.rawrec

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager

/**
 * Debug builds only — the end-to-end test's hand on the app (adb shell am start … --es do X):
 *  live  (--es url … --es key …): the stream set to that server, then started as the app starts it
 *  rec   : the «⏺» of the floating circle (the clean recording beside the stream)
 *  stop  : the stream ended as from the app
 *  log   : the app's report log to logcat (tag RAWREC_E2E)
 * The screen shows a moving picture with a frame counter, so the stream has real motion to carry.
 */
class E2EActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(Moving(this))
        handle(intent)
    }

    override fun onNewIntent(i: Intent) { super.onNewIntent(i); handle(i) }

    private fun handle(i: Intent) {
        when (i.getStringExtra("do")) {
            "live" -> {
                val p = 5   // «other server»
                for (k in LiveSettings.PLATFORMS.indices) LiveSettings.setOn(this, k, false)
                LiveSettings.setPlatform(this, p)
                LiveSettings.setUrl(this, p, i.getStringExtra("url") ?: "")
                LiveSettings.setKey(this, p, i.getStringExtra("key") ?: "")
                LiveSettings.setOn(this, p, true)
                LiveSettings.setAutoQuality(this, true)
                i.getStringExtra("quality")?.toIntOrNull()?.let { LiveSettings.setQuality(this, it) }
                RecLog.clear(this)
                @Suppress("DEPRECATION")
                startActivityForResult(getSystemService(MediaProjectionManager::class.java)!!.createScreenCaptureIntent(), 1)
            }
            "rec" -> startService(Intent(this, RecordService::class.java).setAction(RecordService.ACTION_REC_TOGGLE))
            "stop" -> startService(Intent(this, RecordService::class.java).setAction(RecordService.ACTION_STOP).putExtra(RecordService.EXTRA_SRC, RecordService.SRC_APP))
            "log" -> RecLog.text(this).lines().forEach { Log.i("RAWREC_E2E", it) }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(req: Int, code: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(req, code, data)
        Log.i("RAWREC_E2E", "projection result $code")
        if (code != RESULT_OK || data == null) return
        val prefs = getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)
        val svc = Intent(this, RecordService::class.java).setAction(RecordService.ACTION_START)
        LiveSettings.config(this, RecordConfig.fromPrefs(prefs), false).putInto(svc)
        svc.putExtra(RecordService.EXTRA_CODE, code)
        svc.putExtra(RecordService.EXTRA_DATA, data)
        val ds = LiveSettings.destinations(this)
        svc.putExtra(RecordService.EXTRA_LIVE_URL, ds.first().url)
        svc.putExtra(RecordService.EXTRA_LIVE_KEY, ds.first().key)
        svc.putExtra(RecordService.EXTRA_LIVE_NAME, ds.first().name)
        svc.putExtra(RecordService.EXTRA_LIVE_URLS, ds.map { it.url }.toTypedArray())
        svc.putExtra(RecordService.EXTRA_LIVE_KEYS, ds.map { it.key }.toTypedArray())
        svc.putExtra(RecordService.EXTRA_LIVE_NAMES, ds.map { it.name }.toTypedArray())
        startForegroundService(svc)
    }

    /** Moving bars, a sweeping box and a frame counter: motion for the encoder, a clock for the viewer. */
    private class Moving(ctx: Context) : View(ctx) {
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private var n = 0
        override fun onDraw(c: Canvas) {
            n++
            val w = width.toFloat(); val h = height.toFloat()
            for (k in 0 until 12) {
                p.color = Color.HSVToColor(floatArrayOf(((k * 30 + n * 2) % 360).toFloat(), 0.7f, 0.9f))
                c.drawRect(k * w / 12, 0f, (k + 1) * w / 12, h, p)
            }
            p.color = Color.WHITE
            val x = (n * 7 % w.toInt()).toFloat()
            c.drawRect(x, h * 0.35f, x + w * 0.1f, h * 0.65f, p)
            p.color = Color.BLACK; p.textSize = h / 8
            c.drawText("frame $n", w * 0.05f, h * 0.2f, p)
            postInvalidateOnAnimation()
        }
    }
}
