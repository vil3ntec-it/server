package com.vil3ntec.rawrec

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaCodecInfo.EncoderCapabilities
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import android.os.Build
import android.util.DisplayMetrics
import android.view.Display
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * The default display as it is right now: the size the system renders (current rotation), density,
 * the highest refresh rate at that resolution, the panel's largest physical mode, and all modes.
 */
data class DisplayInfo(
    val width: Int,
    val height: Int,
    val dpi: Int,
    val refresh: Int,
    val physicalLong: Int = 0,
    val physicalShort: Int = 0,
    val bestModeId: Int = 0,
    val modes: List<String> = emptyList(),
) {
    val landscape get() = width > height
    /** True when the panel can show more pixels than the system currently renders (a phone setting). */
    val rendersBelowPanel get() = physicalLong > maxOf(width, height) + 8

    companion object {
        fun read(ctx: Context): DisplayInfo = try { readOrThrow(ctx) } catch (_: Throwable) { DisplayInfo(1080, 2400, 420, 60) }

        private fun readOrThrow(ctx: Context): DisplayInfo {
            val d = ctx.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)
                ?: return DisplayInfo(1080, 2400, 420, 60)
            val m = DisplayMetrics()
            @Suppress("DEPRECATION") d.getRealMetrics(m)
            val cur = d.mode
            val all = d.supportedModes.toList()
            // Highest refresh rate available at the current resolution (adaptive-refresh screens
            // report a lower current rate while idle). No fixed cap: 60, 120, 165, 240 … as reported.
            val same = all.filter { it.physicalWidth == cur.physicalWidth && it.physicalHeight == cur.physicalHeight }
            val best = same.maxByOrNull { it.refreshRate }
            val hz = best?.refreshRate ?: d.refreshRate
            val big = all.maxByOrNull { it.physicalWidth.toLong() * it.physicalHeight } ?: cur
            val modes = all.sortedWith(compareByDescending<Display.Mode> { it.physicalWidth.toLong() * it.physicalHeight }.thenByDescending { it.refreshRate })
                .map { String.format(Locale.US, "%d×%d @ %.0f Hz", maxOf(it.physicalWidth, it.physicalHeight), minOf(it.physicalWidth, it.physicalHeight), it.refreshRate) }
                .distinct()
            return DisplayInfo(
                m.widthPixels, m.heightPixels, m.densityDpi, hz.roundToInt().coerceAtLeast(1),
                maxOf(big.physicalWidth, big.physicalHeight), minOf(big.physicalWidth, big.physicalHeight),
                best?.modeId ?: cur.modeId, modes,
            )
        }
    }
}

/** What will actually be configured. Every field is shown to the user before and after recording. */
data class CapturePlan(
    val mime: String,
    val encoder: String,
    val hardware: Boolean,
    val width: Int,              // encoder and virtual-display size
    val height: Int,
    val contentWidth: Int,       // the screen content inside it (smaller only when padded)
    val contentHeight: Int,
    val padded: Boolean,
    val scaled: Boolean,
    val fps: Int,
    val requestedFps: Int,
    val bitrate: Int,
    val requestedBitrate: Int,
    val encoderMaxBitrate: Int,
    val peakBitrate: Int,        // VBR headroom for fast motion (max-bitrate)
    val mode: Int,               // RecordConfig.MODE_*
    val requestedMode: Int,
    val quality: Int,            // CQ quality, -1 when not CQ
    val qpMax: Int,              // quality floor for VBR (P frames; I −2, B +2), -1 = none
    val qpMin: Int = -1,         // waste floor (P frames; I −2, B +2): no frame is made better than this, -1 = none
    val complexity: Int = -1,    // encoder effort, when the encoder offers a range
    val profile: Int,            // -1 = encoder default
    val level: Int,              // -1 = encoder default
    val dpi: Int,
    val codecFallback: Boolean,
    val altWidth: Int = 0,       // when fps is capped: the largest size that reaches the screen's rate
    val altHeight: Int = 0,
    val sourceWidth: Int = 0,    // the screen size this plan was made for (before encoder fitting)
    val sourceHeight: Int = 0,
) {
    val hevc get() = mime == MediaFormat.MIMETYPE_VIDEO_HEVC
    val codecLabel get() = when (mime) { Encoders.AV1 -> "AV1"; Encoders.HEVC -> "HEVC"; else -> "H.264" }
    val fpsCapped get() = fps < requestedFps
    val bitrateCapped get() = bitrate < requestedBitrate
    val modeFallback get() = mode != requestedMode

    /** Expected average bytes per minute (video target + 320 kbps audio). CQ has no target: encoder max. */
    fun bytesPerMinute(withAudio: Boolean): Long =
        (if (mode == RecordConfig.MODE_CQ) encoderMaxBitrate.toLong() else bitrate.toLong()) * 60 / 8 +
            (if (withAudio) 320_000L * 60 / 8 else 0L)
}

object Encoders {
    const val HEVC = MediaFormat.MIMETYPE_VIDEO_HEVC
    const val AVC = MediaFormat.MIMETYPE_VIDEO_AVC
    const val AV1 = MediaFormat.MIMETYPE_VIDEO_AV1

    @Volatile private var cached: List<MediaCodecInfo>? = null
    private val infos: List<MediaCodecInfo>
        get() = cached ?: (try { MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.toList() } catch (_: Throwable) { emptyList() })
            .also { cached = it }

    /** The codec list is read once per process (it can't change at runtime); tests that install another list reset it. */
    fun clearCache() {
        cached = null
        synchronized(this) { av1Probed = false; av1MuxOk = false }
    }

    /** Software encoders (Google's c2.android / OMX.google) are slow and blocky at screen sizes. */
    fun isHardware(i: MediaCodecInfo): Boolean {
        val n = i.name.lowercase(Locale.US)
        return i.isHardwareAccelerated && !i.isSoftwareOnly && !n.startsWith("omx.google.") && !n.startsWith("c2.android.")
    }

    fun encodersFor(mime: String): List<MediaCodecInfo> = infos.filter { i ->
        i.isEncoder && !i.isAlias && !i.name.lowercase(Locale.US).endsWith(".secure") &&
            i.supportedTypes.any { it.equals(mime, ignoreCase = true) }
    }

    fun hardwareFor(mime: String): MediaCodecInfo? = encodersFor(mime).firstOrNull(::isHardware)

    /** True once a test MediaMuxer accepted an AV1 track on this device (checked once, off the hot path). */
    @Volatile var av1MuxOk = false; private set
    private var av1Probed = false

    @Synchronized
    fun probeAv1Muxer(ctx: Context) {
        if (av1Probed) return
        av1Probed = true
        if (Build.VERSION.SDK_INT < 34 || hardwareFor(AV1) == null) return
        val f = File(ctx.cacheDir, "av1probe.mp4")
        try {
            val m = MediaMuxer(f.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            try { m.addTrack(MediaFormat.createVideoFormat(AV1, 1280, 720)); av1MuxOk = true } finally { m.release() }
        } catch (_: Throwable) {
        } finally { f.delete() }
    }

    fun find(name: String, mime: String): MediaCodecInfo? = encodersFor(mime).firstOrNull { it.name == name }

    private fun video(i: MediaCodecInfo, mime: String): MediaCodecInfo.VideoCapabilities? =
        try { i.getCapabilitiesForType(mime)?.videoCapabilities } catch (_: Throwable) { null }

    fun maxBitrate(i: MediaCodecInfo, mime: String): Int = video(i, mime)?.bitrateRange?.upper ?: 20_000_000

    fun supportsMode(i: MediaCodecInfo, mime: String, codecMode: Int): Boolean = try {
        i.getCapabilitiesForType(mime)?.encoderCapabilities?.isBitrateModeSupported(codecMode) == true
    } catch (_: Throwable) { false }

    /** Highest encoder "complexity" (more effort per frame) when the encoder declares a range, else -1. */
    fun maxComplexity(i: MediaCodecInfo, mime: String): Int = try {
        val r = i.getCapabilitiesForType(mime)?.encoderCapabilities?.complexityRange
        if (r != null && r.upper > r.lower) r.upper else -1
    } catch (_: Throwable) { -1 }

    fun maxQuality(i: MediaCodecInfo, mime: String): Int = try {
        i.getCapabilitiesForType(mime)?.encoderCapabilities?.qualityRange?.upper ?: -1
    } catch (_: Throwable) { -1 }

    data class Fit(val width: Int, val height: Int, val padded: Boolean, val scaled: Boolean)

    /** Encoder size for a w×h screen: pad up to the alignment (never shrink); shrink only if the encoder can't take the size at all. */
    fun fit(i: MediaCodecInfo, mime: String, w: Int, h: Int): Fit {
        val vc = video(i, mime) ?: return Fit(even(w), even(h), false, false)
        val wa = max(2, vc.widthAlignment)
        val ha = max(2, vc.heightAlignment)
        val pw = up(w, wa)
        val ph = up(h, ha)
        if (vc.isSizeSupported(pw, ph)) return Fit(pw, ph, pw != w || ph != h, false)
        var s = 0.98
        while (s > 0.2) {
            val tw = up((w * s).toInt(), wa)
            val th = up((h * s).toInt(), ha)
            if (vc.isSizeSupported(tw, th)) return Fit(tw, th, false, true)
            s -= 0.02
        }
        return Fit(pw, ph, pw != w || ph != h, false)
    }

    /** Highest frame rate ≤ [want] the encoder declares it can sustain at w×h (performance points first). */
    fun sustainableFps(i: MediaCodecInfo, mime: String, w: Int, h: Int, want: Int): Int {
        val vc = video(i, mime) ?: return min(want, 30)
        val points = try { vc.supportedPerformancePoints } catch (_: Throwable) { null }
        for (f in want downTo 1) {
            val ok = if (!points.isNullOrEmpty()) {
                val pp = MediaCodecInfo.VideoCapabilities.PerformancePoint(w, h, f)
                points.any { it.covers(pp) }
            } else {
                try { vc.areSizeAndRateSupported(w, h, f.toDouble()) } catch (_: Throwable) { false }
            }
            if (ok) return f
        }
        return 1
    }

    /** Largest size with the same shape at which the encoder still claims [fps]; null if none ≥ half size. */
    fun sizeForFps(i: MediaCodecInfo, mime: String, w: Int, h: Int, fps: Int): Fit? {
        var s = 1.0
        while (s >= 0.5) {
            val f = fit(i, mime, (w * s).toInt() and 1.inv(), (h * s).toInt() and 1.inv())
            if (!f.scaled && sustainableFps(i, mime, f.width, f.height, fps) >= fps) return f
            s -= 0.05
        }
        return null
    }

    /** Main (HEVC) or High (AVC) profile and the highest level the encoder lists for it (its ceiling, see [levelFor]). */
    fun profileLevel(i: MediaCodecInfo, mime: String): Pair<Int, Int>? {
        val pls = try { i.getCapabilitiesForType(mime)?.profileLevels } catch (_: Throwable) { null } ?: return null
        val wanted = if (mime == HEVC) listOf(CodecProfileLevel.HEVCProfileMain)
        else if (mime == AV1) listOf(CodecProfileLevel.AV1ProfileMain8)
        else listOf(CodecProfileLevel.AVCProfileHigh, CodecProfileLevel.AVCProfileMain, CodecProfileLevel.AVCProfileBaseline)
        for (p in wanted) {
            val lv = pls.filter { it.profile == p }.maxOfOrNull { it.level } ?: continue
            return p to lv
        }
        return null
    }

    /** One level's limits: picture size and rate in luma samples, bit rate in kbit/s (HEVC high tier separately). */
    private class Lv(val code: Int, val pic: Long, val rate: Long, val kbps: Long, val kbpsHigh: Long, val maxW: Int, val maxH: Int)

    private fun avc(code: Int, maxFs: Long, maxMbps: Long, kbps: Long): Lv {
        val dim = (kotlin.math.sqrt(8.0 * maxFs).toInt()) * 16
        return Lv(code, maxFs * 256, maxMbps * 256, kbps, 0, dim, dim)
    }

    private fun hevc(ordinal: Int, ps: Long, sr: Long, kbps: Long, kbpsHigh: Long): Lv {
        val dim = kotlin.math.sqrt(8.0 * ps).toInt()
        return Lv(1 shl (2 * ordinal), ps, sr, kbps, kbpsHigh, dim, dim)
    }

    private fun av1(code: Int, pic: Long, maxW: Int, maxH: Int, rate: Long, kbps: Long) = Lv(code, pic, rate, kbps, 0, maxW, maxH)

    // H.264 Table A-1, H.265 Table A.8/A.9, AV1 Annex A.3.
    private val AVC_LEVELS = listOf(
        avc(CodecProfileLevel.AVCLevel1, 99, 1485, 64), avc(CodecProfileLevel.AVCLevel1b, 99, 1485, 128),
        avc(CodecProfileLevel.AVCLevel11, 396, 3000, 192), avc(CodecProfileLevel.AVCLevel12, 396, 6000, 384),
        avc(CodecProfileLevel.AVCLevel13, 396, 11880, 768), avc(CodecProfileLevel.AVCLevel2, 396, 11880, 2000),
        avc(CodecProfileLevel.AVCLevel21, 792, 19800, 4000), avc(CodecProfileLevel.AVCLevel22, 1620, 20250, 4000),
        avc(CodecProfileLevel.AVCLevel3, 1620, 40500, 10000), avc(CodecProfileLevel.AVCLevel31, 3600, 108000, 14000),
        avc(CodecProfileLevel.AVCLevel32, 5120, 216000, 20000), avc(CodecProfileLevel.AVCLevel4, 8192, 245760, 20000),
        avc(CodecProfileLevel.AVCLevel41, 8192, 245760, 50000), avc(CodecProfileLevel.AVCLevel42, 8704, 522240, 50000),
        avc(CodecProfileLevel.AVCLevel5, 22080, 589824, 135000), avc(CodecProfileLevel.AVCLevel51, 36864, 983040, 240000),
        avc(CodecProfileLevel.AVCLevel52, 36864, 2073600, 240000), avc(CodecProfileLevel.AVCLevel6, 139264, 4177920, 240000),
        avc(CodecProfileLevel.AVCLevel61, 139264, 8355840, 480000), avc(CodecProfileLevel.AVCLevel62, 139264, 16711680, 800000),
    )
    private val HEVC_LEVELS = listOf(
        hevc(0, 36864, 552960, 128, 0), hevc(1, 122880, 3686400, 1500, 0), hevc(2, 245760, 7372800, 3000, 0),
        hevc(3, 552960, 16588800, 6000, 0), hevc(4, 983040, 33177600, 10000, 0),
        hevc(5, 2228224, 66846720, 12000, 30000), hevc(6, 2228224, 133693440, 20000, 50000),
        hevc(7, 8912896, 267386880, 25000, 100000), hevc(8, 8912896, 534773760, 40000, 160000),
        hevc(9, 8912896, 1069547520, 60000, 240000), hevc(10, 35651584, 1069547520, 60000, 240000),
        hevc(11, 35651584, 2139095040, 120000, 480000), hevc(12, 35651584, 4278190080, 240000, 800000),
    )
    private val AV1_LEVELS = listOf(
        av1(CodecProfileLevel.AV1Level2, 147456, 2048, 1152, 4423680, 1500),
        av1(CodecProfileLevel.AV1Level21, 278784, 2816, 1584, 8363520, 3000),
        av1(CodecProfileLevel.AV1Level3, 665856, 4352, 2448, 19975680, 6000),
        av1(CodecProfileLevel.AV1Level31, 1065024, 5504, 3096, 31950720, 10000),
        av1(CodecProfileLevel.AV1Level4, 2359296, 6144, 3456, 70778880, 12000),
        av1(CodecProfileLevel.AV1Level41, 2359296, 6144, 3456, 141557760, 20000),
        av1(CodecProfileLevel.AV1Level5, 8912896, 8192, 4352, 267386880, 30000),
        av1(CodecProfileLevel.AV1Level51, 8912896, 8192, 4352, 534773760, 40000),
        av1(CodecProfileLevel.AV1Level52, 8912896, 8192, 4352, 1069547520, 60000),
        av1(CodecProfileLevel.AV1Level53, 8912896, 8192, 4352, 1069547520, 60000),
        av1(CodecProfileLevel.AV1Level6, 35651584, 16384, 8704, 1069547520, 60000),
        av1(CodecProfileLevel.AV1Level61, 35651584, 16384, 8704, 2139095040, 100000),
        av1(CodecProfileLevel.AV1Level62, 35651584, 16384, 8704, 4278190080, 160000),
        av1(CodecProfileLevel.AV1Level63, 35651584, 16384, 8704, 4278190080, 160000),
    )

    private fun levels(mime: String) = when (mime) { HEVC -> HEVC_LEVELS; AV1 -> AV1_LEVELS; else -> AVC_LEVELS }

    /** Order of a level code; HEVC main and high tier of the same level rank equal. */
    private fun rank(mime: String, code: Int): Int =
        if (mime == HEVC) Integer.numberOfTrailingZeros(code) / 2 else Integer.numberOfTrailingZeros(code)

    /**
     * The lowest level whose limits hold w×h at [fps] with a peak of [bps], not above [maxLevel] (what
     * the encoder lists). 1.4 always declared the encoder's highest level (e.g. HEVC 6.2 for a 1080p
     * video): the encoder sized itself for 8K and other devices' players may refuse such a file.
     * HEVC high tier only when [highTier]. Returns the level and its bit-rate ceiling (bit/s), or
     * null when even [maxLevel] is too small.
     */
    fun minLevel(mime: String, w: Int, h: Int, fps: Int, bps: Long, maxLevel: Int, highTier: Boolean, avcHigh: Boolean = true): Pair<Int, Long>? {
        val aw = if (mime == AVC) up(w, 16) else w
        val ah = if (mime == AVC) up(h, 16) else h
        val area = aw.toLong() * ah
        val factor = if (mime == AVC && avcHigh) 1250L else 1000L
        val top = rank(mime, maxLevel)
        for (l in levels(mime)) {
            if (rank(mime, l.code) > top) break
            if (area > l.pic || aw > l.maxW || ah > l.maxH || area * fps > l.rate) continue
            if (bps <= l.kbps * factor) return l.code to l.kbps * factor
            if (mime == HEVC && highTier && l.kbpsHigh > 0 && bps <= l.kbpsHigh * factor) return (l.code shl 1) to l.kbpsHigh * factor
        }
        return null
    }

    /** Level to configure and its bit-rate ceiling: the lowest that fits, else the encoder's own highest. */
    fun levelFor(mime: String, profile: Int, maxLevel: Int, w: Int, h: Int, fps: Int, bps: Long): Pair<Int, Long> {
        val avcHigh = profile == CodecProfileLevel.AVCProfileHigh
        val high = mime == HEVC && Integer.numberOfTrailingZeros(maxLevel) % 2 == 1
        minLevel(mime, w, h, fps, bps, maxLevel, high, avcHigh)?.let { return it }
        val factor = if (mime == AVC && avcHigh) 1250L else 1000L
        val row = levels(mime).lastOrNull { rank(mime, it.code) == rank(mime, maxLevel) } ?: return maxLevel to Long.MAX_VALUE
        return maxLevel to (if (high && row.kbpsHigh > 0) row.kbpsHigh else row.kbps) * factor
    }

    fun profileName(mime: String, profile: Int): String = when {
        profile < 0 -> "auto"
        mime == HEVC && profile == CodecProfileLevel.HEVCProfileMain -> "Main"
        mime == AV1 && profile == CodecProfileLevel.AV1ProfileMain8 -> "Main 8-bit"
        profile == CodecProfileLevel.AVCProfileHigh -> "High"
        profile == CodecProfileLevel.AVCProfileMain -> "Main"
        profile == CodecProfileLevel.AVCProfileBaseline -> "Baseline"
        else -> profile.toString()
    }

    fun levelName(mime: String, level: Int): String {
        if (level <= 0) return "auto"
        val bit = Integer.numberOfTrailingZeros(level)
        return if (mime == HEVC) {
            val names = listOf("1", "2", "2.1", "3", "3.1", "4", "4.1", "5", "5.1", "5.2", "6", "6.1", "6.2")
            (names.getOrNull(bit / 2) ?: "?") + if (bit % 2 == 1) " High tier" else " Main tier"
        } else if (mime == AV1) {
            (2..7).flatMap { a -> (0..3).map { b -> "$a.$b" } }.getOrNull(bit) ?: "?"
        } else {
            listOf("1", "1b", "1.1", "1.2", "1.3", "2", "2.1", "2.2", "3", "3.1", "3.2", "4", "4.1", "4.2", "5", "5.1", "5.2", "6", "6.1", "6.2")
                .getOrNull(bit) ?: "?"
        }
    }

    private fun up(v: Int, a: Int) = ((v + a - 1) / a) * a
    private fun even(v: Int) = v and 1.inv()
}

object Planner {
    /** Encoder-level codes for the user-facing modes. */
    fun codecMode(mode: Int) = when (mode) {
        RecordConfig.MODE_CQ -> EncoderCapabilities.BITRATE_MODE_CQ
        RecordConfig.MODE_CBR -> EncoderCapabilities.BITRATE_MODE_CBR
        else -> EncoderCapabilities.BITRATE_MODE_VBR
    }

    /** Output size before encoder alignment: true screen size in the chosen orientation, optionally scaled down. */
    fun targetSize(cfg: RecordConfig, d: DisplayInfo): Pair<Int, Int> {
        var w = d.width
        var h = d.height
        when (cfg.orient) {
            RecordConfig.ORIENT_LANDSCAPE -> if (h > w) { val t = w; w = h; h = t }
            RecordConfig.ORIENT_PORTRAIT -> if (w > h) { val t = w; w = h; h = t }
        }
        val short = min(w, h)
        if (cfg.resShort == RecordConfig.RES_4K) {
            // «۴K (بزرگ‌نمایی)»: the long side to 3840. The screen has no more pixels than its own; the
            // compositor scales them up smoothly, which YouTube rewards with its 4K quality.
            val long = maxOf(w, h)
            if (long < 3840) {
                val s = 3840.0 / long
                w = ((w * s).roundToInt()) and 1.inv()
                h = ((h * s).roundToInt()) and 1.inv()
            }
        } else if (cfg.resShort in 1 until short) {
            val s = cfg.resShort.toDouble() / short
            w = ((w * s).toInt()) and 1.inv()
            h = ((h * s).toInt()) and 1.inv()
        }
        return w to h
    }

    /**
     * VBR target (average) for the automatic levels, in bits per second. Reference: bits per pixel
     * at 60 fps, × (fps/60)^0.6: higher frame rates cost less than linearly (consecutive frames are more alike).
     * HEVC values; AVC ×1.4, AV1 ×0.9 (hardware AV1 encoders gain less over HEVC than software ones).
     *   High (default): 0.20 bpp → 1920×1080@60 ≈ 25 Mbps, 2400×1504@60 ≈ 43 Mbps
     *   Light:          0.045 bpp → 1920×1080@30 ≈ 4 Mbps
     *   «بی‌افت»:        0.30 bpp  → 1920×1080@60 ≈ 37 Mbps
     * 2.2: 0.11 was too little where an encoder does not honour the quality range (Android only asks
     * encoders to, it does not oblige them): busy game scenes came out grainy («like an old TV»).
     * Since 1.8 the target is only a guide: quality is held by a narrow QP range per frame
     * ([qpCeiling]..[qpFloor]), like a CRF encode. The owner wants «the pixels I see, but not a bigger
     * file»: a fixed bit rate does both badly — it smears fast motion and pads still screens with bits
     * nobody can see (1.5 allowed QP 10 on a still screen just to reach the target). With the range,
     * every frame lands at the same visible quality: still screens and UI cost almost nothing, fast
     * motion takes what it needs, up to 4× the target (max-bitrate). The codec level and the encoder's
     * maximum cap the peak.
     */
    fun autoBitrate(w: Int, h: Int, fps: Int, mime: String, level: Int): Int {
        val base = when (level) { RecordConfig.BR_MAX -> 0.30; RecordConfig.BR_AUTO_BALANCED -> 0.045; else -> 0.20 }
        val bps = w.toDouble() * h * 60 * base * codecFactor(mime) * (fps / 60.0).pow(0.6)
        return (bps / 1_000_000).roundToInt().coerceAtLeast(3) * 1_000_000
    }

    private fun codecFactor(mime: String) = when (mime) { Encoders.AVC -> 1.4; Encoders.AV1 -> 0.9; else -> 1.0 }

    /** Range that keeps screen content faithful (rule of thumb, shown for reference): 0.10–0.30 bpp HEVC at 60 fps. */
    fun referenceRange(w: Int, h: Int, fps: Int, mime: String): Pair<Int, Int> {
        val k = w.toDouble() * h * 60 * codecFactor(mime) * (fps / 60.0).pow(0.6) / 1_000_000
        return (k * 0.10).roundToInt() to (k * 0.30).roundToInt()
    }

    /**
     * Quality floor (QP ceiling of P frames; I −2, B +2) for VBR: rather than go above it the encoder
     * spends more than the target. 18 keeps text edges, fine game texture and smooth 8-bit gradients
     * clean on HEVC/AV1/AVC hardware encoders (26 in 1.5 showed banding and soft text, 20 in 1.8 still a
     * little soft next to the screen); 16 for «بی‌افت».
     */
    fun qpCeiling(bitrateLevel: Int): Int = when (bitrateLevel) {
        RecordConfig.BR_MAX -> 16
        RecordConfig.BR_AUTO_BALANCED -> 34
        RecordConfig.BR_AUTO_HIGH -> 18
        else -> 23                      // a fixed Mbps chosen by the owner
    }

    /**
     * Waste floor for VBR (P frames; I −2, B +2): no frame is encoded better than this, so a still or
     * simple screen is not padded up to the target with detail no eye can see. Three steps under the
     * ceiling keeps the quality steady (no «breathing») while the size follows the content. A fixed
     * Mbps chosen by the owner keeps the old wide range: there the owner asked for that size.
     */
    fun qpFloor(bitrateLevel: Int): Int = when (bitrateLevel) {
        RecordConfig.BR_MAX, RecordConfig.BR_AUTO_BALANCED, RecordConfig.BR_AUTO_HIGH -> qpCeiling(bitrateLevel) - 3
        else -> 10
    }

    fun plan(cfg: RecordConfig, d: DisplayInfo): CapturePlan? {
        val (w, h) = targetSize(cfg, d)
        // Automatic: HEVC → hardware AV1 (Android 14+, MediaMuxer) → AVC.
        val av1 = if (Build.VERSION.SDK_INT >= 34 && Encoders.av1MuxOk) listOf(Encoders.AV1) else emptyList()
        val order = when (cfg.codec) {
            RecordConfig.CODEC_AVC -> listOf(Encoders.AVC, Encoders.HEVC)
            RecordConfig.CODEC_HEVC -> listOf(Encoders.HEVC, Encoders.AVC)
            RecordConfig.CODEC_AV1 -> av1 + listOf(Encoders.HEVC, Encoders.AVC)
            // Automatic: HEVC first since 2.0 — it goes through RawRec's own MP4 writer (one file, no
            // 4 GB limit); AV1 only when there is no HEVC hardware encoder.
            else -> listOf(Encoders.HEVC) + av1 + listOf(Encoders.AVC)
        }
        val wantFps = wantFps(cfg, d)
        // Every hardware encoder of the allowed codecs is measured against the device's own claims:
        // native size first, then the highest frame rate, then codec preference (AV1 > HEVC > AVC).
        fun best(mimes: List<String>, hwOnly: Boolean): Pair<String, MediaCodecInfo>? {
            var pick: Pair<String, MediaCodecInfo>? = null
            var score = Long.MIN_VALUE
            for ((rank, m) in mimes.withIndex()) for (i in Encoders.encodersFor(m)) {
                if (hwOnly && !Encoders.isHardware(i)) continue
                val f = Encoders.fit(i, m, w, h)
                val fps = Encoders.sustainableFps(i, m, f.width, f.height, wantFps)
                val sc = (if (f.scaled) 0L else 1L shl 40) + (fps.toLong() shl 8) + (mimes.size - rank)
                if (sc > score) { score = sc; pick = m to i }
            }
            return pick
        }
        val all = order.distinct()
        val requested = if (cfg.codec == RecordConfig.CODEC_AUTO) all else all.take(1)
        val chosen = best(requested, true) ?: best(all, true) ?: best(requested, false) ?: best(all, false)
        val (mime, info) = chosen ?: return null
        val fallback = cfg.codec != RecordConfig.CODEC_AUTO && mime != order.first()
        return build(cfg, d, w, h, mime, info, fallback)
    }

    /** The screen can't show more frames than its refresh rate, so that is the ceiling. */
    fun wantFps(cfg: RecordConfig, d: DisplayInfo) = if (cfg.fps <= 0) d.refresh else min(cfg.fps, d.refresh)

    /** Same encoder, new screen size (used when the device rotates while recording). */
    fun replan(cfg: RecordConfig, d: DisplayInfo, cur: CapturePlan): CapturePlan? {
        val info = Encoders.find(cur.encoder, cur.mime) ?: return null
        val (w, h) = targetSize(cfg, d)
        return build(cfg, d, w, h, cur.mime, info, cur.codecFallback)
    }

    private fun build(cfg: RecordConfig, d: DisplayInfo, w: Int, h: Int, mime: String, info: MediaCodecInfo, fallback: Boolean): CapturePlan {
        val fit = Encoders.fit(info, mime, w, h)
        val wantFps = wantFps(cfg, d)
        val fps = Encoders.sustainableFps(info, mime, fit.width, fit.height, wantFps)
        val alt = if (fps < wantFps) Encoders.sizeForFps(info, mime, w, h, wantFps) else null
        val encMax = Encoders.maxBitrate(info, mime)
        // An upscaled picture holds no more detail than the screen: the bits follow the screen's own
        // pixels (×1.35 for the finer grid), not the bigger frame.
        val upscaled = fit.width.toLong() * fit.height > d.width.toLong() * d.height
        val bw = if (upscaled) d.width else fit.width
        val bh = if (upscaled) (d.height * 1.35).toInt() else fit.height
        val want = if (cfg.bitrate < 0) autoBitrate(bw, bh, fps, mime, cfg.bitrate)
        else cfg.bitrate.coerceIn(1, 300) * 1_000_000
        var bitrate = min(want, encMax)
        val cq = Encoders.supportsMode(info, mime, EncoderCapabilities.BITRATE_MODE_CQ)
        val vbr = Encoders.supportsMode(info, mime, EncoderCapabilities.BITRATE_MODE_VBR)
        val cbr = Encoders.supportsMode(info, mime, EncoderCapabilities.BITRATE_MODE_CBR)
        val mode = when (cfg.mode) {
            RecordConfig.MODE_CQ -> if (cq) RecordConfig.MODE_CQ else if (vbr || !cbr) RecordConfig.MODE_VBR else RecordConfig.MODE_CBR
            RecordConfig.MODE_CBR -> if (cbr || !vbr) RecordConfig.MODE_CBR else RecordConfig.MODE_VBR
            else -> if (vbr || !cbr) RecordConfig.MODE_VBR else RecordConfig.MODE_CBR
        }
        // Headroom for fights, fast turns and explosions: the quality range holds (QP ≤ ceiling) only
        // if the peak lets it; short bursts barely change the file's size.
        var peak = if (mode == RecordConfig.MODE_VBR) min(encMax.toLong(), bitrate * 4L) else bitrate.toLong()
        // Lowest level that carries this size, rate and peak; the level's ceiling also bounds the
        // bit rate, so the encoder is never asked for more than the level it declares.
        val pl = Encoders.profileLevel(info, mime)
        var level = -1
        if (pl != null) {
            val (lv, ceiling) = Encoders.levelFor(mime, pl.first, pl.second, fit.width, fit.height, fps, peak)
            level = lv
            if (ceiling < peak) { peak = ceiling; bitrate = min(bitrate.toLong(), ceiling).toInt() }
        }
        val qpMax = if (mode == RecordConfig.MODE_VBR) qpCeiling(cfg.bitrate) else -1
        val qpMin = if (mode == RecordConfig.MODE_VBR) qpFloor(cfg.bitrate) else -1
        return CapturePlan(
            mime = mime, encoder = info.name, hardware = Encoders.isHardware(info),
            width = fit.width, height = fit.height,
            contentWidth = if (fit.scaled) fit.width else w, contentHeight = if (fit.scaled) fit.height else h,
            padded = fit.padded, scaled = fit.scaled,
            fps = fps, requestedFps = wantFps,
            bitrate = bitrate, requestedBitrate = want, encoderMaxBitrate = encMax,
            peakBitrate = peak.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
            mode = mode, requestedMode = cfg.mode,
            quality = if (mode == RecordConfig.MODE_CQ) Encoders.maxQuality(info, mime) else -1,
            qpMax = qpMax, qpMin = qpMin,
            complexity = Encoders.maxComplexity(info, mime),
            profile = pl?.first ?: -1, level = level,
            dpi = d.dpi, codecFallback = fallback,
            altWidth = alt?.width ?: 0, altHeight = alt?.height ?: 0,
            sourceWidth = w, sourceHeight = h,
        )
    }
}
