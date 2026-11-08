package com.vil3ntec.rawrec

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.View
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Draws the picture of a layer (text, chat, alert, goal bar, shape) in pixels of a 1920×1080
 * frame, from the layer's own settings and the stream's numbers — used by the stream and by the
 * editor alike, so what is arranged is exactly what viewers get. Pictures and GIFs are decoded
 * here too. Any thread.
 */
object LayerPainter {

    /** The stream's numbers and messages, for {subs} {viewers} … and the chat / goal layers. */
    class Data {
        @Volatile var subs = -1L
        @Volatile var viewers = -1L
        @Volatile var likes = -1L
        @Volatile var members = 0L
        @Volatile var supers = 0L
        @Volatile var startedAt = 0L
        @Volatile var lastSub = ""
        @Volatile var lastSuper = ""
        @Volatile var manual = 0L
        @Volatile var chat: List<ChatLine> = emptyList()
        /** Values when the stream started, for goals counted «since the start». */
        val base = HashMap<String, Long>()
        fun value(count: String): Long = when (count) {
            "subs" -> subs
            "likes" -> likes
            "viewers" -> viewers
            "members" -> members
            "supers" -> supers
            else -> manual
        }
    }

    class ChatLine(val id: String, val author: String, val text: String, val nameColor: Int, val accent: Int? = null)

    enum class AlertKind { SUBSCRIBER, SUPER, MEMBER, GIFT, CHEER, RAID, GIVEAWAY, GOAL }
    class Alert(val kind: AlertKind, val name: String, val amount: String? = null, val message: String? = null)

    fun rtl(ctx: Context) = ctx.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL

    // ------------------------------------------------------------ text variables

    /** {subs} {viewers} {likes} {members} {uptime} {time} {date} {last_sub} {last_super} with live values. */
    fun vars(t: String, d: Data): String {
        if (!t.contains('{')) return t
        fun n(v: Long) = if (v < 0) "…" else Num.compact(v)
        val up = if (d.startedAt > 0) (System.currentTimeMillis() - d.startedAt) / 1000 else 0
        return t.replace("{subs}", n(d.subs)).replace("{viewers}", n(d.viewers)).replace("{likes}", n(d.likes))
            .replace("{members}", Num.compact(d.members)).replace("{supers}", Num.compact(d.supers))
            .replace("{uptime}", ChatBot.uptime(up))
            .replace("{time}", SimpleDateFormat("HH:mm", Locale.US).format(Date()))
            .replace("{date}", SimpleDateFormat("yyyy/MM/dd", Locale.US).format(Date()))
            .replace("{last_sub}", d.lastSub.ifBlank { "—" }).replace("{last_super}", d.lastSuper.ifBlank { "—" })
    }

    /** True when the text changes by itself with time (redrawn every second). */
    fun ticks(t: String) = t.contains("{time}") || t.contains("{uptime}")

    // ------------------------------------------------------------ painting

    fun typeface(font: Int, bold: Boolean): Typeface {
        val family = when (font) { 1 -> "serif"; 2 -> "monospace"; 3 -> "sans-serif-condensed"; 4 -> "sans-serif-black"; else -> "sans-serif" }
        return Typeface.create(family, if (bold) Typeface.BOLD else Typeface.NORMAL)
    }

    private fun paint(size: Float, color: Int, bold: Boolean = false, shadow: Float = 0.6f, font: Int = 0) = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = size
        this.color = color
        typeface = typeface(font, bold)
        if (shadow > 0f) setShadowLayer(2f + 5f * shadow, 0f, 1.5f * shadow, Color.argb((120 + 135 * shadow).toInt().coerceAtMost(255), 0, 0, 0))
    }

    private fun glass(c: Canvas, r: RectF, radius: Float, alpha: Int, color: Int = Color.rgb(14, 15, 20)) {
        if (alpha <= 0) return
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
        c.drawRoundRect(r, radius, radius, p)
        p.style = Paint.Style.STROKE
        p.strokeWidth = 1.5f
        p.color = Color.argb(alpha * 46 / 255, 255, 255, 255)
        c.drawRoundRect(r, radius, radius, p)
    }

    /** The layer's picture, or null for kinds that are not drawn here (video, camera, web) or not ready. */
    fun paint(ctx: Context, l: Scenes.Layer, d: Data, alert: Alert?, sample: Boolean): Bitmap? = try {
        when (l.kind) {
            Scenes.Kind.TEXT -> text(l, vars(l.str("text"), d), rtl(ctx))
            Scenes.Kind.SHAPE -> shape(l)
            Scenes.Kind.CHAT -> chat(ctx, l, if (sample && d.chat.isEmpty()) sampleChat(ctx) else d.chat)
            Scenes.Kind.GOAL -> goal(ctx, l, d, sample)
            Scenes.Kind.ALERTS -> (alert ?: if (sample) Alert(AlertKind.SUBSCRIBER, "Sara_99") else null)?.let { alertPic(ctx, l, it) }
            Scenes.Kind.IMAGE -> image(ctx, l.str("file"))
            else -> null
        }
    } catch (_: Throwable) { null }

    fun text(l: Scenes.Layer, t: String, rtl: Boolean): Bitmap {
        val tp = paint(l.num("size", 56f), l.int("color", Color.WHITE), l.bool("bold", true), l.num("shadow", 0.8f), l.int("font", 0))
        val pad = l.num("pad", 16f)
        val bg = l.int("bg", 0)
        val maxW = l.num("maxw", 0f).takeIf { it > 0 }?.toInt() ?: 1880
        val text = t.ifEmpty { " " }
        val natural = text.lines().maxOf { tp.measureText(it) }.toInt() + 2
        val w = natural.coerceIn(1, maxW)
        val align = when (l.int("align", 1)) { 0 -> Layout.Alignment.ALIGN_NORMAL; 2 -> Layout.Alignment.ALIGN_OPPOSITE; else -> Layout.Alignment.ALIGN_CENTER }
        val sl = StaticLayout.Builder.obtain(text, 0, text.length, tp, w).setAlignment(align).setIncludePad(false).build()
        val padX = if (Color.alpha(bg) > 0) pad * 1.6f else pad * 0.5f
        val padY = if (Color.alpha(bg) > 0) pad else pad * 0.4f
        val bw = (w + padX * 2).toInt() + 2
        val bh = (sl.height + padY * 2).toInt() + 2
        val b = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        if (Color.alpha(bg) > 0) {
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = bg }
            val r = l.num("radius", 18f).coerceAtMost(bh / 2f)
            c.drawRoundRect(RectF(0f, 0f, bw - 1f, bh - 1f), r, r, p)
        }
        c.translate(padX, padY)
        sl.draw(c)
        return b
    }

    fun shape(l: Scenes.Layer): Bitmap {
        val w = l.int("w", 600).coerceIn(4, 2600)
        val h = l.int("h", 120).coerceIn(4, 1080)
        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        val r = l.num("radius", 24f).coerceAtMost(minOf(w, h) / 2f)
        val bw = l.num("borderW", 0f)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = l.int("color", Color.argb(200, 14, 15, 20)) }
        val rect = RectF(bw / 2f, bw / 2f, w - bw / 2f, h - bw / 2f)
        c.drawRoundRect(rect, r, r, p)
        if (bw > 0f) {
            p.style = Paint.Style.STROKE; p.strokeWidth = bw; p.color = l.int("border", Color.WHITE)
            c.drawRoundRect(rect, r, r, p)
        }
        return b
    }

    private fun sampleChat(ctx: Context) = listOf(
        ChatLine("1", "Ali", ctx.getString(R.string.lay_sample_chat1), Color.rgb(255, 138, 128)),
        ChatLine("2", "Sara_99", "this clutch was insane", Color.rgb(61, 214, 140)),
        ChatLine("3", "Navid", Num.ltr("$5.00") + " — " + ctx.getString(R.string.lay_sample_chat2), Color.rgb(128, 216, 255), Color.argb(90, 255, 176, 32)),
    )

    /** The chat box: style 0 no background, 1 one glass box, 2 a bubble per message. */
    fun chat(ctx: Context, l: Scenes.Layer, lines0: List<ChatLine>): Bitmap? {
        val maxLines = l.int("lines", 6).coerceIn(1, 20)
        val lines = lines0.takeLast(maxLines)
        if (lines.isEmpty()) return null
        val style = l.int("style", 1)
        val w = l.num("width", 600f).coerceIn(200f, 1900f)
        val size = l.num("size", 29f)
        val pad = 18f
        val textW = (w - pad * 2).toInt()
        val bare = style == 0
        val tp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = size; color = l.int("color", Color.WHITE)
            if (bare) { typeface = Typeface.DEFAULT_BOLD; setShadowLayer(4f, 0f, 0f, Color.BLACK) } else setShadowLayer(3f, 0f, 1.5f, Color.argb(160, 0, 0, 0))
        }
        val layouts = ArrayList<Pair<StaticLayout, ChatLine>>()
        var total = 0f
        for (cl in lines) {
            val sb = SpannableStringBuilder()
            sb.append(cl.author)
            sb.setSpan(ForegroundColorSpan(cl.nameColor), 0, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            sb.setSpan(StyleSpan(Typeface.BOLD), 0, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            if (cl.text.isNotBlank()) sb.append(": ").append(cl.text)
            val sl = StaticLayout.Builder.obtain(sb, 0, sb.length, tp, textW)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL).setMaxLines(3).setEllipsize(TextUtils.TruncateAt.END).build()
            layouts += sl to cl
            total += sl.height + 12f
        }
        val bh = total + pad * 2 - 12f
        val b = Bitmap.createBitmap(w.toInt() + 2, bh.toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        if (style == 1) glass(c, RectF(0f, 0f, w, bh), 22f, l.int("bgAlpha", 200))
        var y = pad
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        for ((sl, cl) in layouts) {
            val lineL = (0 until sl.lineCount).minOf { sl.getLineLeft(it) }
            val lineR = (0 until sl.lineCount).maxOf { sl.getLineRight(it) }
            val r = RectF(pad + lineL - 10f, y - 5f, pad + lineR + 10f, y + sl.height + 5f)
            if (style == 2) { p.color = Color.argb(l.int("bgAlpha", 200), 14, 15, 20); c.drawRoundRect(r, 14f, 14f, p) }
            cl.accent?.let {
                p.color = it
                c.drawRoundRect(if (style == 1) RectF(pad - 8f, y - 4f, w - pad + 8f, y + sl.height + 4f) else r, 12f, 12f, p)
            }
            c.save(); c.translate(pad, y); sl.draw(c); c.restore()
            y += sl.height + 12f
        }
        return b
    }

    /** The goal bar: free title (with {variables}), what it counts, start, target, colours. */
    fun goal(ctx: Context, l: Scenes.Layer, d: Data, sample: Boolean): Bitmap {
        val rtl = rtl(ctx)
        val count = l.str("count", "subs")
        val target = l.int("target", 1000).toLong().coerceAtLeast(1)
        var now = d.value(count)
        if (now >= 0 && l.bool("since", false)) now -= d.base[count] ?: now
        if (sample && now < 0) now = target * 74 / 100
        val known = now >= 0
        val w = l.num("width", 600f).coerceIn(250f, 1900f)
        val h = 112f
        val b = Bitmap.createBitmap(w.toInt() + 2, h.toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        glass(c, RectF(0f, 0f, w, h), 22f, l.int("bgAlpha", 200))
        val pad = 22f
        val color = l.int("color", Color.WHITE)
        val title = paint(30f, color, true, 0.6f, l.int("font", 0))
        val num = paint(28f, color, true, 0.6f)
        val ns = Num.ltr("${if (known) Num.grouped(now) else "…"} / ${Num.grouped(target)}")
        val t = TextUtils.ellipsize(vars(l.str("title"), d), title, w - pad * 2 - num.measureText(ns) - 20f, TextUtils.TruncateAt.END).toString()
        val base = pad + 30f
        if (rtl) { c.drawText(t, w - pad - title.measureText(t), base, title); c.drawText(ns, pad, base, num) }
        else { c.drawText(t, pad, base, title); c.drawText(ns, w - pad - num.measureText(ns), base, num) }
        val bar = RectF(pad, h - pad - 28f, w - pad, h - pad)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = Color.argb(48, 255, 255, 255)
        c.drawRoundRect(bar, bar.height() / 2, bar.height() / 2, p)
        val k = if (known) (now.toFloat() / target).coerceIn(0f, 1f) else 0f
        if (k > 0f) {
            val fillW = (bar.width() * k).coerceAtLeast(bar.height())
            val fill = if (rtl) RectF(bar.right - fillW, bar.top, bar.right, bar.bottom) else RectF(bar.left, bar.top, bar.left + fillW, bar.bottom)
            p.color = Color.WHITE
            p.shader = LinearGradient(fill.left, 0f, fill.right, 0f, l.int("c1", Color.rgb(255, 59, 71)), l.int("c2", Color.rgb(255, 176, 32)), Shader.TileMode.CLAMP)
            c.drawRoundRect(fill, bar.height() / 2, bar.height() / 2, p)
            p.shader = null
        }
        if (l.bool("pct", true)) {
            val pct = paint(20f, Color.WHITE, true)
            val ps = String.format(Locale.US, "%d%%", (k * 100).toInt())
            c.drawText(ps, bar.centerX() - pct.measureText(ps) / 2f, bar.centerY() - (pct.descent() + pct.ascent()) / 2f, pct)
        }
        return b
    }

    fun alertColor(k: AlertKind) = when (k) {
        AlertKind.SUBSCRIBER -> Color.rgb(255, 59, 71)
        AlertKind.SUPER, AlertKind.GOAL -> Color.rgb(255, 176, 32)
        AlertKind.MEMBER -> Color.rgb(61, 214, 140)
        AlertKind.GIFT, AlertKind.CHEER -> Color.rgb(186, 120, 255)
        AlertKind.RAID, AlertKind.GIVEAWAY -> Color.rgb(106, 166, 255)
    }

    private fun template(l: Scenes.Layer, a: Alert): String = when (a.kind) {
        AlertKind.SUBSCRIBER -> l.str("t_sub")
        AlertKind.SUPER -> l.str("t_super")
        AlertKind.MEMBER -> l.str("t_member")
        AlertKind.GIFT -> l.str("t_gift")
        AlertKind.CHEER -> l.str("t_cheer")
        AlertKind.RAID -> l.str("t_raid")
        AlertKind.GIVEAWAY -> l.str("t_give")
        AlertKind.GOAL -> l.str("t_goal")
    }

    /** One alert: the owner's text for its kind ({name} {amount} {message}), their colour and picture. */
    fun alertPic(ctx: Context, l: Scenes.Layer, a: Alert): Bitmap {
        val rtl = rtl(ctx)
        val color = l.int("color", 0).takeIf { it != 0 } ?: alertColor(a.kind)
        val mark = when (a.kind) {
            AlertKind.SUBSCRIBER -> "❤"; AlertKind.SUPER -> "$"; AlertKind.MEMBER -> "★"; AlertKind.GIFT -> "🎁"
            AlertKind.CHEER -> "◆"; AlertKind.RAID -> "⚑"; AlertKind.GIVEAWAY -> "🎉"; AlertKind.GOAL -> "🏆"
        }
        val raw = template(l, a).ifBlank { "{name}" }
        val line = raw.replace("{name}", a.name.ifBlank { ctx.getString(R.string.ov_a_someone) })
            .replace("{amount}", Num.ltr(a.amount ?: "")).replace("{message}", "")
        val w = 860f
        val pad = 24f
        val icon = 104f
        val textW = (w - pad * 3 - icon).toInt()
        val np = paint(44f, Color.WHITE, true, 0.6f)
        val cp = paint(30f, Color.argb(235, 255, 255, 255), false, 0.6f)
        val main = StaticLayout.Builder.obtain(line, 0, line.length, np, textW).setMaxLines(2).setEllipsize(TextUtils.TruncateAt.END).build()
        val comment = a.message?.takeIf { it.isNotBlank() }?.let {
            StaticLayout.Builder.obtain(it, 0, it.length, cp, textW).setMaxLines(2).setEllipsize(TextUtils.TruncateAt.END).build()
        }
        val h = maxOf(icon + pad * 2, pad * 2 + main.height + (comment?.let { it.height + 10f } ?: 0f))
        val b = Bitmap.createBitmap(w.toInt() + 2, h.toInt() + 2, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        val r = RectF(0f, 0f, w, h)
        glass(c, r, 28f, 210)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
        c.save(); c.clipRect(if (rtl) RectF(r.right - 8f, 0f, r.right, r.bottom) else RectF(0f, 0f, 8f, r.bottom)); c.drawRoundRect(r, 28f, 28f, p); c.restore()
        val cx = if (rtl) r.right - pad - icon / 2f else pad + icon / 2f
        val cy = r.height() / 2f
        val pic = l.str("image").takeIf { it.isNotBlank() }?.let { image(ctx, it, 256) }
        if (pic != null) {
            c.drawBitmap(pic, null, RectF(cx - icon / 2, cy - icon / 2, cx + icon / 2, cy + icon / 2), Paint(Paint.FILTER_BITMAP_FLAG))
        } else {
            p.shader = LinearGradient(cx - icon / 2, cy - icon / 2, cx + icon / 2, cy + icon / 2, color, darker(color), Shader.TileMode.CLAMP)
            c.drawCircle(cx, cy, icon / 2f, p); p.shader = null
            val mp = paint(52f, Color.WHITE, true, 0.4f)
            c.drawText(mark, cx - mp.measureText(mark) / 2f, cy - (mp.descent() + mp.ascent()) / 2f, mp)
        }
        val tx = if (rtl) pad else pad * 2 + icon
        var y = (h - main.height - (comment?.let { it.height + 10f } ?: 0f)) / 2f
        c.save(); c.translate(tx, y); main.draw(c); c.restore()
        y += main.height + 10f
        if (comment != null) { c.save(); c.translate(tx, y); comment.draw(c); c.restore() }
        return b
    }

    private fun darker(c: Int) = Color.rgb(Color.red(c) * 7 / 10, Color.green(c) * 7 / 10, Color.blue(c) * 7 / 10)

    private val images = object : LinkedHashMap<String, Bitmap>(8, 0.75f, true) {
        override fun removeEldestEntry(e: MutableMap.MutableEntry<String, Bitmap>?) = size > 12
    }

    /** A picture from the owner's files, at most [max] px on its long side (kept in a small cache). */
    fun image(ctx: Context, path: String, max: Int = 1920): Bitmap? {
        if (path.isBlank()) return null
        val f = File(path)
        if (!f.isFile) return null
        val key = "$path:${f.lastModified()}:$max"
        synchronized(images) { images[key] }?.let { return it }
        // ImageDecoder turns phone photos the way they were taken (EXIF); a plain bitmap, so it can be drawn and uploaded
        val b = try {
            android.graphics.ImageDecoder.decodeBitmap(android.graphics.ImageDecoder.createSource(f)) { dec, info, _ ->
                dec.allocator = android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE
                var sample = 1
                while (maxOf(info.size.width, info.size.height) / (sample * 2) >= max) sample *= 2
                if (sample > 1) dec.setTargetSampleSize(sample)
            }
        } catch (_: Exception) {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(path, o)
            var sample = 1
            while (maxOf(o.outWidth, o.outHeight) / (sample * 2) >= max) sample *= 2
            BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        val k = minOf(1f, max.toFloat() / maxOf(b.width, b.height))
        val out = if (k < 1f) Bitmap.createScaledBitmap(b, (b.width * k).toInt().coerceAtLeast(1), (b.height * k).toInt().coerceAtLeast(1), true) else b
        synchronized(images) { images[key] = out }
        return out
    }

    /** A grey stand-in for the camera / video in the editor. */
    fun placeholder(ctx: Context, w: Int, h: Int, label: String, iconRes: Int): Bitmap {
        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        c.drawColor(Color.rgb(40, 44, 54))
        val p = paint(h * 0.1f, Color.argb(220, 255, 255, 255), true, 0.3f)
        p.textAlign = Paint.Align.CENTER
        c.drawText(label, w / 2f, h * 0.62f, p)
        val path = Path()
        path.addCircle(w / 2f, h * 0.36f, h * 0.12f, Path.Direction.CW)
        c.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(120, 255, 255, 255) })
        return b
    }
}

/** Numbers as viewers read them. */
object Num {
    /** Numbers and amounts stay left-to-right inside Persian text («$5.00», not «5.00$»). */
    fun ltr(s: String) = if (s.isEmpty()) s else "⁦$s⁩"
    fun grouped(n: Long): String = String.format(Locale.US, "%,d", n)
    /** 1234 → 1,234; 12345 → 12.3K; 1234567 → 1.23M. */
    fun compact(n: Long): String = when {
        n >= 1_000_000 -> String.format(Locale.US, if (n >= 10_000_000) "%.1fM" else "%.2fM", n / 1_000_000.0).replace(".0M", "M")
        n >= 10_000 -> String.format(Locale.US, if (n >= 100_000) "%.0fK" else "%.1fK", n / 1000.0).replace(".0K", "K")
        else -> String.format(Locale.US, "%,d", n)
    }
}
