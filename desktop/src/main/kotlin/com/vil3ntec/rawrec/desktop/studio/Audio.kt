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
/** A sound's treatment, as OBS's audio filters: noise suppression, noise gate, compressor, a delay to match the picture. */
data class AudioFx(
    val denoise: Boolean = false, val denoisePct: Int = 100,
    val gate: Boolean = false, val gateDb: Float = -42f,
    val comp: Boolean = false, val compDb: Float = -20f, val ratio: Float = 4f,
    val delayMs: Int = 0,
)

class AudioInput(val id: String) {
    @Volatile var gain = 1f
    @Volatile var muted = false
    @Volatile var fx = AudioFx()
        set(v) { val old = field; field = v; if (old.denoise != v.denoise || old.denoisePct != v.denoisePct) { synchronized(lock) { denoiser?.close(); denoiser = null } } }
    private var denoiser: Denoiser? = null
    // the gate's and the compressor's state (mixer thread only)
    private var env = 0f; private var gateGain = 0f; private var holdLeft = 0; private var compEnv = 0f
    /** Loudest sample of the last 100 ms, 0..1, for the meter. */
    @Volatile var level = 0f; internal set

    private val buf = ShortArray(RATE * 2 * 2)   // 2 s
    private var r = 0; private var w = 0; private var n = 0
    private var primed = false
    private val lock = Any()

    /** Little-endian 16-bit stereo PCM (noise suppression, when on, is done here, on the capturing thread). */
    fun push(pcm0: ByteArray, len0: Int = pcm0.size) = synchronized(lock) {
        var pcm = pcm0; var len = len0
        if (fx.denoise) {
            val d = denoiser ?: try { Denoiser(fx.denoisePct).also { denoiser = it } } catch (_: Throwable) { null }
            if (d != null) { pcm = d.process(pcm0, len0); len = pcm.size }
        }
        var i = 0
        while (i + 1 < len) {
            if (n == buf.size) { r = (r + 1) % buf.size; n-- }          // full: the oldest goes
            buf[w] = ((pcm[i].toInt() and 0xFF) or (pcm[i + 1].toInt() shl 8)).toShort()
            w = (w + 1) % buf.size; n++; i += 2
        }
        val d = fx.delayMs.coerceIn(0, 1500)
        if (n > (MAX_MS + d) * RATE * 2 / 1000) { val drop = n - (TARGET_MS + d) * RATE * 2 / 1000; r = (r + drop) % buf.size; n -= drop }
    }

    /** Adds [frames] stereo frames into [mix] (silence while it waits to be held enough again). */
    internal fun mixInto(mix: IntArray, frames: Int) {
        var peak = 0
        val f = fx
        synchronized(lock) {
            if (!primed) { if (n >= (TARGET_MS + f.delayMs.coerceIn(0, 1500)) * RATE * 2 / 1000) primed = true else return }
            val want = frames * 2
            if (n < want) { primed = false; return }
            val g = if (muted) 0f else gain
            val gOpen = dbToLin(f.gateDb); val gClose = dbToLin(f.gateDb - 6f)
            val atk = 1f - kotlin.math.exp(-1f / (RATE * 0.005f)); val rel = 1f - kotlin.math.exp(-1f / (RATE * 0.15f))
            val cAtk = 1f - kotlin.math.exp(-1f / (RATE * 0.006f)); val cRel = 1f - kotlin.math.exp(-1f / (RATE * 0.12f))
            val makeup = if (f.comp) dbToLin(-f.compDb * (1 - 1 / f.ratio) * 0.5f) else 1f
            var k = 0
            while (k < want) {
                var l = buf[r] / 32768f; r = (r + 1) % buf.size
                var rr = buf[r] / 32768f; r = (r + 1) % buf.size
                val lvl = max(abs(l), abs(rr))
                if (f.gate) {
                    // opens above the threshold, closes 6 dB under it after 200 ms: words are never cut in half
                    env = max(lvl, env * 0.9995f)
                    if (env >= gOpen) holdLeft = RATE / 5 else if (holdLeft > 0) holdLeft--
                    val targetG = if (env >= gOpen || holdLeft > 0 || (env >= gClose && gateGain > 0.5f)) 1f else 0f
                    gateGain += (targetG - gateGain) * (if (targetG > gateGain) atk else rel)
                    l *= gateGain; rr *= gateGain
                }
                if (f.comp) {
                    compEnv += (lvl - compEnv) * (if (lvl > compEnv) cAtk else cRel)
                    val over = linToDb(compEnv) - f.compDb
                    val cg = if (over > 0) dbToLin(-over * (1 - 1 / f.ratio)) else 1f
                    l *= cg * makeup; rr *= cg * makeup
                }
                val vl = (l * g * 32768f).roundToInt(); val vr = (rr * g * 32768f).roundToInt()
                mix[k] += vl; mix[k + 1] += vr
                peak = max(peak, max(abs(vl), abs(vr)))
                k += 2
            }
            n -= want
        }
        level = max(level * 0.8f, peak / 32768f)
    }

    fun clear() = synchronized(lock) { r = 0; w = 0; n = 0; primed = false }

    fun close() = synchronized(lock) { denoiser?.close(); denoiser = null }

    companion object {
        fun dbToLin(db: Float) = Math.pow(10.0, db / 20.0).toFloat()
        fun linToDb(v: Float) = if (v <= 1e-6f) -120f else (20 * log10(v))
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
    /** The mix never goes over -1 dBFS (a fast limiter before the soft clip). */
    @Volatile var limiter = true
    private var limGain = 1f
    /** Hearing the mix on this computer's speakers or headphones (as it goes out). */
    @Volatile var monitor = false
        set(v) { field = v; if (!v) { monLine?.close(); monLine = null } }
    private var monLine: javax.sound.sampled.SourceDataLine? = null
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
            val ceil = 32768 * 0.891f       // -1 dBFS
            for (k in mix.indices) {
                var x = mix[k] * m
                if (limiter) {
                    val a = abs(x) * limGain
                    if (a > ceil) limGain = ceil / abs(x)                     // instant down
                    else limGain += (1f - limGain) * 0.0002f                   // ~100 ms back up
                    x *= limGain
                }
                var v = x.toInt()
                if (v > 32767 || v < -32768) v = soft(v)
                peak = max(peak, abs(v))
                pcm[k * 2] = v.toByte(); pcm[k * 2 + 1] = (v shr 8).toByte()
            }
            level = max(level * 0.8f, peak / 32768f)
            if (monitor) try {
                val line = monLine ?: (javax.sound.sampled.AudioSystem.getSourceDataLine(javax.sound.sampled.AudioFormat(48_000f, 16, 2, true, false)).also {
                    it.open(javax.sound.sampled.AudioFormat(48_000f, 16, 2, true, false), 48_000 * 4 / 5); it.start(); monLine = it })
                if (line.available() >= pcm.size) line.write(pcm, 0, pcm.size)
            } catch (_: Exception) { monitor = false }
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

/**
 * Noise suppression as OBS's «RNNoise»: FFmpeg's arnndn with a speech model shipped in the app (measured:
 * pink noise −51 → −68 dB, speech level kept), [pct] % of the cleaned sound mixed in. FFmpeg's spectral
 * denoiser (afftdn) when the model cannot be used.
 */
class Denoiser(pct: Int) : AutoCloseable {
    private val graph = org.bytedeco.ffmpeg.global.avfilter.avfilter_graph_alloc()
    private val src = org.bytedeco.ffmpeg.avfilter.AVFilterContext(null as org.bytedeco.javacpp.Pointer?)
    private val sink = org.bytedeco.ffmpeg.avfilter.AVFilterContext(null as org.bytedeco.javacpp.Pointer?)
    private val inF = org.bytedeco.ffmpeg.global.avutil.av_frame_alloc()
    private val outF = org.bytedeco.ffmpeg.global.avutil.av_frame_alloc()
    private var pts = 0L

    init {
        check(org.bytedeco.ffmpeg.global.avfilter.avfilter_graph_create_filter(src, org.bytedeco.ffmpeg.global.avfilter.avfilter_get_by_name("abuffer"), "in",
            "time_base=1/48000:sample_rate=48000:sample_fmt=s16:channel_layout=stereo", null, graph) >= 0) { "abuffer" }
        check(org.bytedeco.ffmpeg.global.avfilter.avfilter_graph_create_filter(sink, org.bytedeco.ffmpeg.global.avfilter.avfilter_get_by_name("abuffersink"), "out", null as String?, null, graph) >= 0) { "abuffersink" }
        val outs = org.bytedeco.ffmpeg.global.avfilter.avfilter_inout_alloc(); outs.name(org.bytedeco.ffmpeg.global.avutil.av_strdup(org.bytedeco.javacpp.BytePointer("in"))); outs.filter_ctx(src); outs.pad_idx(0); outs.next(null)
        val ins = org.bytedeco.ffmpeg.global.avfilter.avfilter_inout_alloc(); ins.name(org.bytedeco.ffmpeg.global.avutil.av_strdup(org.bytedeco.javacpp.BytePointer("out"))); ins.filter_ctx(sink); ins.pad_idx(0); ins.next(null)
        val mix = (pct.coerceIn(10, 100) / 100f)
        val core = model()?.let { m -> "arnndn=m='${m.absolutePath.replace("\\", "/").replace(":", "\\:")}':mix=${"%.2f".format(java.util.Locale.US, mix)}" }
            ?: "afftdn=nr=${(pct * 0.3f).toInt().coerceIn(3, 30)}:nf=-50:tn=1"
        val desc = "$core,aformat=sample_fmts=s16:channel_layouts=stereo:sample_rates=48000"
        val r = org.bytedeco.ffmpeg.global.avfilter.avfilter_graph_parse_ptr(graph, desc, ins, outs, null)
        org.bytedeco.ffmpeg.global.avfilter.avfilter_inout_free(ins); org.bytedeco.ffmpeg.global.avfilter.avfilter_inout_free(outs)
        check(r >= 0) { "denoise filter: ${com.vil3ntec.rawrec.desktop.VideoDecoder.err(r)}" }
        check(org.bytedeco.ffmpeg.global.avfilter.avfilter_graph_config(graph, null) >= 0) { "config" }
    }

    companion object {
        /** The speech model, copied once from the app into its data folder (the filter reads a file). */
        fun model(): java.io.File? = try {
            val f = java.io.File(com.vil3ntec.rawrec.desktop.AppPaths.data, "rnnoise-speech.rnnn")
            if (!f.isFile || f.length() < 100_000) Denoiser::class.java.classLoader.getResourceAsStream("rnnoise/speech.rnnn")?.use { i -> f.outputStream().use { i.copyTo(it) } }
            f.takeIf { it.isFile && it.length() > 100_000 }
        } catch (_: Exception) { null }
    }

    /** Stereo 16-bit in, the same out (as much as the filter has ready; it may hold a few ms back). */
    fun process(pcm: ByteArray, len: Int): ByteArray {
        val n = len / 4
        if (n == 0) return ByteArray(0)
        inF.nb_samples(n); inF.format(org.bytedeco.ffmpeg.global.avutil.AV_SAMPLE_FMT_S16); inF.sample_rate(48_000)
        org.bytedeco.ffmpeg.global.avutil.av_channel_layout_default(inF.ch_layout(), 2)
        inF.pts(pts); pts += n
        check(org.bytedeco.ffmpeg.global.avutil.av_frame_get_buffer(inF, 0) >= 0)
        inF.data(0).put(pcm, 0, n * 4)
        org.bytedeco.ffmpeg.global.avfilter.av_buffersrc_add_frame_flags(src, inF, 0)
        org.bytedeco.ffmpeg.global.avutil.av_frame_unref(inF)
        val out = java.io.ByteArrayOutputStream(len)
        while (org.bytedeco.ffmpeg.global.avfilter.av_buffersink_get_frame(sink, outF) >= 0) {
            val b = ByteArray(outF.nb_samples() * 4); outF.data(0).get(b); out.write(b)
            org.bytedeco.ffmpeg.global.avutil.av_frame_unref(outF)
        }
        return out.toByteArray()
    }

    override fun close() {
        org.bytedeco.ffmpeg.global.avutil.av_frame_free(inF); org.bytedeco.ffmpeg.global.avutil.av_frame_free(outF)
        org.bytedeco.ffmpeg.global.avfilter.avfilter_graph_free(graph)
    }
}
