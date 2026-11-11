package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.AudioMixer
import com.vil3ntec.rawrec.desktop.studio.SystemSound
import kotlin.math.sqrt

/** Records the computer's own sound for [args0] seconds through [SystemSound] and prints its level (evidence, not a test): SystemSoundCheckKt 6 */
fun main(args: Array<String>) {
    val secs = args.getOrNull(0)?.toIntOrNull() ?: 6
    var sum = 0.0; var n = 0L; var peak = 0
    val mixer = AudioMixer { pcm, _ ->
        var i = 0
        while (i + 1 < pcm.size) { val v = (pcm[i].toInt() and 0xFF) or (pcm[i + 1].toInt() shl 8); sum += v.toDouble() * v; n++; if (kotlin.math.abs(v) > peak) peak = kotlin.math.abs(v); i += 2 }
    }
    mixer.limiter = false
    val ss = SystemSound(mixer.input("desktop"))
    mixer.start(System.nanoTime())
    for (s in 1..secs) {
        Thread.sleep(1000)
        val rms = if (n > 0) sqrt(sum / n) / 32768 else 0.0
        println("t=${s}s captured ${ss.frames} frames, level ${"%.1f".format(20 * kotlin.math.log10(rms.coerceAtLeast(1e-6)))} dBFS, peak ${peak} error ${ss.error}")
        sum = 0.0; n = 0; peak = 0
    }
    ss.close(); mixer.close()
    println(if (ss.frames > 0) "SYSTEM_SOUND_OK" else "SYSTEM_SOUND_NONE")
    System.exit(0)
}
