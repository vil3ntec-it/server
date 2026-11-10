package com.vil3ntec.rawrec.desktop.studio

import org.jetbrains.skia.*
import org.jetbrains.skia.paragraph.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min

/** The pictures of a folder one after another, each [every] seconds, crossfading; loaded one ahead, never all at once. */
class SlideshowSource(private val def: () -> SourceDef?) : DrawnSource {
    override fun stamp(w: Float, h: Float): Any? = if (prev != null || System.currentTimeMillis() - shownAt > ((def()?.prop("every", "5")?.toIntOrNull() ?: 5) * 1000L - 50)) null else listOf(index, folder, def()?.props, w, h)
    private var files: List<File> = emptyList()
    private var folder = ""
    private var index = 0
    private var shownAt = 0L
    private var cur: Image? = null
    private var prev: Image? = null

    private fun load(f: File): Image? = try { Image.makeFromEncoded(f.readBytes()) } catch (_: Exception) { null }

    override fun draw(c: Canvas, w: Float, h: Float) {
        val d = def() ?: return
        val dir = d.prop("folder")
        if (dir != folder) {
            folder = dir
            files = File(dir).listFiles { f -> f.isFile && f.extension.lowercase() in setOf("png", "jpg", "jpeg", "webp", "bmp", "gif") }?.sortedBy { it.name.lowercase() } ?: emptyList()
            index = 0; prev?.close(); prev = null; cur?.close(); cur = files.firstOrNull()?.let(::load); shownAt = System.currentTimeMillis()
        }
        if (files.isEmpty()) return
        val every = (d.prop("every", "5").toIntOrNull() ?: 5).coerceAtLeast(1) * 1000L
        val now = System.currentTimeMillis()
        if (now - shownAt >= every && files.size > 1) {
            index = (index + 1) % files.size
            prev?.close(); prev = cur; cur = load(files[index]); shownAt = now
        }
        val fade = ((now - shownAt) / 700f).coerceIn(0f, 1f)
        val cover = d.prop("fit", "cover") == "cover"
        if (fade < 1f) prev?.let { put(c, it, w, h, cover, 1f) } else { prev?.close(); prev = null }
        cur?.let { put(c, it, w, h, cover, fade) }
    }

    private fun put(c: Canvas, img: Image, w: Float, h: Float, cover: Boolean, a: Float) {
        val s = if (cover) max(w / img.width, h / img.height) else min(w / img.width, h / img.height)
        val dw = img.width * s; val dh = img.height * s
        Paint().use { p ->
            p.alpha = (a * 255).toInt()
            c.save(); c.clipRect(Rect.makeWH(w, h))
            c.drawImageRect(img, Rect.makeWH(img.width.toFloat(), img.height.toFloat()), Rect.makeXYWH((w - dw) / 2, (h - dh) / 2, dw, dh),
                FilterMipmap(FilterMode.LINEAR, MipmapMode.LINEAR), p, true)
            c.restore()
        }
    }

    override fun close() { cur?.close(); prev?.close() }
}

/**
 * Viewers, followers and subscribers of the owner's channels, read from each platform's public pages
 * every 30 s (no login, no API quota). YouTube rounds its public subscriber count (e.g. «1.2K»); that
 * rounding is what is shown.
 */
object PlatformStats {
    enum class Metric(val label: String) { VIEWERS("بیننده"), FOLLOWERS("دنبال‌کننده"), SUBSCRIBERS("مشترک") }
    data class Value(val n: Long, val text: String, val atMs: Long = System.currentTimeMillis())

    private val values = ConcurrentHashMap<String, Value>()
    @Volatile var errors: Map<Platform, String> = emptyMap(); private set
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build()
    @Volatile private var channels: Map<Platform, String> = emptyMap()
    @Volatile private var thread: Thread? = null

    fun get(p: Platform, m: Metric): Value? = values["${p.name}.${m.name}"]
    fun set(p: Platform, m: Metric, v: Value) { values["${p.name}.${m.name}"] = v }
    /** The sum over every platform (the goal bar can count all of them). */
    fun total(m: Metric): Long = Platform.entries.sumOf { get(it, m)?.n ?: 0 }

    fun watch(ch: Map<Platform, String>) {
        channels = ch.filterValues { it.isNotBlank() }
        if (thread == null) thread = Thread({
            while (true) {
                val errs = HashMap<Platform, String>()
                for ((p, c) in channels) try { fetch(p, c) } catch (e: Exception) { errs[p] = e.message ?: e.javaClass.simpleName }
                errors = errs
                try { Thread.sleep(30_000) } catch (_: InterruptedException) { }
            }
        }, "platform-stats").apply { isDaemon = true; start() }
        else thread?.interrupt()
    }

    private fun get(url: String, headers: Map<String, String> = emptyMap()): HttpResponse<String> {
        val b = HttpRequest.newBuilder(URI(url)).header("User-Agent", ChatClient.UA).timeout(Duration.ofSeconds(15))
        for ((k, v) in headers) b.header(k, v)
        return http.send(b.GET().build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun fetch(p: Platform, ch: String) {
        when (p) {
            Platform.TWITCH -> {
                val login = ch.trim().removePrefix("https://").removePrefix("www.").removePrefix("twitch.tv/").trim('/').lowercase()
                val q = JSONArray().put(JSONObject().put("query", "query{user(login:\"${login.replace("\"", "")}\"){followers{totalCount} stream{viewersCount}}}")).toString()
                val r = http.send(HttpRequest.newBuilder(URI("https://gql.twitch.tv/gql")).header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
                    .timeout(Duration.ofSeconds(15)).POST(HttpRequest.BodyPublishers.ofString(q)).build(), HttpResponse.BodyHandlers.ofString())
                val u = JSONArray(r.body()).getJSONObject(0).getJSONObject("data").optJSONObject("user") ?: throw IllegalStateException("کانال پیدا نشد")
                u.optJSONObject("followers")?.optLong("totalCount")?.let { set(p, Metric.FOLLOWERS, Value(it, fmt(it))) }
                val v = u.optJSONObject("stream")?.optLong("viewersCount") ?: 0
                set(p, Metric.VIEWERS, Value(v, fmt(v)))
            }
            Platform.KICK -> {
                val slug = ch.trim().removePrefix("https://").removePrefix("www.").removePrefix("kick.com/").trim('/').lowercase()
                val r = get("https://kick.com/api/v2/channels/" + URLEncoder.encode(slug, "UTF-8"), mapOf("Accept" to "application/json"))
                if (r.statusCode() != 200) throw IllegalStateException("کیک ${r.statusCode()}")
                val o = JSONObject(r.body())
                val f = o.optLong("followers_count", o.optLong("followersCount", 0)); set(p, Metric.FOLLOWERS, Value(f, fmt(f)))
                val v = o.optJSONObject("livestream")?.optLong("viewer_count") ?: 0; set(p, Metric.VIEWERS, Value(v, fmt(v)))
            }
            Platform.YOUTUBE -> {
                val live = get(YouTubeChat.watchUrl(ch), mapOf("Cookie" to "CONSENT=YES+1; SOCS=CAI", "Accept-Language" to "en-US,en;q=0.9")).body()
                val watching = Regex("\"(?:originalViewCount|concurrentViewers)\":\"(\\d+)\"").find(live)?.groupValues?.get(1)?.toLongOrNull()
                    ?: Regex("([\\d,]+) watching").find(live)?.groupValues?.get(1)?.replace(",", "")?.toLongOrNull()
                set(p, Metric.VIEWERS, Value(watching ?: 0, fmt(watching ?: 0)))
                val subs = Regex("\"subscriberCountText\":\\{[^}]*?\"simpleText\":\"([^\"]+)\"").find(live)?.groupValues?.get(1)
                    ?: Regex("([\\d.,]+[KMB]?) subscribers").find(live)?.groupValues?.get(1)
                subs?.let { t -> parseShort(t)?.let { set(p, Metric.SUBSCRIBERS, Value(it, t.substringBefore(" subscriber").trim())) } }
            }
            Platform.TEST -> {}
        }
    }

    /** «1.2K» → 1200, «3.45M subscribers» → 3450000. */
    fun parseShort(t: String): Long? {
        val m = Regex("([\\d.,]+)\\s*([KMB])?", RegexOption.IGNORE_CASE).find(t) ?: return null
        val n = m.groupValues[1].replace(",", "").toDoubleOrNull() ?: return null
        val k = when (m.groupValues[2].uppercase()) { "K" -> 1e3; "M" -> 1e6; "B" -> 1e9; else -> 1.0 }
        return (n * k).toLong()
    }

    fun fmt(n: Long): String = when {
        n >= 1_000_000 -> "%.1fM".format(java.util.Locale.US, n / 1e6)
        n >= 10_000 -> "%.1fK".format(java.util.Locale.US, n / 1e3)
        else -> "%,d".format(java.util.Locale.US, n)
    }
}

private fun text(t: String, size: Float, color: Int, bold: Boolean, w: Float, align: Alignment = Alignment.CENTER): Paragraph {
    val st = TextStyle().setFontFamilies(Fonts.families).setFontSize(size).setColor(color).setFontStyle(if (bold) FontStyle.BOLD else FontStyle.NORMAL)
    val ps = ParagraphStyle().apply { textStyle = st; alignment = align; direction = if (t.any { it in '؀'..'ۿ' }) Direction.RTL else Direction.LTR }
    return ParagraphBuilder(ps, Fonts.collection).pushStyle(st).addText(t).popStyle().build().apply { layout(w) }
}

private fun metricOf(d: SourceDef) = runCatching { PlatformStats.Metric.valueOf(d.prop("metric", "VIEWERS")) }.getOrDefault(PlatformStats.Metric.VIEWERS)

/** The value a counter or goal shows: one platform's, or all platforms' together. */
private fun valueOf(d: SourceDef): Long {
    val m = metricOf(d)
    val p = d.prop("platform", "ALL")
    return if (p == "ALL") PlatformStats.total(m) else runCatching { PlatformStats.get(Platform.valueOf(p), m)?.n ?: 0 }.getOrDefault(0)
}

/** A live number (viewers, followers, subscribers) with its label, in a capsule. */
class CounterSource(private val def: () -> SourceDef?) : DrawnSource {
    override fun stamp(w: Float, h: Float): Any? = def()?.let { listOf(it.props, valueOf(it), w, h) }
    private var key = ""; private var para: Paragraph? = null
    override fun draw(c: Canvas, w: Float, h: Float) {
        val d = def() ?: return
        val m = metricOf(d)
        val n = valueOf(d)
        val label = d.prop("label").ifBlank { m.label }
        val txt = "${PlatformStats.fmt(n)}  $label"
        val size = h * 0.48f
        val k = "$txt|$w|$h"
        if (k != key) { para?.close(); para = text(txt, size, 0xFFFFFFFF.toInt(), true, w - h * 0.6f); key = k }
        Paint().use { p -> p.color = Fonts.color(d.prop("bg", "#CC0F172A"), 0xCC0F172A.toInt()); c.drawRRect(RRect.makeXYWH(0f, 0f, w, h, h / 2), p) }
        Paint().use { p -> p.color = Fonts.color(d.prop("accent", "#EF4444"), 0xFFEF4444.toInt()); c.drawCircle(h * 0.45f, h / 2, h * 0.14f, p) }
        para?.let { it.paint(c, h * 0.6f, (h - it.height) / 2) }
    }
    override fun close() { para?.close() }
}

/** A goal bar: «۲۳۴ / ۵۰۰ مشترک», filling toward the target, with the count from the platforms or set by hand. */
class GoalSource(private val def: () -> SourceDef?) : DrawnSource {
    private var key = ""; private var para: Paragraph? = null
    private var shown = 0f
    private var target = 0f
    // still while the bar has reached its value
    override fun stamp(w: Float, h: Float): Any? = def()?.let { d -> if (kotlin.math.abs(shown - target) > 0.001f) null else listOf(d.props, valueOf(d), w, h) }
    override fun draw(c: Canvas, w: Float, h: Float) {
        val d = def() ?: return
        val target = (d.prop("target", "100").toLongOrNull() ?: 100).coerceAtLeast(1)
        val start = d.prop("start", "0").toLongOrNull() ?: 0
        val now = if (d.prop("platform", "ALL") == "MANUAL") d.prop("value", "0").toLongOrNull() ?: 0 else valueOf(d)
        val got = (now - start).coerceAtLeast(0)
        val f = (got.toFloat() / target).coerceIn(0f, 1f)
        this.target = f
        shown += (f - shown) * 0.08f
        if (kotlin.math.abs(f - shown) < 0.001f) shown = f                 // the bar moves to a new value smoothly
        val label = d.prop("label").ifBlank { "هدف: ${metricOf(d).label}" }
        val txt = "$label   ${PlatformStats.fmt(got)} / ${PlatformStats.fmt(target)}"
        val k = "$txt|$w|$h"
        if (k != key) { para?.close(); para = text(txt, h * 0.42f, 0xFFFFFFFF.toInt(), true, w - h * 0.5f); key = k }
        val r = h / 2
        Paint().use { p -> p.color = 0xCC0F172A.toInt(); c.drawRRect(RRect.makeXYWH(0f, 0f, w, h, r), p) }
        if (shown > 0.002f) Paint().use { p ->
            p.shader = Shader.makeLinearGradient(0f, 0f, w, 0f, intArrayOf(Fonts.color(d.prop("color", "#2DD4BF"), -1), Fonts.color(d.prop("color2", "#3B82F6"), -1)))
            c.save(); c.clipRRect(RRect.makeXYWH(0f, 0f, w, h, r), ClipMode.INTERSECT, true)
            c.drawRect(Rect.makeXYWH(0f, 0f, w * shown, h), p); c.restore()
        }
        para?.let { it.paint(c, h * 0.25f, (h - it.height) / 2) }
    }
    override fun close() { para?.close() }
}
