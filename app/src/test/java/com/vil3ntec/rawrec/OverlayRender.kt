package com.vil3ntec.rawrec

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.Looper
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Draws what viewers see over the stream (alerts, counters, goal bar) and the chat panel on the
 * phone to PNG, with the real drawing code (only when -Drawrec.previewDir=… is given).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OverlayRender {
    private val dir: String? = System.getProperty("rawrec.previewDir")

    private fun game(w: Int, h: Int): Bitmap {
        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        c.drawPaint(Paint().apply { shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), Color.rgb(70, 96, 70), Color.rgb(150, 130, 90), Shader.TileMode.CLAMP) })
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(120, 30, 40, 30) }
        for (i in 0 until 9) c.drawRect(RectF(w * i / 9f, h * 0.55f, w * i / 9f + w / 14f, h * (0.35f + (i % 3) * 0.05f) + h * 0.3f), p)
        return b
    }

    private fun data() = LayerPainter.Data().apply {
        subs = 12_345; viewers = 1_234; likes = 890; members = 7; supers = 3
        startedAt = System.currentTimeMillis() - 3_725_000; lastSub = "Sara_99"; lastSuper = "Navid"
        chat = listOf(
            LayerPainter.ChatLine("1", "Ali", "سلام! بازی عالیه 🔥", Color.rgb(255, 138, 128)),
            LayerPainter.ChatLine("2", "Sara_99", "this clutch was insane", Color.rgb(61, 214, 140)),
            LayerPainter.ChatLine("3", "Navid", Num.ltr("$5.00") + " — ممنون بابتِ پخش", Color.rgb(128, 216, 255), Color.argb(90, 255, 176, 32)),
            LayerPainter.ChatLine("4", "ModReza", "!discord", Color.rgb(106, 166, 255)),
        )
    }

    private fun save(b: Bitmap, name: String) = File(dir, "$name.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }

    /** What viewers see: a scene as the stream draws it (1920×1080), with an alert. */
    private fun stream(tag: String, alert: LayerPainter.Alert?) {
        val app = RuntimeEnvironment.getApplication()
        val scene = Scenes.reload(app).current
        scene.layers.forEach { it.visible = true }
        save(SceneEditorActivity.preview(app, 1920, game(1920, 1080), scene, data(), alert), "stream-$tag")
    }

    /** The owner's own screen while live: the game, and the scene's «on my screen too» layers where the stream has them. */
    private fun ownerScreen(tag: String) {
        val app = RuntimeEnvironment.getApplication()
        val sc = Scenes.reload(app).current
        sc.layers.forEach { it.visible = true }
        val d = data()
        val items = sc.layers.filter { Scenes.mine(it) }.mapNotNull { l ->
            val alert = if (l.kind == Scenes.Kind.ALERTS) LayerPainter.Alert(LayerPainter.AlertKind.SUBSCRIBER, "Sara_99") else null
            LayerPainter.paint(app, l, d, alert, sample = false)?.let { b ->
                OwnerMirror.Item(l.kind, b, l.x, l.y, 0f, l.scale, l.rot, Scenes.cropFor(l, b.width.toFloat(), b.height.toFloat()), l.alpha, 0f, Scenes.hasNumbers(l))
            }
        }
        val m = OwnerMirror(app)
        m.set(items)
        val real = android.graphics.Point()
        @Suppress("DEPRECATION") app.getSystemService(android.view.WindowManager::class.java)!!.defaultDisplay.getRealSize(real)
        val v = m.viewForTests
        v.measure(android.view.View.MeasureSpec.makeMeasureSpec(real.x, android.view.View.MeasureSpec.EXACTLY), android.view.View.MeasureSpec.makeMeasureSpec(real.y, android.view.View.MeasureSpec.EXACTLY))
        v.layout(0, 0, real.x, real.y)
        val out = game(real.x, real.y)
        v.draw(Canvas(out))
        save(out, "owner-screen-$tag")
    }

    /** Every starting scene, and one with each kind of layer turned, cropped and coloured. */
    private fun scenes(tag: String) {
        val app = RuntimeEnvironment.getApplication()
        val proj = Scenes.reload(app)
        for ((i, sc) in proj.scenes.withIndex()) save(SceneEditorActivity.preview(app, 1920, game(1920, 1080), sc, data(), null), "scene$i-$tag")
        val img = Bitmap.createBitmap(900, 500, Bitmap.Config.ARGB_8888).also { b ->
            val c = Canvas(b); c.drawColor(Color.rgb(30, 120, 220))
            c.drawRect(0f, 0f, 450f, 250f, Paint().apply { color = Color.rgb(255, 176, 32) })
            c.drawCircle(675f, 375f, 100f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
        }
        val f = File(Scenes.mediaDir(app), "show.png"); f.outputStream().use { img.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val s = Scenes.Scene(Scenes.newId(), "show", game = true)
        s.layers += Scenes.newLayer(app, Scenes.Kind.SHAPE).apply { x = 0.5f; y = 0.93f; p.put("w", 1920).put("h", 150).put("radius", 0) }
        s.layers += Scenes.newLayer(app, Scenes.Kind.IMAGE).apply { x = 0.82f; y = 0.3f; scale = 0.5f; rot = -8f; crop = floatArrayOf(0f, 0f, 0.5f, 1f); p.put("file", f.path).put("radius", 40) }
        s.layers += Scenes.newLayer(app, Scenes.Kind.TEXT).apply { x = 0.5f; y = 0.08f; rot = 4f; p.put("text", "🔴 LIVE · {viewers} بیننده · {uptime}").put("bg", Color.argb(220, 255, 59, 71)).put("size", 48).put("font", 4) }
        s.layers += Scenes.newLayer(app, Scenes.Kind.TEXT).apply { x = 0.5f; y = 0.93f; p.put("text", "{subs} مشترک — آخرین: {last_sub}").put("color", Color.rgb(255, 230, 0)).put("size", 44) }
        s.layers += Scenes.newLayer(app, Scenes.Kind.GOAL).apply { x = 0.2f; y = 0.8f; p.put("c1", Color.rgb(61, 214, 140)).put("c2", Color.rgb(0, 200, 255)).put("title", "هدفِ امروز: {subs}") }
        s.layers += Scenes.newLayer(app, Scenes.Kind.CHAT).apply { x = 0.17f; y = 0.42f; p.put("style", 2) }
        s.layers += Scenes.newLayer(app, Scenes.Kind.ALERTS).apply { p.put("color", Color.rgb(186, 120, 255)).put("t_super", "وای {name}! {amount} ❤").put("image", f.path) }
        s.layers += Scenes.newLayer(app, Scenes.Kind.CAMERA).apply { p.put("mask", 2) }
        save(SceneEditorActivity.preview(app, 1920, game(1920, 1080), s, data(),
            LayerPainter.Alert(LayerPainter.AlertKind.SUPER, "Navid Gamer", "$5.00", "ممنون بابتِ پخش!")), "scene-show-$tag")
    }

    private fun hud(tag: String) {
        val app = RuntimeEnvironment.getApplication()
        val hud = ChatHud(app, object : ChatHud.Actions {
            override fun send(text: String) {}
            override fun delete(m: LiveChat.Msg) {}
            override fun timeout(m: LiveChat.Msg, seconds: Int) {}
            override fun giveawayStart() {}
            override fun giveawayDraw() {}
            override fun giveawayStop() {}
            override fun goalStep(d: Int) {}
            override fun onScene(id: String) {}
            override fun onLayer(id: String, on: Boolean) {}
        })
        hud.show()
        hud.setPrivate(true)
        hud.setScenes(listOf("g" to "بازی", "s" to "به‌زودی", "b" to "برمی‌گردم", "e" to "پایان"), "g",
            listOf(Triple("c", "چت", true), Triple("a", "تشکر", true), Triple("n", "شمارِ مشترک", true), Triple("w", "صفحهٔ وب", false), Triple("q", "هدف", true)))
        hud.setChatOnStream(true)
        hud.setCanSend(true)
        hud.setStats(1234, 380, 12_345)
        hud.setGiveaway(true, 17)
        fun m(a: String, t: String, k: LiveChat.Kind = LiveChat.Kind.CHAT, amount: String? = null, owner: Boolean = false, mod: Boolean = false, member: Boolean = false,
              p: LiveChat.Platform = LiveChat.Platform.YOUTUBE) =
            LiveChat.Msg("id$a$t", p, "c$a", a, t, k, amount, owner, mod, member, false)
        hud.add(m("Ali", "سلام! بازی عالیه 🔥"))
        hud.add(m("Sara_99", "this clutch was insane", member = true))
        hud.add(m("ModReza", "!discord", mod = true))
        hud.add(m("Navid", "ممنون بابتِ پخش، ادامه بده", k = LiveChat.Kind.SUPER, amount = "$5.00"))
        hud.add(m("NightWolf", "", k = LiveChat.Kind.MEMBER, amount = "Gold"))
        hud.add(m("TwitchFan", "gg", p = LiveChat.Platform.TWITCH))
        hud.add(m("Me", "مرسی بچه‌ها ❤", owner = true))
        hud.setTranslation("idSara_99this clutch was insane", "این حرکت فوق‌العاده بود")
        hud.note(app.getString(R.string.hud_n_winner_fmt, "Sara_99", "17"))
        shadowOf(Looper.getMainLooper()).idle()
        val pad = (16 * app.resources.displayMetrics.density).toInt()
        fun draw(name: String, views: List<android.view.View>) {
            val w = views.maxOf { it.width } + pad * 2
            val h = views.sumOf { it.height } + pad * (views.size + 1)
            val b = game(w, h)
            val c = Canvas(b)
            var y = pad.toFloat()
            for (v in views) { c.save(); c.translate(pad.toFloat(), y); v.draw(c); c.restore(); y += v.height + pad }
            File(dir, "$name-$tag.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        // closed: the button and the read-only feed over the game
        draw("hud-feed", listOf(hud.bubble, hud.feedRoot))
        // open: the panel, with «در پخش» shown
        hud.openForPreview()
        (ChatHud::class.java.getDeclaredField("streamRow").apply { isAccessible = true }.get(hud) as android.view.View).visibility = android.view.View.VISIBLE
        shadowOf(Looper.getMainLooper()).idle()
        hud.panel.findViewWithTag<android.view.View>("x")   // (no-op: keeps the view tree laid out)
        draw("hud-panel", listOf(hud.panel))
        hud.hide()
    }

    /** Every look of the chat over the game, and of the chat on the stream. */
    private fun styles(tag: String) {
        val app = RuntimeEnvironment.getApplication()
        val prefs = app.getSharedPreferences(RecordService.PREFS, android.content.Context.MODE_PRIVATE)
        val pad = (16 * app.resources.displayMetrics.density).toInt()
        for (st in 0..3) {
            prefs.edit().putInt("hud_style", st).commit()
            val hud = ChatHud(app, object : ChatHud.Actions {
                override fun send(text: String) {}; override fun delete(m: LiveChat.Msg) {}; override fun timeout(m: LiveChat.Msg, seconds: Int) {}
                override fun giveawayStart() {}; override fun giveawayDraw() {}; override fun giveawayStop() {}
                override fun goalStep(d: Int) {}; override fun onScene(id: String) {}; override fun onLayer(id: String, on: Boolean) {}
            })
            hud.show(); hud.setPrivate(true); hud.setStats(1234, 380, 12_345)
            fun m(a: String, t: String, k: LiveChat.Kind = LiveChat.Kind.CHAT, amount: String? = null, member: Boolean = false) =
                LiveChat.Msg("s$st$a", LiveChat.Platform.YOUTUBE, "c$a", a, t, k, amount, false, false, member, false)
            hud.add(m("Ali", "سلام! بازی عالیه 🔥"))
            hud.add(m("Sara_99", "this clutch was insane", member = true))
            hud.add(m("Navid", "ممنون بابتِ پخش", LiveChat.Kind.SUPER, "$5.00"))
            hud.add(m("Reza", "کدوم اسلحه بهتره؟"))
            shadowOf(Looper.getMainLooper()).idle()
            val v = hud.feedRoot
            val b = game(v.width + pad * 2, v.height + pad * 2)
            val c = Canvas(b); c.translate(pad.toFloat(), pad.toFloat()); v.draw(c)
            File(dir, "hud-style$st-$tag.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
            hud.hide()
        }
        prefs.edit().remove("hud_style").commit()
        for (st in 0..2) {
            val l = Scenes.newLayer(app, Scenes.Kind.CHAT).apply { p.put("style", st) }
            val pic = LayerPainter.chat(app, l, data().chat)!!
            val b = game(pic.width + 80, pic.height + 80)
            Canvas(b).drawBitmap(pic, 40f, 40f, null)
            save(b, "stream-chat-style$st-$tag")
        }
    }

    /** The «صحنه‌ها و لایه‌ها» editor (layers, a layer's settings, the add list), and the whole «زنده» page. */
    private fun screens(tag: String) {
        val ed = org.robolectric.Robolectric.buildActivity(SceneEditorActivity::class.java).setup().get()
        shadowOf(Looper.getMainLooper()).idle()
        fun shot(name: String, root: android.view.View) {
            val b = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
            root.draw(Canvas(b)); save(b, "$name-$tag")
        }
        shot("scene-editor", ed.window.decorView)
        ed.select(ed.scene().layers.first { it.kind == Scenes.Kind.CHAT }.id)
        shadowOf(Looper.getMainLooper()).idle()
        shot("scene-editor-chat", ed.window.decorView)
        ed.select(ed.scene().layers.first { it.kind == Scenes.Kind.TEXT }.id)
        shadowOf(Looper.getMainLooper()).idle()
        shot("scene-editor-text", ed.window.decorView)
        allViews(ed.window.decorView).first { it.tag == "sc:tab:layers" }.performClick()
        shadowOf(Looper.getMainLooper()).idle()
        allViews(ed.window.decorView).first { it.tag == "sc:add" }.performClick()
        shadowOf(Looper.getMainLooper()).idle()
        shot("scene-add", org.robolectric.shadows.ShadowDialog.getLatestDialog().window!!.decorView)
        org.robolectric.shadows.ShadowDialog.getLatestDialog().dismiss()
        ColorPicker.show(ed, "رنگ", Color.rgb(255, 59, 71)) {}
        shadowOf(Looper.getMainLooper()).idle()
        shot("color-picker", org.robolectric.shadows.ShadowDialog.getLatestDialog().window!!.decorView)

        val a = org.robolectric.Robolectric.buildActivity(MainActivity::class.java).setup().get()
        shadowOf(Looper.getMainLooper()).idle()
        allViews(a.window.decorView).first { it.tag == "nav:LIVE" }.performClick()
        shadowOf(Looper.getMainLooper()).idle()
        val scroll = allViews(a.window.decorView).filterIsInstance<android.widget.ScrollView>().first { it.isShown && it.getChildAt(0)?.height ?: 0 > 0 }
        val content = scroll.getChildAt(0)
        val lb = Bitmap.createBitmap(content.width, content.height, Bitmap.Config.ARGB_8888)
        Canvas(lb).apply { drawColor(Color.rgb(14, 15, 18)); content.draw(this) }
        File(dir, "live-page-$tag.png").outputStream().use { lb.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun allViews(v: android.view.View, out: MutableList<android.view.View> = ArrayList()): MutableList<android.view.View> {
        out += v
        if (v is android.view.ViewGroup) for (i in 0 until v.childCount) allViews(v.getChildAt(i), out)
        return out
    }

    private fun all(qualifiers: String, tag: String) {
        RuntimeEnvironment.setQualifiers(qualifiers)
        val app = RuntimeEnvironment.getApplication()
        stream("$tag-super", LayerPainter.Alert(LayerPainter.AlertKind.SUPER, "Navid Gamer", "$5.00", "ممنون بابتِ پخش، این ماپ رو خیلی خوب بازی کردی! ادامه بده"))
        stream("$tag-sub", LayerPainter.Alert(LayerPainter.AlertKind.SUBSCRIBER, "Sara_99"))
        stream("$tag-member", LayerPainter.Alert(LayerPainter.AlertKind.MEMBER, "NightWolf", "Gold"))
        stream("$tag-giveaway", LayerPainter.Alert(LayerPainter.AlertKind.GIVEAWAY, "علی رضایی", "17"))
        scenes(tag)
        ownerScreen(tag)
        hud(tag)
        styles(tag)
        screens(tag)
        app.toString()
    }

    @Test fun fa() { assumeTrue(dir != null); all("fa-w891dp-h411dp-land-xxhdpi", "fa") }
    @Test fun en() { assumeTrue(dir != null); all("en-w891dp-h411dp-land-xxhdpi", "en") }
}

/** The last overlay window added (the chat panel's root), for drawing it. */
object OverlayWindowsAccess {
    fun last(): android.view.View? {
        val f = OverlayWindows::class.java.getDeclaredField("views").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST") val s = f.get(OverlayWindows) as LinkedHashSet<android.view.View>
        return s.lastOrNull()
    }
}
