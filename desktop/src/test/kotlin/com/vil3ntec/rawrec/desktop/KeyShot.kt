package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.*
import org.jetbrains.skia.*
import java.io.File

/** A green-screen picture over a background, keyed by the engine, saved as PNG (evidence, not a test): KeyShotKt cam.png out.png */
fun main(args: Array<String>) {
    val img = Image.makeFromEncoded(File(args[0]).readBytes())
    val bg = SourceDef("bg", SourceKind.COLOR, "bg", mapOf("color" to "#FF7C3AED"))
    val cam = SourceDef("cam", SourceKind.IMAGE, "cam", mapOf("path" to args[0]))
    val w = 1280f; val h = w * img.height / img.width
    val l = listOf(Layer("b", "bg", 0f, 0f, w, h), Layer("c", "cam", 0f, 0f, w, h, fit = Fit.STRETCH, fx = Fx(key = true, sharpen = 0.3f)))
    val st = Studio(w.toInt(), h.toInt(), 30, listOf(bg, cam), listOf(Scene("s", "s", l)), "s")
    Engine(st, { null }, autostart = false).use { e ->
        val s = Surface.makeRasterN32Premul(st.width, st.height)
        repeat(3) { e.drawProgram(s.canvas, st); Thread.sleep(300) }
        File(args[1]).writeBytes(s.makeImageSnapshot().encodeToData(EncodedImageFormat.PNG)!!.bytes)
    }
}
