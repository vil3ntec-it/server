package com.vil3ntec.rawrec.desktop.studio

import org.bytedeco.ffmpeg.avdevice.AVDeviceInfoList
import org.bytedeco.ffmpeg.global.avdevice.*
import org.bytedeco.ffmpeg.global.avformat.av_find_input_format
import org.bytedeco.javacpp.Pointer
import java.io.File

/** The cameras this computer has, by the names its own capture system gives them. */
object Devices {
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
        avdevice_register_all()
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
