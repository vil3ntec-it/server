package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * 8.4: the chat, the goal, the counters… moved and resized over the game itself, live on the stream
 * (the owner: «روی همان صفحه» — before, «ویرایشِ چیدمان» opened RawRec and took them out of the game).
 *
 * A full-screen window over the game while it is open: every layer of the scene on the stream has a
 * frame where it is on the stream; one finger drags it, two fingers (or the round corner handle)
 * resize it. Each move goes onto the stream at once ([SceneRenderer.editLayer]); «تمام» saves,
 * «برگرداندن» puts back what was moved, «ویرایشِ کامل» opens the full editor (colours, texts…).
 * Main thread.
 */
@SuppressLint("ViewConstructor")
class InPlaceEditor(
    private val ctx: Context,
    private val sr: Target,
    private val geo: () -> OwnerMirror.Geo?,
    private val openFull: () -> Unit,
    private val onClose: () -> Unit,
) {
    /** What the editor moves: the scene on the stream ([SceneRenderer]). */
    interface Target {
        val boxes: List<SceneRenderer.Box>
        fun layerOf(id: String): Scenes.Layer?
        fun editLayer(id: String, x: Float, y: Float, scale: Float)
        fun commitEdit()
        fun push()
    }

    private val wm = ctx.getSystemService(WindowManager::class.java)
    private fun dp(v: Float) = v * ctx.resources.displayMetrics.density
    private val accent = ctx.getColor(R.color.sel)

    /** What was where before this edit (put back by «برگرداندن»). */
    private val before = LinkedHashMap<String, FloatArray>()
    private var selected: String? = null

    private val stage = object : View(ctx) {
        private val frame = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = dp(2f); pathEffect = DashPathEffect(floatArrayOf(dp(8f), dp(5f)), 0f) }
        private val solid = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = dp(3f) }
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = dp(12f); color = Color.WHITE; isFakeBoldText = true }

        override fun onDraw(c: Canvas) {
            c.drawColor(0x33000000)
            for (b in placed()) {
                val on = b.id == selected
                c.save()
                c.translate(b.cx, b.cy); c.rotate(b.rot)
                val r = RectF(-b.w / 2, -b.h / 2, b.w / 2, b.h / 2)
                fill.color = if (on) 0x332F6FE4 else 0x14FFFFFF
                c.drawRect(r, fill)
                val p = if (on) solid else frame
                p.color = if (b.locked) Color.GRAY else if (on) accent else Color.WHITE
                c.drawRect(r, p)
                // the name on a small tag above the frame
                val name = (if (b.locked) "🔒 " else "") + b.name
                val tw = text.measureText(name) + dp(10f)
                fill.color = if (on) accent else 0xCC000000.toInt()
                c.drawRoundRect(RectF(-b.w / 2, -b.h / 2 - dp(20f), -b.w / 2 + tw, -b.h / 2 - dp(2f)), dp(4f), dp(4f), fill)
                c.drawText(name, -b.w / 2 + dp(5f), -b.h / 2 - dp(7f), text)
                if (on && !b.locked) {
                    fill.color = accent
                    c.drawCircle(b.w / 2, b.h / 2, dp(13f), fill)
                    fill.color = Color.WHITE
                    c.drawCircle(b.w / 2, b.h / 2, dp(5f), fill)
                }
                c.restore()
            }
        }

        private var mode = 0                // 0 none, 1 move, 2 corner resize, 3 two-finger resize
        private var downX = 0f; private var downY = 0f
        private var startX = 0f; private var startY = 0f; private var startScale = 1f
        private var startDist = 1f
        private var lastApply = 0L

        override fun onTouchEvent(e: MotionEvent): Boolean {
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    val list = placed()
                    val cur = list.firstOrNull { it.id == selected }
                    mode = 0
                    if (cur != null && !cur.locked && nearCorner(cur, e.x, e.y)) mode = 2
                    else {
                        val hit = list.lastOrNull { inside(it, e.x, e.y) }
                        selected = hit?.id
                        if (hit != null && !hit.locked) mode = 1
                    }
                    val l = selected?.let { sr.layerOf(it) }
                    if (l != null && mode != 0) {
                        before.getOrPut(l.id) { floatArrayOf(l.x, l.y, l.scale) }
                        startX = l.x; startY = l.y; startScale = l.scale
                        downX = e.x; downY = e.y
                        if (mode == 2) list.firstOrNull { it.id == selected }?.let { b -> startDist = hypot(e.x - b.cx, e.y - b.cy).coerceAtLeast(1f) }
                    }
                    invalidate()
                }
                MotionEvent.ACTION_POINTER_DOWN -> if (e.pointerCount == 2 && selected != null && mode != 0) {
                    val l = sr.layerOf(selected!!) ?: return true
                    startScale = l.scale; startX = l.x; startY = l.y
                    startDist = hypot(e.getX(0) - e.getX(1), e.getY(0) - e.getY(1)).coerceAtLeast(1f)
                    mode = 3
                }
                MotionEvent.ACTION_MOVE -> if (mode != 0) {
                    val now = SystemClock.uptimeMillis()
                    if (now - lastApply >= 30) { lastApply = now; move(e) }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { if (mode != 0) move(e); mode = 0 }
                MotionEvent.ACTION_POINTER_UP -> if (mode == 3) {
                    // back to one finger: it moves on from where the picture is now
                    val l = selected?.let { sr.layerOf(it) }
                    val keep = if (e.actionIndex == 0) 1 else 0
                    if (l != null) { startX = l.x; startY = l.y; startScale = l.scale; downX = e.getX(keep); downY = e.getY(keep); mode = 1 }
                }
            }
            return true
        }

        private fun move(e: MotionEvent) {
            val id = selected ?: return
            val m = mapping()
            val spanX = (m.x(1f) - m.x(0f)).takeIf { it != 0f } ?: return
            val spanY = (m.y(1f) - m.y(0f)).takeIf { it != 0f } ?: return
            when (mode) {
                1 -> sr.editLayer(id, startX + (e.getX(0) - downX) / spanX, startY + (e.getY(0) - downY) / spanY, startScale)
                2 -> placed().firstOrNull { it.id == id }?.let { b ->
                    sr.editLayer(id, startX, startY, startScale * hypot(e.x - b.cx, e.y - b.cy) / startDist)
                }
                3 -> if (e.pointerCount >= 2)
                    sr.editLayer(id, startX, startY, startScale * hypot(e.getX(0) - e.getX(1), e.getY(0) - e.getY(1)) / startDist)
            }
            invalidate()
        }
    }

    /** A layer's frame on this screen. */
    private class Placed(val id: String, val name: String, val cx: Float, val cy: Float, val w: Float, val h: Float, val rot: Float, val locked: Boolean)

    private val real = Point()
    private val loc = IntArray(2)

    private fun mapping(): OwnerMirror.Mapping {
        @Suppress("DEPRECATION") (stage.display ?: wm?.defaultDisplay)?.getRealSize(real)
        return OwnerMirror.Mapping.of(geo(), real.x.toFloat().coerceAtLeast(1f), real.y.toFloat().coerceAtLeast(1f))
    }

    private fun placed(): List<Placed> {
        val m = mapping()
        stage.getLocationOnScreen(loc)
        return sr.boxes.map { b ->
            val w = kotlin.math.abs(m.x(b.x + b.w / 2) - m.x(b.x - b.w / 2)).coerceAtLeast(dp(24f))
            val h = kotlin.math.abs(m.y(b.y + b.h / 2) - m.y(b.y - b.h / 2)).coerceAtLeast(dp(24f))
            Placed(b.id, b.name.ifBlank { b.kind.name }, m.x(b.x) - loc[0], m.y(b.y) - loc[1], w, h, b.rot, b.locked)
        }
    }

    /** The point in the frame's own (unrotated) coordinates. */
    private fun local(b: Placed, x: Float, y: Float): Pair<Float, Float> {
        val a = Math.toRadians(-b.rot.toDouble())
        val dx = x - b.cx; val dy = y - b.cy
        return (dx * cos(a) - dy * sin(a)).toFloat() to (dx * sin(a) + dy * cos(a)).toFloat()
    }

    private fun inside(b: Placed, x: Float, y: Float): Boolean {
        val (lx, ly) = local(b, x, y)
        val pad = dp(8f)
        return kotlin.math.abs(lx) <= b.w / 2 + pad && kotlin.math.abs(ly) <= b.h / 2 + pad
    }

    private fun nearCorner(b: Placed, x: Float, y: Float): Boolean {
        val (lx, ly) = local(b, x, y)
        return hypot(lx - b.w / 2, ly - b.h / 2) <= dp(30f)
    }

    private fun button(label: String, primary: Boolean, click: () -> Unit) = TextView(ctx).apply {
        text = label
        textSize = 14f
        setTextColor(Color.WHITE)
        setPadding(dp(14f).toInt(), dp(9f).toInt(), dp(14f).toInt(), dp(9f).toInt())
        background = GradientDrawable().apply { cornerRadius = dp(20f); setColor(if (primary) accent else 0xE6202020.toInt()) }
        setOnClickListener { click() }
    }

    private val hint = TextView(ctx)

    private val root = FrameLayout(ctx).apply {
        addView(stage, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        val bar = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
            fun gap() = View(ctx).apply { layoutParams = LinearLayout.LayoutParams(dp(8f).toInt(), 1) }
            row.addView(button(ctx.getString(R.string.ipe_done), true) { done() }); row.addView(gap())
            row.addView(button(ctx.getString(R.string.ipe_undo), false) { undo() }); row.addView(gap())
            row.addView(button(ctx.getString(R.string.ipe_full), false) { done(); openFull() })
            addView(row)
            addView(hint.apply {
                textSize = 12f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
                setShadowLayer(dp(3f), 0f, 0f, Color.BLACK)
                setPadding(0, dp(6f).toInt(), 0, 0)
            })
        }
        addView(bar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dp(18f).toInt() })
    }

    private val lp = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.LEFT
        layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        title = "RawRec layout"
    }

    var shown = false; private set

    /** Throws when the window can't go on the screen (the caller opens the full editor instead). */
    fun show() {
        sr.push()                    // the frames from what the stream has now
        hint.text = ctx.getString(if (sr.boxes.isEmpty()) R.string.ipe_empty else R.string.ipe_hint)
        OverlayWindows.add(wm, root, lp)
        shown = true
        stage.postInvalidate()
    }

    private fun undo() {
        for ((id, v) in before) sr.editLayer(id, v[0], v[1], v[2])
        before.clear()
        stage.invalidate()
    }

    private fun done() {
        if (before.isNotEmpty()) sr.commitEdit()
        close()
    }

    fun close() {
        if (shown) { try { OverlayWindows.remove(wm, root) } catch (_: Exception) {}; shown = false }
        onClose()
    }

    internal val viewForTests: View get() = stage
    internal val selectedForTests: String? get() = selected
}
