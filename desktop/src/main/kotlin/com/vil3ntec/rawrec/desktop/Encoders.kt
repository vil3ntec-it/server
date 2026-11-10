package com.vil3ntec.rawrec.desktop

import org.bytedeco.ffmpeg.avutil.AVDictionary
import org.bytedeco.ffmpeg.global.avcodec.*
import org.bytedeco.ffmpeg.global.avutil.*

/**
 * The video encoders this computer really has: every graphics card's own (NVIDIA NVENC, AMD AMF,
 * Intel Quick Sync, Apple VideoToolbox, Windows Media Foundation) first, then software. Each is tried
 * for real (opened on a small picture) — present in FFmpeg is not the same as working on this machine:
 * NVENC opens only with an NVIDIA card and its driver.
 */
object Encoders {

    enum class Family(val label: String) { H264("H.264"), HEVC("HEVC (H.265)"), AV1("AV1") }

    data class Encoder(val name: String, val family: Family, val hardware: Boolean, val vendor: String) {
        val label get() = "${family.label} — $vendor" + if (hardware) "" else " (CPU)"
    }

    /** In order of preference within each family. */
    private val CANDIDATES = listOf(
        Encoder("hevc_nvenc", Family.HEVC, true, "NVIDIA"), Encoder("h264_nvenc", Family.H264, true, "NVIDIA"), Encoder("av1_nvenc", Family.AV1, true, "NVIDIA"),
        Encoder("hevc_amf", Family.HEVC, true, "AMD"), Encoder("h264_amf", Family.H264, true, "AMD"), Encoder("av1_amf", Family.AV1, true, "AMD"),
        Encoder("hevc_qsv", Family.HEVC, true, "Intel"), Encoder("h264_qsv", Family.H264, true, "Intel"), Encoder("av1_qsv", Family.AV1, true, "Intel"),
        Encoder("hevc_videotoolbox", Family.HEVC, true, "Apple"), Encoder("h264_videotoolbox", Family.H264, true, "Apple"),
        Encoder("hevc_mf", Family.HEVC, true, "Windows"), Encoder("h264_mf", Family.H264, true, "Windows"),
        Encoder("libx264", Family.H264, false, "x264"), Encoder("libopenh264", Family.H264, false, "OpenH264"),
        Encoder("libsvtav1", Family.AV1, false, "SVT-AV1"),
    )

    @Volatile private var cache: List<Encoder>? = null

    /** The working encoders, best first (found once; about a tenth of a second each). */
    fun available(): List<Encoder> = cache ?: CANDIDATES.filter { works(it) }.also { cache = it }

    /** The best for [family] here, else the best of any. */
    fun best(family: Family? = null): Encoder? = available().let { a -> a.firstOrNull { family == null || it.family == family } ?: a.firstOrNull() }

    private fun works(e: Encoder): Boolean {
        try {
            val c = avcodec_find_encoder_by_name(e.name) ?: return false
            if (c.isNull) return false
            val ctx = avcodec_alloc_context3(c)
            try {
                ctx.width(640); ctx.height(360)
                ctx.time_base(av_make_q(1, 1000)); ctx.framerate(av_make_q(30, 1))
                ctx.pix_fmt(VideoEncoder.pixFmtFor(e.name))
                ctx.bit_rate(2_000_000)
                return avcodec_open2(ctx, c, null as AVDictionary?) >= 0
            } finally { avcodec_free_context(ctx) }
        } catch (_: Throwable) { return false }
    }
}
