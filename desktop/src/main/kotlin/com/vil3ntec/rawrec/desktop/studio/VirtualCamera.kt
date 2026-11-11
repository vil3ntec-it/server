package com.vil3ntec.rawrec.desktop.studio

import com.sun.jna.Library
import com.sun.jna.Native
import com.sun.jna.Pointer
import com.sun.jna.platform.win32.Advapi32Util
import com.sun.jna.platform.win32.WinNT.HANDLE
import com.sun.jna.platform.win32.WinReg
import com.vil3ntec.rawrec.desktop.AppPaths
import com.vil3ntec.rawrec.desktop.VideoFrame
import org.bytedeco.ffmpeg.avcodec.AVPacket
import org.bytedeco.ffmpeg.avformat.AVFormatContext
import org.bytedeco.ffmpeg.global.avcodec.*
import org.bytedeco.ffmpeg.global.avformat.*
import org.bytedeco.ffmpeg.global.avutil.*
import org.bytedeco.ffmpeg.global.swscale.*
import org.bytedeco.javacpp.BytePointer
import org.bytedeco.javacpp.DoublePointer
import org.bytedeco.javacpp.IntPointer
import org.bytedeco.javacpp.PointerPointer
import java.io.File

/**
 * The studio's picture as a camera for other programs (Zoom, Meet, Discord, Teams, a browser…), as OBS's «Virtual Camera».
 * Windows: a DirectShow camera named «RawRec Studio» (the MIT-licensed UnityCapture filter, registered once with the owner's
 * permission), fed through its shared memory. Linux: a v4l2loopback device, written as raw video. Sound is not part of a camera.
 * An [Output] of the engine: it gets every picture; a worker sends the newest one, so the studio never waits for a viewer.
 */
class VirtualCamera : Output, AutoCloseable {
    @Volatile var error: String? = null; private set
    @Volatile var sent = 0L; private set
    /** True while a program on this computer is actually showing the camera (Windows only knows this). */
    @Volatile var watched = false; private set
    @Volatile private var running = true
    private val lock = Object()
    private var pending: ByteArray? = null
    private var pw = 0; private var ph = 0
    private var spare: ByteArray? = null
    private val worker = Thread({ loop() }, "virtual-camera").apply { isDaemon = true; start() }

    override fun video(f: VideoFrame) {
        synchronized(lock) {
            val need = f.width * f.height * 4
            val b = spare?.takeIf { it.size == need } ?: ByteArray(need)
            spare = null
            val src = f.bgra.duplicate(); src.clear(); src.limit(need); src.get(b)
            pending?.let { spare = it }
            pending = b; pw = f.width; ph = f.height
            lock.notifyAll()
        }
    }
    override fun audio(pcm: ByteArray, ptsUs: Long) {}

    private fun loop() {
        val os = System.getProperty("os.name").lowercase()
        val sink: ((ByteArray, Int, Int) -> Unit)? = try {
            when {
                os.contains("win") -> WinSink()::send
                os.contains("linux") -> LinuxSink()::send
                else -> { error = "دوربینِ مجازی در مک هنوز نیست (به افزونهٔ سیستمیِ امضاشده نیاز دارد)"; null }
            }
        } catch (t: Throwable) { error = t.message; null }
        while (running && sink != null) {
            val job = synchronized(lock) {
                while (running && pending == null) lock.wait(200)
                val x = pending
                pending = null
                if (x == null) null else Triple(x, pw, ph)
            } ?: continue
            val (b, w, h) = job
            try { sink(b, w, h); error = null } catch (t: Throwable) { error = t.message ?: t.javaClass.simpleName; Thread.sleep(1000) }
            synchronized(lock) { if (spare == null) spare = b }
        }
    }

    override fun close() { running = false; synchronized(lock) { lock.notifyAll() }; worker.join(1500) }

    // ------------------------------------------------------------------ Windows: UnityCapture's shared memory

    @Suppress("FunctionName")
    private interface K32 : Library {
        fun OpenMutexA(access: Int, inherit: Boolean, name: String): HANDLE?
        fun CreateEventA(sa: Pointer?, manual: Boolean, initial: Boolean, name: String): HANDLE?
        fun OpenEventA(access: Int, inherit: Boolean, name: String): HANDLE?
        fun OpenFileMappingA(access: Int, inherit: Boolean, name: String): HANDLE?
        fun MapViewOfFile(h: HANDLE, access: Int, hi: Int, lo: Int, size: Long): Pointer?
        fun UnmapViewOfFile(p: Pointer): Boolean
        fun WaitForSingleObject(h: HANDLE, ms: Int): Int
        fun ReleaseMutex(h: HANDLE): Boolean
        fun SetEvent(h: HANDLE): Boolean
        fun CloseHandle(h: HANDLE): Boolean
    }

    private inner class WinSink {
        private val k = Native.load("kernel32", K32::class.java)
        private var mutex: HANDLE? = null; private var want: HANDLE? = null; private var sentEv: HANDLE? = null
        private var map: HANDLE? = null; private var mem: Pointer? = null
        private var lastTry = 0L
        private var row = ByteArray(0)

        /** The filter makes these while a program has the camera open; until then there is no one to send to. */
        private fun open(): Boolean {
            if (mem != null) return true
            val now = System.currentTimeMillis()
            if (now - lastTry < 1000) return false
            lastTry = now
            val m = k.OpenMutexA(0x00100000 /* SYNCHRONIZE */, false, "UnityCapture_Mutx") ?: return false
            k.WaitForSingleObject(m, -1)
            var w: HANDLE? = null; var s: HANDLE? = null; var f: HANDLE? = null; var p: Pointer? = null
            try {
                w = k.CreateEventA(null, false, false, "UnityCapture_Want")
                s = k.OpenEventA(0x0002 /* EVENT_MODIFY_STATE */, false, "UnityCapture_Sent")
                f = k.OpenFileMappingA(0x0002 /* FILE_MAP_WRITE */, false, "UnityCapture_Data")
                p = f?.let { k.MapViewOfFile(it, 0x0002, 0, 0, 0) }
            } finally { k.ReleaseMutex(m) }
            if (w == null || s == null || f == null || p == null) {
                listOfNotNull(w, s, f, m).forEach { k.CloseHandle(it) }; return false
            }
            mutex = m; want = w; sentEv = s; map = f; mem = p
            return true
        }

        private fun reset() {
            mem?.let { k.UnmapViewOfFile(it) }; listOfNotNull(map, sentEv, want, mutex).forEach { k.CloseHandle(it) }
            mem = null; map = null; sentEv = null; want = null; mutex = null
        }

        fun send(bgra: ByteArray, w: Int, h: Int) {
            if (!open()) { watched = false; return }
            val p = mem!!
            val max = p.getInt(0).toLong() and 0xFFFFFFFFL
            if (w.toLong() * h * 4 > max) { error = "تصویر برای دوربینِ مجازی بزرگ است (بیشینه 4K)"; return }
            if (row.size < w * 4) row = ByteArray(w * 4)
            k.WaitForSingleObject(mutex!!, -1)
            try {
                p.setInt(4, w); p.setInt(8, h); p.setInt(12, w)          // stride in pixels
                p.setInt(16, 0)                                            // 8-bit RGBA
                p.setInt(20, 1)                                            // scaled to whatever size the program asks for
                p.setInt(24, 0); p.setInt(28, 1000)                        // not mirrored; «no signal» after 1 s without pictures
                // RGBA, bottom row first (the camera's picture is bottom-up); the studio's own order may already be RGBA
                val r0 = if (SurfacePixels.rgba) 0 else 2; val b0 = 2 - r0
                for (y in 0 until h) {
                    val s = (h - 1 - y) * w * 4
                    var i = 0
                    while (i < w * 4) {
                        row[i] = bgra[s + i + r0]; row[i + 1] = bgra[s + i + 1]; row[i + 2] = bgra[s + i + b0]; row[i + 3] = -1
                        i += 4
                    }
                    p.write(32L + y.toLong() * w * 4, row, 0, w * 4)
                }
            } finally { k.ReleaseMutex(mutex!!) }
            k.SetEvent(sentEv!!)
            watched = k.WaitForSingleObject(want!!, 0) == 0 || watched
            sent++
            // the program closed the camera: the filter's objects go away; look for them again later
            if (sent % 300 == 0L) { reset(); watched = false }
        }
    }

    // ------------------------------------------------------------------ Linux: v4l2loopback

    private inner class LinuxSink {
        private var ctx: AVFormatContext? = null
        private var sws: org.bytedeco.ffmpeg.swscale.SwsContext? = null
        private var cw = 0; private var ch = 0
        private val dev: String = System.getProperty("rawrec.vcam") ?: loopbackDevice()
            ?: throw IllegalStateException("دستگاهِ v4l2loopback نیست: sudo apt install v4l2loopback-dkms && sudo modprobe v4l2loopback card_label=\"RawRec Studio\" exclusive_caps=1")

        private fun loopbackDevice(): String? = File("/sys/devices/virtual/video4linux").listFiles()?.sortedBy { it.name }
            ?.firstOrNull { File(it, "name").takeIf { f -> f.isFile }?.readText()?.isNotBlank() == true }?.let { "/dev/${it.name}" }

        private fun start(w: Int, h: Int) {
            stop()
            Devices.captureError?.let { throw IllegalStateException(it) }
            val c = AVFormatContext(null as org.bytedeco.javacpp.Pointer?)
            check(avformat_alloc_output_context2(c, null, "v4l2", dev) >= 0) { "v4l2 در این نسخهٔ FFmpeg نیست" }
            val st = avformat_new_stream(c, null)
            st.codecpar().codec_type(AVMEDIA_TYPE_VIDEO); st.codecpar().codec_id(AV_CODEC_ID_RAWVIDEO)
            st.codecpar().format(AV_PIX_FMT_YUV420P); st.codecpar().width(w); st.codecpar().height(h)
            st.time_base().num(1); st.time_base().den(30)
            val r = avformat_write_header(c, null as PointerPointer<*>?)
            check(r >= 0) { "دوربینِ مجازی باز نشد ($dev): ${com.vil3ntec.rawrec.desktop.VideoDecoder.err(r)}" }
            ctx = c; cw = w; ch = h
            sws = sws_getContext(w, h, SurfacePixels.avFormat, w, h, AV_PIX_FMT_YUV420P, SWS_BILINEAR, null, null, null as DoublePointer?)
            watched = true
        }

        private fun stop() {
            ctx?.let { av_write_trailer(it); avformat_free_context(it) }; ctx = null
            sws?.let { sws_freeContext(it) }; sws = null
        }

        fun send(bgra: ByteArray, w: Int, h: Int) {
            val ew = w and 1.inv(); val eh = h and 1.inv()
            if (ctx == null || cw != ew || ch != eh) start(ew, eh)
            val ysz = ew * eh
            val pkt = AVPacket(); check(av_new_packet(pkt, ysz * 3 / 2) >= 0)
            val out = pkt.data()
            val src = BytePointer(*bgra)
            // straight into the packet: Y, then U, then V
            sws_scale(sws, PointerPointer<BytePointer>(src), IntPointer(w * 4), 0, eh,
                PointerPointer<BytePointer>(BytePointer(out).position(0), BytePointer(out).position(ysz.toLong()), BytePointer(out).position((ysz + ysz / 4).toLong())),
                IntPointer(ew, ew / 2, ew / 2))
            pkt.stream_index(0)
            val r = av_write_frame(ctx, pkt)
            av_packet_unref(pkt); src.close()
            if (r < 0) { stop(); throw IllegalStateException("دوربینِ مجازی: ${com.vil3ntec.rawrec.desktop.VideoDecoder.err(r)}") }
            sent++
        }
    }

    companion object {
        const val NAME = "RawRec Studio"
        private const val CLSID = "{5C2CD55C-92AD-4999-8666-912BD3E70010}"
        private val win = System.getProperty("os.name").lowercase().contains("win")

        /** Windows: is the camera registered on this computer (done once, with the owner's permission)? */
        val installed: Boolean get() = !win || try { Advapi32Util.registryKeyExists(WinReg.HKEY_CLASSES_ROOT, "CLSID\\$CLSID") } catch (_: Throwable) { false }

        /** The filter copied to the app's data folder (it survives app updates there) and registered with Windows' permission prompt. */
        fun install(remove: Boolean = false): String? {
            if (!win) return null
            val shipped = AppPaths.bundled("vcam/UnityCaptureFilter64.dll") ?: return "دوربینِ مجازیِ ویندوز در این نسخه نیست (درایورِ دوربین هنوز همراهِ برنامه نیست)"
            val dll = File(AppPaths.data, "vcam/UnityCaptureFilter64.dll")
            if (!remove) { dll.parentFile.mkdirs(); if (!dll.isFile || dll.length() != shipped.length()) shipped.copyTo(dll, overwrite = true) }
            val args = if (remove) "'/u','/s','\"${dll.absolutePath}\"'" else "'/s','\"${dll.absolutePath}\"','\"/i:UnityCaptureName=$NAME\"'"
            return try {
                val p = ProcessBuilder("powershell", "-NoProfile", "-Command", "Start-Process regsvr32 -Verb RunAs -Wait -ArgumentList $args").redirectErrorStream(true).start()
                val out = p.inputStream.bufferedReader().readText(); p.waitFor()
                if (!remove && !installed) "نصب نشد (اجازهٔ ویندوز داده نشد؟) $out".trim() else null
            } catch (t: Throwable) { t.message }
        }

        /** Not offered as a webcam of the studio itself (that would show the studio inside itself for ever). */
        fun isOwn(deviceName: String) = deviceName == NAME || deviceName.startsWith("$NAME #") || deviceName.startsWith("Unity Video Capture")
    }
}
