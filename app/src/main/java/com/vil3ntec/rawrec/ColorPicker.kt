package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ComposeShader
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Any colour, with transparency: a hue strip, a saturation / brightness square, a transparency
 * strip, the hex code (#AARRGGBB or #RRGGBB) and a row of quick colours. Main thread.
 */
object ColorPicker {

    private val SWATCHES = intArrayOf(
        Color.WHITE, Color.BLACK, Color.rgb(255, 59, 71), Color.rgb(255, 176, 32), Color.rgb(255, 230, 0), Color.rgb(61, 214, 140),
        Color.rgb(0, 200, 255), Color.rgb(106, 166, 255), Color.rgb(186, 120, 255), Color.rgb(255, 105, 180), Color.argb(200, 14, 15, 20), Color.TRANSPARENT,
    )

    fun show(ctx: Context, title: String, initial: Int, alpha: Boolean = true, done: (Int) -> Unit) {
        val d = ctx.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val hsv = FloatArray(3)
        Color.colorToHSV(initial, hsv)
        var a = Color.alpha(initial)
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(12), dp(20), dp(4)) }
        val preview = View(ctx)
        val hex = EditText(ctx).apply {
            setSingleLine(); textDirection = View.TEXT_DIRECTION_LTR; textAlignment = View.TEXT_ALIGNMENT_CENTER
            setTextColor(Color.WHITE)
        }
        lateinit var sv: SvSquare
        lateinit var hue: Strip
        lateinit var al: Strip
        var silent = false
        // a colour typed or tapped stays exactly that colour (HSV can be one step off); the sliders make their own
        var exact: Int? = initial
        fun current() = exact ?: Color.HSVToColor(a, hsv)
        fun refresh(fromHex: Boolean = false) {
            preview.background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(current()); setStroke(dp(1), Color.GRAY) }
            sv.hue = hsv[0]; sv.s = hsv[1]; sv.v = hsv[2]; sv.invalidate()
            hue.pos = hsv[0] / 360f; hue.invalidate()
            al.pos = a / 255f; al.base = Color.HSVToColor(hsv); al.invalidate()
            if (!fromHex) { silent = true; hex.setText(String.format("#%08X", current())); silent = false }
        }
        sv = SvSquare(ctx) { s, v -> hsv[1] = s; hsv[2] = v; exact = null; refresh() }
        hue = Strip(ctx, Strip.HUE) { p -> hsv[0] = (p * 360f).coerceIn(0f, 359.9f); exact = null; refresh() }
        al = Strip(ctx, Strip.ALPHA) { p -> a = (p * 255).toInt().coerceIn(0, 255); exact = null; refresh() }
        hex.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(e: Editable?) {
                if (silent) return
                val t = e.toString().trim().removePrefix("#")
                val v = when (t.length) { 6 -> t.toLongOrNull(16)?.let { (0xFF000000 or it).toInt() }; 8 -> t.toLongOrNull(16)?.toInt(); else -> null } ?: return
                Color.colorToHSV(v, hsv); a = Color.alpha(v); exact = v; refresh(fromHex = true)
            }
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, af: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
        })
        root.addView(sv, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(170)))
        root.addView(hue, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(30)).apply { topMargin = dp(12) })
        if (alpha) root.addView(al, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(30)).apply { topMargin = dp(10) })
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        row.addView(preview, LinearLayout.LayoutParams(dp(48), dp(40)))
        row.addView(hex, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(12) })
        root.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
        val sw = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        for (c in SWATCHES) {
            if (!alpha && Color.alpha(c) < 255) continue
            sw.addView(TextView(ctx).apply {
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(c); setStroke(dp(1), Color.GRAY) }
                text = if (c == Color.TRANSPARENT) "∅" else ""
                gravity = Gravity.CENTER; setTextColor(Color.GRAY)
                setOnClickListener { Color.colorToHSV(c, hsv); a = Color.alpha(c); exact = c; refresh() }
            }, LinearLayout.LayoutParams(0, dp(26), 1f).apply { marginEnd = dp(4) })
        }
        root.addView(sw, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
        refresh()
        AlertDialog.Builder(ctx)
            .setTitle(title)
            .setView(android.widget.ScrollView(ctx).apply { addView(root) })
            .setPositiveButton(R.string.lay_save) { _, _ -> done(if (alpha) current() else current() or (0xFF shl 24)) }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    /** Saturation (left → right) and brightness (bottom → top) for one hue. */
    @SuppressLint("ViewConstructor")
    private class SvSquare(ctx: Context, private val onPick: (Float, Float) -> Unit) : View(ctx) {
        var hue = 0f; var s = 1f; var v = 1f
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3f * resources.displayMetrics.density; color = Color.WHITE }
        override fun onDraw(c: Canvas) {
            val r = RectF(0f, 0f, width.toFloat(), height.toFloat())
            val sat = LinearGradient(0f, 0f, r.right, 0f, Color.WHITE, Color.HSVToColor(floatArrayOf(hue, 1f, 1f)), Shader.TileMode.CLAMP)
            val dark = LinearGradient(0f, 0f, 0f, r.bottom, Color.TRANSPARENT, Color.BLACK, Shader.TileMode.CLAMP)
            p.shader = ComposeShader(sat, dark, PorterDuff.Mode.SRC_OVER)
            c.drawRoundRect(r, 12f, 12f, p)
            p.shader = null
            c.drawCircle(s * width, (1 - v) * height, 10f * resources.displayMetrics.density, ring)
        }
        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: MotionEvent): Boolean {
            parent?.requestDisallowInterceptTouchEvent(true)
            onPick((e.x / width).coerceIn(0f, 1f), 1f - (e.y / height).coerceIn(0f, 1f))
            return true
        }
    }

    /** A horizontal strip: the hue circle, or transparency over a checkerboard. */
    @SuppressLint("ViewConstructor")
    private class Strip(ctx: Context, private val kind: Int, private val onPick: (Float) -> Unit) : View(ctx) {
        var pos = 0f
        var base = Color.RED
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val knob = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3f * resources.displayMetrics.density; color = Color.WHITE }
        override fun onDraw(c: Canvas) {
            val r = RectF(0f, 0f, width.toFloat(), height.toFloat())
            if (kind == HUE) {
                p.shader = LinearGradient(0f, 0f, r.right, 0f, IntArray(7) { Color.HSVToColor(floatArrayOf(it * 60f, 1f, 1f)) }, null, Shader.TileMode.CLAMP)
                c.drawRoundRect(r, r.height() / 2, r.height() / 2, p)
            } else {
                val sq = r.height() / 2
                var x = 0f
                var i = 0
                while (x < r.right) {
                    p.shader = null
                    p.color = if (i % 2 == 0) Color.LTGRAY else Color.WHITE; c.drawRect(x, 0f, x + sq, sq, p)
                    p.color = if (i % 2 == 0) Color.WHITE else Color.LTGRAY; c.drawRect(x, sq, x + sq, r.bottom, p)
                    x += sq; i++
                }
                p.shader = LinearGradient(0f, 0f, r.right, 0f, Color.argb(0, Color.red(base), Color.green(base), Color.blue(base)), base or (0xFF shl 24), Shader.TileMode.CLAMP)
                c.drawRect(r, p)
            }
            p.shader = null
            c.drawCircle(pos * width, height / 2f, height / 2f - 2f, knob)
        }
        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: MotionEvent): Boolean {
            parent?.requestDisallowInterceptTouchEvent(true)
            onPick((e.x / width).coerceIn(0f, 1f))
            return true
        }
        companion object { const val HUE = 0; const val ALPHA = 1 }
    }
}
