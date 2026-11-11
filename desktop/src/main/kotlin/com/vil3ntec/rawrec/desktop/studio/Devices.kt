package com.vil3ntec.rawrec.desktop.studio

import org.bytedeco.ffmpeg.avdevice.AVDeviceInfoList
import org.bytedeco.ffmpeg.global.avdevice.*
import org.bytedeco.ffmpeg.global.avformat.av_find_input_format
import org.bytedeco.javacpp.Pointer
import java.io.File

/** The cameras this computer has, by the names its own capture system gives them. */
object Devices {
    /**
     * FFmpeg's capture devices (screen, webcam, desktop sound) are loaded once and only when asked for. On Linux they
     * need the system's sound and X libraries; when one is missing only these sources say why — the rest of the app runs.
     */
    val captureError: String? by lazy {
        try { avdevice_register_all(); null } catch (t: Throwable) {
            val os = System.getProperty("os.name").lowercase()
            if (os.contains("linux")) "ضبطِ صفحه، وب‌کم و صدای کامپیوتر به کتابخانه‌های سیستم نیاز دارند: sudo apt install libpulse0 libasound2 libxcb1 libxcb-shm0 libdrm2"
            else "ابزارِ ضبطِ دستگاه‌ها بار نشد: ${t.message ?: t.javaClass.simpleName}"
        }
    }
    val captureReady get() = captureError == null

    /** A monitor in real pixels (Windows scales what Java reports; the capture needs the true size). */
    data class Monitor(val index: Int, val x: Int, val y: Int, val w: Int, val h: Int, val primary: Boolean) {
        val label get() = "مانیتورِ ${index + 1} — ${w}×${h}" + if (primary) " (اصلی)" else ""
    }

    /** The monitors, the main one first. */
    fun monitors(): List<Monitor> = try {
        val ge = java.awt.GraphicsEnvironment.getLocalGraphicsEnvironment()
        if (java.awt.GraphicsEnvironment.isHeadless()) emptyList() else {
            val main = ge.defaultScreenDevice
            ge.screenDevices.sortedBy { if (it == main) 0 else 1 }.mapIndexed { i, d ->
                val c = d.defaultConfiguration; val b = c.bounds; val t = c.defaultTransform
                Monitor(i, (b.x * t.scaleX).toInt(), (b.y * t.scaleY).toInt(), (b.width * t.scaleX).toInt() and 1.inv(), (b.height * t.scaleY).toInt() and 1.inv(), d == main)
            }
        }
    } catch (_: Throwable) { emptyList() }

    /** Windows' Desktop Duplication capture is in this FFmpeg (the fast way, games included). */
    val hasDda: Boolean by lazy {
        captureReady && try { org.bytedeco.ffmpeg.global.avfilter.avfilter_get_by_name("ddagrab") != null } catch (_: Throwable) { false }
    }

    fun webcams(): List<String> {
        val os = System.getProperty("os.name").lowercase()
        return try {
            when {
                os.contains("win") -> listed("dshow").filter { !VirtualCamera.isOwn(it) }
                os.contains("mac") -> listOf("0", "1", "2")          // AVFoundation names cameras by number
                else -> File("/dev").listFiles { f -> f.name.matches(Regex("video\\d+")) }
                    ?.filter { f -> File("/sys/class/video4linux/${f.name}/name").let { n -> !n.isFile || !VirtualCamera.isOwn(n.readText().trim()) } }
                    ?.map { it.absolutePath }?.sorted() ?: emptyList()
            }
        } catch (_: Throwable) { emptyList() }
    }

    private fun listed(format: String): List<String> {
        if (!captureReady) return emptyList()
        val fmt = av_find_input_format(format) ?: return emptyList()
        val list = AVDeviceInfoList(null as Pointer?)
        if (avdevice_list_input_sources(fmt, null as String?, null, list) < 0 || list.isNull) return emptyList()
        val out = ArrayList<String>()
        for (i in 0 until list.nb_devices()) {
            val d = list.devices(i)
            val types = (0 until d.nb_media_types()).map { d.media_types().get(it.toLong()) }
            if (types.isEmpty() || types.contains(0 /* AVMEDIA_TYPE_VIDEO */)) d.device_description()?.getString()?.let { out.add(it) }
        }
        avdevice_free_list_devices(list)
        return out
    }
}
