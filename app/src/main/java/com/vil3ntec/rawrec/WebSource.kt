package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

/**
 * A web page as a picture for the stream (a «Browser source»): any address — a live subscriber
 * counter, an alert or goal widget from Streamlabs / StreamElements, a scoreboard — loaded in a
 * hidden browser of [vw]×[vh] pixels and photographed [fps] times a second. The layer's crop keeps
 * only the part the owner wants. Transparent pages stay transparent. Main thread.
 *
 * The hidden browser needs a window: while streaming it is a window placed outside the screen
 * (never seen, never touched, never captured); in the editor it sits off to the side of the page.
 */
class WebSource(private val ctx: Context, private val host: Host, private val onFrame: (Bitmap) -> Unit) {

    interface Host {
        fun attach(v: View, w: Int, h: Int)
        fun detach(v: View)
    }

    /** Off the screen, for the service: a window the user never sees. */
    class OffscreenWindow(private val ctx: Context) : Host {
        private val wm = ctx.getSystemService(WindowManager::class.java)
        override fun attach(v: View, w: Int, h: Int) {
            val lp = WindowManager.LayoutParams(w, h, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT).apply {
                gravity = Gravity.TOP or Gravity.LEFT
                x = -w - 4000; y = 0
            }
            OverlayWindows.add(wm, v, lp)
        }
        override fun detach(v: View) = OverlayWindows.remove(wm, v)
    }

    /** Inside a page of the app (the editor): far to the side of what is shown. */
    class InParent(private val parent: ViewGroup) : Host {
        override fun attach(v: View, w: Int, h: Int) {
            parent.addView(v, FrameLayout.LayoutParams(w, h))
            v.translationX = -(w + 20000f)
        }
        override fun detach(v: View) { parent.removeView(v) }
    }

    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    private var url = ""
    private var vw = 1280
    private var vh = 720
    private var fps = 4
    private var css = ""
    private var transparent = true
    private var zoom = 100
    private var built = false
    private var want: Scenes.Layer? = null
    private val rebuild = Runnable { want?.let { build(it) } }
    private val ring = arrayOfNulls<Bitmap>(3)
    private var next = 0
    @Volatile private var running = false

    private fun key(l: Scenes.Layer) = listOf(l.str("url").trim(), l.int("vw", 1280).coerceIn(200, 1920), l.int("vh", 720).coerceIn(150, 1920),
        l.str("css"), l.bool("transparent", true), l.int("zoom", 100).coerceIn(25, 400)).joinToString("\u0001")
    private var builtKey = ""

    /**
     * Loads [l]'s page, again only when what matters changed, and only once the owner stops typing
     * the address or moving a slider (not a new browser for every letter).
     */
    fun configure(l: Scenes.Layer) {
        fps = l.int("fps", 4).coerceIn(1, 15)
        val k = key(l)
        want = l.copy()
        main.removeCallbacks(rebuild)
        if (k == builtKey) return
        if (!built) build(want!!) else main.postDelayed(rebuild, 700)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun build(l: Scenes.Layer) {
        built = true
        builtKey = key(l)
        release()
        url = l.str("url").trim(); vw = l.int("vw", 1280).coerceIn(200, 1920); vh = l.int("vh", 720).coerceIn(150, 1920)
        css = l.str("css"); transparent = l.bool("transparent", true); zoom = l.int("zoom", 100).coerceIn(25, 400)
        if (!url.startsWith("http")) return
        val v = WebView(ctx).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = true   // nothing starts playing by itself
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            setInitialScale(zoom)
            if (transparent) setBackgroundColor(Color.TRANSPARENT)
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView, u: String?, favicon: Bitmap?) { view.evaluateJavascript(SILENT, null) }
                override fun onPageFinished(view: WebView, u: String?) {
                    view.evaluateJavascript(SILENT, null)
                    // the owner's own CSS, and a clear page background when asked (like OBS)
                    val rules = (if (transparent) "html,body{background:transparent!important;}" else "") + css
                    if (rules.isNotBlank()) view.evaluateJavascript(
                        "(function(){var s=document.createElement('style');s.textContent=" + org.json.JSONObject.quote(rules) +
                            ";document.head.appendChild(s);})()", null)
                }
            }
        }
        try { host.attach(v, vw, vh) } catch (_: Exception) { return }
        web = v
        v.loadUrl(url)
        running = true
        main.postDelayed(snap, 600)
    }

    private val snap = object : Runnable {
        override fun run() {
            val v = web ?: return
            if (!running) return
            try {
                if (v.width > 0 && v.height > 0) {
                    // three pictures in turn: the one being uploaded is never drawn over
                    val b = ring[next]?.takeIf { it.width == v.width && it.height == v.height }
                        ?: Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888).also { ring[next] = it }
                    next = (next + 1) % ring.size
                    b.eraseColor(Color.TRANSPARENT)
                    v.draw(Canvas(b))
                    onFrame(b)
                }
            } catch (_: Throwable) {}
            main.postDelayed(this, 1000L / fps)
        }
    }

    fun reload() { web?.reload() }

    companion object {
        /**
         * The page stays silent: a sound from it would come out of the speaker, into the microphone
         * and so into the stream (a live page of the stream itself would repeat every sound without end).
         */
        private const val SILENT = "(function(){if(window.__rrSilent)return;window.__rrSilent=1;" +
            "function m(){document.querySelectorAll('video,audio').forEach(function(e){e.muted=true;e.volume=0;});}" +
            "m();setInterval(m,1000);try{new MutationObserver(m).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}" +
            "try{var A=window.AudioContext||window.webkitAudioContext;if(A){var r=A.prototype.resume;A.prototype.resume=function(){var c=this;" +
            "try{c.suspend();}catch(e){}return Promise.resolve();};var o=A;var W=function(){var c=new o();try{c.suspend();}catch(e){}return c;};" +
            "W.prototype=o.prototype;window.AudioContext=W;window.webkitAudioContext=W;}}catch(e){}})()"
    }

    fun release() {
        running = false
        main.removeCallbacks(snap)
        main.removeCallbacks(rebuild)
        web?.let { v ->
            try { host.detach(v) } catch (_: Exception) {}
            try { v.stopLoading(); v.destroy() } catch (_: Exception) {}
        }
        web = null
    }
}
