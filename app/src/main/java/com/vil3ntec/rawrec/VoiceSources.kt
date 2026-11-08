package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import java.io.File

/**
 * «صدای یارها»: game sounds and the characters' voices stay; only the teammates' voice chat can be
 * left out (the owner's choice). Android captures other apps' sound by its *kind* (usage), not by
 * voice: a game usually plays its sounds as «بازی» and its voice chat as a separate player
 * («رسانه» or «سایر»). So the recording takes only the chosen kinds.
 *
 * Nothing is guessed: every recording measures the three kinds apart (and the microphone), keeps
 * the last 20 s of what each of them really played as a clip the owner can listen to in the app,
 * and decides from the measurement which kind is the game and which the teammates. The owner can
 * also pick it by ear. If the game mixes its voice chat into its own sound, Android cannot tell
 * them apart — then that is said, and game sound is never removed without the owner confirming.
 *
 * Teammates heard from the phone's speaker reach the microphone too: with the speaker's sound
 * removed from the microphone (echo cancelling, when the phone has it) only the owner's voice is
 * left there.
 */
object VoiceSources {
    const val GAME = VoiceAnalyzer.GAME
    const val MEDIA = VoiceAnalyzer.MEDIA
    const val OTHER = VoiceAnalyzer.OTHER
    /** Measured and listened to, not a kind of other apps' sound. */
    const val MIC = VoiceAnalyzer.MIC
    const val ALL = GAME or MEDIA or OTHER

    val KINDS = listOf(GAME, MEDIA, OTHER)

    /** Apps whose sound is the stream itself when watched on the phone while live (YouTube, YouTube Studio). */
    fun echoUids(ctx: Context): List<Int> = listOf("com.google.android.youtube", "com.google.android.apps.youtube.creator",
        "com.google.android.apps.youtube.music", "com.google.android.youtube.tv").mapNotNull {
        try { ctx.packageManager.getApplicationInfo(it, 0).uid } catch (_: Exception) { null }
    }

    fun usageOf(kind: Int) = when (kind) {
        GAME -> AudioAttributes.USAGE_GAME
        MEDIA -> AudioAttributes.USAGE_MEDIA
        else -> AudioAttributes.USAGE_UNKNOWN
    }

    fun nameRes(kind: Int) = when (kind) {
        GAME -> R.string.vs_game
        MEDIA -> R.string.vs_media
        MIC -> R.string.vs_mic
        else -> R.string.vs_other
    }

    // ---- what the last recording found, and the owner's own choices
    private const val K_ACT = "vs_act_"        // + kind: % of time active in the last recording
    private const val K_VOICE = "vs_voice"     // the kind found to be the teammates (0 = not found)
    private const val K_MIXED = "vs_mixed"     // the voices seemed to be inside the game sound
    private const val K_GAMEKIND = "vs_game"   // the kind that sounded nearly all the time (the game)
    private const val K_PICK = "vs_pick"       // the owner's own answer: teammates are in this kind (0 = automatic)
    private const val K_GAME_OFF = "vs_game_off"   // the owner confirmed leaving the game's own kind out
    private const val K_AEC = "vs_aec"         // remove the speaker's sound from the microphone

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)

    fun lastActivity(ctx: Context, kind: Int): Int = SafePrefs.int(prefs(ctx), K_ACT + kind, -1)
    fun learnedVoice(ctx: Context): Int = SafePrefs.int(prefs(ctx), K_VOICE, 0)
    /** The teammates' kind: the owner's pick when there is one, else what the last recording found. */
    fun voiceKind(ctx: Context): Int = pick(ctx).takeIf { it != 0 } ?: learnedVoice(ctx)
    fun mixed(ctx: Context): Boolean = pick(ctx) == 0 && SafePrefs.bool(prefs(ctx), K_MIXED, false)
    /** The kind the game's own sound came in (0 = not known yet). */
    fun gameKind(ctx: Context): Int = SafePrefs.int(prefs(ctx), K_GAMEKIND, 0)
    fun pick(ctx: Context): Int = SafePrefs.int(prefs(ctx), K_PICK, 0)
    fun setPick(ctx: Context, kind: Int) = prefs(ctx).edit().putInt(K_PICK, kind).apply()
    fun gameOffConfirmed(ctx: Context) = SafePrefs.bool(prefs(ctx), K_GAME_OFF, false)
    fun setGameOffConfirmed(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean(K_GAME_OFF, on).apply()
    fun aec(ctx: Context) = SafePrefs.bool(prefs(ctx), K_AEC, true)
    fun setAec(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean(K_AEC, on).apply()

    /** The clip of [kind] from the last recording («گوش بده»), or null. */
    fun clipFile(ctx: Context, kind: Int): File? = File(File(ctx.filesDir, "voice"), "k$kind.wav").takeIf { it.isFile && it.length() > 44 }

    /**
     * The kinds a recording captures: the owner's switches, minus the teammates' kind when they
     * asked for «نیاید» and it is known (and is not the game's own kind). The game's own kind stays
     * in unless the owner confirmed leaving it out. Never empty.
     */
    fun effectiveMask(ctx: Context, cfg: RecordConfig): Int {
        var m = cfg.audioKinds and ALL
        val g = gameKind(ctx)
        val v = voiceKind(ctx)
        if (!cfg.teamVoice && v in KINDS && v != g) m = m and v.inv()
        if (g != 0 && !gameOffConfirmed(ctx)) m = m or g    // the game's own sound is not lost by accident
        return if (m == 0) ALL else m
    }

    /** Levels of the three kinds (and the microphone) during a recording, measured apart. */
    class Meter(private val projection: MediaProjection) {
        private val recs = HashMap<Int, AudioRecord>()
        @Volatile private var running = false
        private var thread: Thread? = null
        val analyzer = VoiceAnalyzer()
        /** The kinds whose separate capture could be opened (the others are «not measured»). */
        val opened: Set<Int> get() = recs.keys.toSet()
        @Volatile var micFed = false; private set

        @SuppressLint("MissingPermission")
        fun start() {
            for (k in KINDS) try {
                val cfg = AudioPlaybackCaptureConfiguration.Builder(projection).addMatchingUsage(usageOf(k)).build()
                val r = AudioRecord.Builder()
                    .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(48_000).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
                    .setBufferSizeInBytes(96_000)
                    .setAudioPlaybackCaptureConfig(cfg)
                    .build()
                if (r.state == AudioRecord.STATE_INITIALIZED) { r.startRecording(); recs[k] = r } else r.release()
            } catch (_: Throwable) {}
            if (recs.isEmpty()) return
            running = true
            thread = Thread({ loop() }, "rawrec-voice-meter").apply { priority = Thread.MIN_PRIORITY; start() }
        }

        private fun loop() {
            val buf = ShortArray(4_800)   // 100 ms
            while (running) {
                for ((k, r) in recs) {
                    // Everything that came since the last turn, so the clip has no holes.
                    var guard = 0
                    while (guard++ < 20) {
                        val n = try { r.read(buf, 0, buf.size, AudioRecord.READ_NON_BLOCKING) } catch (_: Throwable) { -1 }
                        if (n <= 0) break
                        analyzer.feed(k, buf, n)
                        if (n < buf.size) break
                    }
                }
                try { Thread.sleep(50) } catch (_: InterruptedException) { return }
            }
        }

        /** The microphone's samples as they were recorded (from the recorder's audio thread). */
        fun feedMic(samples: ShortArray, n: Int) {
            if (n <= 0) return
            micFed = true
            analyzer.feed(MIC, samples, n)
        }

        fun stop() {
            running = false
            thread?.interrupt()
            try { thread?.join(500) } catch (_: Throwable) {}
            for (r in recs.values) try { r.stop(); r.release() } catch (_: Throwable) {}
        }

        /** % of the recording each kind was sounding, and how often it started again. */
        fun summary(): Map<Int, Pair<Int, Int>> = analyzer.summary().mapValues { it.value.activePct to it.value.bursts }

        /**
         * Saves what this recording found and the clips to listen to. Recordings shorter than 10 s
         * say nothing. Returns the teammates' kind, 0 when none is known.
         */
        fun learn(ctx: Context): Int {
            val s = analyzer.summary()
            val d = analyzer.decide()
            if (!d.enough) return voiceKind(ctx)
            val e = prefs(ctx).edit()
            for (k in KINDS + MIC) s[k]?.let { e.putInt(K_ACT + k, it.activePct) } ?: e.remove(K_ACT + k)
            if (d.gameKind != 0) e.putInt(K_GAMEKIND, d.gameKind)
            if (d.voiceKind != 0) e.putInt(K_VOICE, d.voiceKind).putBoolean(K_MIXED, false)
            else if (d.mixed) e.putBoolean(K_MIXED, true)
            e.apply()
            saveClips(ctx)
            return voiceKind(ctx)
        }

        private fun saveClips(ctx: Context) {
            val dir = File(ctx.filesDir, "voice")
            dir.mkdirs()
            for (k in KINDS + MIC) {
                val f = File(dir, "k$k.wav")
                val pcm = analyzer.clip(k)
                try {
                    if (pcm.isEmpty()) f.delete()
                    else f.writeBytes(VoiceAnalyzer.wav(pcm))
                } catch (_: Exception) {}
            }
        }
    }
}
