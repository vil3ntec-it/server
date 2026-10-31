package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Outline
import android.graphics.PixelFormat
import android.graphics.SurfaceTexture
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.SessionConfiguration
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Range
import android.util.Size
import android.view.Display
import android.view.Gravity
import android.view.MotionEvent
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.max

private fun overlayParams(sizePx: Int, x: Int, y: Int) = WindowManager.LayoutParams(
    sizePx, sizePx,
    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
    PixelFormat.TRANSLUCENT,
).apply { gravity = Gravity.TOP or Gravity.LEFT; this.x = x; this.y = y }

/**
 * Every overlay window of the app is added and removed through here, so a stop, an error or the
 * service ending can take all of them off the screen ([removeAll]); none can be left behind
 * invisible and still taking touches. Main thread only.
 */
object OverlayWindows {
    private val views = LinkedHashSet<View>()

    /** Throws like WindowManager.addView (e.g. the overlay permission was taken away). */
    fun add(wm: WindowManager?, v: View, lp: WindowManager.LayoutParams) {
        requireNotNull(wm) { "no WindowManager" }
        if (v in views || v.isAttachedToWindow) remove(wm, v)
        wm.addView(v, lp)
        views += v
    }

    fun update(wm: WindowManager?, v: View, lp: WindowManager.LayoutParams) {
        if (v in views) try { wm?.updateViewLayout(v, lp) } catch (_: Exception) {}
    }

    fun remove(wm: WindowManager?, v: View) {
        val ours = views.remove(v)
        if (ours || v.isAttachedToWindow) try { wm?.removeView(v) } catch (_: Exception) {}
    }

    fun removeAll(ctx: Context) {
        val wm = ctx.getSystemService(WindowManager::class.java)
        for (v in views.toList()) remove(wm, v)
    }

    val count: Int get() = views.size
}

/**
 * Keeps an overlay at the same relative spot (fractions of the free space) so it lands in the
 * right place after a rotation instead of off-screen, and remembers the spot between recordings.
 */
private class Placer(
    private val ctx: Context,
    private val key: String,
    private val wm: WindowManager?,
    private val view: View,
    private val lp: WindowManager.LayoutParams,
    private val size: Int,
    defFx: Float,
    defFy: Float,
) {
    private val prefs = ctx.getSharedPreferences("rawrec", Context.MODE_PRIVATE)
    var fx = SafePrefs.float(prefs, key + "_fx", defFx)
    var fy = SafePrefs.float(prefs, key + "_fy", defFy)

    private fun screen(): Pair<Int, Int> = DisplayInfo.read(ctx).let { it.width to it.height }

    fun place() {
        val (w, h) = screen()
        lp.x = (fx.coerceIn(0f, 1f) * max(0, w - size)).toInt()
        lp.y = (fy.coerceIn(0f, 1f) * max(0, h - size)).toInt()
    }

    fun moveTo(x: Int, y: Int) {
        val (w, h) = screen()
        lp.x = x.coerceIn(0, max(0, w - size))
        lp.y = y.coerceIn(0, max(0, h - size))
        update()
    }

    fun remember() {
        val (w, h) = screen()
        fx = lp.x.toFloat() / max(1, w - size)
        fy = lp.y.toFloat() / max(1, h - size)
        prefs.edit().putFloat(key + "_fx", fx).putFloat(key + "_fy", fy).apply()
    }

    fun reapply() { place(); update() }

    fun update() = OverlayWindows.update(wm, view, lp)
}

/**
 * The floating recording control: a small dark-glass panel on the screen edge with icon buttons.
 *
 *  ┌──────────────────┐
 *  │ ⠿  ● 0:12     —  │  header: drag handle, pulsing red dot + elapsed time, minimize.
 *  │  ■        ❚❚     │  Drag the header to move (it snaps to the nearest side); tap it to
 *  │  🎤       📷     │  shrink the panel to a small dot. Tap the dot to open it again.
 *  │  🗑       👁     │  stop, pause / resume, microphone, face cam, delete (tap twice), hide.
 *  └──────────────────┘
 *
 * Everything that takes a touch is drawn: there is no invisible state and no hidden gesture (1.4's
 * «invisible while recording» kept an empty window that swallowed taps and stopped or paused the
 * recording on a double-tap / long-press nobody could see). The panel is in a full-screen video,
 * so it is small, translucent and shrinks to the dot 5 s after the last touch; «hide» removes it
 * completely (stop then from the notification, the Quick Settings tile or shake-to-stop).
 *
 * [startMinimized]: go to the dot as soon as the recording starts.
 */
class FloatingControl(
    private val ctx: Context,
    private val startMinimized: Boolean,
    private val actions: Actions,
) {
    interface Actions {
        fun stop()
        fun pauseToggle()
        fun micToggle()
        fun camToggle()
        fun delete()
        /** «پنهان کردن»: take the control off the screen; the notification can bring it back. */
        fun hideControl() {}
    }

    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val res = ctx.resources
    private fun px(id: Int) = res.getDimensionPixelSize(id)
    private val density = res.displayMetrics.density
    private fun dp(v: Int) = (v * density).toInt()
    private val main = Handler(Looper.getMainLooper())
    private val prefs = ctx.getSharedPreferences("rawrec", Context.MODE_PRIVATE)
    private val red = ctx.getColor(R.color.eng_rec_red)
    private val amber = ctx.getColor(R.color.eng_paused)
    private val btnFill = ctx.getColor(R.color.eng_btn)

    private val lp = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
        PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.LEFT; title = "RawRec control" }

    private fun glass(radius: Float) = GradientDrawable().apply {
        cornerRadius = radius
        setColor(ctx.getColor(R.color.eng_glass))
        setStroke(dp(1), ctx.getColor(R.color.eng_glass_stroke))
    }

    private fun recDotDrawable() = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(red) }

    /** The window's only child: the open panel or the small dot. */
    val root = FrameLayout(ctx)

    private val panel = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        val p = px(R.dimen.eng_ctl_pad)
        setPadding(p, p, p, p)
        background = glass(px(R.dimen.eng_ctl_radius).toFloat())
        tag = "pill"
    }

    // Header: drag handle · pulsing record dot · elapsed time · minimize. One touch target.
    private val recDot = View(ctx).apply { background = recDotDrawable(); tag = "pill:recDot" }
    private val timerText = TextView(ctx).apply {
        setTextColor(Color.WHITE)
        textSize = 13f
        setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
        gravity = Gravity.CENTER_VERTICAL
        textDirection = View.TEXT_DIRECTION_LTR
        maxLines = 1
        text = "0:00"
    }
    val timer: LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        tag = "pill:timer"
        isClickable = true
        isFocusable = true
        val ripple = android.graphics.drawable.RippleDrawable(
            android.content.res.ColorStateList.valueOf(ctx.getColor(R.color.eng_btn_ripple)), null,
            GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(Color.WHITE) },
        )
        background = ripple
        val grip = ImageView(ctx).apply {
            setImageResource(R.drawable.eng_ic_drag)
            imageTintList = android.content.res.ColorStateList.valueOf(Color.WHITE)
            alpha = 0.6f
            tag = "pill:handle"
        }
        addView(grip, LinearLayout.LayoutParams(dp(18), dp(18)).apply { marginStart = dp(2) })
        addView(recDot, LinearLayout.LayoutParams(px(R.dimen.eng_ctl_rec_dot), px(R.dimen.eng_ctl_rec_dot)).apply { marginStart = dp(4) })
        addView(timerText, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(6) })
        addView(ImageView(ctx).apply {
            setImageResource(R.drawable.eng_ic_minimize)
            imageTintList = android.content.res.ColorStateList.valueOf(Color.WHITE)
            alpha = 0.8f
            contentDescription = ctx.getString(R.string.eng_ctl_minimize)
            tag = "pill:minimize"
        }, LinearLayout.LayoutParams(dp(20), dp(20)).apply { marginEnd = dp(4) })
    }

    val stop = round(R.drawable.eng_ic_stop, "pill:stop", fill = ctx.getColor(R.color.eng_stop_fill))
    val pause = round(R.drawable.eng_ic_pause, "pill:pause")
    val mic = round(R.drawable.eng_ic_mic, "pill:mic")
    val cam = round(R.drawable.eng_ic_videocam, "pill:cam")
    val delete = round(R.drawable.eng_ic_delete, "pill:delete")
    val hideButton = round(R.drawable.eng_ic_hide, "pill:hide")

    // Minimized: a small glass circle with the record dot; tap opens, drag moves.
    private val dot = View(ctx).apply { background = recDotDrawable(); tag = "pill:dot" }
    private val dotFrame = FrameLayout(ctx).apply {
        background = glass(px(R.dimen.eng_ctl_dot) / 2f)
        addView(dot, FrameLayout.LayoutParams(dp(14), dp(14), Gravity.CENTER))
        contentDescription = ctx.getString(R.string.eng_ctl_expand)
        isClickable = true
        tag = "pill:dotFrame"
    }

    private var recording = false
    private var paused = false
    private var expanded = true
    private var deleteArmed = false
    private var shown = false
    private var right = true
    private var fy = 0.3f

    val isExpanded get() = expanded

    /** A 48 dp round button with a white icon on a faint glass disc (or [fill]). */
    private fun round(icon: Int, tag: String, fill: Int = btnFill): FrameLayout = FrameLayout(ctx).apply {
        this.tag = tag
        isClickable = true
        isFocusable = true
        background = android.graphics.drawable.RippleDrawable(
            android.content.res.ColorStateList.valueOf(ctx.getColor(R.color.eng_btn_ripple)),
            GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(fill) }, null,
        )
        addView(ImageView(ctx).apply {
            setImageResource(icon)
            imageTintList = android.content.res.ColorStateList.valueOf(ctx.getColor(R.color.eng_icon))
            this.tag = "$tag:icon"
        }, FrameLayout.LayoutParams(px(R.dimen.eng_ctl_icon), px(R.dimen.eng_ctl_icon), Gravity.CENTER))
    }

    private fun row(a: View, b: View) = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_HORIZONTAL
        val s = px(R.dimen.eng_ctl_button)
        addView(a, LinearLayout.LayoutParams(s, s))
        addView(b, LinearLayout.LayoutParams(s, s).apply { marginStart = px(R.dimen.eng_ctl_gap) })
    }

    init {
        val gap = px(R.dimen.eng_ctl_gap)
        panel.addView(timer, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, px(R.dimen.eng_ctl_header)))
        for (r in listOf(row(stop, pause), row(mic, cam), row(delete, hideButton))) {
            panel.addView(r, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = gap })
        }
        stop.contentDescription = ctx.getString(R.string.pill_stop)
        delete.contentDescription = ctx.getString(R.string.pill_delete)
        hideButton.contentDescription = ctx.getString(R.string.eng_ctl_hide)
        stop.setOnClickListener { touched(); actions.stop() }
        pause.setOnClickListener { touched(); actions.pauseToggle() }
        mic.setOnClickListener { touched(); actions.micToggle() }
        cam.setOnClickListener { touched(); actions.camToggle() }
        delete.setOnClickListener {
            touched()
            if (deleteArmed) { disarm(); actions.delete() } else arm()
        }
        hideButton.setOnClickListener { actions.hideControl() }
        attachDrag(timer) { collapse() }
        attachDrag(dotFrame) { expand() }
        fy = SafePrefs.float(prefs, "pill_fy", 0.3f).coerceIn(0f, 1f)
        right = SafePrefs.bool(prefs, "pill_right", true)
        setTime(0)
        setPaused(false)
        setMic(on = true, available = true)
        setCam(on = false, available = true)
    }

    fun show() {
        if (shown) return
        render()
        place()
        // While on screen, ask for the panel's highest refresh rate (only a request).
        lp.preferredDisplayModeId = DisplayInfo.read(ctx).bestModeId
        OverlayWindows.add(wm, root, lp)
        shown = true
        pulse.run()
    }

    fun hide() {
        shown = false
        main.removeCallbacksAndMessages(null)
        OverlayWindows.remove(wm, root)
    }

    fun setRecording(rec: Boolean) {
        val starting = rec && !recording
        recording = rec
        if (starting && startMinimized) collapse()
        else { if (rec) touched(); render() }
    }

    fun setPaused(p: Boolean) {
        paused = p
        icon(pause).setImageResource(if (p) R.drawable.eng_ic_play else R.drawable.eng_ic_pause)
        pause.contentDescription = ctx.getString(if (p) R.string.pill_resume else R.string.pill_pause)
        // Paused: the record dot turns amber and stops pulsing.
        val c = if (p) amber else red
        for (v in listOf(recDot, dot)) { (v.background as? GradientDrawable)?.setColor(c); v.alpha = 1f }
    }

    fun setTime(sec: Long) {
        timerText.text = if (sec >= 3600) String.format(java.util.Locale.US, "%d:%02d:%02d", sec / 3600, sec / 60 % 60, sec % 60)
        else String.format(java.util.Locale.US, "%d:%02d", sec / 60, sec % 60)
        timer.contentDescription = ctx.getString(R.string.eng_ctl_header_fmt, timerText.text)
    }

    fun setMic(on: Boolean, available: Boolean) {
        icon(mic).setImageResource(if (on && available) R.drawable.eng_ic_mic else R.drawable.eng_ic_mic_off)
        mic.isEnabled = available
        mic.alpha = if (available) 1f else 0.38f
        mic.contentDescription = ctx.getString(if (on) R.string.pill_mic_on else R.string.pill_mic_off)
    }

    fun setCam(on: Boolean, available: Boolean) {
        icon(cam).setImageResource(if (on) R.drawable.eng_ic_videocam else R.drawable.eng_ic_videocam_off)
        cam.isEnabled = available
        cam.alpha = if (available) 1f else 0.38f
        cam.contentDescription = ctx.getString(if (on) R.string.pill_cam_on else R.string.pill_cam_off)
    }

    fun onDisplayChanged() { if (shown) place() }

    fun collapse() { expanded = false; disarm(); main.removeCallbacks(autoCollapse); render() }
    fun expand() { expanded = true; touched(); render() }

    private fun icon(b: FrameLayout) = b.getChildAt(0) as ImageView

    private fun armedFill(on: Boolean) {
        (delete.background as? android.graphics.drawable.RippleDrawable)?.getDrawable(0)
            ?.let { (it as? GradientDrawable)?.setColor(if (on) ctx.getColor(R.color.eng_armed) else btnFill) }
    }

    private fun arm() {
        deleteArmed = true
        armedFill(true)
        delete.contentDescription = ctx.getString(R.string.pill_delete_confirm)
        main.postDelayed(disarmR, 3000)
    }
    private val disarmR = Runnable { disarm() }
    private fun disarm() {
        deleteArmed = false
        main.removeCallbacks(disarmR)
        armedFill(false)
        delete.contentDescription = ctx.getString(R.string.pill_delete)
    }
    val armed get() = deleteArmed

    /** Any touch keeps the panel open for a while; while recording it then shrinks to the dot. */
    private val autoCollapse = Runnable { if (recording && expanded) collapse() }
    private fun touched() {
        main.removeCallbacks(autoCollapse)
        main.postDelayed(autoCollapse, 5000)
    }

    /**
     * The record dot pulses in a few steps per second, not as a per-frame animation: an overlay
     * that changes every frame would make the compositor produce a new frame at the full refresh
     * rate even on a still screen, which costs battery and file size.
     */
    private val pulseSteps = floatArrayOf(1f, 0.8f, 0.55f, 0.35f, 0.55f, 0.8f)
    private var pulseAt = 0
    private val pulse = object : Runnable {
        override fun run() {
            if (!shown) return
            val a = if (recording && !paused) pulseSteps[pulseAt++ % pulseSteps.size] else 1f
            recDot.alpha = a
            dot.alpha = a
            main.postDelayed(this, 180)
        }
    }

    private fun render() {
        val want: View = if (expanded) panel else dotFrame
        if (root.childCount != 1 || root.getChildAt(0) !== want) {
            root.removeAllViews()
            if (expanded) root.addView(panel, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT))
            else root.addView(dotFrame, FrameLayout.LayoutParams(px(R.dimen.eng_ctl_dot), px(R.dimen.eng_ctl_dot)))
        }
        if (shown) place()
    }

    /** The window's size now: measured, so it always matches what is drawn. */
    private fun size(): Pair<Int, Int> {
        val u = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        root.measure(u, u)
        return root.measuredWidth to root.measuredHeight
    }

    private fun screen(): Pair<Int, Int> = DisplayInfo.read(ctx).let { it.width to it.height }

    private fun place() {
        val (w, h) = screen()
        val (vw, vh) = size()
        lp.x = if (right) (w - vw).coerceAtLeast(0) else 0
        lp.y = (fy * (h - vh).coerceAtLeast(0)).toInt()
        if (shown) OverlayWindows.update(wm, root, lp)
    }

    /** Side the control is on after the last drag (true = right edge). */
    val onRightEdge get() = right
    val x get() = lp.x
    val y get() = lp.y

    @SuppressLint("ClickableViewAccessibility")
    private fun attachDrag(v: View, onTap: () -> Unit) {
        val slop = ViewConfiguration.get(ctx).scaledTouchSlop
        var dx0 = 0f; var dy0 = 0f; var x0 = 0; var y0 = 0; var moved = false
        v.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { dx0 = e.rawX; dy0 = e.rawY; x0 = lp.x; y0 = lp.y; moved = false; v.isPressed = true; touched() }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - dx0; val dy = e.rawY - dy0
                    if (!moved && (abs(dx) > slop || abs(dy) > slop)) { moved = true; v.isPressed = false }
                    if (moved) {
                        lp.x = x0 + dx.toInt(); lp.y = y0 + dy.toInt()
                        if (shown) OverlayWindows.update(wm, root, lp)
                    }
                }
                MotionEvent.ACTION_UP -> {
                    v.isPressed = false
                    if (moved) snap() else { v.performClick(); onTap() }
                }
                MotionEvent.ACTION_CANCEL -> { v.isPressed = false; if (moved) snap() }
            }
            true
        }
    }

    /** Release after a drag: stick to the nearest side, keep the height, remember it. */
    private fun snap() {
        val (w, h) = screen()
        val (vw, vh) = size()
        right = lp.x + vw / 2 > w / 2
        fy = (lp.y.toFloat() / (h - vh).coerceAtLeast(1)).coerceIn(0f, 1f)
        prefs.edit().putBoolean("pill_right", right).putFloat("pill_fy", fy).apply()
        place()
    }
}

/** Big countdown number in the middle of the screen, with an optional one-line hint. Not touchable. */
class CountdownOverlay(private val ctx: Context, hint: String?) {
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val density = ctx.resources.displayMetrics.density
    private val number = TextView(ctx).apply {
        gravity = Gravity.CENTER
        textSize = 44f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.WHITE)
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(ctx.getColor(R.color.eng_glass))
            setStroke((4 * density).toInt(), ctx.getColor(R.color.eng_rec_red))
        }
    }
    private val root = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        val s = (112 * density).toInt()
        addView(number, LinearLayout.LayoutParams(s, s))
        if (!hint.isNullOrEmpty()) {
            addView(TextView(ctx).apply {
                text = hint
                textSize = 14f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                val p = (12 * density).toInt()
                setPadding(p, p / 2, p, p / 2)
                background = GradientDrawable().apply {
                    cornerRadius = 16 * density
                    setColor(ctx.getColor(R.color.eng_glass))
                }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = (12 * density).toInt()
            })
        }
    }
    private var shown = false

    fun set(n: Int) {
        number.text = String.format(java.util.Locale.getDefault(), "%d", n)
        if (!shown) {
            val lp = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT,
            ).apply { gravity = Gravity.CENTER }
            try { OverlayWindows.add(wm, root, lp); shown = true } catch (_: Exception) {}
        }
    }

    fun hide() {
        OverlayWindows.remove(wm, root)
        shown = false
    }
}

/** Round, draggable front-camera bubble. It is on screen, so it ends up in the video. */
class FacecamOverlay(private val ctx: Context, sizeLevel: Int) {
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val dm = ctx.getSystemService(DisplayManager::class.java)
    private val density = ctx.resources.displayMetrics.density
    private val sizePx = ((when (sizeLevel) { 1 -> 100; 3 -> 190; else -> 140 }) * density).toInt()
    private val lp = overlayParams(sizePx, 0, 0)
    private val container = FrameLayout(ctx)
    private val texture = TextureView(ctx)
    private val placer = Placer(ctx, "cam", wm, container, lp, sizePx, 0.03f, 0.05f)
    private val thread = HandlerThread("rawrec-cam").apply { start() }
    private val bg = Handler(thread.looper)
    @Volatile private var closed = false
    private var previewSurface: Surface? = null
    private var device: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var previewSize = Size(640, 480)
    private var sensorOrientation = 270
    private var shown = false

    @SuppressLint("ClickableViewAccessibility")
    fun show() {
        container.outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) = outline.setOval(0, 0, view.width, view.height)
        }
        container.clipToOutline = true
        container.setBackgroundColor(Color.BLACK)
        container.foreground = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setStroke((3 * density).toInt(), Color.WHITE)
        }
        container.addView(texture, FrameLayout.LayoutParams(sizePx, sizePx))
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0
        container.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y }
                MotionEvent.ACTION_MOVE -> placer.moveTo(startX + (e.rawX - downX).toInt(), startY + (e.rawY - downY).toInt())
                MotionEvent.ACTION_UP -> placer.remember()
            }
            true
        }
        texture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) = openCamera(st)
            override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) = applyTransform()
            override fun onSurfaceTextureDestroyed(st: SurfaceTexture) = true
            override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
        }
        placer.place()
        try {
            OverlayWindows.add(wm, container, lp)
        } catch (e: Exception) {
            closed = true
            thread.quitSafely()   // nothing was opened yet; don't leave the camera thread behind
            throw e
        }
        shown = true
    }

    /** Called by the service when the display rotates: keep the bubble on screen and upright. */
    fun onDisplayChanged() {
        if (!shown) return
        placer.reapply()
        container.post { applyTransform() }
    }

    @SuppressLint("MissingPermission")
    private fun openCamera(st: SurfaceTexture) {
        val cm = ctx.getSystemService(CameraManager::class.java) ?: return
        val ids = try { cm.cameraIdList } catch (_: Exception) { return }
        val id = ids.firstOrNull {
            cm.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
        } ?: ids.firstOrNull() ?: return
        val ch = cm.getCameraCharacteristics(id)
        sensorOrientation = ch.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 270
        val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        val sizes = map?.getOutputSizes(SurfaceTexture::class.java)?.toList().orEmpty()
        // Smallest size that is still sharp in the bubble: keeps camera and GPU cost low.
        previewSize = sizes.filter { it.width >= 480 && it.height >= 360 && it.width <= 1280 }
            .minByOrNull { it.width * it.height } ?: sizes.firstOrNull() ?: Size(640, 480)
        // At most 30 fps: the bubble does not need more, and every camera frame costs GPU time
        // that the game and the screen capture need.
        val fpsRange = ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
            ?.filter { it.upper <= 30 }?.maxWithOrNull(compareBy<Range<Int>> { it.upper }.thenBy { -it.lower })
        st.setDefaultBufferSize(previewSize.width, previewSize.height)
        applyTransform()

        try {
            cm.openCamera(id, object : CameraDevice.StateCallback() {
                override fun onOpened(cd: CameraDevice) {
                    if (closed) { cd.close(); return }
                    device = cd
                    val surface = Surface(st).also { previewSurface = it }
                    val req = cd.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply { addTarget(surface) }
                    val cfg = SessionConfiguration(
                        SessionConfiguration.SESSION_REGULAR,
                        listOf(OutputConfiguration(surface)),
                        { r -> bg.post(r) },
                        object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(s: CameraCaptureSession) {
                                if (closed) { s.close(); return }
                                session = s
                                req.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                                if (fpsRange != null) req.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, fpsRange)
                                try { s.setRepeatingRequest(req.build(), null, bg) } catch (_: Exception) {}
                            }
                            override fun onConfigureFailed(s: CameraCaptureSession) {}
                        },
                    )
                    try { cd.createCaptureSession(cfg) } catch (_: Exception) {}
                }
                override fun onDisconnected(cd: CameraDevice) { cd.close(); device = null }
                override fun onError(cd: CameraDevice, error: Int) { cd.close(); device = null }
            }, bg)
        } catch (_: Exception) {}
    }

    /**
     * The camera framework turns the image upright for the device's natural orientation (and
     * mirrors the front camera). TextureView stretches it to the square bubble; undo the stretch
     * (center-crop) and counter-rotate for the current screen rotation.
     */
    private fun applyTransform() {
        val rotation = dm?.getDisplay(Display.DEFAULT_DISPLAY)?.rotation ?: Surface.ROTATION_0
        val displayDeg = rotation * 90
        val size = sizePx.toFloat()
        val c = size / 2f
        val swap = sensorOrientation % 180 == 90
        val cw = (if (swap) previewSize.height else previewSize.width).toFloat()
        val ch = (if (swap) previewSize.width else previewSize.height).toFloat()
        val s = maxOf(size / cw, size / ch)
        val m = Matrix()
        m.setScale(cw * s / size, ch * s / size, c, c)
        if (displayDeg != 0) m.postRotate(-displayDeg.toFloat(), c, c)
        texture.setTransform(m)
    }

    fun hide() {
        shown = false
        closed = true
        OverlayWindows.remove(wm, container)
        bg.post {
            try { session?.close() } catch (_: Exception) {}
            try { device?.close() } catch (_: Exception) {}
            try { previewSurface?.release() } catch (_: Exception) {}
            thread.quitSafely()
        }
    }
}
