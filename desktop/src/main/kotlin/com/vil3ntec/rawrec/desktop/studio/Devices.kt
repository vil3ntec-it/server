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

    fun webcams(): List<String> {
        val os = System.getProperty("os.name").lowercase()
        return try {
            when {
                os.contains("win") -> listed("dshow")
                os.contains("mac") -> listOf("0", "1", "2")          // AVFoundation names cameras by number
                else -> File("/dev").listFiles { f -> f.name.matches(Regex("video\\d+")) }?.map { it.absolutePath }?.sorted() ?: emptyList()
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
