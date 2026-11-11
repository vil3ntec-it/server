package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.*

/**
 * The studio's picture through the virtual camera and back, as another program sees it (evidence, not a test):
 * VirtualCameraCheckKt <camera name or /dev/videoN> — the scene is red above, blue below; the camera is opened like a
 * webcam and its top and bottom colours are printed.
 */
fun main(args: Array<String>) {
    val device = args[0]
    var s = Studio.default().copy(width = 1280, height = 720, fps = 30)
    s = s.add(SourceKind.COLOR, "red", mapOf("color" to "#FFFF0000")).first
    s = s.add(SourceKind.COLOR, "blue", mapOf("color" to "#FF0000FF")).first.let { st ->
        st.withLayer(st.scene.layers.last().copy(x = 0f, y = 360f, w = 1280f, h = 360f))
    }
    s = s.withScene(s.scene.copy(layers = s.scene.layers.filter { st -> s.source(st.sourceId)?.kind == SourceKind.COLOR }))
    Engine(s, { null }).use { e ->
        val cam = VirtualCamera(); e.outputs.add(cam)
        Thread.sleep(1500)
        val src = MediaSource.webcam(device)
        var ok = false
        for (i in 1..40) {
            Thread.sleep(500)
            val img = src.image() ?: continue
            val b = org.jetbrains.skia.Bitmap(); b.allocPixels(img.imageInfo); img.readPixels(b, 0, 0)
            val top = b.getColor(img.width / 2, img.height / 8); val bottom = b.getColor(img.width / 2, img.height * 7 / 8)
            fun hex(c: Int) = "#%06X".format(c and 0xFFFFFF)
            println("VCAM ${img.width}x${img.height} top=${hex(top)} bottom=${hex(bottom)} sent=${cam.sent} watched=${cam.watched} error=${cam.error ?: src.error}")
            val r = { c: Int -> (c shr 16) and 0xFF }; val bl = { c: Int -> c and 0xFF }
            if (r(top) > 180 && bl(top) < 80 && bl(bottom) > 180 && r(bottom) < 80) { ok = true; break }
        }
        println(if (ok) "VCAM_OK" else "VCAM_FAILED camera error=${cam.error} source error=${src.error}")
        src.close(); e.outputs.remove(cam); cam.close()
    }
    System.exit(0)
}
