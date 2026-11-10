package com.vil3ntec.rawrec.desktop.studio

import com.vil3ntec.rawrec.desktop.Session
import com.vil3ntec.rawrec.desktop.VideoDecoder
import org.bytedeco.ffmpeg.avcodec.AVCodecContext
import org.bytedeco.ffmpeg.avformat.AVFormatContext
import org.bytedeco.ffmpeg.avutil.AVDictionary
import org.bytedeco.ffmpeg.global.avcodec.*
import org.bytedeco.ffmpeg.global.avdevice.avdevice_register_all
import org.bytedeco.ffmpeg.global.avformat.*
import org.bytedeco.ffmpeg.global.avutil.*
import org.bytedeco.ffmpeg.global.swscale.*
import org.bytedeco.javacpp.BytePointer
import org.bytedeco.javacpp.DoublePointer
import org.bytedeco.javacpp.IntPointer
import org.bytedeco.javacpp.Pointer
import org.bytedeco.javacpp.PointerPointer
import org.jetbrains.skia.*
import org.jetbrains.skia.paragraph.*
import java.io.File
import java.util.concurrent.atomic.AtomicReference

/** What a layer shows, made ready on the picture thread. */
sealed interface SourceRuntime : AutoCloseable {
    override fun close() {}
}

/** Sources that are a picture (phone, webcam, video file, image). */
interface PictureSource : SourceRuntime {
    /** The newest picture, or null while there is none; called on the picture thread only. */
    fun image(): Image?
    /** The size it is shown at, from its own size: sources that decode convert straight to it (see VideoDecoder.scaleTo). */
    fun want(size: ((Int, Int) -> Pair<Int, Int>?)?) {}
}

/** Sources drawn straight into their box (text, colour, chat, alerts), in the box's own pixels. */
interface DrawnSource : SourceRuntime {
    fun draw(c: Canvas, w: Float, h: Float)
}

/** BGRA pixels handed from a capture thread to the picture thread. */
class Pixels(val w: Int, val h: Int, val bgra: ByteArray, val seq: Long)

/** Turns the newest [Pixels] into a Skia image, only when they changed. */
private class LatestImage {
    private var seq = -1L
    private var img: Image? = null
    fun from(p: Pixels?): Image? {
        if (p == null) { img?.close(); img = null; seq = -1; return null }
        if (p.seq != seq) {
            img?.close()
            img = Image.makeRaster(ImageInfo(p.w, p.h, ColorType.BGRA_8888, ColorAlphaType.OPAQUE), p.bgra, p.w * 4)
            seq = p.seq
        }
        return img
    }
    fun close() { img?.close(); img = null }
}

/** The phone on the cable: whatever [Session] decoded last. */
class PhoneSource(private val session: () -> Session?) : PictureSource {
    private val latest = LatestImage()
    override fun want(size: ((Int, Int) -> Pair<Int, Int>?)?) { session()?.scaleTo = size }
    override fun image(): Image? {
        val p = session()?.latest?.get() ?: return latest.from(null)
        return latest.from(Pixels(p.width, p.height, p.bgra, p.seq))
    }
    override fun close() = latest.close()
}

/** A still picture from a file (PNG, JPEG, WebP, …). */
class ImageFileSource(path: String) : PictureSource {
    private val img: Image? = try { Image.makeFromEncoded(File(path).readBytes()) } catch (_: Exception) { null }
    override fun image() = img
    override fun close() { img?.close() }
}

/**
 * A webcam (the system's own capture: DirectShow, AVFoundation, Video4Linux) or a video file played in a
 * loop, decoded on its own thread; the picture thread takes the newest picture, never waits for one.
 */
class MediaSource(private val format: String?, private val url: String, private val loop: Boolean, private val options: Map<String, String> = emptyMap()) : PictureSource {
    private val newest = AtomicReference<Pixels?>(null)
    private val latest = LatestImage()
    @Volatile private var scaleTo: ((Int, Int) -> Pair<Int, Int>?)? = null
    override fun want(size: ((Int, Int) -> Pair<Int, Int>?)?) { scaleTo = size }
    @Volatile private var running = true
    @Volatile var error: String? = null; private set
    private val thread = Thread({ run() }, "source-$url").apply { isDaemon = true; start() }

    override fun image(): Image? = latest.from(newest.get())

    private fun run() {
        var seq = 0L
        while (running) {
            try {
                val ic = AVFormatContext(null as Pointer?)
                val fmt = format?.let { avdevice_register_all(); av_find_input_format(it) }
                val opts = AVDictionary(null as Pointer?)
                for ((k, v) in options) av_dict_set(opts, k, v, 0)
                val r = avformat_open_input(ic, url, fmt, opts)
                av_dict_free(opts)
                if (r < 0) { error = VideoDecoder.err(r); Thread.sleep(2000); continue }
                try {
                    avformat_find_stream_info(ic, null as PointerPointer<*>?)
                    val vi = av_find_best_stream(ic, AVMEDIA_TYPE_VIDEO, -1, -1, null as org.bytedeco.ffmpeg.avcodec.AVCodec?, 0)
                    if (vi < 0) { error = "no picture in it"; return }
                    val st = ic.streams(vi)
                    val codec = avcodec_find_decoder(st.codecpar().codec_id()) ?: run { error = "unknown picture format"; return }
                    val dec: AVCodecContext = avcodec_alloc_context3(codec)
                    avcodec_parameters_to_context(dec, st.codecpar())
                    dec.thread_count(0)
                    check(avcodec_open2(dec, codec, null as AVDictionary?) >= 0)
                    error = null
                    val pkt = av_packet_alloc(); val frm = av_frame_alloc()
                    var sws: org.bytedeco.ffmpeg.swscale.SwsContext? = null
                    val tb = av_q2d(st.time_base())
                    var t0Ns = 0L; var firstPts = Long.MIN_VALUE
                    try {
                        while (running && av_read_frame(ic, pkt) >= 0) {
                            if (pkt.stream_index() == vi && avcodec_send_packet(dec, pkt) >= 0) {
                                while (avcodec_receive_frame(dec, frm) >= 0) {
                                    val sw = frm.width(); val sh = frm.height()
                                    val (w, h) = (scaleTo?.invoke(sw, sh) ?: (sw to sh)).let { (a, b) -> a.coerceIn(2, 7680) to b.coerceIn(2, 7680) }
                                    val fl = if (w * h < sw * sh) SWS_AREA else SWS_BICUBIC
                                    sws = sws_getCachedContext(sws, sw, sh, frm.format(), w, h, AV_PIX_FMT_BGRA, fl, null, null, null as DoublePointer?)
                                    val out = ByteArray(w * h * 4)
                                    val bp = BytePointer(out.size.toLong())
                                    val dst = PointerPointer<BytePointer>(4L).put(0L, bp); val ls = IntPointer(4L).put(0L, w * 4)
                                    sws_scale(sws, frm.data(), frm.linesize(), 0, sh, dst, ls)
                                    bp.get(out); bp.close(); dst.close(); ls.close()
                                    // a file plays at its own speed; a camera gives pictures as they come
                                    if (format == null) {
                                        val pts = frm.best_effort_timestamp()
                                        if (pts != AV_NOPTS_VALUE) {
                                            if (firstPts == Long.MIN_VALUE) { firstPts = pts; t0Ns = System.nanoTime() }
                                            val due = t0Ns + ((pts - firstPts) * tb * 1e9).toLong()
                                            val wait = due - System.nanoTime()
                                            if (wait > 0) Thread.sleep(wait / 1_000_000, (wait % 1_000_000).toInt())
                                        }
                                    }
                                    newest.set(Pixels(w, h, out, ++seq))
                                }
                            }
                            av_packet_unref(pkt)
                        }
                    } finally {
                        sws?.let { sws_freeContext(it) }
                        av_frame_free(frm); av_packet_free(pkt); avcodec_free_context(dec)
                    }
                } finally { avformat_close_input(ic) }
                if (!loop) { while (running) Thread.sleep(200) }
            } catch (e: InterruptedException) { return } catch (e: Throwable) { error = e.message ?: e.javaClass.simpleName; Thread.sleep(2000) }
        }
    }

    override fun close() { running = false; thread.interrupt(); latest.close() }

    companion object {
        /** The system's camera input, by name as the system lists it. */
        fun webcam(device: String): MediaSource {
            val os = System.getProperty("os.name").lowercase()
            return when {
                os.contains("win") -> MediaSource("dshow", "video=$device", true, mapOf("rtbufsize" to "64M"))
                os.contains("mac") -> MediaSource("avfoundation", device, true, mapOf("framerate" to "30"))
                else -> MediaSource("v4l2", device, true)
            }
        }
    }
}

/** Fonts for drawn text: Vazirmatn (shipped with the app) first, so Persian is shaped right everywhere. */
object Fonts {
    val collection: FontCollection by lazy {
        val provider = TypefaceFontProvider()
        for (f in listOf("Vazirmatn-Regular.ttf", "Vazirmatn-Bold.ttf")) {
            Fonts::class.java.classLoader.getResourceAsStream("fonts/$f")?.use { s ->
                FontMgr.default.makeFromData(Data.makeFromBytes(s.readBytes()))?.let { provider.registerTypeface(it, "Vazirmatn") }
            }
        }
        FontCollection().setDefaultFontManager(FontMgr.default).setAssetFontManager(provider)
    }
    val families = arrayOf("Vazirmatn", "Segoe UI", "Noto Sans", "Helvetica", "Arial")

    fun color(s: String, def: Int): Int = try {
        val h = s.trim().removePrefix("#")
        when (h.length) { 6 -> (0xFF000000 or h.toLong(16)).toInt(); 8 -> h.toLong(16).toInt(); else -> def }
    } catch (_: Exception) { def }
}

/** Text in its box: size, colour, outline, background, alignment; right-to-left for Persian. */
class TextSource(private val def: () -> SourceDef?) : DrawnSource {
    private var key = ""
    private var para: Paragraph? = null
    override fun draw(c: Canvas, w: Float, h: Float) {
        val d = def() ?: return
        val text = d.prop("text", d.name)
        val size = d.prop("size", "64").toFloatOrNull() ?: 64f
        val k = "$text|$size|${d.props}|$w"
        if (k != key) {
            para?.close()
            val st = TextStyle().setFontFamilies(Fonts.families).setFontSize(size)
                .setColor(Fonts.color(d.prop("color", "#FFFFFF"), -1))
                .setFontStyle(if (d.prop("bold", "1") == "1") FontStyle.BOLD else FontStyle.NORMAL)
            if (d.prop("shadow", "1") == "1") st.addShadow(Shadow(0x99000000.toInt(), 0f, size * 0.05f, size * 0.08))
            val ps = ParagraphStyle().apply {
                textStyle = st
                direction = if (text.any { it in '؀'..'ۿ' }) Direction.RTL else Direction.LTR
                alignment = when (d.prop("align", "center")) { "start" -> Alignment.START; "end" -> Alignment.END; else -> Alignment.CENTER }
            }
            para = ParagraphBuilder(ps, Fonts.collection).pushStyle(st).addText(text).popStyle().build().apply { layout(w) }
            key = k
        }
        val bg = d.prop("bg")
        if (bg.isNotBlank()) Paint().use { p -> p.color = Fonts.color(bg, 0x80000000.toInt()); c.drawRRect(RRect.makeXYWH(0f, 0f, w, h, h * 0.18f), p) }
        val p = para ?: return
        p.paint(c, 0f, ((h - p.height) / 2).coerceAtLeast(0f))
    }
    override fun close() { para?.close() }
}

/** A colour or a two-colour gradient filling the box. */
class ColorSource(private val def: () -> SourceDef?) : DrawnSource {
    override fun draw(c: Canvas, w: Float, h: Float) {
        val d = def() ?: return
        val a = Fonts.color(d.prop("color", "#101820"), 0xFF101820.toInt())
        val b = d.prop("color2").takeIf { it.isNotBlank() }?.let { Fonts.color(it, a) }
        Paint().use { p ->
            if (b != null) p.shader = Shader.makeLinearGradient(0f, 0f, if (d.prop("vertical") == "1") 0f else w, if (d.prop("vertical") == "1") h else 0f, intArrayOf(a, b))
            else p.color = a
            c.drawRect(Rect.makeWH(w, h), p)
        }
    }
}
