package com.vil3ntec.rawrec

import android.content.Intent

/** Everything the recorder needs, passed from the activity to the service as extras. */
data class RecordConfig(
    val preset: Int = PRESET_SCREEN,
    val resShort: Int = 0,          // 0 = native screen size, else the short side in pixels
    val orient: Int = ORIENT_AUTO,
    val fps: Int = 0,               // 0 = the screen's highest refresh rate, capped by what the encoder sustains
    val codec: Int = CODEC_AUTO,
    val bitrate: Int = BR_AUTO_HIGH, // BR_* sentinel, or Mbps
    val mode: Int = MODE_VBR,
    val audioMode: Int = AUDIO_INTERNAL,
    val gameGain: Float = 1f,
    val micGain: Float = 1f,
    val countdown: Int = 3,
    val shakeStop: Boolean = false,  // off by default; a deliberate hard shake only (see ShakeGesture)
    val facecam: Int = 0,           // 0 off, 1 small, 2 medium, 3 large
    val floatingButton: Boolean = true,
    // Was «invisible while recording» (an empty window that still took touches) until 1.4. Now: the
    // control shrinks to a small visible dot as soon as the recording starts. Nothing is ever invisible.
    val invisibleControl: Boolean = true,
    // «کنترل در ویدیو دیده نشود»: while recording the control is off the screen; a shake (or «نمایشِ
    // کنترل» in the notification) opens it and pauses the recording first, so no frame with the
    // control in it is ever written. See RecordService.ghostOpen.
    val ghostControl: Boolean = true,
    val smartStart: Boolean = true,  // «شروعِ هوشمند برای بازی»: rotation in the first 20 s restarts into one file
    val rotateNewFile: Boolean = false, // «فایلِ جدا برای هر چرخش»: off = one file per recording (see RotationPolicy)
    val gameMode: Boolean = false,   // «حالتِ بازی»: Android 14+ single-app capture, the control stays visible
    val testSeconds: Int = 0,       // > 0: stop by itself after this many seconds and show the report
    // No split by size since 2.0 (RawRec's own MP4 writer has no 4 GB limit); MediaMuxer files
    // (AV1) still stop at MediaStoreSink.MEDIA_MUXER_LIMIT. Tests set a small value.
    val segmentBytes: Long = Long.MAX_VALUE,
) {
    val hasAudio get() = audioMode != AUDIO_NONE
    val usesMic get() = audioMode == AUDIO_MIC || audioMode == AUDIO_BOTH
    val usesInternal get() = audioMode == AUDIO_INTERNAL || audioMode == AUDIO_BOTH
    val wantsOverlay get() = facecam > 0 || floatingButton

    fun putInto(i: Intent) {
        i.putExtra("preset", preset); i.putExtra("res", resShort); i.putExtra("orient", orient)
        i.putExtra("fps", fps); i.putExtra("codec", codec); i.putExtra("br", bitrate); i.putExtra("mode", mode)
        i.putExtra("am", audioMode); i.putExtra("gg", gameGain); i.putExtra("mg", micGain)
        i.putExtra("cd", countdown); i.putExtra("shake", shakeStop); i.putExtra("cam", facecam)
        i.putExtra("float", floatingButton); i.putExtra("invis", invisibleControl); i.putExtra("ghost", ghostControl)
        i.putExtra("smart", smartStart); i.putExtra("game", gameMode); i.putExtra("rotnew", rotateNewFile)
        i.putExtra("test", testSeconds); i.putExtra("seg", segmentBytes)
    }

    companion object {
        const val PRESET_SCREEN = 0   // «مثلِ صفحه (حداکثر)»: native size × highest fps the encoder sustains
        const val PRESET_60 = 1       // «۶۰ فریم»
        const val PRESET_LIGHT = 2    // «سبک»: native size @30, smaller files
        const val PRESET_CUSTOM = 3

        const val ORIENT_AUTO = 0
        const val ORIENT_PORTRAIT = 1
        const val ORIENT_LANDSCAPE = 2

        const val CODEC_AUTO = 0
        const val CODEC_HEVC = 1
        const val CODEC_AVC = 2
        const val CODEC_AV1 = 3

        const val BR_MAX = -1          // «بی‌افت»: about 3× the default target
        const val BR_AUTO_HIGH = -2
        const val BR_AUTO_BALANCED = -3

        const val MODE_VBR = 0
        const val MODE_CBR = 1
        const val MODE_CQ = 2

        const val AUDIO_NONE = 0
        const val AUDIO_INTERNAL = 1
        const val AUDIO_MIC = 2
        const val AUDIO_BOTH = 3

        fun from(i: Intent) = RecordConfig(
            preset = i.getIntExtra("preset", PRESET_SCREEN),
            resShort = i.getIntExtra("res", 0),
            orient = i.getIntExtra("orient", ORIENT_AUTO),
            fps = i.getIntExtra("fps", 0),
            codec = i.getIntExtra("codec", CODEC_AUTO),
            bitrate = i.getIntExtra("br", BR_AUTO_HIGH),
            mode = i.getIntExtra("mode", MODE_VBR),
            audioMode = i.getIntExtra("am", AUDIO_INTERNAL),
            gameGain = i.getFloatExtra("gg", 1f),
            micGain = i.getFloatExtra("mg", 1f),
            countdown = i.getIntExtra("cd", 3),
            shakeStop = i.getBooleanExtra("shake", false),
            facecam = i.getIntExtra("cam", 0),
            floatingButton = i.getBooleanExtra("float", true),
            invisibleControl = i.getBooleanExtra("invis", true),
            ghostControl = i.getBooleanExtra("ghost", true),
            smartStart = i.getBooleanExtra("smart", true),
            rotateNewFile = i.getBooleanExtra("rotnew", false),
            gameMode = i.getBooleanExtra("game", false),
            testSeconds = i.getIntExtra("test", 0),
            segmentBytes = i.getLongExtra("seg", Long.MAX_VALUE),
        )

        /** The fixed video values behind each preset. Audio and overlay choices are kept. */
        fun withPreset(base: RecordConfig, preset: Int): RecordConfig = when (preset) {
            PRESET_SCREEN -> base.copy(preset = preset, resShort = 0, fps = 0, codec = CODEC_AUTO, bitrate = BR_AUTO_HIGH, mode = MODE_VBR)
            PRESET_60 -> base.copy(preset = preset, resShort = 0, fps = 60, codec = CODEC_AUTO, bitrate = BR_AUTO_HIGH, mode = MODE_VBR)
            PRESET_LIGHT -> base.copy(preset = preset, resShort = 0, fps = 30, codec = CODEC_AUTO, bitrate = BR_AUTO_BALANCED, mode = MODE_VBR)
            else -> base.copy(preset = PRESET_CUSTOM)
        }
    }
}
