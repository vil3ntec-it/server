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

    private fun stream(tag: String, alert: StreamOverlay.Alert?) {
        val w = 1920; val h = 1080
        var layers: List<LookFilter.Layer> = emptyList()
        val app = RuntimeEnvironment.getApplication()
        val o = StreamOverlay(app) { layers = it }
        o.showSubs = true; o.showViewers = true; o.showGoal = true; o.showChat = true
        o.setSize(w, h)
        o.setChat(listOf(
            StreamOverlay.ChatLine("1", "Ali", "سلام! بازی عالیه 🔥", Color.rgb(255, 138, 128)),
            StreamOverlay.ChatLine("2", "Sara_99", "this clutch was insane", Color.rgb(61, 214, 140)),
            StreamOverlay.ChatLine("3", "Navid", StreamOverlay.ltr("$5.00") + " — ممنون بابتِ پخش", Color.rgb(128, 216, 255), Color.argb(90, 255, 176, 32)),
            StreamOverlay.ChatLine("4", "ModReza", "!discord", Color.rgb(106, 166, 255)),
        ))
        o.setStats(1234, 12_345)
        o.setGoal(app.getString(R.string.ov_goal_subs_fmt, "13000"), 12_345, 13_000)
        if (alert != null) o.alert(alert)
        shadowOf(Looper.getMainLooper()).idle()
        val out = game(w, h)
        val c = Canvas(out)
        for (l in layers) c.drawBitmap(l.bitmap, null, RectF(l.x * w, l.y * h, (l.x + l.w) * w, (l.y + l.h) * h), Paint(Paint.FILTER_BITMAP_FLAG))
        File(dir, "stream-$tag.png").outputStream().use { out.compress(Bitmap.CompressFormat.PNG, 100, it) }
        o.release()
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
            override fun onStream(what: String, on: Boolean) {}
        })
        hud.show()
        hud.setPrivate(true)
        hud.setStreamState(mapOf(ChatHud.ON_CHAT to true, ChatHud.ON_ALERTS to true, ChatHud.ON_SUBS to true, ChatHud.ON_VIEWERS to false, ChatHud.ON_GOAL to true))
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
        draw("hud-feed", listOf(hud.bubble, hud.feed))
        // open: the panel, with «در پخش» shown
        hud.openForPreview()
        (ChatHud::class.java.getDeclaredField("streamRow").apply { isAccessible = true }.get(hud) as android.view.View).visibility = android.view.View.VISIBLE
        shadowOf(Looper.getMainLooper()).idle()
        hud.panel.findViewWithTag<android.view.View>("x")   // (no-op: keeps the view tree laid out)
        draw("hud-panel", listOf(hud.panel))
        hud.hide()
    }

    private fun all(qualifiers: String, tag: String) {
        RuntimeEnvironment.setQualifiers(qualifiers)
        val app = RuntimeEnvironment.getApplication()
        stream("$tag-super", StreamOverlay.Alert(StreamOverlay.Kind.SUPER, "Navid Gamer", "$5.00", "ممنون بابتِ پخش، این ماپ رو خیلی خوب بازی کردی! ادامه بده"))
        stream("$tag-sub", StreamOverlay.Alert(StreamOverlay.Kind.SUBSCRIBER, "Sara_99"))
        stream("$tag-member", StreamOverlay.Alert(StreamOverlay.Kind.MEMBER, "NightWolf", "Gold"))
        stream("$tag-giveaway", StreamOverlay.Alert(StreamOverlay.Kind.GIVEAWAY, "علی رضایی", "17"))
        hud(tag)
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
