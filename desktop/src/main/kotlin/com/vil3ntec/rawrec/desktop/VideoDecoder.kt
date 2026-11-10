package com.vil3ntec.rawrec.desktop

import org.bytedeco.ffmpeg.avcodec.AVCodecContext
import org.bytedeco.ffmpeg.avcodec.AVPacket
import org.bytedeco.ffmpeg.avutil.AVDictionary
import org.bytedeco.ffmpeg.avutil.AVFrame
import org.bytedeco.ffmpeg.global.avcodec.*
import org.bytedeco.ffmpeg.global.avutil.*
import org.bytedeco.ffmpeg.global.swscale.*
import org.bytedeco.ffmpeg.swscale.SwsContext
import org.bytedeco.javacpp.BytePointer
import org.bytedeco.javacpp.DoublePointer
import org.bytedeco.javacpp.IntPointer
import org.bytedeco.javacpp.PointerPointer
import java.nio.ByteBuffer

/**
 * One decoded picture, BGRA, 4 bytes a pixel, rows packed ([width] * 4 bytes). The buffer is only valid
 * during the callback that hands it over: whoever keeps the picture copies it.
 */
class VideoFrame(val width: Int, val height: Int, val bgra: ByteBuffer, val ptsUs: Long)

/**
 * The phone's stream (H.264 / HEVC / AV1 packets, Annex-B) into BGRA pictures. Low delay: no frame
 * threading (each picture comes out as soon as its packet is in), slice threads only. A size change
 * (the phone turned) is followed on the next picture.
 */
class VideoDecoder(codec: String) : AutoCloseable {
    private val ctx: AVCodecContext
    private val pkt: AVPacket = av_packet_alloc()
    private val frm: AVFrame = av_frame_alloc()
    private var sws: SwsContext? = null
    private var out: BytePointer? = null
    private var outW = 0
    private var outH = 0
    /** A configuration packet (SPS/PPS/VPS) waits to go in front of the next picture, as scrcpy itself does. */
    private var pendingConfig: ByteArray? = null
    @Volatile var decoded = 0L; private set
    /**
     * The size the picture is shown at, from its own size (null = as it is): converting straight to it here,
     * from YUV where FFmpeg's scaler is fastest, spares the studio any resampling (laid down 1:1).
     */
    @Volatile var scaleTo: ((Int, Int) -> Pair<Int, Int>?)? = null
    private var lastCs = -1; private var lastRange = -1
    /** The picture's own size as the phone sends it (before [scaleTo]). */
    @Volatile var srcW = 0; private set
    @Volatile var srcH = 0; private set
    @Volatile var errors = 0L; private set

    init {
        val c = avcodec_find_decoder_by_name(if (codec == "h265") "hevc" else codec)
            ?: throw IllegalStateException("no decoder for $codec")
        ctx = avcodec_alloc_context3(c)
        ctx.thread_count(0)
        ctx.thread_type(2)   // FF_THREAD_SLICE (not exported by the Java presets)
        ctx.flags(ctx.flags() or AV_CODEC_FLAG_LOW_DELAY)
        val r = avcodec_open2(ctx, c, null as AVDictionary?)
        check(r >= 0) { "decoder $codec: ${err(r)}" }
    }

    fun decode(data: ByteArray, ptsUs: Long, config: Boolean, onFrame: (VideoFrame) -> Unit) {
        if (config) { pendingConfig = data; return }
        val bytes = pendingConfig?.let { c -> pendingConfig = null; c + data } ?: data
        if (av_new_packet(pkt, bytes.size) < 0) { errors++; return }
        pkt.data().put(bytes, 0, bytes.size)
        pkt.pts(ptsUs)
        val s = avcodec_send_packet(ctx, pkt)
        av_packet_unref(pkt)
        if (s < 0 && s != AVERROR_EAGAIN()) { errors++; return }
        while (avcodec_receive_frame(ctx, frm) == 0) {
            try { onFrame(toBgra(frm)) } finally { av_frame_unref(frm) }
        }
    }

    private fun toBgra(f: AVFrame): VideoFrame {
        val w = f.width(); val h = f.height()
        srcW = w; srcH = h
        val (ow, oh) = (scaleTo?.invoke(w, h) ?: (w to h)).let { (a, b) -> a.coerceIn(2, 7680) to b.coerceIn(2, 7680) }
        if (ow != outW || oh != outH || out == null) {
            out?.let { av_free(it) }
            out = BytePointer(av_malloc(ow.toLong() * oh * 4)).capacity(ow.toLong() * oh * 4)
            outW = ow; outH = oh
        }
        // smaller: every source pixel counted (no shimmer); bigger: bicubic (sharp); same size: colours only
        val flags = when { ow * oh < w * h -> SWS_AREA; ow * oh > w * h -> SWS_BICUBIC; else -> SWS_BILINEAR } or SWS_FULL_CHR_H_INT or SWS_ACCURATE_RND
        val before = sws
        sws = sws_getCachedContext(sws, w, h, f.format(), ow, oh, AV_PIX_FMT_BGRA, flags, null, null, null as DoublePointer?)
        // the phone's own colour standard (BT.709 or BT.601, video or full range): colours exactly as on its screen
        val cs = f.colorspace(); val range = f.color_range()
        if (sws != before || cs != lastCs || range != lastRange) {
            val std = when (cs) { AVCOL_SPC_BT709 -> SWS_CS_ITU709; AVCOL_SPC_BT2020_NCL, AVCOL_SPC_BT2020_CL -> SWS_CS_BT2020; else -> SWS_CS_ITU601 }
            val coefs = sws_getCoefficients(std)
            sws_setColorspaceDetails(sws, coefs, if (range == AVCOL_RANGE_JPEG) 1 else 0, coefs, 1, 0, 1 shl 16, 1 shl 16)
            lastCs = cs; lastRange = range
        }
        val dst = PointerPointer<BytePointer>(4L).put(0L, out)
        val ls = IntPointer(4L).put(0L, ow * 4)
        sws_scale(sws, f.data(), f.linesize(), 0, h, dst, ls)
        dst.close(); ls.close()
        decoded++
        val pts = f.best_effort_timestamp().takeIf { it != AV_NOPTS_VALUE } ?: f.pts()
        return VideoFrame(ow, oh, out!!.asByteBuffer(), pts)
    }

    override fun close() {
        sws?.let { sws_freeContext(it) }; sws = null
        out?.let { av_free(it) }; out = null
        av_frame_free(frm); av_packet_free(pkt)
        avcodec_free_context(ctx)
    }

    companion object {
        fun err(code: Int): String {
            val b = ByteArray(256)
            av_strerror(code, b, b.size.toLong())
            return String(b).trimEnd('\u0000') + " ($code)"
        }
    }
}
