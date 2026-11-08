package com.vil3ntec.rawrec

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.graphics.Rect
import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaFormat
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.RadioButton
import android.widget.Switch
import android.widget.TextView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.MediaCodecInfoBuilder
import org.robolectric.shadows.ShadowDialog
import org.robolectric.shadows.ShadowDisplayManager
import org.robolectric.shadows.ShadowMediaCodecList
import org.robolectric.shadows.ShadowMediaPlayer
import org.robolectric.shadows.ShadowStatFs
import org.robolectric.shadows.ShadowToast
import org.robolectric.shadows.util.DataSource
import java.io.File

/**
 * «صدای یارها» and the «زنده» page, tapped like a finger does it: every switch must do what it says
 * at once — before anything was detected, after it was, and with the owner's own pick — and
 * every setting on the live page must be saved.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34, 35])
class VoiceLiveUiTest {

    private val app: Context get() = RuntimeEnvironment.getApplication()
    private fun prefs() = app.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)
    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    @Before
    fun device() {
        RuntimeEnvironment.setQualifiers("w411dp-h914dp-560dpi")
        ShadowDisplayManager.setSupportedModes(Display.DEFAULT_DISPLAY, displayMode(0, 1504, 2400, 165f), displayMode(2, 1504, 2400, 60f))
        ShadowMediaCodecList.reset()
        Encoders.clearCache()
        for (dir in listOf(app.getExternalFilesDir(null), app.filesDir)) if (dir != null) ShadowStatFs.registerStats(dir, 16_000_000, 16_000_000, 16_000_000)
        for ((name, mime, pl) in listOf(
            Triple("c2.qti.hevc.encoder", MediaFormat.MIMETYPE_VIDEO_HEVC, CodecProfileLevel.HEVCProfileMain to CodecProfileLevel.HEVCMainTierLevel62),
            Triple("c2.qti.avc.encoder", MediaFormat.MIMETYPE_VIDEO_AVC, CodecProfileLevel.AVCProfileHigh to CodecProfileLevel.AVCLevel62),
        )) {
            val caps = MediaCodecInfoBuilder.CodecCapabilitiesBuilder.newBuilder()
                .setMediaFormat(MediaFormat.createVideoFormat(mime, 8192, 4320)).setIsEncoder(true)
                .setProfileLevels(arrayOf(CodecProfileLevel().apply { profile = pl.first; level = pl.second }))
                .setColorFormats(intArrayOf(MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)).build()
            ShadowMediaCodecList.addCodec(MediaCodecInfoBuilder.newBuilder().setName(name).setIsEncoder(true)
                .setIsHardwareAccelerated(true).setIsVendor(true).setCapabilities(caps).build())
        }
    }

    // ------------------------------------------------------------ finger helpers (as in InteractionTest)

    private fun launch(): Activity {
        val a = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        idle()
        assertNull("crash screen", CrashLog.pending(app))
        return a
    }

    private fun all(v: View, out: MutableList<View> = ArrayList()): MutableList<View> {
        out += v
        if (v is ViewGroup) for (i in 0 until v.childCount) all(v.getChildAt(i), out)
        return out
    }

    private fun shown(v: View): Boolean {
        var p: View? = v
        while (p != null) { if (p.visibility != View.VISIBLE) return false; p = p.parent as? View }
        return v.isAttachedToWindow
    }

    private fun hit(v: View, x: Float, y: Float): View? {
        if (v.visibility != View.VISIBLE) return null
        val l = IntArray(2); v.getLocationInWindow(l)
        if (x < l[0] || y < l[1] || x >= l[0] + v.width || y >= l[1] + v.height) return null
        if (v is ViewGroup) for (i in v.childCount - 1 downTo 0) hit(v.getChildAt(i), x, y)?.let { return it }
        return if (v.isClickable) v else null
    }

    private fun touch(a: Activity, v: View) {
        v.requestRectangleOnScreen(Rect(0, 0, v.width, v.height), true)
        idle()
        val l = IntArray(2); v.getLocationInWindow(l)
        val x = l[0] + v.width / 2f
        val y = l[1] + v.height / 2f
        val root = a.window.decorView
        assertSame("hit-test at the centre of «${v.tag ?: (v as? TextView)?.text}»", v, hit(root, x, y))
        val t = SystemClock.uptimeMillis()
        root.dispatchTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x, y, 0))
        root.dispatchTouchEvent(MotionEvent.obtain(t, t + 40, MotionEvent.ACTION_UP, x, y, 0))
        idle()
    }

    private fun byTag(a: Activity, tag: String): View = all(a.window.decorView).first { it.tag == tag && shown(it) }
    private fun has(a: Activity, tag: String) = all(a.window.decorView).any { it.tag == tag && shown(it) }
    private fun sw(a: Activity, tag: String) = (byTag(a, "$tag:switch") as Switch).isChecked
    private fun tab(a: Activity, t: MainActivity.Tab) = touch(a, byTag(a, "nav:${t.name}"))
    private fun openAudio(a: Activity) { tab(a, MainActivity.Tab.SETTINGS); touch(a, byTag(a, "sub:${MainActivity.Sub.AUDIO.name}")) }
    private fun kinds() = prefs().getInt("c_kinds", VoiceSources.ALL)
    private fun chip(a: Activity, text: String): RadioButton =
        all(a.window.decorView).filterIsInstance<RadioButton>().firstOrNull { shown(it) && it.text.toString() == text }
            ?: throw AssertionError("no chip «$text» among " + all(a.window.decorView).filterIsInstance<RadioButton>().filter { shown(it) }.map { it.text })
    private fun cfg() = RecordConfig.fromPrefs(prefs())

    // ------------------------------------------------------------ «صدای یارها»

    @Test fun everyVoiceSwitchWorksBeforeAnythingIsKnown() {
        val a = launch()
        openAudio(a)
        for (t in listOf("tog:team", "tog:kind1", "tog:kind2", "tog:kind4")) {
            val row = byTag(a, t)
            assertTrue("«$t» can be tapped", row.isEnabled && row.isClickable)
            val before = sw(a, t)
            touch(a, row)
            assertEquals("«$t» flips", !before, sw(a, t))
            touch(a, row)
            assertEquals("«$t» flips back", before, sw(a, t))
        }
        // and the switches really change what is recorded
        touch(a, byTag(a, "tog:kind2"))
        assertEquals("media left out", VoiceSources.ALL and VoiceSources.MEDIA.inv(), kinds())
        assertEquals(VoiceSources.ALL and VoiceSources.MEDIA.inv(), VoiceSources.effectiveMask(app, cfg()))
        assertFalse(sw(a, "tog:kind2"))
        touch(a, byTag(a, "tog:kind2"))
        assertEquals("media back", VoiceSources.ALL, kinds())
        touch(a, byTag(a, "tog:team"))
        assertFalse("team off saved", prefs().getBoolean("c_team", true))
        assertNull("no error while tapping", CrashLog.pending(app))
    }

    @Test fun theLastPartCannotBeSwitchedOffSilently() {
        val a = launch()
        openAudio(a)
        touch(a, byTag(a, "tog:kind2")); touch(a, byTag(a, "tog:kind4"))
        assertEquals(VoiceSources.GAME, VoiceSources.effectiveMask(app, cfg()))
        touch(a, byTag(a, "tog:kind1"))
        assertEquals("explained, not silently «record everything»", a.getString(R.string.vs_need_one), ShadowToast.getTextOfLatestToast())
        assertTrue(sw(a, "tog:kind1"))
        assertEquals(VoiceSources.GAME, VoiceSources.effectiveMask(app, cfg()))
    }

    @Test fun knownGameSoundAsksFirstAndTeammatesFollowTheSwitch() {
        prefs().edit().putInt("vs_game", VoiceSources.GAME).putInt("vs_voice", VoiceSources.MEDIA)
            .putInt("vs_act_1", 98).putInt("vs_act_2", 14).commit()
        val a = launch()
        openAudio(a)
        // the game's own part: a question first, nothing changes until «yes»
        touch(a, byTag(a, "tog:kind1"))
        val d = ShadowDialog.getLatestDialog() as AlertDialog
        assertTrue(d.isShowing)
        assertTrue("still recorded while asking", sw(a, "tog:kind1"))
        assertEquals(VoiceSources.ALL, kinds())
        d.getButton(AlertDialog.BUTTON_POSITIVE).performClick(); idle()
        assertFalse("game sound off after «yes»", sw(a, "tog:kind1"))
        assertEquals(0, VoiceSources.effectiveMask(app, cfg()) and VoiceSources.GAME)
        touch(a, byTag(a, "tog:kind1"))
        assertTrue("and on again", sw(a, "tog:kind1"))
        assertEquals(VoiceSources.GAME, VoiceSources.effectiveMask(app, cfg()) and VoiceSources.GAME)
        // «حرفِ یارها ضبط شود» off: exactly the teammates' part goes, the game stays
        assertTrue(sw(a, "tog:team"))
        touch(a, byTag(a, "tog:team"))
        assertFalse(sw(a, "tog:team"))
        assertFalse("teammates' part shown as not recorded", sw(a, "tog:kind2"))
        assertEquals(VoiceSources.GAME or VoiceSources.OTHER, VoiceSources.effectiveMask(app, cfg()))
        // switching the teammates' part on again means recording them
        touch(a, byTag(a, "tog:kind2"))
        assertTrue(sw(a, "tog:kind2"))
        assertTrue("team on again", sw(a, "tog:team"))
        assertEquals(VoiceSources.ALL, VoiceSources.effectiveMask(app, cfg()))
    }

    @Test fun listenToEachPartAndPickByEar() {
        val dir = File(app.filesDir, "voice").apply { mkdirs() }
        val f = File(dir, "k${VoiceSources.MEDIA}.wav")
        f.writeBytes(VoiceAnalyzer.wav(ShortArray(16_000) { (it % 200 - 100).toShort() }))
        ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(f.path), ShadowMediaPlayer.MediaInfo(1000, 0))
        val a = launch()
        openAudio(a)
        val play = byTag(a, "listen:${VoiceSources.MEDIA}")
        touch(a, play)
        val pf = MainActivity::class.java.getDeclaredField("player").apply { isAccessible = true }
        val p = pf.get(a) as android.media.MediaPlayer?
        val note = MainActivity::class.java.getDeclaredField("listenNote").apply { isAccessible = true }.get(a) as TextView?
        assertNotNull("playing the media part (note: «${note?.text}»)", p)
        assertTrue(p!!.isPlaying)
        touch(a, byTag(a, "listen:${VoiceSources.MEDIA}"))
        assertNull("the same button stops it", pf.get(a))
        touch(a, byTag(a, "listen:${VoiceSources.OTHER}"))
        assertTrue("a part without sound says so",
            all(a.window.decorView).any { shown(it) && it is TextView && it.text.toString() == a.getString(R.string.vs_listen_empty_fmt, a.getString(R.string.vs_other)) })
        // pick: the teammates are in «رسانه»
        touch(a, chip(a, a.getString(R.string.vs_media)))
        assertEquals(VoiceSources.MEDIA, prefs().getInt("vs_pick", 0))
        assertTrue(all(a.window.decorView).any { shown(it) && it is TextView && it.text.toString() == a.getString(R.string.vs_found_user_fmt, a.getString(R.string.vs_media)) })
        touch(a, byTag(a, "tog:team"))
        assertEquals("picked part left out, game stays", VoiceSources.ALL and VoiceSources.MEDIA.inv(), VoiceSources.effectiveMask(app, cfg()))
        // pick «خودکار» again
        touch(a, chip(a, a.getString(R.string.vs_pick_auto)))
        assertEquals(0, prefs().getInt("vs_pick", -1))
        assertNull(CrashLog.pending(app))
    }

    @Test fun speakerRemovalShowsWithMicAndSaves() {
        prefs().edit().putInt("c_audio", RecordConfig.AUDIO_BOTH).commit()
        val a = launch()
        openAudio(a)
        assertTrue(has(a, "tog:aec"))
        assertTrue("on by default", sw(a, "tog:aec"))
        touch(a, byTag(a, "tog:aec"))
        assertFalse(VoiceSources.aec(app))
        assertFalse(sw(a, "tog:aec"))
    }

    // ------------------------------------------------------------ «زنده»

    @Test fun everyLiveSwitchFlipsAndIsSaved() {
        val a = launch()
        tab(a, MainActivity.Tab.LIVE)
        val keys = mapOf(
            "tog:live_team" to "live_team", "tog:live_mic" to "live_mic", "tog:hud_on" to "hud_on",
            "tog:ov_alerts" to "ov_alerts", "tog:ov_subs" to "ov_subs", "tog:ov_viewers" to "ov_viewers", "tog:ov_goal" to "ov_goal",
            "tog:bot_on" to "bot_on", "tog:bot_welcome" to "bot_welcome",
            "tog:mod_links" to "mod_links", "tog:mod_caps" to "mod_caps", "tog:mod_spam" to "mod_spam",
        )
        for ((tag, key) in keys) {
            assertTrue("«$tag» on the live page", has(a, tag))
            val before = sw(a, tag)
            touch(a, byTag(a, tag))
            assertEquals("«$tag» flips", !before, sw(a, tag))
            assertEquals("«$key» saved", !before, prefs().getBoolean(key, before))
            touch(a, byTag(a, tag))
            assertEquals("«$tag» flips back", before, sw(a, tag))
            assertEquals(before, prefs().getBoolean(key, !before))
        }
        assertNull(CrashLog.pending(app))
    }

    @Test fun everyLiveChoiceIsSelectedAndSaved() {
        val a = launch()
        tab(a, MainActivity.Tab.LIVE)
        val chips = all(a.window.decorView).filterIsInstance<RadioButton>().filter { shown(it) }
        assertTrue("chips on the live page: ${chips.size}", chips.size >= 30)
        for (c in chips) {
            if (!shown(c)) continue
            touch(a, c)
            assertTrue("chip «${c.text}» selected after a tap", c.isChecked)
        }
        // a few concrete values
        touch(a, chip(a, a.getString(R.string.pos_br)))
        touch(a, chip(a, a.getString(R.string.live_goal_t_manual)))
        assertEquals(LiveExtras.GOAL_MANUAL, LiveExtras.goalType(app))
        touch(a, chip(a, a.getString(R.string.live_hud_l)))
        assertEquals(2, LiveExtras.hudSize(app))
        assertNull(CrashLog.pending(app))
    }

    @Test fun liveTextFieldsAreSavedAndSecretsSealed() {
        val a = launch()
        tab(a, MainActivity.Tab.LIVE)
        fun field(hint: String) = all(a.window.decorView).filterIsInstance<android.widget.EditText>().first { shown(it) && it.hint?.toString() == hint }
        fun type(e: android.widget.EditText, s: String) { e.requestFocus(); e.setText(s); a.window.decorView.findFocus(); e.clearFocus(); idle() }
        type(field(a.getString(R.string.live_tw_hint)), "https://www.twitch.tv/SomeOne")
        assertEquals("someone", LiveExtras.twChannel(app))
        type(field(a.getString(R.string.live_bot_cmds_hint)), "!discord = d.gg/x\n!phone: RawRec")
        assertEquals(setOf("!discord", "!phone"), LiveExtras.botConfig(app).commands.keys)
        type(field(a.getString(R.string.live_bot_timers_hint)), "۱۰ = hello")
        assertEquals(listOf(10 to "hello"), LiveExtras.botConfig(app).timers)
        type(field("1000"), "250")
        assertEquals(250, LiveExtras.goalTarget(app))
        type(field("…apps.googleusercontent.com"), "123-abc.apps.googleusercontent.com")
        assertEquals("123-abc.apps.googleusercontent.com", LiveExtras.ytClientId(app))
        // the YouTube button without a secret explains instead of doing nothing
        touch(a, all(a.window.decorView).first { shown(it) && it is android.widget.Button && it.text == a.getString(R.string.live_yt_signin) })
        assertEquals(a.getString(R.string.live_yt_need_client), ShadowToast.getTextOfLatestToast())
        assertNull(CrashLog.pending(app))
    }
}
