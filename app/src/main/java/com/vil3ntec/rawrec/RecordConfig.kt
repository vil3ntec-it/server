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
    // «ظاهرِ ویدیو» (LookFilter): steps, index 1 = neutral except sharp (0 = off). All neutral = no GPU pass.
    val lookSharp: Int = 0,      // 0 off, 1 light, 2 medium, 3 strong
    val lookContrast: Int = 1,   // 0 softer, 1 as is, 2 more, 3 much more
    val lookColor: Int = 1,      // 0 calmer, 1 as is, 2 vivid, 3 very vivid
    val lookBright: Int = 1,     // 0 darker, 1 as is, 2 brighter
    val lookWarm: Int = 1,       // 0 cooler, 1 as is, 2 warmer
    val lookClarity: Int = 0,    // «جزئیاتِ دور»: 0 off, 1 light, 2 medium, 3 strong
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

    /** The look as strengths for [LookFilter]. */
    fun look(): LookFilter.Look = LookFilter.Look(
        sharp = floatArrayOf(0f, 0.35f, 0.65f, 0.95f)[lookSharp.coerceIn(0, 3)],
        contrast = floatArrayOf(0.94f, 1f, 1.08f, 1.16f)[lookContrast.coerceIn(0, 3)],
        brightness = floatArrayOf(-0.03f, 0f, 0.03f)[lookBright.coerceIn(0, 2)],
        saturation = floatArrayOf(0.9f, 1f, 1.08f, 1.18f)[lookColor.coerceIn(0, 3)],
        vibrance = floatArrayOf(0f, 0f, 0.15f, 0.25f)[lookColor.coerceIn(0, 3)],
        warmth = floatArrayOf(-0.04f, 0f, 0.04f)[lookWarm.coerceIn(0, 2)],
        clarity = floatArrayOf(0f, 0.35f, 0.65f, 0.95f)[lookClarity.coerceIn(0, 3)],
    )

    /** Which ready look this is (index into [LOOKS]), or -1 for a look of the owner's own. */
    val lookPreset get() = LOOKS.indexOfFirst { it.contentEquals(intArrayOf(lookSharp, lookContrast, lookColor, lookBright, lookWarm, lookClarity)) }

    fun withLook(i: Int): RecordConfig {
        val v = LOOKS.getOrNull(i) ?: return this
        return copy(lookSharp = v[0], lookContrast = v[1], lookColor = v[2], lookBright = v[3], lookWarm = v[4], lookClarity = v[5])
    }

    fun putInto(i: Intent) {
        i.putExtra("preset", preset); i.putExtra("res", resShort); i.putExtra("orient", orient)
        i.putExtra("fps", fps); i.putExtra("codec", codec); i.putExtra("br", bitrate); i.putExtra("mode", mode)
        i.putExtra("am", audioMode); i.putExtra("gg", gameGain); i.putExtra("mg", micGain)
        i.putExtra("cd", countdown); i.putExtra("shake", shakeStop); i.putExtra("cam", facecam)
        i.putExtra("float", floatingButton); i.putExtra("invis", invisibleControl); i.putExtra("ghost", ghostControl)
        i.putExtra("smart", smartStart); i.putExtra("game", gameMode); i.putExtra("rotnew", rotateNewFile)
        i.putExtra("lk", intArrayOf(lookSharp, lookContrast, lookColor, lookBright, lookWarm, lookClarity))
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

        /** Ready looks: sharp, contrast, colour, brightness, warmth, far detail. «طبیعی», «واضح», «زنده برای بازی», «سینمایی». */
        val LOOKS = listOf(intArrayOf(0, 1, 1, 1, 1, 0), intArrayOf(2, 1, 1, 1, 1, 2), intArrayOf(2, 2, 2, 1, 1, 2), intArrayOf(1, 3, 0, 0, 2, 1))

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
            lookSharp = i.getIntArrayExtra("lk")?.getOrNull(0) ?: 0,
            lookContrast = i.getIntArrayExtra("lk")?.getOrNull(1) ?: 1,
            lookColor = i.getIntArrayExtra("lk")?.getOrNull(2) ?: 1,
            lookBright = i.getIntArrayExtra("lk")?.getOrNull(3) ?: 1,
            lookWarm = i.getIntArrayExtra("lk")?.getOrNull(4) ?: 1,
            lookClarity = i.getIntArrayExtra("lk")?.getOrNull(5) ?: 0,
            gameMode = i.getBooleanExtra("game", false),
            testSeconds = i.getIntExtra("test", 0),
            segmentBytes = i.getLongExtra("seg", Long.MAX_VALUE),
        )

        fun fromPrefs(p: android.content.SharedPreferences): RecordConfig {
            val i = { k: String, d: Int -> SafePrefs.int(p, k, d) }
            return RecordConfig(
                preset = i("c_preset", RecordConfig.PRESET_60).coerceIn(0, 3),
                resShort = i("c_res", 0).coerceAtLeast(0),
                orient = i("c_orient", RecordConfig.ORIENT_AUTO).coerceIn(0, 2),
                fps = i("c_fps", 0).coerceAtLeast(0),
                codec = i("c_codec", RecordConfig.CODEC_AUTO).coerceIn(0, 3),
                bitrate = i("c_br", RecordConfig.BR_AUTO_HIGH),
                mode = i("c_mode", RecordConfig.MODE_VBR).coerceIn(0, 2),
                audioMode = i("c_audio", RecordConfig.AUDIO_INTERNAL).coerceIn(0, 3),
                gameGain = SafePrefs.float(p, "c_gg", 1f),
                micGain = SafePrefs.float(p, "c_mg", 1f),
                countdown = i("c_cd", 3).coerceIn(0, 60),
                shakeStop = SafePrefs.bool(p, "c_shake", false),
                facecam = i("c_cam", 0).coerceIn(0, 3),
                floatingButton = SafePrefs.bool(p, "c_float", true),
                invisibleControl = SafePrefs.bool(p, "c_invis", true),
                ghostControl = SafePrefs.bool(p, "c_ghost", true),
                smartStart = SafePrefs.bool(p, "c_smart", true),
                rotateNewFile = SafePrefs.bool(p, "c_rotnew", false),
                lookSharp = i("c_lk_sharp", 0).coerceIn(0, 3),
                lookContrast = i("c_lk_con", 1).coerceIn(0, 3),
                lookColor = i("c_lk_col", 1).coerceIn(0, 3),
                lookBright = i("c_lk_bri", 1).coerceIn(0, 2),
                lookWarm = i("c_lk_warm", 1).coerceIn(0, 2),
                lookClarity = i("c_lk_cla", 0).coerceIn(0, 3),
                gameMode = SafePrefs.bool(p, "c_game", false),
            )
        }

        /** The settings as the app last saved them, with the chosen preset applied (QuickStart). */
        fun saved(p: android.content.SharedPreferences): RecordConfig {
            val c = fromPrefs(p)
            return if (c.preset == PRESET_CUSTOM) c else withPreset(c, c.preset)
        }

        /** The fixed video values behind each preset. Audio and overlay choices are kept. */
        fun withPreset(base: RecordConfig, preset: Int): RecordConfig = when (preset) {
            PRESET_SCREEN -> base.copy(preset = preset, resShort = 0, fps = 0, codec = CODEC_AUTO, bitrate = BR_AUTO_HIGH, mode = MODE_VBR)
            PRESET_60 -> base.copy(preset = preset, resShort = 0, fps = 60, codec = CODEC_AUTO, bitrate = BR_AUTO_HIGH, mode = MODE_VBR)
            PRESET_LIGHT -> base.copy(preset = preset, resShort = 0, fps = 30, codec = CODEC_AUTO, bitrate = BR_AUTO_BALANCED, mode = MODE_VBR)
            else -> base.copy(preset = PRESET_CUSTOM)
        }
    }
}
