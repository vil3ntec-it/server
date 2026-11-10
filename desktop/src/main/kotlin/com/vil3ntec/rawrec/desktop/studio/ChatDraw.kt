package com.vil3ntec.rawrec.desktop.studio

import org.jetbrains.skia.*
import org.jetbrains.skia.paragraph.*
import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.min

/** One thing said or given on a platform. [amount] for paid messages and gifts ("$5.00", "100 bits"). */
data class ChatMessage(
    val id: String, val platform: Platform, val author: String, val text: String,
    val kind: Kind = Kind.MESSAGE, val amount: String? = null, val authorColor: Int? = null,
    val atMs: Long = System.currentTimeMillis(), val translated: String? = null,
) {
    enum class Kind { MESSAGE, SUPERCHAT, GIFT, MEMBER, FOLLOW, BITS, RAID }
    val paid get() = kind != Kind.MESSAGE
}

enum class Platform(val label: String, val color: Int) {
    YOUTUBE("YouTube", 0xFFFF3D3D.toInt()), TWITCH("Twitch", 0xFF9B5CFF.toInt()), KICK("Kick", 0xFF53FC18.toInt()), TEST("RawRec", 0xFF22D3EE.toInt())
}

/**
 * Every platform's chat in one place: the newest messages for the chat box, the paid ones and gifts
 * queued for the alert box, and listeners (the window, translation).
 */
object ChatHub {
    private val recent = ConcurrentLinkedDeque<ChatMessage>()
    private val seen = java.util.Collections.newSetFromMap(java.util.concurrent.ConcurrentHashMap<String, Boolean>())
    val alerts = ConcurrentLinkedDeque<ChatMessage>()
    val listeners = CopyOnWriteArrayList<(ChatMessage) -> Unit>()
    @Volatile var version = 0L; private set

    fun add(m: ChatMessage) {
        if (!seen.add(m.platform.name + m.id)) return           // the same message twice (a reconnect) shows once
        recent.addLast(m)
        while (recent.size > 200) recent.pollFirst()
        if (seen.size > 5000) seen.clear()
        if (m.paid) alerts.addLast(m)
        version++
        for (l in listeners) try { l(m) } catch (_: Throwable) {}
    }

    /** A message with its translation added (the same message, updated in place). */
    fun update(m: ChatMessage) {
        val it = recent.iterator()
        val list = ArrayList<ChatMessage>()
        while (it.hasNext()) { val x = it.next(); list.add(if (x.id == m.id && x.platform == m.platform) m else x) }
        recent.clear(); recent.addAll(list); version++
    }

    fun newest(n: Int): List<ChatMessage> = recent.toList().takeLast(n)
    fun clear() { recent.clear(); alerts.clear(); seen.clear(); version++ }
}

private fun para(text: String, size: Float, color: Int, bold: Boolean, w: Float, rtl: Boolean, extra: List<Pair<String, TextStyle>> = emptyList()): Paragraph {
    val st = TextStyle().setFontFamilies(Fonts.families).setFontSize(size).setColor(color)
        .setFontStyle(if (bold) FontStyle.BOLD else FontStyle.NORMAL)
    val ps = ParagraphStyle().apply { textStyle = st; direction = if (rtl) Direction.RTL else Direction.LTR; alignment = Alignment.START }
    val b = ParagraphBuilder(ps, Fonts.collection)
    for ((t, s) in extra) { b.pushStyle(s); b.addText(t); b.popStyle() }
    b.pushStyle(st).addText(text).popStyle()
    return b.build().apply { layout(w) }
}

/** Kept in its own direction inside Persian text: "$5.00" stays "$5.00", a Latin name stays whole. */
private fun iso(s: String) = "\u2068$s\u2069"

private fun isRtl(s: String) = s.firstOrNull { it.isLetter() }?.let { it in '֐'..'ࣿ' } ?: false

/**
 * The chat on the picture: newest at the bottom, older ones rising and fading out; each message with
 * its platform's mark and the author's name kept exactly as written (never translated).
 */
class ChatSource(private val def: () -> SourceDef?) : DrawnSource {
    private val cache = LinkedHashMap<String, Paragraph>()
    override fun draw(c: Canvas, w: Float, h: Float) {
        val d = def() ?: return
        val size = d.prop("size", "30").toFloatOrNull() ?: 30f
        val fadeS = d.prop("fade", "0").toIntOrNull() ?: 0          // 0 = never fade out
        val showOriginal = d.prop("original", "1") == "1"
        val pad = size * 0.45f
        val gap = size * 0.3f
        val now = System.currentTimeMillis()
        var y = h
        val used = HashSet<String>()
        for (m in ChatHub.newest(40).asReversed()) {
            if (fadeS > 0 && now - m.atMs > fadeS * 1000L + 1000) break
            val key = "${m.platform}${m.id}|${m.translated}|$w|$size|$showOriginal"
            used.add(key)
            val body = m.translated?.let { tr -> if (showOriginal && tr != m.text) "$tr\n${m.text}" else tr } ?: m.text
            val p = cache.getOrPut(key) {
                val name = TextStyle().setFontFamilies(Fonts.families).setFontSize(size).setFontStyle(FontStyle.BOLD)
                    .setColor(m.authorColor ?: m.platform.color)
                para(body, size, 0xFFFFFFFF.toInt(), false, w - pad * 2 - size * 0.5f, isRtl(body),
                    listOf("${iso(m.author)}${if (m.amount != null) "  ${iso(m.amount)}" else ""}:  " to name))
            }
            val bh = p.height + pad * 1.2f
            y -= bh
            if (y < 0) break
            val age = (now - m.atMs) / 1000f
            val alpha = if (fadeS > 0 && age > fadeS) (1f - (age - fadeS)).coerceIn(0f, 1f) else 1f
            Paint().use { bg ->
                bg.color = if (m.paid) 0xCC7A4A00.toInt() else 0xB3101418.toInt()
                bg.alpha = (bg.alpha * alpha).toInt()
                c.drawRRect(RRect.makeXYWH(0f, y, w, bh, size * 0.4f), bg)
                bg.color = m.platform.color; bg.alpha = (255 * alpha).toInt()
                c.drawRRect(RRect.makeXYWH(w - size * 0.22f, y + pad * 0.5f, size * 0.12f, bh - pad, size * 0.06f), bg)
            }
            if (alpha < 1f) Paint().use { a -> a.alpha = (alpha * 255).toInt(); c.saveLayer(null, a) }
            p.paint(c, pad, y + pad * 0.6f)
            if (alpha < 1f) c.restore()
            y -= gap
        }
        val stale = cache.keys.filter { it !in used }
        for (k in stale) cache.remove(k)?.close()
    }
    override fun close() { cache.values.forEach { it.close() }; cache.clear() }
}

/**
 * Super Chats, gifts, new members and bits, one at a time: slides in, stays [hold] seconds, fades out;
 * the next waits its turn (none is ever skipped).
 */
class AlertSource(private val def: () -> SourceDef?) : DrawnSource {
    private var current: ChatMessage? = null
    private var since = 0L
    private var para: Paragraph? = null
    private var title: Paragraph? = null
    override fun draw(c: Canvas, w: Float, h: Float) {
        val d = def() ?: return
        val holdMs = (d.prop("hold", "7").toIntOrNull() ?: 7) * 1000L
        val now = System.currentTimeMillis()
        if (current == null || now - since > holdMs + 600) {
            current = ChatHub.alerts.pollFirst()
            since = now
            para?.close(); title?.close(); para = null; title = null
        }
        val m = current ?: return
        val t = now - since
        val inA = min(1f, t / 350f)
        val outA = if (t > holdMs) (1f - (t - holdMs) / 600f).coerceIn(0f, 1f) else 1f
        val a = inA * outA
        val size = min(h * 0.26f, w * 0.05f)
        if (title == null) {
            val what = when (m.kind) {
                ChatMessage.Kind.SUPERCHAT -> "سوپرچت"; ChatMessage.Kind.GIFT -> "هدیه"; ChatMessage.Kind.MEMBER -> "عضوِ تازه"
                ChatMessage.Kind.FOLLOW -> "دنبال‌کنندهٔ تازه"; ChatMessage.Kind.BITS -> "بیتس"; ChatMessage.Kind.RAID -> "رِید"; else -> ""
            }
            title = para("${iso(m.author)}${m.amount?.let { "  •  ${iso(it)}" } ?: ""}  —  $what", size * 1.05f, 0xFFFFFFFF.toInt(), true, w - size * 2, true)
            para = para(m.translated ?: m.text, size * 0.85f, 0xFFF5F7FA.toInt(), false, w - size * 2, isRtl(m.translated ?: m.text))
        }
        c.save()
        c.translate(0f, (1f - inA) * -h * 0.4f)
        Paint().use { p ->
            p.shader = Shader.makeLinearGradient(0f, 0f, w, h, intArrayOf(0xF0F59E0B.toInt(), 0xF0DB2777.toInt()))
            p.alpha = (235 * a).toInt()
            c.drawRRect(RRect.makeXYWH(0f, 0f, w, h, size * 0.6f), p)
        }
        Paint().use { p -> p.alpha = (255 * a).toInt(); c.saveLayer(null, p) }
        title?.paint(c, size, size * 0.4f)
        para?.paint(c, size, size * 0.6f + (title?.height ?: 0f))
        c.restore()
        c.restore()
    }
    override fun close() { para?.close(); title?.close() }
}
