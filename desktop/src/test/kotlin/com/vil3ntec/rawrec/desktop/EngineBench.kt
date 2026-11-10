package com.vil3ntec.rawrec.desktop

import org.bytedeco.ffmpeg.global.avutil.AV_PIX_FMT_BGRA
import org.bytedeco.ffmpeg.global.swscale.*
import org.bytedeco.javacpp.BytePointer
import org.bytedeco.javacpp.DoublePointer
import org.bytedeco.javacpp.IntPointer
import org.bytedeco.javacpp.PointerPointer
import org.jetbrains.skia.*

/** Where the engine's time goes, piece by piece (run by hand: gradle pipelineCheck -PcheckMain=...EngineBenchKt). */
fun main() {
    fun t(name: String, n: Int = 30, f: () -> Unit) { repeat(3) { f() }; val a = System.nanoTime(); repeat(n) { f() }; println("%-34s %6.2f ms".format(name, (System.nanoTime() - a) / 1e6 / n)) }
    val sw = 1280; val sh = 720; val dw = 1920; val dh = 1080
    val src = ByteArray(sw * sh * 4) { (it * 7).toByte() }
    t("Image.makeRaster 1280x720") { Image.makeRaster(ImageInfo(sw, sh, ColorType.BGRA_8888, ColorAlphaType.OPAQUE), src, sw * 4).close() }
    val sp = BytePointer(src.size.toLong()).put(*src)
    val dp = BytePointer(dw.toLong() * dh * 4)
    for ((nm, fl) in listOf("bicubic+accurate" to (SWS_BICUBIC or SWS_ACCURATE_RND), "bicubic" to SWS_BICUBIC, "lanczos" to SWS_LANCZOS, "bilinear" to SWS_BILINEAR)) {
        val c = sws_getContext(sw, sh, AV_PIX_FMT_BGRA, dw, dh, AV_PIX_FMT_BGRA, fl, null, null, null as DoublePointer?)
        val spp = PointerPointer<BytePointer>(4L).put(0L, sp); val sl = IntPointer(4L).put(0L, sw * 4)
        val dpp = PointerPointer<BytePointer>(4L).put(0L, dp); val dl = IntPointer(4L).put(0L, dw * 4)
        var r = 0
        t("sws up $nm", 10) { r = sws_scale(c, spp, sl, 0, sh, dpp, dl) }
        println("   (rows out: $r)")
        sws_freeContext(c)
    }
    val surf = Surface.makeRasterN32Premul(dw, dh)
    val big = Image.makeRaster(ImageInfo(dw, dh, ColorType.BGRA_8888, ColorAlphaType.OPAQUE), ByteArray(dw * dh * 4), dw * 4)
    t("clear 1080p") { surf.canvas.clear(0xFF000000.toInt()) }
    t("drawImage 1:1 1080p") { surf.canvas.drawImage(big, 0f, 0f) }
    val small = Image.makeRaster(ImageInfo(sw, sh, ColorType.BGRA_8888, ColorAlphaType.OPAQUE), src, sw * 4)
    t("skia up linear") { surf.canvas.drawImageRect(small, Rect.makeWH(sw.toFloat(), sh.toFloat()), Rect.makeWH(dw.toFloat(), dh.toFloat()), FilterMipmap(FilterMode.LINEAR, MipmapMode.NONE), null, true) }
    t("skia up cubic") { surf.canvas.drawImageRect(small, Rect.makeWH(sw.toFloat(), sh.toFloat()), Rect.makeWH(dw.toFloat(), dh.toFloat()), CubicResampler(1 / 3f, 1 / 3f), null, true) }
    val bytes = ByteArray(dw * dh * 4)
    t("copy 8MB ByteArray") { dp.position(0).get(bytes) }
    t("snapshot+close") { surf.makeImageSnapshot().close(); surf.canvas.clear(0) }
}
