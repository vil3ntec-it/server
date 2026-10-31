package com.vil3ntec.rawrec

import android.content.Context
import android.os.StatFs
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Number formatting. Technical values use Latin digits so they can be copied into a message. */
object Fmt {
    fun bytes(b: Long): String = iso(when {
        b >= 1_000_000_000L -> String.format(Locale.US, "%.2f GB", b / 1e9)
        b >= 1_000_000L -> String.format(Locale.US, "%.0f MB", b / 1e6)
        else -> String.format(Locale.US, "%.0f KB", b / 1e3)
    })

    fun mbps(bps: Int): String = iso(String.format(Locale.US, "%d Mbps", (bps + 500_000) / 1_000_000))
    fun mbps(bps: Double): String = iso(String.format(Locale.US, "%.1f Mbps", bps / 1e6))
    fun hms(sec: Long): String = iso(String.format(Locale.US, "%02d:%02d:%02d", sec / 3600, sec / 60 % 60, sec % 60))
    fun mbPerMin(bytesPerMin: Long): String = iso(String.format(Locale.US, "%d MB", bytesPerMin / 1_000_000))
    fun size(w: Int, h: Int): String = iso(String.format(Locale.US, "%d×%d", w, h))
    fun fps(v: Int): String = iso(String.format(Locale.US, "%d fps", v))

    /**
     * Left-to-right isolate (U+2066 … U+2069): keeps a technical value such as "120 fps" or an
     * encoder name in its own order inside a Persian sentence. The marks are invisible.
     */
    fun iso(s: String): String = "\u2066$s\u2069"
    fun num(v: Long): String = String.format(Locale.US, "%d", v)
    fun num(v: Int): String = String.format(Locale.US, "%d", v)
    fun dec(v: Double): String = String.format(Locale.US, "%.1f", v)
}

object Storage {
    /** Space kept free: below this the recording stops and the file is finalized cleanly. */
    const val RESERVE = 400L * 1024 * 1024

    fun free(ctx: Context): Long = try {
        val dir = ctx.getExternalFilesDir(null) ?: ctx.filesDir
        StatFs(dir.path).availableBytes
    } catch (_: Exception) { Long.MAX_VALUE }
}

object Texts {
    fun modeName(mode: Int) = when (mode) {
        RecordConfig.MODE_CQ -> "CQ"
        RecordConfig.MODE_CBR -> "CBR"
        else -> "VBR"
    }

    fun codecName(p: CapturePlan) = when (p.mime) { Encoders.AV1 -> "AV1"; Encoders.HEVC -> "HEVC (H.265)"; else -> "H.264 (AVC)" }

    fun bitrateText(p: CapturePlan): String =
        if (p.mode == RecordConfig.MODE_CQ) "CQ ${p.quality}" else "${Fmt.mbps(p.bitrate)} ${modeName(p.mode)}"

    /** One line: HEVC • 2400×1080 • 120 fps • 12 Mbps VBR */
    fun short(p: CapturePlan) = Fmt.iso("${p.codecLabel} • ${Fmt.size(p.width, p.height)} • ${p.fps} fps • ${bitrateText(p)}")

    /** Notes about anything that differs from what was asked for. Empty when everything is as asked. */
    fun notes(ctx: Context, p: CapturePlan): List<String> {
        val n = ArrayList<String>()
        if (!p.hardware) n += ctx.getString(R.string.note_software)
        if (p.codecFallback) n += ctx.getString(R.string.note_codec_fallback_fmt, codecName(p))
        if (p.scaled) n += ctx.getString(R.string.note_scaled_fmt, Fmt.size(p.width, p.height))
        else if (p.padded) n += ctx.getString(R.string.note_padded_fmt, Fmt.num(p.width - p.contentWidth + p.height - p.contentHeight))
        if (p.fpsCapped) {
            n += ctx.getString(R.string.note_fps_capped_fmt, Fmt.num(p.requestedFps), Fmt.size(p.width, p.height), Fmt.fps(p.fps))
            if (p.altWidth > 0) n += ctx.getString(R.string.note_fps_alt_fmt, Fmt.size(p.altWidth, p.altHeight), Fmt.fps(p.requestedFps))
        }
        if (p.bitrateCapped && p.requestedBitrate < 300_000_000) n += ctx.getString(R.string.note_br_capped_fmt, Fmt.mbps(p.encoderMaxBitrate))
        if (p.modeFallback) n += ctx.getString(R.string.note_mode_fallback_fmt, modeName(p.requestedMode), modeName(p.mode))
        return n
    }

    fun applied(ctx: Context, cfg: RecordConfig, p: CapturePlan, dropped: List<String>, audioKbps: Int, audioOk: Boolean): String {
        val auto = ctx.getString(R.string.auto)
        val sb = StringBuilder()
        sb.append(ctx.getString(R.string.ap_encoder_fmt, Fmt.iso(p.encoder), ctx.getString(if (p.hardware) R.string.hw else R.string.sw))).append('\n')
        val lvl = if ("level" in dropped || "profile" in dropped) auto else Encoders.levelName(p.mime, p.level)
        val prof = if ("profile" in dropped) auto else Encoders.profileName(p.mime, p.profile)
        sb.append(ctx.getString(R.string.ap_codec_fmt, Fmt.iso(codecName(p)), Fmt.iso(prof), Fmt.iso(lvl))).append('\n')
        sb.append(ctx.getString(R.string.ap_size_fmt, Fmt.size(p.width, p.height)))
        if (p.padded) sb.append(ctx.getString(R.string.ap_content_fmt, Fmt.size(p.contentWidth, p.contentHeight)))
        if (p.scaled) sb.append(ctx.getString(R.string.ap_scaled))
        sb.append('\n').append(ctx.getString(R.string.ap_fps_fmt, Fmt.fps(p.fps)))
        if (p.fpsCapped) sb.append(ctx.getString(R.string.ap_fps_screen_fmt, Fmt.num(p.requestedFps)))
        sb.append('\n').append(ctx.getString(R.string.ap_bitrate_fmt, Fmt.iso(bitrateText(p))))
        if ("mode" in dropped) sb.append(ctx.getString(R.string.ap_mode_default))
        if (p.mode == RecordConfig.MODE_VBR && "mode" !in dropped) sb.append(ctx.getString(R.string.ap_peak_fmt, Fmt.mbps(p.peakBitrate)))
        if (p.qpMax > 0 && "qp" !in dropped) sb.append(ctx.getString(R.string.ap_qp_fmt, if (p.qpMin > 0) Fmt.num(p.qpMin) + "–" + Fmt.num(p.qpMax) else "≤" + Fmt.num(p.qpMax)))
        sb.append('\n').append(ctx.getString(if ("color" in dropped) R.string.ap_color_default else R.string.ap_color))
        if (p.complexity >= 0 && "complexity" !in dropped) sb.append('\n').append(ctx.getString(R.string.ap_complexity_fmt, Fmt.num(p.complexity)))
        sb.append('\n').append(ctx.getString(R.string.ap_audio_fmt, audioText(ctx, cfg, audioKbps, audioOk)))
        if (dropped.isNotEmpty()) sb.append('\n').append(ctx.getString(R.string.ap_dropped_fmt, dropped.joinToString(", ")))
        return sb.toString()
    }

    fun audioSource(ctx: Context, mode: Int): String = ctx.getString(when (mode) {
        RecordConfig.AUDIO_INTERNAL -> R.string.audio_internal
        RecordConfig.AUDIO_MIC -> R.string.audio_mic
        RecordConfig.AUDIO_BOTH -> R.string.audio_both
        else -> R.string.audio_none
    })

    fun audioText(ctx: Context, cfg: RecordConfig, kbps: Int, ok: Boolean): String {
        if (!cfg.hasAudio) return ctx.getString(R.string.audio_none)
        val src = audioSource(ctx, cfg.audioMode)
        return if (!ok) ctx.getString(R.string.audio_failed_fmt, src) else ctx.getString(R.string.audio_ok_fmt, src, Fmt.num(kbps))
    }

    /** «گزارشِ ضبط»: numbers measured from what was written, for the owner to send back. */
    fun report(
        ctx: Context, cfg: RecordConfig, p: CapturePlan, s: RecStats, parts: List<SegMuxer.Part>, videoBytes: Long,
        dropped: List<String>, audioKbps: Int, audioOk: Boolean, muxWaitMs: Long, error: String?,
    ): String {
        val durS = s.durationUs / 1e6
        val avgFps = if (durS > 0) (s.frames - 1).coerceAtLeast(0) / durS else 0.0
        val maxFps = if (s.minGapUs in 1 until Long.MAX_VALUE) 1e6 / s.minGapUs else 0.0
        val expected = (durS * p.fps).toLong()
        val less = (expected - s.frames).coerceAtLeast(0)
        val avgBr = if (durS > 0) videoBytes * 8 / durS else 0.0
        val total = parts.sumOf { it.bytes }
        val perMin = if (durS > 1) (total / (durS / 60.0)).toLong() else 0L
        val rot = parts.count { it.reason == SegMuxer.REASON_ROTATE }
        val sb = StringBuilder()
        sb.append(ctx.getString(R.string.rep_title_fmt, BuildInfo.version(ctx))).append('\n')
        sb.append(ctx.getString(R.string.rep_time_fmt, SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date()))).append('\n')
        sb.append(applied(ctx, cfg, p, dropped, audioKbps, audioOk)).append('\n')
        sb.append(ctx.getString(R.string.rep_measured)).append('\n')
        sb.append(ctx.getString(R.string.rep_fps_fmt, Fmt.num(p.fps), Fmt.dec(avgFps), String.format(Locale.US, "%.0f", maxFps))).append('\n')
        sb.append(ctx.getString(R.string.rep_frames_fmt, Fmt.num(s.frames), Fmt.num(expected), Fmt.num(less))).append('\n')
        sb.append(ctx.getString(R.string.rep_gaps_fmt, Fmt.num(s.longGaps), Fmt.num(s.maxGapUs / 1000))).append('\n')
        sb.append(ctx.getString(R.string.rep_br_fmt, Fmt.mbps(avgBr), Fmt.iso(bitrateText(p)))).append('\n')
        val ref = Planner.referenceRange(p.width, p.height, p.fps, p.mime)
        sb.append(ctx.getString(R.string.rep_ref_fmt, Fmt.iso("${ref.first}–${ref.second} Mbps"))).append('\n')
        sb.append(ctx.getString(R.string.rep_permin_fmt, Fmt.mbPerMin(perMin), Fmt.bytes(perMin * 30))).append('\n')
        sb.append(ctx.getString(R.string.rep_dur_fmt, Fmt.hms(durS.toLong()), Fmt.bytes(total), Fmt.num(parts.size)))
        if (rot > 0) sb.append(ctx.getString(R.string.rep_rot_fmt, Fmt.num(rot)))
        sb.append('\n').append(ctx.getString(R.string.rep_keys_fmt, Fmt.num(s.keyFrames), Fmt.num(muxWaitMs))).append('\n')
        if (!error.isNullOrEmpty()) sb.append(ctx.getString(R.string.rep_error_fmt, error)).append('\n')
        sb.append(ctx.getString(R.string.rep_hint))
        val text = sb.toString()
        // The same numbers, structured, for the stats card on screen (tied to this exact report text).
        ReportStats.save(ctx, text, linkedMapOf(
            "dur" to durS.toLong().toString(), "bytes" to total.toString(), "parts" to parts.size.toString(),
            "fpsSet" to p.fps.toString(), "fpsAvg" to Fmt.dec(avgFps), "fpsMax" to String.format(Locale.US, "%.0f", maxFps),
            "frames" to s.frames.toString(), "expected" to expected.toString(), "gaps" to s.longGaps.toString(),
            "maxGapMs" to (s.maxGapUs / 1000).toString(), "brAvg" to avgBr.toLong().toString(), "brTarget" to bitrateText(p),
            "perMin" to perMin.toString(), "w" to p.width.toString(), "h" to p.height.toString(), "codec" to p.codecLabel,
            "rot" to rot.toString(), "error" to (if (error.isNullOrEmpty()) "0" else "1"),
        ))
        return text
    }
}

/**
 * The last report's numbers as key → value, saved next to the report text so the screen can show
 * a stats card instead of parsing translated sentences. [load] returns null when the saved numbers
 * belong to another report (e.g. one written by 1.4), so the card never shows stale values.
 */
object ReportStats {
    private const val KEY = "last_stats"

    fun save(ctx: Context, report: String, values: Map<String, String>) {
        runCatching {
            val body = (values + ("hash" to report.hashCode().toString()))
                .entries.joinToString("\n") { (k, v) -> k + "=" + v.replace('\n', ' ') }
            ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE).edit().putString(KEY, body).apply()
        }
    }

    fun load(ctx: Context, report: String): Map<String, String>? {
        if (report.isEmpty()) return null
        val raw = runCatching { SafePrefs.str(ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE), KEY) }.getOrDefault("")
        if (raw.isEmpty()) return null
        val m = raw.lineSequence().mapNotNull { l -> l.indexOf('=').takeIf { it > 0 }?.let { l.substring(0, it) to l.substring(it + 1) } }.toMap()
        return if (m["hash"] == report.hashCode().toString()) m else null
    }
}
