package com.vil3ntec.rawrec

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.view.View
import java.util.Locale

/**
 * What the viewers see over the game (the owner's phone shows none of it): thank-you alerts for
 * new subscribers, Super Chats, members, gifts, cheers and raids; the subscriber count (and,
 * if wanted, viewers); the goal bar; the giveaway winner. Drawn as small pictures with Canvas and
 * handed to [LookFilter] as layers: a picture is made only when its content changes, the slide-in
 * and fade of an alert only move it. Main thread.
 */
class StreamOverlay(private val ctx: Context, private val sink: (List<LookFilter.Layer>) -> Unit) {

    enum class Kind { SUBSCRIBER, SUPER, MEMBER, GIFT, CHEER, RAID, GIVEAWAY, GOAL }
    class Alert(val kind: Kind, val name: String, val detail: String? = null, val comment: String? = null)

    private val main = Handler(Looper.getMainLooper())
    private val rtl = ctx.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
    /** Frame size; the pictures are drawn for it (and placed in fractions, so a resize only scales them). */
    private var fw = 1920
    private var fh = 1080
    private var u = 1f

    private var gen = 0
    private var badges: Bitmap? = null; private var badgesGen = 0
    private var goalBmp: Bitmap? = null; private var goalGen = 0
    private var alertBmp: Bitmap? = null; private var alertGen = 0

    // ---- what is shown (set by the service from the settings and the chat)
    var showSubs = true
    var showViewers = false
    var badgePos = LiveExtras.POS_TL
    var showAlerts = true
    var alertPos = LiveExtras.POS_TC
    var showGoal = false
    var goalPos = LiveExtras.POS_BL
    private var subs = -1L
    private var viewers = -1L
    private var goalTitle = ""
    private var goalNow = 0L
    private var goalTarget = 1L
    private var goalReached = false
    private var goalStartedBelow = false

    // ---- the alert on screen and the ones waiting
    private val queue = ArrayDeque<Alert>()
    private var current: Alert? = null
    private var shownAt = 0L
    private var holdMs = 0L
    @Volatile private var released = false

    fun setSize(w: Int, h: Int) {
        if (w <= 0 || h <= 0 || (w == fw && h == fh)) return
        fw = w; fh = h
        u = minOf(w, h) / 1080f
        redrawBadges(); redrawGoal(); current?.let { alertBmp = drawAlert(it); alertGen = ++gen }
        push()
    }

    fun setStats(viewers: Long, subs: Long) {
        if (viewers == this.viewers && subs == this.subs) return
        this.viewers = viewers; this.subs = subs
        redrawBadges(); push()
    }

    /** The goal: [now] of [target]. Reaching it (after starting below it) gives one celebration alert. */
    fun setGoal(title: String, now: Long, target: Long) {
        val t = target.coerceAtLeast(1)
        if (title == goalTitle && now == goalNow && t == goalTarget) return
        if (goalTarget != t) { goalReached = false; goalStartedBelow = false }
        goalTitle = title; goalNow = now; goalTarget = t
        if (now < t) goalStartedBelow = true
        if (showGoal && !goalReached && goalStartedBelow && now >= t) {
            goalReached = true
            alert(Alert(Kind.GOAL, title, "${Fmt.num(now)} / ${Fmt.num(t)}"))
        }
        redrawGoal(); push()
    }

    /** Settings changed while live. */
    fun refreshAll() { redrawBadges(); redrawGoal(); push() }

    fun alert(a: Alert) {
        if (!showAlerts || released) return
        // A rush of new subscribers is thanked together instead of one by one for minutes.
        if (a.kind == Kind.SUBSCRIBER && queue.count { it.kind == Kind.SUBSCRIBER } >= 3) {
            val subsQ = queue.filter { it.kind == Kind.SUBSCRIBER }
            queue.removeAll { it.kind == Kind.SUBSCRIBER }
            val names = (subsQ.map { it.name } + a.name).filter { it.isNotBlank() }
            queue.addLast(Alert(Kind.SUBSCRIBER, names.take(6).joinToString(ctx.getString(R.string.bot_and)) +
                if (names.size > 6) " +${names.size - 6}" else ""))
        } else if (queue.size < 30) {
            // Paid alerts go first.
            if (a.kind == Kind.SUPER || a.kind == Kind.GIVEAWAY || a.kind == Kind.GOAL) {
                val i = queue.indexOfFirst { it.kind != Kind.SUPER && it.kind != Kind.GIVEAWAY && it.kind != Kind.GOAL }
                if (i < 0) queue.addLast(a) else queue.add(i, a)
            } else queue.addLast(a)
        }
        if (current == null) next()
    }

    fun release() {
        released = true
        main.removeCallbacks(anim)
        queue.clear()
        current = null
        sink(emptyList())
    }

    // ------------------------------------------------------------ alert timing

    private fun next() {
        val a = queue.removeFirstOrNull()
        current = a
        if (a == null) { alertBmp = null; push(); return }
        alertBmp = drawAlert(a)
        alertGen = ++gen
        shownAt = System.currentTimeMillis()
        holdMs = when {
            a.kind == Kind.SUPER && !a.comment.isNullOrBlank() -> 9_000L
            a.kind == Kind.GIVEAWAY || a.kind == Kind.GOAL -> 8_000L
            else -> 5_500L
        }
        main.removeCallbacks(anim)
        main.post(anim)
    }

    private val anim = object : Runnable {
        override fun run() {
            if (released || current == null) return
            val t = System.currentTimeMillis() - shownAt
            if (t > IN + holdMs + OUT) { next(); return }
            push()
            // Moving: 30 times a second; still: only once more when it starts to leave.
            val still = t in IN..(IN + holdMs)
            main.postDelayed(this, if (still) (IN + holdMs - t + 1).coerceAtLeast(1) else 33)
        }
    }

    /** 0…1 visibility of the current alert and its slide (in px of the frame). */
    private fun alertMotion(): Pair<Float, Float> {
        val t = System.currentTimeMillis() - shownAt
        val k = when {
            t < IN -> t / IN.toFloat()
            t < IN + holdMs -> 1f
            else -> (1f - (t - IN - holdMs) / OUT.toFloat()).coerceAtLeast(0f)
        }
        val e = 1f - (1f - k) * (1f - k)   // ease out
        return e to (1f - e) * -28f * u
    }

    // ------------------------------------------------------------ layout

    private fun push() {
        if (released) return
        val out = ArrayList<LookFilter.Layer>()
        val margin = 28f * u
        val gap = 12f * u
        // Stacks per corner: badges, then the goal, then the alert (when they share a corner).
        val used = HashMap<Int, Float>()
        fun place(id: Int, b: Bitmap?, g: Int, pos: Int, alpha: Float = 1f, dy: Float = 0f) {
            if (b == null) return
            val w = b.width.toFloat(); val h = b.height.toFloat()
            val x = when (pos % 3) { 0 -> margin; 1 -> (fw - w) / 2f; else -> fw - margin - w }
            val off = used[pos] ?: 0f
            val top = pos < 3
            val y = if (top) margin + off + dy else fh - margin - off - h - dy
            used[pos] = off + h + gap
            out += LookFilter.Layer(id, b, g, x / fw, y / fh, w / fw, h / fh, alpha)
        }
        if (showSubs || showViewers) place(1, badges, badgesGen, badgePos)
        if (showGoal) place(2, goalBmp, goalGen, goalPos)
        if (current != null && alertBmp != null) {
            val (a, dy) = alertMotion()
            place(3, alertBmp, alertGen, alertPos, a, dy)
        }
        sink(out)
    }

    // ------------------------------------------------------------ drawing

    private fun paint(size: Float, bold: Boolean = false, color: Int = Color.WHITE) = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = size * u
        this.color = color
        typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        setShadowLayer(3f * u, 0f, 1.5f * u, Color.argb(140, 0, 0, 0))
    }

    private fun glass(c: Canvas, r: RectF, radius: Float) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = Color.argb(200, 14, 15, 20)
        c.drawRoundRect(r, radius, radius, p)
        p.style = Paint.Style.STROKE
        p.strokeWidth = 1.5f * u
        p.color = Color.argb(46, 255, 255, 255)
        c.drawRoundRect(r, radius, radius, p)
    }

    private fun redrawBadges() {
        val parts = ArrayList<Pair<Int, String>>()   // icon kind (0 people, 1 eye) and text
        if (showSubs && subs >= 0) parts += 0 to ctx.getString(R.string.ov_subs_fmt, compact(subs))
        if (showViewers && viewers >= 0) parts += 1 to ctx.getString(R.string.ov_viewers_fmt, compact(viewers))
        if (parts.isEmpty()) { badges = null; return }
        val tp = paint(30f, true)
        val ic = 30f * u
        val pad = 18f * u
        val between = 14f * u
        val h = 58f * u
        val widths = parts.map { pad + ic + 10f * u + tp.measureText(it.second) + pad }
        val w = widths.sum() + between * (parts.size - 1)
        val b = Bitmap.createBitmap(w.toInt() + 2, h.toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        var x = 0f
        val order = if (rtl) parts.indices.reversed() else parts.indices
        for (i in order) {
            val (kind, text) = parts[i]
            val r = RectF(x, 0f, x + widths[i], h)
            glass(c, r, h / 2f)
            val iconX = if (rtl) r.right - pad - ic else r.left + pad
            if (kind == 0) person(c, iconX, (h - ic) / 2f, ic, Color.rgb(255, 59, 71)) else eye(c, iconX, (h - ic) / 2f, ic, Color.rgb(106, 166, 255))
            val tx = if (rtl) iconX - 10f * u - tp.measureText(text) else iconX + ic + 10f * u
            c.drawText(text, tx, h / 2f - (tp.descent() + tp.ascent()) / 2f, tp)
            x += widths[i] + between
        }
        badges = b
        badgesGen = ++gen
    }

    private fun redrawGoal() {
        if (!showGoal) { goalBmp = null; return }
        val w = 600f * u
        val h = 112f * u
        val b = Bitmap.createBitmap(w.toInt() + 2, h.toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        glass(c, RectF(0f, 0f, w, h), 22f * u)
        val pad = 22f * u
        val title = paint(30f, true)
        val num = paint(28f, true, Color.argb(235, 255, 255, 255))
        val t = TextUtils.ellipsize(goalTitle, title, w - pad * 2 - 170f * u, TextUtils.TruncateAt.END).toString()
        val ns = "${Fmt.num(goalNow)} / ${Fmt.num(goalTarget)}"
        val base = pad + 30f * u
        if (rtl) {
            c.drawText(t, w - pad - title.measureText(t), base, title)
            c.drawText(ns, pad, base, num)
        } else {
            c.drawText(t, pad, base, title)
            c.drawText(ns, w - pad - num.measureText(ns), base, num)
        }
        val bar = RectF(pad, h - pad - 28f * u, w - pad, h - pad)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = Color.argb(48, 255, 255, 255)
        c.drawRoundRect(bar, bar.height() / 2, bar.height() / 2, p)
        val k = (goalNow.toFloat() / goalTarget).coerceIn(0f, 1f)
        if (k > 0f) {
            val fillW = (bar.width() * k).coerceAtLeast(bar.height())
            val fill = if (rtl) RectF(bar.right - fillW, bar.top, bar.right, bar.bottom) else RectF(bar.left, bar.top, bar.left + fillW, bar.bottom)
            p.shader = LinearGradient(fill.left, 0f, fill.right, 0f, Color.rgb(255, 59, 71), Color.rgb(255, 176, 32), Shader.TileMode.CLAMP)
            c.drawRoundRect(fill, bar.height() / 2, bar.height() / 2, p)
            p.shader = null
        }
        val pct = paint(20f, true)
        val ps = String.format(Locale.US, "%d%%", (k * 100).toInt())
        c.drawText(ps, bar.centerX() - pct.measureText(ps) / 2f, bar.centerY() - (pct.descent() + pct.ascent()) / 2f, pct)
        goalBmp = b
        goalGen = ++gen
    }

    private fun drawAlert(a: Alert): Bitmap {
        val (title, color, mark) = when (a.kind) {
            Kind.SUBSCRIBER -> Triple(ctx.getString(R.string.ov_a_sub), Color.rgb(255, 59, 71), "❤")
            Kind.SUPER -> Triple(ctx.getString(R.string.ov_a_super_fmt, a.detail ?: ""), Color.rgb(255, 176, 32), "$")
            Kind.MEMBER -> Triple(if (a.detail.isNullOrBlank()) ctx.getString(R.string.ov_a_member) else ctx.getString(R.string.ov_a_member_fmt, a.detail), Color.rgb(61, 214, 140), "★")
            Kind.GIFT -> Triple(ctx.getString(R.string.ov_a_gift_fmt, a.detail ?: "1"), Color.rgb(186, 120, 255), "🎁")
            Kind.CHEER -> Triple(ctx.getString(R.string.ov_a_cheer_fmt, a.detail ?: ""), Color.rgb(186, 120, 255), "◆")
            Kind.RAID -> Triple(ctx.getString(R.string.ov_a_raid_fmt, a.detail ?: ""), Color.rgb(106, 166, 255), "⚑")
            Kind.GIVEAWAY -> Triple(ctx.getString(R.string.ov_a_giveaway_fmt, a.detail ?: ""), Color.rgb(106, 166, 255), "🎉")
            Kind.GOAL -> Triple(ctx.getString(R.string.ov_a_goal), Color.rgb(255, 176, 32), "🏆")
        }
        val w = 860f * u
        val pad = 24f * u
        val icon = 104f * u
        val textW = (w - pad * 3 - icon).toInt()
        val tp = paint(32f, true, Color.argb(225, 255, 255, 255))
        val np = paint(50f, true, color)
        val cp = paint(30f, false, Color.argb(235, 255, 255, 255))
        val name = TextUtils.ellipsize(a.name.ifBlank { ctx.getString(R.string.ov_a_someone) }, np, textW.toFloat(), TextUtils.TruncateAt.END).toString()
        val comment = a.comment?.takeIf { it.isNotBlank() }?.let {
            StaticLayout.Builder.obtain(it, 0, it.length, cp, textW)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL).setMaxLines(2).setEllipsize(TextUtils.TruncateAt.END).build()
        }
        val h = pad * 2 + 42f * u + 60f * u + (comment?.let { it.height + 8f * u } ?: 0f)
        val b = Bitmap.createBitmap(w.toInt() + 2, maxOf(h, icon + pad * 2).toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        val r = RectF(0f, 0f, w, b.height - 2f)
        glass(c, r, 28f * u)
        // the accent edge on the side where reading starts
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = color
        val edge = 8f * u
        c.save()
        c.clipRect(if (rtl) RectF(r.right - edge, 0f, r.right, r.bottom) else RectF(0f, 0f, edge, r.bottom))
        c.drawRoundRect(r, 28f * u, 28f * u, p)
        c.restore()
        // round mark
        val cx = if (rtl) r.right - pad - icon / 2f else pad + icon / 2f
        val cy = r.height() / 2f
        p.shader = LinearGradient(cx - icon / 2, cy - icon / 2, cx + icon / 2, cy + icon / 2, color, darker(color), Shader.TileMode.CLAMP)
        c.drawCircle(cx, cy, icon / 2f, p)
        p.shader = null
        val mp = paint(52f, true)
        c.drawText(mark, cx - mp.measureText(mark) / 2f, cy - (mp.descent() + mp.ascent()) / 2f, mp)
        // texts
        val tx0 = if (rtl) pad else pad * 2 + icon
        fun line(s: String, tpaint: TextPaint, y: Float) {
            val x = if (rtl) tx0 + textW - tpaint.measureText(s) else tx0
            c.drawText(s, x, y, tpaint)
        }
        var y = pad + 34f * u
        line(TextUtils.ellipsize(title, tp, textW.toFloat(), TextUtils.TruncateAt.END).toString(), tp, y)
        y += 62f * u
        line(name, np, y)
        if (comment != null) {
            c.save()
            c.translate(tx0, y + 16f * u)
            comment.draw(c)
            c.restore()
        }
        return b
    }

    private fun person(c: Canvas, x: Float, y: Float, s: Float, color: Int) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
        c.drawCircle(x + s / 2f, y + s * 0.32f, s * 0.22f, p)
        val path = Path()
        path.addArc(RectF(x + s * 0.12f, y + s * 0.6f, x + s * 0.88f, y + s * 1.25f), 180f, 180f)
        c.drawPath(path, p)
    }

    private fun eye(c: Canvas, x: Float, y: Float, s: Float, color: Int) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; style = Paint.Style.STROKE; strokeWidth = s * 0.1f }
        val path = Path()
        path.moveTo(x + s * 0.05f, y + s / 2f)
        path.quadTo(x + s / 2f, y + s * 0.05f, x + s * 0.95f, y + s / 2f)
        path.quadTo(x + s / 2f, y + s * 0.95f, x + s * 0.05f, y + s / 2f)
        c.drawPath(path, p)
        p.style = Paint.Style.FILL
        c.drawCircle(x + s / 2f, y + s / 2f, s * 0.16f, p)
    }

    private fun darker(c: Int) = Color.rgb(Color.red(c) * 7 / 10, Color.green(c) * 7 / 10, Color.blue(c) * 7 / 10)

    companion object {
        private const val IN = 350L
        private const val OUT = 350L

        /** 1234 → 1,234; 12345 → 12.3K; 1234567 → 1.23M. */
        fun compact(n: Long): String = when {
            n >= 1_000_000 -> String.format(Locale.US, if (n >= 10_000_000) "%.1fM" else "%.2fM", n / 1_000_000.0).replace(".0M", "M")
            n >= 10_000 -> String.format(Locale.US, if (n >= 100_000) "%.0fK" else "%.1fK", n / 1000.0).replace(".0K", "K")
            else -> String.format(Locale.US, "%,d", n)
        }
    }
}
