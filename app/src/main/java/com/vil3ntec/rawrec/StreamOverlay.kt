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
    /** A chat message as viewers see it on the stream; [accent] colours paid / member lines. */
    class ChatLine(val id: String, val author: String, val text: String, val nameColor: Int, val accent: Int? = null)
    class Alert(val kind: Kind, val name: String, val detail: String? = null, val comment: String? = null)

    private val main = Handler(Looper.getMainLooper())
    private val rtl = ctx.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
    /** Frame size; the pictures are drawn for it (and placed in fractions, so a resize only scales them). */
    private var fw = 1920
    private var fh = 1080
    private var u = 1f

    private var gen = 0
    private var subsBmp: Bitmap? = null; private var subsGen = 0
    private var viewersBmp: Bitmap? = null; private var viewersGen = 0
    private var goalBmp: Bitmap? = null; private var goalGen = 0
    private var alertBmp: Bitmap? = null; private var alertGen = 0
    private var chatBmp: Bitmap? = null; private var chatGen = 0

    // ---- what is shown (set by the service from the settings and the chat)
    var showSubs = true
    var showViewers = false
    var showAlerts = true
    var showGoal = false
    var showChat = false
    /** Where each thing sits (OverlayLayout keys), as the owner arranged it in «چیدمانِ پخش». */
    private var places: Map<String, OverlayLayout.Place> = OverlayLayout.ITEMS.associate { it.key to OverlayLayout.Place(it.defX, it.defY, 1f) }

    fun setPlaces(p: Map<String, OverlayLayout.Place>) { places = p; push() }
    /** 0 no background (outlined text), 1 one glass box, 2 a bubble per message. */
    var chatStyle = 1
    private var subs = -1L
    private var viewers = -1L
    private var goalTitle = ""
    private var goalNow = 0L
    private var goalKnown: Long? = null
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

    /**
     * The goal: [now] of [target]; [now] null = not known yet (the bar shows «… / target»).
     * Reaching it after a known value below it gives one celebration alert (a goal already passed
     * when the stream starts is not celebrated).
     */
    fun setGoal(title: String, now: Long?, target: Long) {
        val t = target.coerceAtLeast(1)
        if (title == goalTitle && now == goalKnown && t == goalTarget) return
        if (goalTarget != t) { goalReached = false; goalStartedBelow = false }
        goalTitle = title; goalTarget = t; goalKnown = now
        goalNow = now ?: 0
        if (now != null && now < t) goalStartedBelow = true
        if (now != null && showGoal && !goalReached && goalStartedBelow && now >= t) {
            goalReached = true
            alert(Alert(Kind.GOAL, title, "${grouped(now)} / ${grouped(t)}"))
        }
        redrawGoal(); push()
    }

    /** The latest messages (oldest first) for the chat on the stream; empty = none shown. */
    fun setChat(lines: List<ChatLine>) {
        chatBmp = if (lines.isEmpty()) null else drawChat(lines)
        chatGen = ++gen
        push()
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
        /** [b] scaled by its place, centred where the owner put it, kept inside the frame. */
        fun place(id: Int, key: String, b: Bitmap?, g: Int, alpha: Float = 1f, dy: Float = 0f) {
            if (b == null) return
            val p = places[key] ?: return
            val w = b.width * p.scale; val h = b.height * p.scale
            val x = (p.x * fw - w / 2f).coerceIn(0f, maxOf(0f, fw - w))
            val y = (p.y * fh - h / 2f).coerceIn(0f, maxOf(0f, fh - h))
            out += LookFilter.Layer(id, b, g, x / fw, (y + dy) / fh, w / fw, h / fh, alpha)
        }
        if (showSubs) place(1, OverlayLayout.SUBS, subsBmp, subsGen)
        if (showViewers) place(5, OverlayLayout.VIEWERS, viewersBmp, viewersGen)
        if (showGoal) place(2, OverlayLayout.GOAL, goalBmp, goalGen)
        if (showChat) place(4, OverlayLayout.CHAT, chatBmp, chatGen)
        if (current != null && alertBmp != null) {
            val (a, dy) = alertMotion()
            place(3, OverlayLayout.ALERT, alertBmp, alertGen, a, dy)
        }
        sink(out)
    }

    /**
     * Each thing as viewers would see it, with sample content, for «چیدمانِ پخش» (drawn by the
     * same code as the stream, so what is arranged there is exactly what appears).
     */
    fun samples(): Map<String, Bitmap> = mapOf(
        OverlayLayout.SUBS to badge(0, ctx.getString(R.string.ov_subs_fmt, compact(12_345))),
        OverlayLayout.VIEWERS to badge(1, ctx.getString(R.string.ov_viewers_fmt, compact(1_234))),
        OverlayLayout.GOAL to drawGoal(ctx.getString(R.string.ov_goal_subs_fmt, "13000"), 12_345, 13_000),
        OverlayLayout.CHAT to drawChat(listOf(
            ChatLine("1", "Ali", ctx.getString(R.string.lay_sample_chat1), Color.rgb(255, 138, 128)),
            ChatLine("2", "Sara_99", "this clutch was insane", Color.rgb(61, 214, 140)),
            ChatLine("3", "Navid", ltr("$5.00") + " — " + ctx.getString(R.string.lay_sample_chat2), Color.rgb(128, 216, 255), Color.argb(90, 255, 176, 32)),
        )),
        OverlayLayout.ALERT to drawAlert(Alert(Kind.SUBSCRIBER, "Sara_99")),
    )

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
        subsBmp = if (showSubs && subs >= 0) badge(0, ctx.getString(R.string.ov_subs_fmt, compact(subs))) else null
        subsGen = ++gen
        viewersBmp = if (showViewers && viewers >= 0) badge(1, ctx.getString(R.string.ov_viewers_fmt, compact(viewers))) else null
        viewersGen = ++gen
    }

    /** One counter pill: [kind] 0 people (subscribers), 1 eye (viewers). */
    private fun badge(kind: Int, text: String): Bitmap {
        val tp = paint(30f, true)
        val ic = 30f * u
        val pad = 18f * u
        val h = 58f * u
        val w = pad + ic + 10f * u + tp.measureText(text) + pad
        val b = Bitmap.createBitmap(w.toInt() + 2, h.toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        val r = RectF(0f, 0f, w, h)
        glass(c, r, h / 2f)
        val iconX = if (rtl) r.right - pad - ic else r.left + pad
        if (kind == 0) person(c, iconX, (h - ic) / 2f, ic, Color.rgb(255, 59, 71)) else eye(c, iconX, (h - ic) / 2f, ic, Color.rgb(106, 166, 255))
        val tx = if (rtl) iconX - 10f * u - tp.measureText(text) else iconX + ic + 10f * u
        c.drawText(text, tx, h / 2f - (tp.descent() + tp.ascent()) / 2f, tp)
        return b
    }

    private fun redrawGoal() {
        if (!showGoal) { goalBmp = null; return }
        goalBmp = drawGoal(goalTitle, goalKnown, goalTarget)
        goalGen = ++gen
    }

    private fun drawGoal(goalTitle: String, goalKnown: Long?, goalTarget: Long): Bitmap {
        val goalNow = goalKnown ?: 0L
        val w = 600f * u
        val h = 112f * u
        val b = Bitmap.createBitmap(w.toInt() + 2, h.toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        glass(c, RectF(0f, 0f, w, h), 22f * u)
        val pad = 22f * u
        val title = paint(30f, true)
        val num = paint(28f, true, Color.argb(235, 255, 255, 255))
        val t = TextUtils.ellipsize(goalTitle, title, w - pad * 2 - 170f * u, TextUtils.TruncateAt.END).toString()
        val ns = ltr("${goalKnown?.let { grouped(it) } ?: "…"} / ${grouped(goalTarget)}")
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
            p.color = Color.WHITE   // full alpha: the paint's alpha would dim the gradient
            p.shader = LinearGradient(fill.left, 0f, fill.right, 0f, Color.rgb(255, 59, 71), Color.rgb(255, 176, 32), Shader.TileMode.CLAMP)
            c.drawRoundRect(fill, bar.height() / 2, bar.height() / 2, p)
            p.shader = null
        }
        val pct = paint(20f, true)
        val ps = String.format(Locale.US, "%d%%", (k * 100).toInt())
        c.drawText(ps, bar.centerX() - pct.measureText(ps) / 2f, bar.centerY() - (pct.descent() + pct.ascent()) / 2f, pct)
        return b
    }

    private fun drawChat(lines: List<ChatLine>): Bitmap {
        val w = 600f * u
        val pad = 18f * u
        val textW = (w - pad * 2).toInt()
        val bare = chatStyle == 0
        val tp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 29f * u
            color = Color.WHITE
            if (bare) { typeface = Typeface.DEFAULT_BOLD; setShadowLayer(4f * u, 0f, 0f, Color.BLACK) }
            else setShadowLayer(3f * u, 0f, 1.5f * u, Color.argb(160, 0, 0, 0))
        }
        // newest last; as many as fit in the box
        val layouts = ArrayList<Pair<StaticLayout, ChatLine>>()
        var total = 0f
        for (l in lines.reversed()) {
            val sb = android.text.SpannableStringBuilder()
            sb.append(l.author)
            sb.setSpan(android.text.style.ForegroundColorSpan(l.nameColor), 0, sb.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            sb.setSpan(android.text.style.StyleSpan(Typeface.BOLD), 0, sb.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            if (l.text.isNotBlank()) sb.append(": ").append(l.text)
            val sl = StaticLayout.Builder.obtain(sb, 0, sb.length, tp, textW)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL).setMaxLines(2).setEllipsize(TextUtils.TruncateAt.END).build()
            val h = sl.height + 12f * u
            if (layouts.isNotEmpty() && total + h > 430f * u) break
            layouts += sl to l
            total += h
        }
        layouts.reverse()
        val bh = total + pad * 2 - 12f * u
        val b = Bitmap.createBitmap(w.toInt() + 2, bh.toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        if (chatStyle == 1) glass(c, RectF(0f, 0f, w, bh), 22f * u)
        var y = pad
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        for ((sl, l) in layouts) {
            // a bubble of the line's own width (style 2), or only the paid / member highlight
            // where the text really is (a line can run right-to-left or left-to-right by its first letter)
            val lineL = (0 until sl.lineCount).minOf { sl.getLineLeft(it) }
            val lineR = (0 until sl.lineCount).maxOf { sl.getLineRight(it) }
            val r = RectF(pad + lineL - 10f * u, y - 5f * u, pad + lineR + 10f * u, y + sl.height + 5f * u)
            if (chatStyle == 2) { p.color = Color.argb(185, 14, 15, 20); c.drawRoundRect(r, 14f * u, 14f * u, p) }
            l.accent?.let {
                p.color = it
                c.drawRoundRect(if (chatStyle == 1) RectF(pad - 8f * u, y - 4f * u, w - pad + 8f * u, y + sl.height + 4f * u) else r, 12f * u, 12f * u, p)
            }
            c.save()
            c.translate(pad, y)
            sl.draw(c)
            c.restore()
            y += sl.height + 12f * u
        }
        return b
    }

    private fun drawAlert(a: Alert): Bitmap {
        val (title, color, mark) = when (a.kind) {
            Kind.SUBSCRIBER -> Triple(ctx.getString(R.string.ov_a_sub), Color.rgb(255, 59, 71), "❤")
            Kind.SUPER -> Triple(ctx.getString(R.string.ov_a_super_fmt, ltr(a.detail ?: "")), Color.rgb(255, 176, 32), "$")
            Kind.MEMBER -> Triple(if (a.detail.isNullOrBlank()) ctx.getString(R.string.ov_a_member) else ctx.getString(R.string.ov_a_member_fmt, a.detail), Color.rgb(61, 214, 140), "★")
            Kind.GIFT -> Triple(ctx.getString(R.string.ov_a_gift_fmt, a.detail ?: "1"), Color.rgb(186, 120, 255), "🎁")
            Kind.CHEER -> Triple(ctx.getString(R.string.ov_a_cheer_fmt, ltr(a.detail ?: "")), Color.rgb(186, 120, 255), "◆")
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

        /** Numbers and amounts stay left-to-right inside Persian text («$5.00», not «5.00$»). */
        fun ltr(s: String) = if (s.isEmpty()) s else "\u2066$s\u2069"

        fun grouped(n: Long): String = String.format(Locale.US, "%,d", n)

        /** 1234 → 1,234; 12345 → 12.3K; 1234567 → 1.23M. */
        fun compact(n: Long): String = when {
            n >= 1_000_000 -> String.format(Locale.US, if (n >= 10_000_000) "%.1fM" else "%.2fM", n / 1_000_000.0).replace(".0M", "M")
            n >= 10_000 -> String.format(Locale.US, if (n >= 100_000) "%.0fK" else "%.1fK", n / 1000.0).replace(".0K", "K")
            else -> String.format(Locale.US, "%,d", n)
        }
    }
}
