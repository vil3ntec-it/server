package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import kotlin.math.abs

/**
 * «دکمهٔ شناورِ ضبط»: while RawRec is NOT recording, a small round record button floats at the
 * screen's edge — over a game too — so a recording starts with one tap without leaving the game
 * (the owner: «توی خودِ بازی سریع ریکورد بزنم»). Tap: Android's own «start recording?» dialog over
 * the game (QuickStartActivity), then the recording. Drag: move it (it sticks to the nearest side).
 * Long press: open RawRec.
 *
 * It is never in a video: it is taken off the screen before the recording starts and comes back
 * after. Not shown while RawRec itself is open. Main thread only.
 */
object IdleBubble {
    const val PREF = "c_bubble"
    private var view: View? = null
    private var lp: WindowManager.LayoutParams? = null
    private val main = Handler(Looper.getMainLooper())

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)

    fun enabled(ctx: Context): Boolean = SafePrefs.bool(prefs(ctx), PREF, true)

    fun setEnabled(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(PREF, on).apply()
        if (!on) hide(ctx)
    }

    fun show(ctx0: Context) {
        val ctx = ctx0.applicationContext
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post { show(ctx) }; return }
        try {
            if (view != null || !enabled(ctx) || RecordService.state != RecordService.State.IDLE) return
            if (!Settings.canDrawOverlays(ctx)) return
            val wm = ctx.getSystemService(WindowManager::class.java) ?: return
            val d = ctx.resources.displayMetrics.density
            fun dp(v: Int) = (v * d).toInt()
            val size = dp(52)
            val root = FrameLayout(ctx).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Color.argb(200, 24, 26, 30))
                    setStroke(dp(2), Color.argb(90, 255, 255, 255))
                }
                contentDescription = ctx.getString(R.string.bubble_start)
                tag = "bubble"
                alpha = 0.9f
            }
            root.addView(ImageView(ctx).apply {
                setImageResource(R.drawable.eng_ic_rec)
                setColorFilter(ctx.getColor(R.color.eng_rec_red))
            }, FrameLayout.LayoutParams(dp(30), dp(30), Gravity.CENTER))
            val p = prefs(ctx)
            val right = SafePrefs.bool(p, "bubble_right", true)
            val fy = SafePrefs.float(p, "bubble_fy", 0.42f).coerceIn(0f, 1f)
            val screen = DisplayInfo.read(ctx)
            val l = WindowManager.LayoutParams(
                size, size,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.LEFT
                x = if (right) (screen.width - size).coerceAtLeast(0) else 0
                y = (fy * (screen.height - size).coerceAtLeast(0)).toInt()
            }
            attachTouch(ctx, wm, root, l, size)
            wm.addView(root, l)
            view = root; lp = l
        } catch (_: Throwable) {
            view = null; lp = null
        }
    }

    fun hide(ctx0: Context) {
        val ctx = ctx0.applicationContext
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post { hide(ctx) }; return }
        val v = view ?: return
        view = null; lp = null
        try { ctx.getSystemService(WindowManager::class.java)?.removeView(v) } catch (_: Throwable) {}
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun attachTouch(ctx: Context, wm: WindowManager, v: View, l: WindowManager.LayoutParams, size: Int) {
        val slop = ViewConfiguration.get(ctx).scaledTouchSlop
        val longMs = ViewConfiguration.getLongPressTimeout().toLong()
        var rx = 0f; var ry = 0f; var x0 = 0; var y0 = 0; var moved = false; var longDone = false
        val long = Runnable {
            longDone = true
            hide(ctx)
            try {
                ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
            } catch (_: Throwable) {}
        }
        v.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    rx = e.rawX; ry = e.rawY; x0 = l.x; y0 = l.y; moved = false; longDone = false
                    v.alpha = 1f
                    main.postDelayed(long, longMs)
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - rx; val dy = e.rawY - ry
                    if (!moved && (abs(dx) > slop || abs(dy) > slop)) { moved = true; main.removeCallbacks(long) }
                    if (moved) {
                        l.x = x0 + dx.toInt(); l.y = y0 + dy.toInt()
                        try { wm.updateViewLayout(v, l) } catch (_: Throwable) {}
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    main.removeCallbacks(long)
                    v.alpha = 0.9f
                    if (moved) {
                        val s = DisplayInfo.read(ctx)
                        val right = l.x + size / 2 > s.width / 2
                        l.x = if (right) (s.width - size).coerceAtLeast(0) else 0
                        val fy = (l.y.toFloat() / (s.height - size).coerceAtLeast(1)).coerceIn(0f, 1f)
                        prefs(ctx).edit().putBoolean("bubble_right", right).putFloat("bubble_fy", fy).apply()
                        try { wm.updateViewLayout(v, l) } catch (_: Throwable) {}
                    } else if (!longDone && e.actionMasked == MotionEvent.ACTION_UP) {
                        // One tap: Android's dialog over the game, then the recording.
                        hide(ctx)
                        try { ctx.startActivity(QuickStartActivity.intent(ctx)) } catch (_: Throwable) { show(ctx) }
                    }
                }
            }
            true
        }
    }
}
