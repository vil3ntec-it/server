package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.Fx
import com.vil3ntec.rawrec.desktop.studio.FxFilter

/** Times the green screen and sharpening at 720p and 1080p (bench, not a test): FxBenchKt */
fun main() {
    for ((w, h) in listOf(1280 to 720, 1920 to 1080)) {
        val px = ByteArray(w * h * 4) { i -> when (i % 4) { 1 -> -1; 3 -> -1; else -> if (i % 4 == 0 && (i / 4) % w > 600) 100 else 0 } }
        for ((name, fx) in listOf("key" to Fx(key = true), "sharpen" to Fx(sharpen = 0.3f), "key+sharpen" to Fx(key = true, sharpen = 0.3f))) {
            FxFilter().use { f ->
                repeat(10) { f.apply(px, w, h, fx) }
                val t = System.nanoTime(); repeat(40) { f.apply(px, w, h, fx) }
                println("%-12s %dx%d  %.1f ms".format(name, w, h, (System.nanoTime() - t) / 1e6 / 40))
            }
        }
    }
}
