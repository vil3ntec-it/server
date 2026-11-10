package com.vil3ntec.rawrec.desktop.studio

import java.util.concurrent.ConcurrentHashMap
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.DataLine
import javax.sound.sampled.TargetDataLine
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * One sound going into the mix (the phone, a microphone): 16-bit stereo 48 kHz as it comes, held a
 * little ([TARGET_MS]) so its uneven arrival never becomes crackle, then taken at the mixer's steady pace.
 * Its clock and this computer's drift apart slowly: too much held is trimmed, too little waits.
 */
class AudioInput(val id: String) {
    @Volatile var gain = 1f
    @Volatile var muted = false
    /** Loudest sample of the last 100 ms, 0..1, for the meter. */
    @Volatile var level = 0f; internal set

    private val buf = ShortArray(RATE * 2 * 2)   // 2 s
    private var r = 0; private var w = 0; private var n = 0
    private var primed = false
    private val lock = Any()

    /** Little-endian 16-bit stereo PCM. */
    fun push(pcm: ByteArray, len: Int = pcm.size) = synchronized(lock) {
        var i = 0
        while (i + 1 < len) {
            if (n == buf.size) { r = (r + 1) % buf.size; n-- }          // full: the oldest goes
            buf[w] = ((pcm[i].toInt() and 0xFF) or (pcm[i + 1].toInt() shl 8)).toShort()
            w = (w + 1) % buf.size; n++; i += 2
        }
        if (n > MAX_MS * RATE * 2 / 1000) { val drop = n - TARGET_MS * RATE * 2 / 1000; r = (r + drop) % buf.size; n -= drop }
    }

    /** Adds [frames] stereo frames into [mix] (silence while it waits to be held enough again). */
    internal fun mixInto(mix: IntArray, frames: Int) {
        var peak = 0
        synchronized(lock) {
            if (!primed) { if (n >= TARGET_MS * RATE * 2 / 1000) primed = true else return }
            val want = frames * 2
            if (n < want) { primed = false; return }
            val g = if (muted) 0f else gain
            for (k in 0 until want) {
                val s = buf[r].toInt(); r = (r + 1) % buf.size
                val v = (s * g).roundToInt()
                mix[k] += v
                peak = max(peak, abs(v))
            }
            n -= want
        }
        level = max(level * 0.8f, peak / 32768f)
    }

    fun clear() = synchronized(lock) { r = 0; w = 0; n = 0; primed = false }

    companion object {
        const val RATE = 48_000
        const val TARGET_MS = 60
        const val MAX_MS = 250
    }
}

/**
 * The studio's sound: every input summed every 10 ms on this computer's clock (the same clock as the
 * pictures), clipped softly, handed to the outputs with its time.
 */
class AudioMixer(private val out: (ByteArray, Long) -> Unit) : AutoCloseable {
    val inputs = ConcurrentHashMap<String, AudioInput>()
    @Volatile var master = 1f
    @Volatile var level = 0f; private set
    @Volatile private var running = false
    private var thread: Thread? = null

    fun input(id: String): AudioInput = inputs.getOrPut(id) { AudioInput(id) }

    fun start(t0: Long) {
        running = true
        thread = Thread({ loop(t0) }, "studio-mixer").apply { priority = Thread.MAX_PRIORITY - 1; isDaemon = true; start() }
    }

    private fun loop(t0: Long) {
        val frames = AudioInput.RATE / 100            // 10 ms
        val mix = IntArray(frames * 2)
        val pcm = ByteArray(frames * 4)
        var chunk = (System.nanoTime() - t0) / 10_000_000L
        while (running) {
            val due = t0 + chunk * 10_000_000L
            val wait = due - System.nanoTime()
            if (wait > 0) Thread.sleep(wait / 1_000_000, (wait % 1_000_000).toInt())
            else if (-wait > 200_000_000L) { chunk = (System.nanoTime() - t0) / 10_000_000L; continue }   // the computer slept
            mix.fill(0)
            for (i in inputs.values) i.mixInto(mix, frames)
            var peak = 0
            val m = master
            for (k in mix.indices) {
                var v = (mix[k] * m).toInt()
                if (v > 32767 || v < -32768) v = soft(v)
                peak = max(peak, abs(v))
                pcm[k * 2] = v.toByte(); pcm[k * 2 + 1] = (v shr 8).toByte()
            }
            level = max(level * 0.8f, peak / 32768f)
            try { out(pcm, chunk * 10_000) } catch (t: Throwable) { System.err.println("mixer out: ${t.message}") }
            chunk++
        }
    }

    /** Loud sums are bent, not cut flat (a cut sounds like a crack). */
    private fun soft(v: Int): Int {
        val x = v / 32768.0
        return (Math.tanh(x) * 32767).toInt()
    }

    override fun close() { running = false; thread?.join(500) }

    companion object {
        fun db(level: Float): Float = if (level <= 0.00001f) -100f else (20 * log10(level))
    }
}

/** A microphone (or any recording input of the system) into a mixer input. */
class MicCapture(private val mixerName: String?, private val into: AudioInput) : AutoCloseable {
    @Volatile private var running = true
    @Volatile var error: String? = null; private set
    private val thread = Thread({ run() }, "mic").apply { isDaemon = true; start() }

    private fun run() {
        val fmt = AudioFormat(48_000f, 16, 2, true, false)
        val mono = AudioFormat(48_000f, 16, 1, true, false)
        try {
            val info = AudioSystem.getMixerInfo().firstOrNull { it.name == mixerName }
            val m = info?.let { AudioSystem.getMixer(it) }
            val (line, stereo) = listOf(fmt to true, mono to false).firstNotNullOfOrNull { (f, st) ->
                val li = DataLine.Info(TargetDataLine::class.java, f)
                try { ((if (m != null) m.getLine(li) else AudioSystem.getLine(li)) as TargetDataLine).also { it.open(f, 48_000 * 4 / 25) } to st } catch (_: Exception) { null }
            } ?: run { error = "this microphone gives no 48 kHz sound"; return }
            line.start()
            val b = ByteArray(if (stereo) 1920 else 960)
            val st = ByteArray(1920)
            while (running) {
                val k = line.read(b, 0, b.size)
                if (k <= 0) continue
                if (stereo) into.push(b, k)
                else {
                    var j = 0
                    var i = 0
                    while (i + 1 < k) { st[j] = b[i]; st[j + 1] = b[i + 1]; st[j + 2] = b[i]; st[j + 3] = b[i + 1]; i += 2; j += 4 }
                    into.push(st, j)
                }
            }
            line.stop(); line.close()
        } catch (e: Exception) { error = e.message ?: e.javaClass.simpleName }
    }

    override fun close() { running = false; thread.join(500); into.clear() }

    companion object {
        /** The system's sound inputs that can record (names as the system gives them). */
        fun devices(): List<String> = AudioSystem.getMixerInfo().filter { mi ->
            try { AudioSystem.getMixer(mi).targetLineInfo.any { it.lineClass == TargetDataLine::class.java } } catch (_: Exception) { false }
        }.map { it.name }
    }
}
