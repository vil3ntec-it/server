package com.vil3ntec.rawrec

import java.io.ByteArrayOutputStream
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * The measuring part of «صدای یارها», with no Android inside (tested on the JVM): the sound of each
 * kind (game / media / other, and the microphone) comes in as samples; out come how much of the
 * time each kind was sounding, how often it started again, a decision (which kind is the game,
 * which one the teammates), and for each kind a short clip of what it really played — the owner
 * listens and knows, nothing is guessed.
 *
 * The clip keeps the last [clipSeconds] of *sound* of that kind (silent stretches are skipped), at
 * 16 kHz mono: enough to hear voices, ~0.6 MB per kind.
 */
class VoiceAnalyzer(private val rate: Int = 48_000, val clipSeconds: Int = 20) {

    class Stat(val activePct: Int, val bursts: Int, val windows: Int, val loudestDb: Float)
    class Decision(val gameKind: Int, val voiceKind: Int, val mixed: Boolean, val enough: Boolean)

    private class Track(capacity: Int) {
        var windows = 0
        var active = 0
        var bursts = 0
        var lastOn = false
        var loudest = -90f
        var level = -90f
        // the 100 ms window being filled
        val win = ShortArray(4_800)
        var fill = 0
        // the clip: ring of 16 kHz samples
        val ring = ShortArray(capacity)
        var ringPos = 0
        var ringLen = 0
    }

    private val winSize = rate / 10
    private val tracks = HashMap<Int, Track>()
    private val cap = clipSeconds * OUT_RATE

    /** [samples] of [kind], [channels] interleaved (stereo is averaged). Any thread. */
    @Synchronized
    fun feed(kind: Int, samples: ShortArray, n: Int, channels: Int = 1) {
        val t = tracks.getOrPut(kind) { Track(cap) }
        var i = 0
        while (i + channels <= n) {
            val v = if (channels == 2) ((samples[i] + samples[i + 1]) / 2).toShort() else samples[i]
            i += channels
            if (t.fill < t.win.size) t.win[t.fill] = v
            t.fill++
            if (t.fill >= winSize) window(t)
        }
    }

    /** The current level of [kind] in dBFS (for a live meter). */
    @Synchronized
    fun level(kind: Int): Float = tracks[kind]?.level ?: -90f

    private fun window(t: Track) {
        val n = minOf(t.fill, t.win.size)
        var sum = 0.0
        for (j in 0 until n) sum += t.win[j].toDouble() * t.win[j]
        val rms = if (n > 0) sqrt(sum / n) / 32768.0 else 0.0
        val db = if (rms > 0) (20 * log10(rms)).toFloat() else -90f
        t.level = db
        t.windows++
        val on = db > ON_DB
        if (on) {
            t.active++
            if (!t.lastOn) t.bursts++
            if (db > t.loudest) t.loudest = db
            // 48 → 16 kHz: the mean of three samples (also a gentle low-pass against aliasing)
            val step = rate / OUT_RATE
            var j = 0
            while (j + step <= n) {
                var s = 0
                for (q in 0 until step) s += t.win[j + q]
                t.ring[t.ringPos] = (s / step).toShort()
                t.ringPos = (t.ringPos + 1) % t.ring.size
                if (t.ringLen < t.ring.size) t.ringLen++
                j += step
            }
        }
        t.lastOn = on
        t.fill = 0
    }

    @Synchronized
    fun summary(): Map<Int, Stat> = tracks.filter { it.value.windows > 0 }.mapValues { (_, t) ->
        Stat(t.active * 100 / t.windows, t.bursts, t.windows, t.loudest)
    }

    /** What [kind] played, oldest first, 16 kHz mono; empty when it never sounded. */
    @Synchronized
    fun clip(kind: Int): ShortArray {
        val t = tracks[kind] ?: return ShortArray(0)
        val out = ShortArray(t.ringLen)
        val start = (t.ringPos - t.ringLen + t.ring.size) % t.ring.size
        for (i in 0 until t.ringLen) out[i] = t.ring[(start + i) % t.ring.size]
        return out
    }

    fun decide(): Decision = decide(summary())

    companion object {
        // The kinds (the same bits as VoiceSources): other apps' sound by usage, and the microphone.
        const val GAME = 1
        const val MEDIA = 2
        const val OTHER = 4
        const val MIC = 8
        const val OUT_RATE = 16_000
        /** A window counts as sounding above this level (quiet room ≈ −60, soft game music ≈ −40). */
        const val ON_DB = -50f
        /** 10 s of measuring before anything is concluded. */
        const val MIN_WINDOWS = 100

        /**
         * The game is the kind of other apps' sound that was on most of the time (≥ 40 %); the
         * teammates are another kind that came and went (started ≥ 2 times, sounding 1–75 % of the
         * time). Only kinds 1, 2, 4 (other apps' sound) are judged; the microphone is shown, not judged.
         * [mixed]: only the game's kind sounded at all, so voices (if any) were inside it.
         */
        fun decide(s: Map<Int, Stat>): Decision {
            val apps = s.filterKeys { it == GAME || it == MEDIA || it == OTHER }
            val enough = apps.values.any { it.windows >= MIN_WINDOWS }
            if (!enough) return Decision(0, 0, false, false)
            val game = apps.maxByOrNull { it.value.activePct }?.takeIf { it.value.activePct >= 40 }?.key ?: 0
            val voice = apps.filter { it.key != game && it.value.activePct in 1..75 && it.value.bursts >= 2 }
                .maxByOrNull { it.value.bursts * 1000 + it.value.activePct }?.key ?: 0
            val mixed = game != 0 && voice == 0 && apps.count { it.value.activePct > 0 } == 1
            return Decision(game, if (game != 0) voice else 0, mixed, true)
        }

        /** 16-bit mono PCM as a .wav file. */
        fun wav(pcm: ShortArray, sampleRate: Int = OUT_RATE): ByteArray {
            val data = pcm.size * 2
            val b = ByteArrayOutputStream(44 + data)
            fun i32(v: Int) { b.write(v and 255); b.write(v shr 8 and 255); b.write(v shr 16 and 255); b.write(v shr 24 and 255) }
            fun i16(v: Int) { b.write(v and 255); b.write(v shr 8 and 255) }
            b.write("RIFF".toByteArray()); i32(36 + data); b.write("WAVE".toByteArray())
            b.write("fmt ".toByteArray()); i32(16); i16(1); i16(1); i32(sampleRate); i32(sampleRate * 2); i16(2); i16(16)
            b.write("data".toByteArray()); i32(data)
            for (v in pcm) i16(v.toInt())
            return b.toByteArray()
        }
    }
}
