package com.vil3ntec.rawrec.desktop.studio

import com.sun.jna.Function
import com.sun.jna.Memory
import com.sun.jna.Native
import com.sun.jna.Pointer
import com.sun.jna.platform.win32.Guid
import com.sun.jna.platform.win32.Ole32
import com.sun.jna.ptr.IntByReference
import com.sun.jna.ptr.LongByReference
import com.sun.jna.ptr.PointerByReference
import org.bytedeco.ffmpeg.avcodec.AVPacket
import org.bytedeco.ffmpeg.avformat.AVFormatContext
import org.bytedeco.ffmpeg.avutil.AVDictionary
import org.bytedeco.ffmpeg.global.avcodec.av_packet_unref
import org.bytedeco.ffmpeg.global.avformat.*
import org.bytedeco.ffmpeg.global.avutil.av_dict_free
import org.bytedeco.ffmpeg.global.avutil.av_dict_set
import org.bytedeco.javacpp.PointerPointer

/**
 * What the computer itself plays (the game, the browser, a call) as a sound input, with nothing to install or enable:
 * Windows — the speakers' own stream (WASAPI loopback, as OBS's «Desktop Audio»); Linux — the PulseAudio / PipeWire
 * monitor of the default output. Always 48 kHz 16-bit stereo into [into].
 */
class SystemSound(private val into: AudioInput) : AutoCloseable {
    @Volatile private var running = true
    @Volatile var error: String? = null; private set
    @Volatile var frames = 0L; private set
    private val os = System.getProperty("os.name").lowercase()
    private val thread = Thread({ run() }, "system-sound").apply { isDaemon = true; start() }

    private fun run() {
        try {
            when {
                os.contains("win") -> wasapi()
                os.contains("mac") -> error = "در مک صدای خودِ کامپیوتر فقط با یک بلندگوی مجازی ضبط می‌شود: BlackHole (رایگان) را نصب کن و آن را این‌جا انتخاب کن"
                else -> pulse()
            }
        } catch (t: Throwable) { if (running) error = t.message ?: t.javaClass.simpleName }
    }

    // ------------------------------------------------------------------ Linux: the default output's monitor

    private fun pulse() {
        Devices.captureError?.let { error = it; return }
        val fmt = av_find_input_format("pulse") ?: run { error = "PulseAudio در این نسخهٔ FFmpeg نیست"; return }
        while (running) {
            val ic = AVFormatContext(null as org.bytedeco.javacpp.Pointer?)
            val opts = AVDictionary(null as org.bytedeco.javacpp.Pointer?)
            av_dict_set(opts, "sample_rate", "48000", 0); av_dict_set(opts, "channels", "2", 0); av_dict_set(opts, "fragment_size", "3840", 0)
            val r = avformat_open_input(ic, "@DEFAULT_MONITOR@", fmt, opts)
            av_dict_free(opts)
            if (r < 0) { error = "صدای کامپیوتر باز نشد (PulseAudio/PipeWire): ${com.vil3ntec.rawrec.desktop.VideoDecoder.err(r)}"; Thread.sleep(3000); continue }
            error = null
            val pkt = AVPacket()
            try {
                while (running && av_read_frame(ic, pkt) >= 0) {
                    val n = pkt.size()
                    if (n > 0) { val b = ByteArray(n); pkt.data().get(b); into.push(b, n); frames += n / 4 }
                    av_packet_unref(pkt)
                }
            } finally { avformat_close_input(ic) }
        }
    }

    // ------------------------------------------------------------------ Windows: WASAPI loopback (COM through JNA)

    /** Calls method [index] of a COM object's table with the object first, as COM does; returns its HRESULT. */
    private fun com(obj: Pointer, index: Int, vararg args: Any?): Int {
        val fp = obj.getPointer(0).getPointer(index.toLong() * Native.POINTER_SIZE)
        return Function.getFunction(fp, Function.ALT_CONVENTION).invokeInt(arrayOf<Any?>(obj, *args))
    }
    private fun ok(hr: Int, what: String) { if (hr < 0) throw IllegalStateException("$what (0x${Integer.toHexString(hr)})") }
    private fun guid(s: String) = Guid.GUID.fromString(s).also { it.write() }

    private fun wasapi() {
        Ole32.INSTANCE.CoInitializeEx(null, Ole32.COINIT_MULTITHREADED)
        val pp = PointerByReference()
        ok(Ole32.INSTANCE.CoCreateInstance(guid("{BCDE0395-E52F-467C-8E3D-C4579291692E}"), null, 0x17,
            guid("{A95664D2-9614-4F35-A746-DE8DB63617E6}"), pp).toInt(), "MMDeviceEnumerator")
        val enumr = pp.value
        var device: Pointer? = null; var client: Pointer? = null; var capture: Pointer? = null
        try {
            // the default output (eRender, eConsole): what the person hears
            ok(com(enumr, 4, 0, 0, pp), "بلندگوی پیش‌فرض پیدا نشد"); device = pp.value
            ok(com(device!!, 3, guid("{1CB9AD4C-DBFA-4c32-B178-C2F568A703B2}").pointer, 0x17, null, pp), "IAudioClient"); client = pp.value
            ok(com(client!!, 8, pp), "GetMixFormat")
            val wf = pp.value
            val tag = wf.getShort(0).toInt() and 0xFFFF
            val ch = wf.getShort(2).toInt() and 0xFFFF
            val rate = wf.getInt(4)
            val bits = wf.getShort(14).toInt() and 0xFFFF
            val block = wf.getShort(12).toInt() and 0xFFFF
            // float (most systems) or integer samples; extensible formats name it in their sub-format
            val isFloat = tag == 3 || (tag == 0xFFFE && wf.getInt(24) == 3)
            // shared mode, loopback, a 1 s buffer
            ok(com(client, 3, 0, 0x00020000, 10_000_000L, 0L, wf, null), "Initialize loopback")
            ok(com(client, 14, guid("{C8ADBD64-E71E-48a0-A4DE-185C395CD317}").pointer, pp), "IAudioCaptureClient"); capture = pp.value
            ok(com(client, 10), "Start")
            error = null
            val data = PointerByReference(); val nFrames = IntByReference(); val flags = IntByReference(); val pos = LongByReference(); val qpc = LongByReference()
            val next = IntByReference()
            var out = ByteArray(0)
            var frac = 0.0                                          // resampling position when the output is not 48 kHz
            val step = rate / 48_000.0
            var lastL = 0f; var lastR = 0f
            while (running) {
                Thread.sleep(10)
                while (running) {
                    ok(com(capture!!, 5, next), "GetNextPacketSize")
                    if (next.value == 0) break
                    ok(com(capture, 3, data, nFrames, flags, pos, qpc), "GetBuffer")
                    val n = nFrames.value
                    val silent = flags.value and 2 != 0
                    val src = data.value
                    // to 48 kHz stereo 16-bit: first two channels, linear between neighbours when the rate differs
                    val outN = ((n - frac) / step).toInt().coerceAtLeast(0) + 1
                    if (out.size < outN * 4) out = ByteArray(outN * 4)
                    var o = 0
                    var t = frac
                    fun sample(i: Int, c: Int): Float {
                        if (silent || src == null) return 0f
                        val off = i.toLong() * block + c.coerceAtMost(ch - 1) * (bits / 8)
                        return when {
                            isFloat && bits == 32 -> src.getFloat(off)
                            bits == 16 -> src.getShort(off) / 32768f
                            bits == 24 -> ((src.getByte(off).toInt() and 0xFF) or ((src.getByte(off + 1).toInt() and 0xFF) shl 8) or (src.getByte(off + 2).toInt() shl 16)) / 8388608f
                            bits == 32 -> src.getInt(off) / 2147483648f
                            else -> 0f
                        }
                    }
                    while (t < n) {
                        val i = t.toInt(); val f = (t - i).toFloat()
                        val l0 = if (i == 0) lastL else sample(i - 1, 0); val r0 = if (i == 0) lastR else sample(i - 1, 1)
                        val l1 = sample(i, 0); val r1 = sample(i, 1)
                        val l = if (step == 1.0) l1 else l0 + (l1 - l0) * f
                        val r = if (step == 1.0) r1 else r0 + (r1 - r0) * f
                        val sl = (l * 32767f).toInt().coerceIn(-32768, 32767); val sr = (r * 32767f).toInt().coerceIn(-32768, 32767)
                        out[o] = sl.toByte(); out[o + 1] = (sl shr 8).toByte(); out[o + 2] = sr.toByte(); out[o + 3] = (sr shr 8).toByte(); o += 4
                        t += step
                    }
                    frac = t - n
                    if (n > 0) { lastL = sample(n - 1, 0); lastR = sample(n - 1, 1) }
                    ok(com(capture, 4, n), "ReleaseBuffer")
                    if (o > 0) { into.push(out, o); frames += o / 4 }
                }
            }
            com(client, 11)
            Ole32.INSTANCE.CoTaskMemFree(wf)
        } finally {
            capture?.let { com(it, 2) }; client?.let { com(it, 2) }; device?.let { com(it, 2) }; com(enumr, 2)
            Ole32.INSTANCE.CoUninitialize()
        }
    }

    override fun close() { running = false; thread.join(800); into.clear() }

    companion object {
        /** The choice in the computer-sound channel's device list. */
        const val NAME = "صدای خودِ کامپیوتر (بلندگوها)"
        /** Where this works without extra software. */
        val available: Boolean get() = !System.getProperty("os.name").lowercase().contains("mac")
    }
}
