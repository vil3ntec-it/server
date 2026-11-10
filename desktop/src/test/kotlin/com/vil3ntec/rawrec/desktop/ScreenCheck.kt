package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.MediaSource
import org.bytedeco.ffmpeg.global.avdevice.avdevice_register_all
import org.bytedeco.ffmpeg.global.avformat.av_find_input_format

/** Screen capture on this machine's display (Linux: X11): what devices the app has, and whether a picture comes. */
fun main() {
    avdevice_register_all()
    for (n in listOf("x11grab", "gdigrab", "dshow", "avfoundation", "v4l2", "lavfi", "kmsgrab", "pulse", "alsa")) println("%-12s %s".format(n, if (av_find_input_format(n) != null) "yes" else "-"))
    val s = MediaSource.screen("", "", 30)
    var img: org.jetbrains.skia.Image? = null
    repeat(50) { if (img == null) { Thread.sleep(100); img = s.image() } }
    println("SCREEN ${img?.let { "${it.width}x${it.height}" } ?: "none"} error=${s.error}")
    img?.let { java.io.File(System.getProperty("user.home"), "screen.png").writeBytes(it.encodeToData(org.jetbrains.skia.EncodedImageFormat.PNG)!!.bytes) }
    s.close()
    System.exit(if (img != null) 0 else 1)
}
