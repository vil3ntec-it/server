package com.vil3ntec.rawrec.desktop.studio

import javafx.application.Platform
import javafx.scene.Scene
import javafx.scene.SnapshotParameters
import javafx.scene.image.PixelFormat
import javafx.scene.image.WritableImage
import javafx.scene.layout.StackPane
import javafx.scene.paint.Color
import javafx.scene.web.WebView
import javafx.stage.Stage
import javafx.stage.StageStyle
import org.jetbrains.skia.Image
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicReference

/**
 * A web page on the picture, as OBS's «Browser» source: stream widgets (alerts, chat boxes, timers from StreamElements,
 * Streamlabs…), an HTML file, any address. The page is drawn by WebKit at the chosen size with a see-through background,
 * [fps] times a second, in its own off-screen window (never shown on screen or the taskbar); scripts, CSS animations,
 * fonts, images and GIFs work. The page's own sound plays on the speakers (pick «the computer's own sound» to have it in
 * the mix).
 */
class BrowserSource(private val url: String, private val width: Int, private val height: Int, private val fps: Int, private val css: String) : PictureSource {
    private val newest = AtomicReference<Pixels?>(null)
    private val latest = LatestImage()
    @Volatile var error: String? = null; private set
    @Volatile var loaded = false; private set
    private var stage: Stage? = null
    private var view: WebView? = null
    private var timer: javafx.animation.AnimationTimer? = null
    private var seq = 0L

    init {
        FxToolkit.start()
        Platform.runLater {
            try {
                val v = WebView()
                v.setPrefSize(width.toDouble(), height.toDouble()); v.setMinSize(width.toDouble(), height.toDouble()); v.setMaxSize(width.toDouble(), height.toDouble())
                v.pageFill = Color.TRANSPARENT
                v.isContextMenuEnabled = false
                val e = v.engine
                e.userAgent = e.userAgent + " RawRecStudio/1.3 OBS/30.0"   // widgets that look for OBS show their OBS layout
                // OBS's default page style (see-through, no margin, no scroll bars) plus the owner's own CSS
                val pageStyle = "body { background-color: rgba(0, 0, 0, 0) !important; margin: 0px auto; overflow: hidden; } $css"
                e.userStyleSheetLocation = "data:text/css;charset=utf-8;base64," + java.util.Base64.getEncoder().encodeToString(pageStyle.toByteArray())
                e.loadWorker.stateProperty().addListener { _, _, st ->
                    when (st) {
                        javafx.concurrent.Worker.State.SUCCEEDED -> { loaded = true; error = null }
                        javafx.concurrent.Worker.State.FAILED -> error = "صفحه باز نشد: ${e.loadWorker.exception?.message ?: url}"
                        else -> {}
                    }
                }
                val root = StackPane(v).apply { style = "-fx-background-color: transparent;" }
                val sc = Scene(root, width.toDouble(), height.toDouble(), Color.TRANSPARENT)
                val st = Stage(StageStyle.TRANSPARENT)
                st.scene = sc; st.x = -32000.0; st.y = -32000.0; st.isAlwaysOnTop = false
                // a utility owner keeps it off the taskbar on Windows
                val owner = Stage(StageStyle.UTILITY)
                owner.opacity = 0.0; owner.x = -32000.0; owner.y = -32000.0; owner.setWidth(1.0); owner.setHeight(1.0); owner.show()
                st.initOwner(owner)
                st.show()
                stage = st; view = v
                e.load(normalise(url))
                val img = WritableImage(width, height)
                val params = SnapshotParameters().apply { fill = Color.TRANSPARENT }
                val buf = ByteBuffer.allocate(width * height * 4)
                val fmt = PixelFormat.getByteBgraPreInstance()
                val period = 1_000_000_000L / fps.coerceIn(1, 60)
                var last = 0L
                timer = object : javafx.animation.AnimationTimer() {
                    override fun handle(now: Long) {
                        if (now - last < period) return
                        last = now
                        try {
                            v.snapshot(params, img)
                            buf.clear()
                            img.pixelReader.getPixels(0, 0, width, height, fmt, buf, width * 4)
                            newest.set(Pixels(width, height, buf.array().copyOf(), ++seq, alpha = true))
                        } catch (t: Throwable) { error = t.message }
                    }
                }.also { it.start() }
            } catch (t: Throwable) { error = "مرورگر باز نشد: ${t.message ?: t.javaClass.simpleName}" }
        }
    }

    override fun image(): Image? = latest.from(newest.get())

    /** Again from the start (as OBS's «Refresh cache of current page»). */
    fun reload() = Platform.runLater { view?.engine?.reload() }

    override fun close() {
        Platform.runLater {
            timer?.stop()
            view?.engine?.load("about:blank")
            stage?.owner?.let { (it as? Stage)?.close() }
            stage?.close()
        }
        latest.close()
    }

    companion object {
        /** An address as typed: a web address, a local HTML file, or bare text taken as a web address. */
        fun normalise(u: String): String {
            val t = u.trim()
            return when {
                t.startsWith("http://") || t.startsWith("https://") || t.startsWith("file:") || t.startsWith("data:") || t.startsWith("about:") -> t
                java.io.File(t).isFile -> java.io.File(t).toURI().toString()
                t.isBlank() -> "about:blank"
                else -> "https://$t"
            }
        }
    }
}

/** JavaFX started once for the whole app (never stopped by closing its last window). */
object FxToolkit {
    @Volatile private var started = false
    @Synchronized fun start() {
        if (started) return
        // through the Swing bridge: the way JavaFX shares a process with AWT/Compose on every system (macOS included,
        // where a plain start would wait for the main thread forever)
        try {
            val make = Runnable { javafx.embed.swing.JFXPanel() }
            if (javax.swing.SwingUtilities.isEventDispatchThread()) make.run() else javax.swing.SwingUtilities.invokeAndWait(make)
        } catch (_: Throwable) {
            val latch = CountDownLatch(1)
            try { Platform.startup { latch.countDown() } } catch (_: IllegalStateException) { latch.countDown() }
            latch.await()
        }
        Platform.setImplicitExit(false)
        started = true
    }
}
