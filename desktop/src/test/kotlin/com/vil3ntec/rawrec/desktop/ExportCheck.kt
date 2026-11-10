package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.*
import java.io.File

/** Args: clipA clipB outDir. Cuts A 1–4 s and B 2–5 s, joins them, enhances to 1440p; prints the result. */
fun main(args: Array<String>) {
    val out = File(args[2]).apply { mkdirs() }
    val ex = Exporter(listOf(Clip(File(args[0]), 1000, 4000), Clip(File(args[1]), 2000, 5000)), ExportOptions(height = 1440, enhance = args.getOrNull(3) != "plain", sharpen = 0.9f), out)
    val t0 = System.currentTimeMillis()
    val th = Thread { ex.run() }.apply { start() }
    while (th.isAlive) { Thread.sleep(1000); println("progress ${(ex.progress * 100).toInt()}%") }
    println("EXPORT ${ex.done?.absolutePath} error=${ex.error} in ${(System.currentTimeMillis() - t0) / 1000.0}s")
    // the editor's own before/after preview
    val before = Media.frameAt(File(args[0]), 2500, 1280)
    val after = Media.frameAt(File(args[0]), 2500, 2560, ExportOptions(height = 1440, enhance = true, sharpen = 0.6f))
    for ((n, img) in listOf("before" to before, "after" to after)) img?.let {
        File(out, "$n.png").writeBytes(org.jetbrains.skia.Bitmap.makeFromImage(it).let { b -> org.jetbrains.skia.Image.makeFromBitmap(b).encodeToData()!!.bytes })
        println("$n ${it.width}x${it.height}")
    }
    System.exit(if (ex.done != null) 0 else 1)
}
