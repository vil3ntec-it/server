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
        if (w != outW || h != outH || out == null) {
            out?.let { av_free(it) }
            out = BytePointer(av_malloc(w.toLong() * h * 4)).capacity(w.toLong() * h * 4)
            outW = w; outH = h
        }
        sws = sws_getCachedContext(sws, w, h, f.format(), w, h, AV_PIX_FMT_BGRA, SWS_BILINEAR, null, null, null as DoublePointer?)
        val dst = PointerPointer<BytePointer>(4L).put(0L, out)
        val ls = IntPointer(4L).put(0L, w * 4)
        sws_scale(sws, f.data(), f.linesize(), 0, h, dst, ls)
        dst.close(); ls.close()
        decoded++
        val pts = f.best_effort_timestamp().takeIf { it != AV_NOPTS_VALUE } ?: f.pts()
        return VideoFrame(w, h, out!!.asByteBuffer(), pts)
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
