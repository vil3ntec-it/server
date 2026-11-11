package com.vil3ntec.rawrec.desktop.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.PointerIcon
import androidx.compose.ui.input.pointer.pointerHoverIcon
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.sp
import com.vil3ntec.rawrec.desktop.studio.*
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.min

private enum class Grip { MOVE, TL, T, TR, R, BR, B, BL, L }

/**
 * The program as it goes out (the engine's own picture, so what is seen here is exactly what is
 * recorded and streamed), with the chosen layer's frame and grips on top: drag to move, grips to size
 * (corners keep the shape), edges and centre pull the layer to them with a guide line.
 */
@Composable
fun ProgramView(app: StudioApp, studio: Studio, selected: String?, onSelect: (String?) -> Unit, onEdit: (Studio) -> Unit, phoneLive: Boolean, modifier: Modifier = Modifier,
                /** Studio mode: show the scene being prepared (editable) instead of the program. */
                prepared: Boolean = false, interactive: Boolean = true) {
    var bmp by remember { mutableStateOf<ImageBitmap?>(null) }
    // a vertical scene opened for editing is shown on its own upright canvas
    val vert = interactive && !prepared && studio.editing.vertical
    LaunchedEffect(prepared, vert) {
        var seen = -1L
        while (true) {
            val s = when { vert -> app.engine.vpreviewSeq; prepared -> app.engine.nextSeq; else -> app.engine.previewSeq }
            if (s != seen) {
                seen = s
                bmp = when { vert -> app.engine.useVertical { it.toComposeImageBitmap() }; prepared -> app.engine.useNext { it.toComposeImageBitmap() }; else -> app.engine.usePreview { it.toComposeImageBitmap() } }
            }
            delay(15)
        }
    }
    var box by remember { mutableStateOf(IntSize.Zero) }
    val cur by rememberUpdatedState(studio)
    val sel by rememberUpdatedState(selected)
    var guides by remember { mutableStateOf<List<Pair<Boolean, Float>>>(emptyList()) }   // (vertical?, canvas coord)
    val tm = rememberTextMeasurer()

    fun sceneOf(): Scene = if (interactive) cur.editing else cur.scene
    // the canvas being shown: the upright one for a vertical scene
    fun cW(): Int = if (interactive && !prepared && cur.editing.vertical) cur.vWidth else cur.width
    fun cH(): Int = if (interactive && !prepared && cur.editing.vertical) cur.vHeight else cur.height
    fun fit(): Pair<Float, Offset> {
        val k = min(box.width / cW().toFloat(), box.height / cH().toFloat())
        return k to Offset((box.width - cW() * k) / 2, (box.height - cH() * k) / 2)
    }
    fun toCanvas(p: Offset): Offset { val (k, o) = fit(); return Offset((p.x - o.x) / k, (p.y - o.y) / k) }
    fun hitLayer(c: Offset): Layer? = sceneOf().layers.lastOrNull { l -> l.visible && c.x in l.x..(l.x + l.w) && c.y in l.y..(l.y + l.h) }
    fun grips(l: Layer): List<Pair<Grip, Offset>> = listOf(
        Grip.TL to Offset(l.x, l.y), Grip.T to Offset(l.x + l.w / 2, l.y), Grip.TR to Offset(l.x + l.w, l.y), Grip.R to Offset(l.x + l.w, l.y + l.h / 2),
        Grip.BR to Offset(l.x + l.w, l.y + l.h), Grip.B to Offset(l.x + l.w / 2, l.y + l.h), Grip.BL to Offset(l.x, l.y + l.h), Grip.L to Offset(l.x, l.y + l.h / 2))

    var drag by remember { mutableStateOf<Triple<String, Grip, Layer>?>(null) }   // layer, grip, layer at start
    var acc by remember { mutableStateOf(Offset.Zero) }

    Box(modifier.background(Color(0xFF07090C)).onSizeChanged { box = it }
        .pointerHoverIcon(PointerIcon.Crosshair)
        .pointerInput(interactive) {
            if (interactive) detectTapGestures { p -> onSelect(hitLayer(toCanvas(p))?.id) }
        }
        .pointerInput(interactive) {
            if (interactive) detectDragGestures(
                onDragStart = { p ->
                    val c = toCanvas(p)
                    val (k, _) = fit()
                    val reach = 9f / k
                    val s = sceneOf().layers.firstOrNull { it.id == sel }
                    val g = s?.let { l -> grips(l).firstOrNull { (_, o) -> abs(o.x - c.x) < reach && abs(o.y - c.y) < reach } }
                    val hit = if (g != null) s else hitLayer(c)
                    // a layer covering the whole picture (the game) moves only once chosen: never by a stray drag
                    val l = hit?.takeIf { it.id == sel || !(it.x <= 1f && it.y <= 1f && it.w >= cW() - 1f && it.h >= cH() - 1f) }
                    if (hit != null && l == null) onSelect(hit.id)
                    if (l != null && !l.locked) { drag = Triple(l.id, g?.first ?: Grip.MOVE, l); acc = Offset.Zero; onSelect(l.id) } else drag = null
                },
                onDragEnd = { drag = null; guides = emptyList() },
                onDragCancel = { drag = null; guides = emptyList() },
                onDrag = { ch, amount ->
                    ch.consume()
                    val d = drag ?: return@detectDragGestures
                    val (k, _) = fit()
                    acc += amount / k
                    val o = d.third
                    var x = o.x; var y = o.y; var w = o.w; var h = o.h
                    val ar = o.w / o.h
                    when (d.second) {
                        Grip.MOVE -> { x += acc.x; y += acc.y }
                        Grip.L -> { x += acc.x; w -= acc.x }
                        Grip.R -> w += acc.x
                        Grip.T -> { y += acc.y; h -= acc.y }
                        Grip.B -> h += acc.y
                        Grip.TL, Grip.TR, Grip.BL, Grip.BR -> {
                            val sx = if (d.second == Grip.TL || d.second == Grip.BL) -acc.x else acc.x
                            val sy = if (d.second == Grip.TL || d.second == Grip.TR) -acc.y else acc.y
                            val nw = maxOf(16f, o.w + maxOf(sx, sy * ar))
                            val nh = nw / ar
                            if (d.second == Grip.TL || d.second == Grip.BL) x = o.x + o.w - nw
                            if (d.second == Grip.TL || d.second == Grip.TR) y = o.y + o.h - nh
                            w = nw; h = nh
                        }
                    }
                    w = maxOf(16f, w); h = maxOf(16f, h)
                    // pulled to the canvas edges and centre (within 10 screen pixels), with a guide
                    val snap = 10f / k
                    val g = ArrayList<Pair<Boolean, Float>>()
                    if (d.second == Grip.MOVE) {
                        for ((cx, edge) in listOf(0f to x, cW() / 2f to x + w / 2, cW().toFloat() to x + w))
                            if (abs(edge - cx) < snap) { x += cx - edge; g.add(true to cx); break }
                        for ((cy, edge) in listOf(0f to y, cH() / 2f to y + h / 2, cH().toFloat() to y + h))
                            if (abs(edge - cy) < snap) { y += cy - edge; g.add(false to cy); break }
                    }
                    guides = g
                    onEdit(cur.withLayer(sceneOf().layers.first { it.id == d.first }.copy(x = x, y = y, w = w, h = h)))
                },
            )
        }) {
        Canvas(Modifier.fillMaxSize()) {
            val (k, o) = fit()
            val cw = cW() * k; val ch = cH() * k
            drawRect(Color.Black, o, Size(cw, ch))
            bmp?.let { drawImage(it, dstOffset = androidx.compose.ui.unit.IntOffset(o.x.toInt(), o.y.toInt()), dstSize = IntSize(cw.toInt(), ch.toInt()), filterQuality = FilterQuality.Medium) }
            // a phone layer with no phone yet: say so here (never in the program itself)
            for (l in sceneOf().layers) {
                if (!l.visible) continue
                val src = cur.source(l.sourceId) ?: continue
                if (src.kind == SourceKind.PHONE && !phoneLive) {
                    val tl = Offset(o.x + l.x * k, o.y + l.y * k)
                    drawRect(K.Line, tl, Size(l.w * k, l.h * k), style = Stroke(1.5f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f))))
                    val long = "گوشی وصل نیست — از زبانهٔ «منبع» وصلش کن یا «همین کامپیوتر» را بزن"
                    val style = TextStyle(color = K.Dim, fontSize = 13.sp, fontFamily = K.font)
                    val m = tm.measure(long, style).takeIf { it.size.width < l.w * k - 16 } ?: tm.measure("گوشی وصل نیست", style.copy(fontSize = 11.sp))
                    drawText(m, topLeft = Offset(tl.x + (l.w * k - m.size.width) / 2, tl.y + (l.h * k - m.size.height) / 2))
                }
            }
            for ((vertical, at) in guides) {
                if (vertical) drawLine(K.Amber, Offset(o.x + at * k, o.y), Offset(o.x + at * k, o.y + ch), 1f)
                else drawLine(K.Amber, Offset(o.x, o.y + at * k), Offset(o.x + cw, o.y + at * k), 1f)
            }
            if (interactive) sceneOf().layers.firstOrNull { it.id == sel }?.let { l ->
                val tl = Offset(o.x + l.x * k, o.y + l.y * k)
                drawRect(if (l.locked) K.Dim else K.Accent, tl, Size(l.w * k, l.h * k), style = Stroke(1.5f))
                if (!l.locked) for ((_, g) in grips(l)) {
                    val p = Offset(o.x + g.x * k, o.y + g.y * k)
                    drawRect(Color.White, p - Offset(4f, 4f), Size(8f, 8f))
                    drawRect(K.Accent, p - Offset(4f, 4f), Size(8f, 8f), style = Stroke(1.5f))
                }
            }
        }
    }
}

/** The upright output as it goes out, small (not editable here). */
@Composable
fun VerticalMini(app: StudioApp, modifier: Modifier) {
    var bmp by remember { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(Unit) {
        var seen = -1L
        while (true) {
            val s = app.engine.vpreviewSeq
            if (s != seen) { seen = s; bmp = app.engine.useVertical { it.toComposeImageBitmap() } }
            delay(30)
        }
    }
    Box(modifier.background(Color.Black)) { bmp?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) } }
}
