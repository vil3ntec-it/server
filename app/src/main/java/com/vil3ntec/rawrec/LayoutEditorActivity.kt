package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.Size
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import kotlin.math.abs

/**
 * «چیدمانِ پخش»: the stream's picture, big, with everything viewers see on it (chat, goal bar,
 * subscriber and viewer counters, thank-you alert) drawn by the same code as the stream. Drag a
 * thing to move it, pinch to resize it, tap it for its switch and options. Saved at once; a
 * running stream takes the change immediately. Shown on the last recording's picture, so the
 * owner arranges it over their own game.
 */
class LayoutEditorActivity : Activity() {

    override fun attachBaseContext(newBase: Context) = super.attachBaseContext(AppLang.wrap(newBase))

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private lateinit var stage: Stage
    private lateinit var toolbar: LinearLayout
    private lateinit var toolTitle: TextView
    private lateinit var eyeBtn: TextView
    private lateinit var extraBox: LinearLayout
    private val chips = LinkedHashMap<String, TextView>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        stage = Stage(this)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(10, 11, 14)) }
        root.addView(stage, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        // top: close, the things (tap to pick one, even when hidden or small), back to the default
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(8), dp(10), dp(8))
        }
        top.addView(pill(getString(R.string.lay_done), Color.rgb(255, 59, 71)) { finish() })
        val chipRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for (it in OverlayLayout.ITEMS) {
            val c = pill(getString(it.name)) { stage.select(it.key) }
            chips[it.key] = c
            chipRow.addView(c)
        }
        top.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(chipRow) },
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(pill(getString(R.string.lay_reset)) { confirmReset() })
        root.addView(top, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP))

        // bottom: the picked thing's switch, size and options
        toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(8), dp(14), dp(8))
            background = GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setColor(Color.argb(225, 22, 24, 30)) }
            visibility = View.GONE
        }
        toolTitle = TextView(this).apply {
            setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setPadding(0, 0, dp(12), 0)
        }
        toolbar.addView(toolTitle)
        eyeBtn = pill("") { stage.selected?.let { k -> OverlayLayout.setShown(this, k, !OverlayLayout.shown(this, k)); changed() } }
        toolbar.addView(eyeBtn)
        toolbar.addView(pill("−") { stage.resize(1f / 1.12f) })
        toolbar.addView(pill("+") { stage.resize(1.12f) })
        extraBox = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        toolbar.addView(extraBox)
        root.addView(toolbar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(12) })

        setContentView(root)
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        }
        stage.onSelect = { renderTools() }
        stage.onChanged = { changed() }
        loadBackground()
        renderTools()
    }

    private fun pill(text: String, color: Int = Color.argb(70, 255, 255, 255), click: () -> Unit) = TextView(this).apply {
        this.text = text
        setTextColor(Color.WHITE)
        typeface = Typeface.DEFAULT_BOLD
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        gravity = Gravity.CENTER
        minWidth = dp(48)
        setPadding(dp(14), 0, dp(14), 0)
        background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(color) }
        setOnClickListener { click() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(44)).apply { marginEnd = dp(8) }
    }

    /** A thing changed: saved already; redraw, refresh the tools, and tell a running stream. */
    private fun changed() {
        stage.reload()
        renderTools()
        RecordService.layoutChanged()
    }

    private fun renderTools() {
        val k = stage.selected
        for ((key, c) in chips) {
            val on = OverlayLayout.shown(this, key)
            (c.background as GradientDrawable).setColor(when {
                key == k -> Color.rgb(106, 166, 255)
                on -> Color.argb(110, 255, 255, 255)
                else -> Color.argb(45, 255, 255, 255)
            })
            c.alpha = if (on || key == k) 1f else 0.6f
        }
        if (k == null) { toolbar.visibility = View.GONE; return }
        toolbar.visibility = View.VISIBLE
        toolTitle.text = getString(OverlayLayout.item(k).name)
        val shown = OverlayLayout.shown(this, k)
        eyeBtn.text = getString(if (shown) R.string.lay_shown else R.string.lay_hidden)
        (eyeBtn.background as GradientDrawable).setColor(if (shown) Color.rgb(61, 160, 110) else Color.argb(70, 255, 255, 255))
        extraBox.removeAllViews()
        when (k) {
            OverlayLayout.CHAT -> {
                val names = listOf(R.string.live_style_bare, R.string.live_style_glass, R.string.live_style_bubbles)
                for ((i, n) in names.withIndex()) {
                    val sel = LiveExtras.chatStyle(this) == i
                    extraBox.addView(pill(getString(n), if (sel) Color.rgb(106, 166, 255) else Color.argb(70, 255, 255, 255)) {
                        LiveExtras.put(this, "ov_chat_style", i); changed()
                    })
                }
            }
            OverlayLayout.GOAL -> extraBox.addView(pill(getString(R.string.lay_goal_settings)) { goalDialog() })
        }
    }

    private fun confirmReset() {
        AlertDialog.Builder(this)
            .setTitle(R.string.lay_reset)
            .setMessage(R.string.lay_reset_msg)
            .setPositiveButton(R.string.lay_reset) { _, _ -> OverlayLayout.reset(this); changed() }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    /** The goal bar: what it counts, the number, its text. */
    private fun goalDialog() {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0) }
        val group = RadioGroup(this)
        val types = listOf(R.string.live_goal_t_subs, R.string.live_goal_t_likes, R.string.live_goal_t_members, R.string.live_goal_t_manual)
        for ((i, t) in types.withIndex()) group.addView(RadioButton(this).apply { id = 100 + i; text = getString(t) })
        group.check(100 + LiveExtras.goalType(this))
        box.addView(group)
        val target = EditText(this).apply {
            hint = getString(R.string.live_goal_target)
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setText(LiveExtras.goalTarget(this@LayoutEditorActivity).toString())
        }
        box.addView(TextView(this).apply { text = getString(R.string.live_goal_target) })
        box.addView(target)
        val title = EditText(this).apply {
            hint = getString(R.string.live_goal_name)
            setText(LiveExtras.goalTitle(this@LayoutEditorActivity))
        }
        box.addView(TextView(this).apply { text = getString(R.string.live_goal_name) })
        box.addView(title)
        AlertDialog.Builder(this)
            .setTitle(R.string.lay_goal_settings)
            .setView(box)
            .setPositiveButton(R.string.lay_save) { _, _ ->
                LiveExtras.put(this, "ov_goal_type", (group.checkedRadioButtonId - 100).coerceIn(0, 3))
                ChatBot.toAsciiDigits(target.text.toString().trim()).toIntOrNull()?.takeIf { it > 0 }?.let { LiveExtras.put(this, "ov_goal_target", it) }
                LiveExtras.put(this, "ov_goal_title", title.text.toString().trim())
                changed()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    /** The owner's own last recording as the picture to arrange on (a game-like gradient until there is one). */
    private fun loadBackground() {
        Thread {
            val b = try {
                VideoLibrary.query(this).firstOrNull()?.let { contentResolver.loadThumbnail(it.uri, Size(1280, 720), null) }
            } catch (_: Exception) { null }
            if (b != null) runOnUiThread { stage.background = b; stage.invalidate() }
        }.start()
    }

    /** The 16:9 stage and the things on it. */
    @SuppressLint("ViewConstructor")
    class Stage(ctx: Context) : View(ctx) {
        var background: Bitmap? = null
        var selected: String? = null; private set
        var onSelect: () -> Unit = {}
        var onChanged: () -> Unit = {}
        private val d = resources.displayMetrics.density
        private var samples: Map<String, Bitmap> = emptyMap()
        private val places = HashMap<String, OverlayLayout.Place>()
        private val stage = RectF()
        private var guideX = false
        private var guideY = false
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = 2f * d; color = Color.WHITE
            pathEffect = DashPathEffect(floatArrayOf(8f * d, 6f * d), 0f)
        }
        private val guide = Paint().apply { color = Color.rgb(106, 166, 255); strokeWidth = 1.5f * d }
        private val hint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(220, 255, 255, 255); textSize = 14f * d; textAlign = Paint.Align.CENTER
            setShadowLayer(4f * d, 0f, 0f, Color.BLACK)
        }

        init { reload() }

        fun reload() {
            val o = StreamOverlay(context) {}
            o.chatStyle = LiveExtras.chatStyle(context)
            samples = o.samples()
            o.release()
            for (it in OverlayLayout.ITEMS) places[it.key] = OverlayLayout.place(context, it.key)
            invalidate()
        }

        fun select(key: String?) { selected = key; onSelect(); invalidate() }

        fun resize(f: Float) {
            val k = selected ?: return
            val p = places[k] ?: return
            val np = OverlayLayout.Place(p.x, p.y, (p.scale * f).coerceIn(OverlayLayout.MIN_SCALE, OverlayLayout.MAX_SCALE))
            places[k] = np
            OverlayLayout.setPlace(context, k, np)
            onChanged()
        }

        override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
            // 16:9 inside the view, a little room at the top and bottom for the bars
            val availH = h - 2 * 64 * d
            var sw = w.toFloat() - 24 * d
            var sh = sw * 9f / 16f
            if (sh > availH) { sh = availH; sw = sh * 16f / 9f }
            stage.set((w - sw) / 2f, (h - sh) / 2f, (w + sw) / 2f, (h + sh) / 2f)
        }

        /** The thing's rectangle on screen, as the stream places it (centred, kept inside the frame). */
        internal fun rectOf(key: String): RectF? {
            val b = samples[key] ?: return null
            val p = places[key] ?: return null
            val k = stage.width() / FRAME_W
            val w = b.width * p.scale * k; val h = b.height * p.scale * k
            // kept inside the picture (a thing larger than the picture sits at its start)
            val x = (stage.left + p.x * stage.width() - w / 2f).coerceIn(stage.left, maxOf(stage.left, stage.right - w))
            val y = (stage.top + p.y * stage.height() - h / 2f).coerceIn(stage.top, maxOf(stage.top, stage.bottom - h))
            return RectF(x, y, x + w, y + h)
        }

        override fun onDraw(c: Canvas) {
            val bg = background
            if (bg != null) c.drawBitmap(bg, null, stage, paint)
            else {
                paint.shader = LinearGradient(stage.left, stage.top, stage.right, stage.bottom, Color.rgb(52, 74, 60), Color.rgb(120, 104, 74), Shader.TileMode.CLAMP)
                c.drawRect(stage, paint)
                paint.shader = null
            }
            for (it in OverlayLayout.ITEMS) {
                val r = rectOf(it.key) ?: continue
                paint.alpha = if (OverlayLayout.shown(context, it.key)) 255 else 90
                c.drawBitmap(samples[it.key]!!, null, r, paint)
                paint.alpha = 255
                if (it.key == selected) c.drawRoundRect(RectF(r.left - 4 * d, r.top - 4 * d, r.right + 4 * d, r.bottom + 4 * d), 8 * d, 8 * d, line)
            }
            if (guideX) c.drawLine(stage.centerX(), stage.top, stage.centerX(), stage.bottom, guide)
            if (guideY) c.drawLine(stage.left, stage.centerY(), stage.right, stage.centerY(), guide)
            if (selected == null) c.drawText(context.getString(R.string.lay_hint), stage.centerX(), stage.bottom - 14 * d, hint)
        }

        private val scaler = ScaleGestureDetector(ctx, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(det: ScaleGestureDetector): Boolean {
                val k = selected ?: return false
                val p = places[k] ?: return false
                places[k] = OverlayLayout.Place(p.x, p.y, (p.scale * det.scaleFactor).coerceIn(OverlayLayout.MIN_SCALE, OverlayLayout.MAX_SCALE))
                invalidate()
                return true
            }
        })
        private var dragKey: String? = null
        private var grabDx = 0f
        private var grabDy = 0f
        private var moved = false
        private var downX = 0f
        private var downY = 0f

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: MotionEvent): Boolean {
            scaler.onTouchEvent(e)
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.x; downY = e.y; moved = false
                    // topmost first (the alert is drawn first in the list, the chat last)
                    dragKey = OverlayLayout.ITEMS.reversed().firstOrNull { rectOf(it.key)?.contains(e.x, e.y) == true }?.key
                    dragKey?.let { k ->
                        val r = rectOf(k)!!
                        grabDx = e.x - r.centerX(); grabDy = e.y - r.centerY()
                        if (selected != k) select(k)
                    }
                }
                MotionEvent.ACTION_MOVE -> {
                    val k = dragKey
                    if (k != null && !scaler.isInProgress && e.pointerCount == 1) {
                        if (abs(e.x - downX) > 6 * d || abs(e.y - downY) > 6 * d) moved = true
                        if (moved) {
                            var cx = e.x - grabDx
                            var cy = e.y - grabDy
                            // snap to the middle lines (and show them)
                            guideX = abs(cx - stage.centerX()) < 10 * d
                            guideY = abs(cy - stage.centerY()) < 10 * d
                            if (guideX) cx = stage.centerX()
                            if (guideY) cy = stage.centerY()
                            val p = places[k]!!
                            places[k] = OverlayLayout.Place(((cx - stage.left) / stage.width()).coerceIn(0f, 1f),
                                ((cy - stage.top) / stage.height()).coerceIn(0f, 1f), p.scale)
                            invalidate()
                        }
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    guideX = false; guideY = false
                    val k = dragKey ?: selected
                    if (dragKey == null && !moved && !scaler.isInProgress && e.actionMasked == MotionEvent.ACTION_UP) select(null)
                    if (k != null) { places[k]?.let { OverlayLayout.setPlace(context, k, it) }; onChanged() }
                    dragKey = null
                    invalidate()
                }
            }
            return true
        }
    }

    companion object {
        const val FRAME_W = 1920f

        /** A small picture of the arrangement for the «زنده» page (same drawing as the stream). */
        fun preview(ctx: Context, w: Int, background: Bitmap?): Bitmap {
            val h = w * 9 / 16
            val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(out)
            val p = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            val all = RectF(0f, 0f, w.toFloat(), h.toFloat())
            if (background != null) c.drawBitmap(background, null, all, p)
            else {
                p.shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), Color.rgb(52, 74, 60), Color.rgb(120, 104, 74), Shader.TileMode.CLAMP)
                c.drawRect(all, p); p.shader = null
            }
            val o = StreamOverlay(ctx) {}
            o.chatStyle = LiveExtras.chatStyle(ctx)
            val samples = o.samples()
            o.release()
            val k = w / FRAME_W
            for (it in OverlayLayout.ITEMS) {
                if (!OverlayLayout.shown(ctx, it.key)) continue
                val b = samples[it.key] ?: continue
                val pl = OverlayLayout.place(ctx, it.key)
                val bw = b.width * pl.scale * k; val bh = b.height * pl.scale * k
                val x = (pl.x * w - bw / 2f).coerceIn(0f, maxOf(0f, w - bw))
                val y = (pl.y * h - bh / 2f).coerceIn(0f, maxOf(0f, h - bh))
                c.drawBitmap(b, null, RectF(x, y, x + bw, y + bh), p)
            }
            return out
        }

        /** The last recording's picture, or null (call off the main thread). */
        fun lastFrame(ctx: Context): Bitmap? = try {
            VideoLibrary.query(ctx).firstOrNull()?.let { ctx.contentResolver.loadThumbnail(it.uri, Size(1280, 720), null) }
        } catch (_: Exception) { null }

        @Suppress("unused") private val keepImports = listOf(ColorStateList::class, ImageView::class)
    }
}
