package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.BrowserSource
import org.jetbrains.skia.EncodedImageFormat
import java.io.File

/**
 * A web page drawn by [BrowserSource] (evidence, not a test): BrowserCheckKt page.html out.png — prints the picture's size,
 * whether its background is see-through and whether it moves (a CSS animation), then saves a frame.
 */
fun main(args: Array<String>) {
    val src = BrowserSource(args[0], 800, 600, 30, "")
    var first: ByteArray? = null
    var moved = false
    for (i in 1..80) {
        Thread.sleep(100)
        val img = src.image() ?: continue
        val bmp = org.jetbrains.skia.Bitmap(); bmp.allocPixels(img.imageInfo); img.readPixels(bmp, 0, 0)
        val px = bmp.readPixels() ?: continue
        if (first == null && src.loaded && i > 20) first = px
        else if (first != null && !px.contentEquals(first)) moved = true
        if (i == 70) {
            val corner = bmp.getColor(2, 2); val mid = bmp.getColor(400, 300)
            println("BROWSER ${img.width}x${img.height} loaded=${src.loaded} corner alpha=${corner ushr 24} centre=#${Integer.toHexString(mid)} error=${src.error}")
            File(args[1]).writeBytes(img.encodeToData(EncodedImageFormat.PNG)!!.bytes)
        }
    }
    println("BROWSER moving=$moved")
    src.close()
    System.exit(0)
}
