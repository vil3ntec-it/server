package com.vil3ntec.rawrec.desktop.studio

import com.vil3ntec.rawrec.desktop.Session
import com.vil3ntec.rawrec.desktop.VideoFrame
import org.jetbrains.skia.*
import org.jetbrains.skia.impl.BufferUtil
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.max
import kotlin.math.min

/** Where the finished picture and sound go: a recording, a live stream. Called on the engine's threads. */
interface Output {
    /** The picture is valid only during the call (copy what is kept). [VideoFrame.ptsUs] on the engine's clock. */
    fun video(f: VideoFrame)
    /** 16-bit PCM, 48 kHz, stereo, at [ptsUs] on the same clock as the pictures. */
    fun audio(pcm: ByteArray, ptsUs: Long)
}

/**
 * The studio's heart: draws the current scene at exactly the chosen rate on its own thread and gives
 * every picture to the outputs and the preview. One clock for picture and sound (this computer's): a
 * picture's time is its tick, never when it happened to be drawn, so files and streams are evenly timed.
 * The canvas size is fixed while anything records or streams (a size change mid-way made the phone
 * app's game small in black).
 */
class Engine(initial: Studio, private val session: () -> Session?, autostart: Boolean = true) : AutoCloseable {
    @Volatile var studio: Studio = initial
        set(v) { field = if (outputs.isNotEmpty() && (v.width != field.width || v.height != field.height || v.fps != field.fps)) v.copy(width = field.width, height = field.height, fps = field.fps) else v }

    val outputs = CopyOnWriteArrayList<Output>()
    /** What takes the upright (9:16) picture: its live stream and recording; same clock and sound as the main ones. */
    val vOutputs = CopyOnWriteArrayList<Output>()
    val mixer = AudioMixer { pcm, pts -> for (o in outputs) o.audio(pcm, pts); for (o in vOutputs) o.audio(pcm, pts) }

    /** The newest finished picture for the window (at most [PREVIEW_FPS] a second); see [usePreview]. */
    private var preview: Image? = null
    private val previewLock = Any()
    @Volatile var previewSeq = 0L; private set

    /** The window's look at the newest picture, safely (the engine never frees it meanwhile). */
    fun <T> usePreview(f: (Image) -> T): T? = synchronized(previewLock) { preview?.let(f) }

    /** Studio mode: the scene being prepared, drawn smaller and slower (only for the window, never sent). */
    private var next: Image? = null
    @Volatile var nextSeq = 0L; private set
    fun <T> useNext(f: (Image) -> T): T? = synchronized(previewLock) { next?.let(f) }

    /** The upright picture for the window, while a vertical scene exists. */
    private var vpreview: Image? = null
    @Volatile var vpreviewSeq = 0L; private set
    fun <T> useVertical(f: (Image) -> T): T? = synchronized(previewLock) { vpreview?.let(f) }
    private var vSurface: Surface? = null
    @Volatile var vDrawMs = 0.0; private set

    // the transition between the last scene on air and the new one
    private var onAir: String? = null
    private var leaving: String? = null
    private var transStartNs = 0L

    /** The program as a picture file (PNG), at its full size. */
    fun screenshot(to: java.io.File): Boolean {
        val png = usePreview { it.encodeToData(EncodedImageFormat.PNG)?.bytes } ?: return false
        to.parentFile.mkdirs(); to.writeBytes(png); return true
    }

    // what the window shows about the engine
    @Volatile var fps = 0; private set
    @Volatile var drawMs = 0.0; private set
    @Volatile var late = 0L; private set

    private val runtimes = java.util.concurrent.ConcurrentHashMap<String, Pair<SourceDef, SourceRuntime>>()
    /** Colour corrections as ready colour filters (one per setting; few). */
    private val colorFilters = object : LinkedHashMap<Fx, ColorFilter?>() { override fun removeEldestEntry(e: MutableMap.MutableEntry<Fx, ColorFilter?>?) = size > 64 }
    private val t0 = System.nanoTime()
    @Volatile private var running = true
    /** [autostart] false: no picture thread (tests draw by hand). */
    private val thread = Thread({ loop() }, "studio-engine").apply { priority = Thread.MAX_PRIORITY - 1; isDaemon = true; if (autostart) start() }

    init { mixer.start(t0) }

    /** Microseconds on the engine's clock (shared by pictures and sound). */
    fun nowUs() = (System.nanoTime() - t0) / 1000

    private var nextSurface: Surface? = null

    private fun loop() {
        var surface: Surface? = null
        var tick = 0L
        var lastPreviewNs = 0L
        var count = 0; var countAt = System.nanoTime(); var drawSum = 0.0
        while (running) {
            val st = studio
            val period = 1_000_000_000L / st.fps
            if (surface == null || surface.width != st.width || surface.height != st.height) {
                surface?.close()
                surface = Surface.makeRasterN32Premul(st.width, st.height)
                tick = (System.nanoTime() - t0) / period + 1
            }
            // the next tick on the clock; a tick missed (the computer was busy) is skipped, never squeezed in late
            val due = t0 + tick * period
            val wait = due - System.nanoTime()
            if (wait > 0) Thread.sleep(wait / 1_000_000, (wait % 1_000_000).toInt())
            else if (-wait > period) { val skip = -wait / period; late += skip; tick += skip; continue }
            val a = System.nanoTime()
            try {
                drawProgram(surface.canvas, st, a)
                val pts = tick * period / 1000
                if (outputs.isNotEmpty()) {
                    val pm = Pixmap()
                    if (surface.peekPixels(pm)) {
                        val buf = BufferUtil.getByteBufferFromPointer(pm.addr, (pm.rowBytes * st.height))
                        val f = VideoFrame(st.width, st.height, buf, pts)
                        for (o in outputs) o.video(f)
                    }
                    pm.close()
                }
                // the upright canvas, from the same tick: its outputs get every picture, the window a few a second
                val vs = st.verticalScene
                if (vs != null) {
                    val va = System.nanoTime()
                    if (vSurface == null || vSurface!!.width != st.vWidth || vSurface!!.height != st.vHeight) { vSurface?.close(); vSurface = Surface.makeRasterN32Premul(st.vWidth, st.vHeight) }
                    val vsf = vSurface!!
                    vsf.canvas.clear(0xFF000000.toInt()); drawScene(vsf.canvas, st, vs, secondary = true)
                    if (vOutputs.isNotEmpty()) {
                        val pm = Pixmap()
                        if (vsf.peekPixels(pm)) {
                            val f = VideoFrame(st.vWidth, st.vHeight, BufferUtil.getByteBufferFromPointer(pm.addr, pm.rowBytes * st.vHeight), pts)
                            for (o in vOutputs) o.video(f)
                        }
                        pm.close()
                    }
                    if (a - lastPreviewNs >= 1_000_000_000L / PREVIEW_FPS) {
                        val snap = vsf.makeImageSnapshot()
                        synchronized(previewLock) { vpreview?.close(); vpreview = snap }
                        vpreviewSeq++
                    }
                    vDrawMs = (System.nanoTime() - va) / 1e6
                } else if (vpreview != null) synchronized(previewLock) { vpreview?.close(); vpreview = null }
                if (a - lastPreviewNs >= 1_000_000_000L / PREVIEW_FPS) {
                    val snap = surface.makeImageSnapshot()
                    synchronized(previewLock) { preview?.close(); preview = snap }
                    previewSeq++
                    lastPreviewNs = a
                    // studio mode: the prepared scene at half the rate and a smaller size (the program comes first)
                    val pv = st.preview?.let { st.sceneById(it) }
                    if (pv != null && previewSeq % 2 == 0L) {
                        val k = min(1f, 1280f / st.width)
                        val w = (st.width * k).toInt(); val h = (st.height * k).toInt()
                        if (nextSurface == null || nextSurface!!.width != w || nextSurface!!.height != h) { nextSurface?.close(); nextSurface = Surface.makeRasterN32Premul(w, h) }
                        val c = nextSurface!!.canvas
                        c.save(); c.scale(k, k); c.clear(0xFF000000.toInt()); drawScene(c, st, pv); c.restore()
                        val img = nextSurface!!.makeImageSnapshot()
                        synchronized(previewLock) { next?.close(); next = img }
                        nextSeq++
                    }
                }
            } catch (t: Throwable) {
                System.err.println("engine: ${t.message}")
            }
            drawSum += (System.nanoTime() - a) / 1e6; count++
            tick++
            if (System.nanoTime() - countAt >= 1_000_000_000L) {
                fps = count; drawMs = if (count > 0) drawSum / count else 0.0
                count = 0; drawSum = 0.0; countAt = System.nanoTime()
            }
        }
        surface?.close(); nextSurface?.close(); vSurface?.close()
        runtimes.values.forEach { it.second.close() }
    }

    /** The program: the scene on air, or two scenes while one gives way to the other. */
    fun drawProgram(c: Canvas, st: Studio, nowNs: Long = System.nanoTime()) {
        val cur = st.scene.id
        if (onAir == null) onAir = cur
        if (cur != onAir) {
            leaving = if (st.transition == Transition.CUT || st.transitionMs <= 0) null else onAir
            onAir = cur; transStartNs = nowNs
        }
        val from = leaving?.let { st.sceneById(it) }
        val t = if (from == null) 1f else ((nowNs - transStartNs) / 1e6f / st.transitionMs).coerceIn(0f, 1f)
        if (t >= 1f) leaving = null
        syncRuntimes(st, listOfNotNull(st.scene, from, st.preview?.let { st.sceneById(it) }, st.verticalScene))
        c.clear(0xFF000000.toInt())
        if (from == null || t >= 1f) { drawScene(c, st, st.scene); return }
        val e = smooth(t)
        when (st.transition) {
            Transition.FADE -> {
                drawScene(c, st, from)
                Paint().use { p -> p.alpha = (e * 255).toInt(); c.saveLayer(null, p) }
                drawScene(c, st, st.scene); c.restore()
            }
            Transition.SLIDE -> {
                c.save(); c.translate(-e * st.width, 0f); drawScene(c, st, from); c.restore()
                c.save(); c.translate((1 - e) * st.width, 0f); drawScene(c, st, st.scene); c.restore()
            }
            Transition.ZOOM -> {
                drawScene(c, st, from)
                Paint().use { p -> p.alpha = (e * 255).toInt(); c.saveLayer(null, p) }
                val z = 1.12f - 0.12f * e
                c.save(); c.translate(st.width / 2f, st.height / 2f); c.scale(z, z); c.translate(-st.width / 2f, -st.height / 2f)
                drawScene(c, st, st.scene); c.restore(); c.restore()
            }
            Transition.CUT -> drawScene(c, st, st.scene)
        }
    }

    private fun smooth(t: Float) = t * t * (3 - 2 * t)

    /**
     * One picture of a scene: layers bottom to top, each placed, turned, cut, faded and treated as set. [secondary]: the
     * upright canvas — a source shown on the main canvas too keeps the main canvas's size and treatment (one conversion per
     * picture, never two fighting each other).
     */
    fun drawScene(c: Canvas, st: Studio, scene: Scene, secondary: Boolean = false) {
        val onMain = if (secondary) st.scene.layers.mapTo(HashSet()) { it.sourceId } else emptySet<String>()
        for (l in scene.layers) {
            if (!l.visible || l.opacity <= 0f || l.w < 1f || l.h < 1f) continue
            val rt = runtimes[l.sourceId]?.second ?: continue
            c.save()
            c.translate(l.x + l.w / 2, l.y + l.h / 2)
            if (l.rot != 0f) c.rotate(l.rot)
            c.translate(-l.w / 2, -l.h / 2)
            if (l.radius > 0f) c.clipRRect(RRect.makeXYWH(0f, 0f, l.w, l.h, l.radius), ClipMode.INTERSECT, true)
            when (rt) {
                is PictureSource -> {
                    if (l.sourceId !in onMain) {
                        rt.want(if (l.rot == 0f && l.crop == Crop() && (scene.id == st.scene.id || secondary)) shownSize(l) else null)
                        rt.fx(l.fx)
                    }
                    rt.image()?.let { drawPicture(c, it, l) }
                }
                is DrawnSource -> {
                    val stamp = rt.stamp(l.w, l.h)
                    val img = if (stamp == null) null else cachedDraw(l, rt, stamp)
                    if (img != null) Paint().use { p -> if (l.opacity < 1f) p.alpha = (l.opacity * 255).toInt(); c.drawImage(img, 0f, 0f, p) }
                    else {
                        if (l.opacity < 1f) Paint().use { p -> p.alpha = (l.opacity * 255).toInt(); c.saveLayer(null, p) }
                        rt.draw(c, l.w, l.h)
                        if (l.opacity < 1f) c.restore()
                    }
                }
            }
            c.restore()
        }
    }

    private class Cached(val stamp: Any, val img: Image)
    private val drawnCache = HashMap<String, Cached>()

    /** A still drawn layer as a ready picture: drawn again only when its stamp changes. */
    private fun cachedDraw(l: Layer, rt: DrawnSource, stamp: Any): Image? {
        val key = "${l.id}|${l.sourceId}"
        drawnCache[key]?.let { if (it.stamp == stamp) return it.img }
        val w = Math.ceil(l.w.toDouble()).toInt(); val h = Math.ceil(l.h.toDouble()).toInt()
        if (w < 1 || h < 1 || w * h > 8_300_000) return null
        val img = Surface.makeRasterN32Premul(w, h).use { s -> s.canvas.clear(0); rt.draw(s.canvas, l.w, l.h); s.makeImageSnapshot() }
        drawnCache.put(key, Cached(stamp, img))?.img?.close()
        return img
    }

    /** The size a picture of (w, h) takes in the layer's box, for sources to convert straight to it. */
    private fun shownSize(l: Layer): (Int, Int) -> Pair<Int, Int> = { w, h ->
        when (l.fit) {
            Fit.STRETCH -> Math.round(l.w) to Math.round(l.h)
            Fit.CONTAIN -> { val s = min(l.w / w, l.h / h); Math.round(w * s) to Math.round(h * s) }
            Fit.COVER -> { val s = max(l.w / w, l.h / h); Math.round(w * s) to Math.round(h * s) }
        }
    }

    private fun drawPicture(c: Canvas, img: Image, l: Layer) {
        val iw = img.width.toFloat(); val ih = img.height.toFloat()
        var sx = iw * l.crop.l; var sy = ih * l.crop.t
        var sw = iw * (1 - l.crop.l - l.crop.r); var sh = ih * (1 - l.crop.t - l.crop.b)
        if (sw < 1f || sh < 1f) return
        var dx = 0f; var dy = 0f; var dw = l.w; var dh = l.h
        when (l.fit) {
            Fit.CONTAIN -> { val s = min(l.w / sw, l.h / sh); dw = sw * s; dh = sh * s; dx = (l.w - dw) / 2; dy = (l.h - dh) / 2 }
            Fit.COVER -> { val s = max(l.w / sw, l.h / sh); val cw = l.w / s; val ch = l.h / s; sx += (sw - cw) / 2; sy += (sh - ch) / 2; sw = cw; sh = ch }
            Fit.STRETCH -> {}
        }
        val cf = colorFilters.getOrPut(l.fx) { FxFilter.colorFilter(l.fx) }
        // shown as it came (the source already converted it to this size): laid down pixel for pixel
        if (l.rot == 0f && kotlin.math.abs(dw - sw) < 1.01f && kotlin.math.abs(dh - sh) < 1.01f) {
            Paint().use { p ->
                if (l.opacity < 1f) p.alpha = (l.opacity * 255).toInt()
                cf?.let { p.colorFilter = it }
                val ox = Math.round(l.x + dx) - l.x; val oy = Math.round(l.y + dy) - l.y
                c.drawImageRect(img, Rect.makeXYWH(sx, sy, sw, sh), Rect.makeXYWH(ox, oy, sw, sh), SamplingMode.DEFAULT, p, true)
            }
            return
        }
        val scale = min(dw / sw, dh / sh)
        // a strong reduction (a tall phone picture into a small box) reads its smaller copies: no shimmer
        // (only while a source is still catching up with a new box size, or for a turned layer)
        val sampling: SamplingMode = if (scale < 0.6f) FilterMipmap(FilterMode.LINEAR, MipmapMode.LINEAR) else FilterMipmap(FilterMode.LINEAR, MipmapMode.NONE)
        Paint().use { p ->
            if (l.opacity < 1f) p.alpha = (l.opacity * 255).toInt()
            cf?.let { p.colorFilter = it }
            c.drawImageRect(img, Rect.makeXYWH(sx, sy, sw, sh), Rect.makeXYWH(dx, dy, dw, dh), sampling, p, true)
        }
    }

    /** Make, keep or drop each source's live part as the studio changes (a webcam opens once, not each picture). */
    private fun syncRuntimes(st: Studio, scenes: List<Scene>) {
        val used = scenes.flatMap { it.layers }.map { it.sourceId }.toSet()
        val keys = scenes.flatMap { it.layers }.map { "${it.id}|${it.sourceId}" }.toSet()
        drawnCache.keys.filter { it !in keys }.forEach { drawnCache.remove(it)?.img?.close() }
        val it = runtimes.entries.iterator()
        while (it.hasNext()) {
            val (id, pair) = it.next()
            val def = st.source(id)
            if (def == null || id !in used || needsRestart(pair.first, def)) { pair.second.close(); it.remove(); mixer.inputs.remove("media-$id") }
        }
        for (id in used) if (!runtimes.containsKey(id)) {
            val def = st.source(id) ?: continue
            runtimes[id] = def to make(def)
        }
    }

    private fun needsRestart(a: SourceDef, b: SourceDef) = when (a.kind) {
        SourceKind.WEBCAM -> a.prop("device") != b.prop("device")
        SourceKind.VIDEO -> a.prop("path") != b.prop("path") || a.prop("audio", "1") != b.prop("audio", "1")
        SourceKind.IMAGE -> a.prop("path") != b.prop("path")
        SourceKind.SCREEN -> a.prop("display") != b.prop("display") || a.prop("window") != b.prop("window")
        else -> false
    }

    private fun make(d: SourceDef): SourceRuntime = when (d.kind) {
        SourceKind.PHONE -> PhoneSource(session)
        SourceKind.WEBCAM -> MediaSource.webcam(d.prop("device"))
        SourceKind.VIDEO -> MediaSource(null, d.prop("path"), loop = true, sound = if (d.prop("audio", "1") == "1") mixer.input("media-${d.id}") else null)
        SourceKind.SCREEN -> MediaSource.screen(d.prop("display"), d.prop("window"), studio.fps)
        SourceKind.SLIDESHOW -> SlideshowSource { studio.source(d.id) }
        SourceKind.COUNTER -> CounterSource { studio.source(d.id) }
        SourceKind.GOAL -> GoalSource { studio.source(d.id) }
        SourceKind.IMAGE -> ImageFileSource(d.prop("path"))
        SourceKind.TEXT -> TextSource { studio.source(d.id) }
        SourceKind.COLOR -> ColorSource { studio.source(d.id) }
        SourceKind.CHAT -> ChatSource { studio.source(d.id) }
        SourceKind.ALERTS -> AlertSource { studio.source(d.id) }
    }

    /** A source's problem to show in the window (a webcam that will not open…). */
    fun sourceError(id: String): String? = (runtimes[id]?.second as? MediaSource)?.error

    override fun close() {
        running = false
        mixer.close()
        if (thread.isAlive) thread.join(2000)
        synchronized(previewLock) { preview?.close(); preview = null; next?.close(); next = null }
    }

    companion object {
        const val PREVIEW_FPS = 30

    }
}
