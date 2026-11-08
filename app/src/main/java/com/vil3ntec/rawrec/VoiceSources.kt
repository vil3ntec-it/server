package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * «صدای یارها»: game sounds and the characters' voices always stay; only the teammates' voice chat
 * can be left out (the owner). Android captures other apps' sound by its *kind* (usage), not by
 * voice: a game usually plays its sounds as «بازی» and its voice chat as a separate player
 * («رسانه» or «سایر»). So the recording takes only the chosen kinds.
 *
 * Which kind carries the teammates differs per game, so every recording measures the three kinds
 * apart (cheap: three small capture streams, levels only, nothing is mixed or stored). After the
 * recording the kind that was on nearly all the time is the game; a kind that came and went is the
 * voice chat. If the game mixes its voice chat into its own sound, the two can't be told apart by
 * Android — then nothing is ever switched off: game sound is never risked.
 */
object VoiceSources {
    const val GAME = 1
    const val MEDIA = 2
    const val OTHER = 4
    const val ALL = GAME or MEDIA or OTHER

    val KINDS = listOf(GAME, MEDIA, OTHER)

    fun usageOf(kind: Int) = when (kind) {
        GAME -> AudioAttributes.USAGE_GAME
        MEDIA -> AudioAttributes.USAGE_MEDIA
        else -> AudioAttributes.USAGE_UNKNOWN
    }

    fun nameRes(kind: Int) = when (kind) {
        GAME -> R.string.vs_game
        MEDIA -> R.string.vs_media
        else -> R.string.vs_other
    }

    // ---- what the last recording found
    private const val K_ACT = "vs_act_"        // + kind: % of time active in the last recording
    private const val K_VOICE = "vs_voice"     // the kind found to be the teammates (0 = not found)
    private const val K_MIXED = "vs_mixed"     // the voices seemed to be inside the game sound
    private const val K_GAMEKIND = "vs_game"   // the kind that sounded nearly all the time (the game)

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)

    fun lastActivity(ctx: Context, kind: Int): Int = SafePrefs.int(prefs(ctx), K_ACT + kind, -1)
    fun voiceKind(ctx: Context): Int = SafePrefs.int(prefs(ctx), K_VOICE, 0)
    fun mixed(ctx: Context): Boolean = SafePrefs.bool(prefs(ctx), K_MIXED, false)
    /** The kind the game's own sound came in (0 = not known yet). */
    fun gameKind(ctx: Context): Int = SafePrefs.int(prefs(ctx), K_GAMEKIND, 0)

    /**
     * The kinds a recording captures: the owner's choice, minus the teammates' kind when they asked
     * for «نیاید» and it is known. Never empty, never without the game's own kind.
     */
    fun effectiveMask(ctx: Context, cfg: RecordConfig): Int {
        var m = cfg.audioKinds and ALL
        val g = gameKind(ctx)
        val v = voiceKind(ctx)
        if (!cfg.teamVoice && v != 0 && v != g) m = m and v.inv()
        if (g != 0) m = m or g    // the game's own sound is never left out
        return if (m == 0) ALL else m
    }

    /** Levels of the three kinds during a recording, measured apart. */
    class Meter(private val projection: MediaProjection) {
        private val recs = HashMap<Int, AudioRecord>()
        @Volatile private var running = false
        private var thread: Thread? = null
        private val windows = IntArray(8)
        private val active = IntArray(8)
        private val bursts = IntArray(8)
        private val lastOn = BooleanArray(8)
        @Volatile var levels = FloatArray(8) { -90f }; private set
        private var total = 0

        @SuppressLint("MissingPermission")
        fun start() {
            for (k in KINDS) try {
                val cfg = AudioPlaybackCaptureConfiguration.Builder(projection).addMatchingUsage(usageOf(k)).build()
                val r = AudioRecord.Builder()
                    .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(48_000).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
                    .setBufferSizeInBytes(48_000)
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
                    val n = try { r.read(buf, 0, buf.size, AudioRecord.READ_NON_BLOCKING) } catch (_: Throwable) { -1 }
                    var db = -90f
                    if (n > 0) {
                        var sum = 0.0
                        for (i in 0 until n) sum += buf[i].toDouble() * buf[i]
                        val rms = sqrt(sum / n) / 32768.0
                        db = if (rms > 0) (20 * log10(rms)).toFloat() else -90f
                    }
                    levels[k] = db
                    val on = db > -50f
                    synchronized(this) {
                        windows[k]++
                        if (on) active[k]++
                        if (on && !lastOn[k]) bursts[k]++
                        lastOn[k] = on
                    }
                }
                total++
                try { Thread.sleep(100) } catch (_: InterruptedException) { return }
            }
        }

        fun stop() {
            running = false
            thread?.interrupt()
            try { thread?.join(500) } catch (_: Throwable) {}
            for (r in recs.values) try { r.stop(); r.release() } catch (_: Throwable) {}
            recs.clear()
        }

        /** % of the recording each kind was sounding, and how often it started again. */
        fun summary(): Map<Int, Pair<Int, Int>> = synchronized(this) {
            KINDS.filter { windows[it] > 0 }.associateWith { (active[it] * 100 / windows[it]) to bursts[it] }
        }

        /**
         * Saves what this recording found: the always-on kind is the game; a kind that came and went
         * (≥ 3 times, active 1–60 % of the time) is the teammates. Recordings shorter than 15 s say
         * nothing. Returns the teammates' kind, 0 when none was found.
         */
        fun learn(ctx: Context): Int {
            if (total < 150) return voiceKind(ctx)
            val s = summary()
            val e = prefs(ctx).edit()
            for ((k, v) in s) e.putInt(K_ACT + k, v.first)
            val game = s.maxByOrNull { it.value.first }
            val voice = s.filter { it.key != game?.key && it.value.first in 1..60 && it.value.second >= 3 }
                .maxByOrNull { it.value.second }?.key ?: 0
            if (game != null && game.value.first >= 50) e.putInt(K_GAMEKIND, game.key)
            if (voice != 0 && game != null && game.value.first >= 50) {
                e.putInt(K_VOICE, voice).putBoolean(K_MIXED, false)
            } else if (game != null && game.value.first >= 50 && s.count { it.value.first > 0 } == 1) {
                // Only one kind sounded at all: if the teammates spoke, they were inside the game sound.
                e.putBoolean(K_MIXED, true)
            }
            e.apply()
            return if (voice != 0) voice else voiceKind(ctx)
        }
    }
}
