package com.vil3ntec.rawrec

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipboardManager
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.database.Cursor
import android.database.MatrixCursor
import android.graphics.Rect
import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaFormat
import android.net.Uri
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.provider.Settings
import android.view.Display
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.RadioButton
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
import org.robolectric.shadows.ShadowSettings
import org.robolectric.shadows.ShadowStatFs
import org.robolectric.shadows.ShadowToast
import java.util.Locale

/** A stand-in for MediaStore: two recordings in Movies/RawRec. */
class FakeMediaProvider : ContentProvider() {
    companion object {
        val rows = mutableListOf(
            arrayOf<Any?>(11L, "RawRec 2026-10-31 17-02.mp4", 1_793_000_000L, 45_000L, 156_000_000L, 1504, 2400),
            arrayOf<Any?>(12L, "RawRec 2026-10-31 17-10 (۲).mp4", 1_793_000_600L, 12_000L, 40_000_000L, 2400, 1504),
        )
        var deleted = 0
    }
    override fun onCreate() = true
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
        val cols = arrayOf(MediaStore.Video.Media._ID, MediaStore.Video.Media.DISPLAY_NAME, MediaStore.Video.Media.DATE_ADDED,
            MediaStore.Video.Media.DURATION, MediaStore.Video.Media.SIZE, MediaStore.Video.Media.WIDTH, MediaStore.Video.Media.HEIGHT)
        return MatrixCursor(cols).apply { rows.forEach { addRow(it) } }
    }
    override fun getType(uri: Uri): String = "video/mp4"
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, args: Array<out String>?): Int {
        val id = uri.lastPathSegment?.toLongOrNull() ?: return 0
        val before = rows.size
        rows.removeAll { it[0] == id }
        deleted += before - rows.size
        return before - rows.size
    }
    override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
}

/**
 * Every control on every tab and settings page is tapped like a finger does it: scrolled into view,
 * then ACTION_DOWN/UP dispatched through the window at its centre, after a hit-test proves nothing
 * covers it. Runs on a phone (bottom bar) and on a tablet (navigation rail), Android 10/13/14/15.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 33, 34, 35])
class InteractionTest {

    private val app: Context get() = RuntimeEnvironment.getApplication()
    private fun prefs() = app.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)
    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    private val phone = "w411dp-h914dp-560dpi"
    private val tablet = "sw800dp-w1280dp-h800dp-xhdpi"

    @Before
    fun device() {
        RuntimeEnvironment.setQualifiers(phone)
        ShadowDisplayManager.setSupportedModes(Display.DEFAULT_DISPLAY, Display.Mode(0, 1504, 2400, 165f), Display.Mode(2, 1504, 2400, 60f))
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

    private fun label(v: View) = (v as? TextView)?.text?.toString()?.lineSequence()?.firstOrNull() ?: (v.tag?.toString() ?: v.toString())

    private fun hit(v: View, x: Float, y: Float): View? {
        if (v.visibility != View.VISIBLE) return null
        val l = IntArray(2); v.getLocationInWindow(l)
        if (x < l[0] || y < l[1] || x >= l[0] + v.width || y >= l[1] + v.height) return null
        if (v is ViewGroup) for (i in v.childCount - 1 downTo 0) hit(v.getChildAt(i), x, y)?.let { return it }
        return if (v.isClickable) v else null
    }

    private fun touch(a: Activity, v: View, longPress: Boolean = false) {
        v.requestRectangleOnScreen(Rect(0, 0, v.width, v.height), true)
        idle()
        val l = IntArray(2); v.getLocationInWindow(l)
        val x = l[0] + v.width / 2f
        val y = l[1] + v.height / 2f
        val root = a.window.decorView
        assertSame("hit-test at the centre of «${label(v)}»", v, hit(root, x, y))
        val t = SystemClock.uptimeMillis()
        root.dispatchTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x, y, 0))
        if (longPress) { shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(800)) }
        root.dispatchTouchEvent(MotionEvent.obtain(t, t + if (longPress) 900 else 40, MotionEvent.ACTION_UP, x, y, 0))
        idle()
    }

    private fun byTag(a: Activity, tag: String): View = all(a.window.decorView).first { it.tag == tag && shown(it) }
    private fun has(a: Activity, tag: String) = all(a.window.decorView).any { it.tag == tag && shown(it) }

    private fun home(a: Activity) {
        var guard = 0
        while (!has(a, "hero") && guard++ < 5) { @Suppress("DEPRECATION") a.onBackPressed(); idle() }
    }

    /** Every destination is one tap on the bottom bar (phone) or the rail (tablet). */
    private fun tab(a: Activity, t: MainActivity.Tab) {
        touch(a, byTag(a, "nav:${t.name}"))
        assertTrue("${t.name} is the selected destination", byTag(a, "nav:${t.name}").isSelected)
    }
    private fun openSub(a: Activity, s: MainActivity.Sub) { tab(a, MainActivity.Tab.SETTINGS); touch(a, byTag(a, "sub:${s.name}")) }
    private fun expand(a: Activity, key: String) {
        val h = byTag(a, "section:$key")
        if (!shown(byTagAny(a, "section:$key:body"))) touch(a, h)
        assertTrue("section $key opens", shown(byTagAny(a, "section:$key:body")))
    }
    private fun byTagAny(a: Activity, tag: String): View = all(a.window.decorView).first { it.tag == tag }
    private fun visibleText(a: Activity, s: String) = all(a.window.decorView).any { shown(it) && it is TextView && it.text.toString().contains(s) }

    // ------------------------------------------------------------ navigation

    private fun navigationWorks(size: String) {
        RuntimeEnvironment.setQualifiers(size)
        val a = launch()
        assertTrue("home shows the record button", visibleText(a, a.getString(R.string.home_start)))
        assertTrue(byTag(a, "nav:HOME").isSelected)
        // bar / rail → each destination → system back → home
        for (t in listOf(MainActivity.Tab.VIDEOS, MainActivity.Tab.QUALITY, MainActivity.Tab.SETTINGS, MainActivity.Tab.ABOUT)) {
            tab(a, t)
            assertFalse("${t.name} replaced the home", has(a, "hero"))
            assertFalse("only one destination is selected", byTag(a, "nav:HOME").isSelected)
            @Suppress("DEPRECATION") a.onBackPressed(); idle()
            assertTrue("back to home from ${t.name}", has(a, "hero"))
            assertTrue(byTag(a, "nav:HOME").isSelected)
        }
        // destination to destination, then home from the bar itself
        tab(a, MainActivity.Tab.ABOUT); tab(a, MainActivity.Tab.QUALITY); tab(a, MainActivity.Tab.HOME)
        assertTrue(has(a, "hero"))
        // settings sub-pages: header back and system back
        for (s in MainActivity.Sub.values().filter { it != MainActivity.Sub.NONE }) {
            openSub(a, s)
            touch(a, byTag(a, "back"))
            assertTrue("back to the settings list from ${s.name}", has(a, "sub:${s.name}"))
            touch(a, byTag(a, "sub:${s.name}"))
            @Suppress("DEPRECATION") a.onBackPressed(); idle()
            assertTrue(has(a, "sub:${s.name}"))
        }
        @Suppress("DEPRECATION") a.onBackPressed(); idle()      // settings → home
        assertTrue(has(a, "hero"))
        assertFalse(a.isFinishing)
        @Suppress("DEPRECATION") a.onBackPressed(); idle()      // home → leave
        assertTrue(a.isFinishing)
    }

    @Test fun navigationPhone() = navigationWorks(phone)
    @Test fun navigationTablet() = navigationWorks(tablet)

    private fun x(v: View) = IntArray(2).also { v.getLocationInWindow(it) }

    @Test fun tabletShowsHeroBesideTheSheetAndARail() {
        RuntimeEnvironment.setQualifiers(tablet)
        val a = launch()
        val lh = x(byTag(a, "hero")); val ls = x(byTag(a, "sheet")); val lr = x(byTag(a, "rail"))
        // RTL (Persian default): rail on the right edge, then the stage, then the quick settings.
        assertTrue("hero right of sheet", lh[0] > ls[0])
        assertTrue("rail on the start (right) side", lr[0] > lh[0])
        assertFalse("no bottom bar on a tablet", has(a, "navbar"))
        tab(a, MainActivity.Tab.VIDEOS)
        assertFalse(has(a, "hero"))
    }

    @Test fun phoneSheetSitsBelowTheHeroAndTheBarAtTheBottom() {
        val a = launch()
        val lh = x(byTag(a, "hero")); val ls = x(byTag(a, "sheet")); val lb = x(byTag(a, "navbar"))
        assertTrue(ls[1] > lh[1])
        assertTrue("bottom bar below the stage", lb[1] > lh[1])
        assertFalse("no rail on a phone", has(a, "rail"))
        assertTrue("bar in the lower part of the window", lb[1] > a.window.decorView.height / 2)
    }

    @Test fun englishIsLeftToRight() {
        prefs().edit().putString("app_lang", "en").commit()
        RuntimeEnvironment.setQualifiers(tablet)
        val a = launch()
        val lh = x(byTag(a, "hero")); val ls = x(byTag(a, "sheet")); val lr = x(byTag(a, "rail"))
        assertTrue("LTR: rail, stage, then quick settings from the left", lr[0] < lh[0] && lh[0] < ls[0])
    }

    @Test fun everyTouchTargetIsAtLeast48dp() {
        val a = launch()
        val min = (48 * a.resources.displayMetrics.density).toInt() - 1
        fun check() = all(a.window.decorView).filter { shown(it) && it.isClickable && it.width > 0 }.forEach {
            assertTrue("${it.javaClass.simpleName} «${label(it)}» ${it.width}×${it.height}", it.height >= min && it.width >= min)
        }
        check()
        tab(a, MainActivity.Tab.QUALITY); expand(a, "advanced"); check()
        openSub(a, MainActivity.Sub.CONTROLS); check()
    }

    @Test fun sectionsAreClosedByDefaultAndToggle() {
        val a = launch()
        tab(a, MainActivity.Tab.QUALITY)
        assertFalse(shown(byTagAny(a, "section:advanced:body")))
        touch(a, byTag(a, "section:advanced")); assertTrue(shown(byTagAny(a, "section:advanced:body")))
        touch(a, byTag(a, "section:advanced")); assertFalse(shown(byTagAny(a, "section:advanced:body")))
        tab(a, MainActivity.Tab.ABOUT)
        for (k in listOf("report", "device", "crash")) {
            assertFalse("$k closed", shown(byTagAny(a, "section:$k:body")))
            touch(a, byTag(a, "section:$k")); assertTrue(shown(byTagAny(a, "section:$k:body")))
            touch(a, byTag(a, "section:$k")); assertFalse(shown(byTagAny(a, "section:$k:body")))
        }
    }

    /** Every on/off row on the settings pages flips its switch when tapped anywhere on the row. */
    @Test fun everyToggleResponds() {
        val a = launch()
        var flipped = 0
        for (s in listOf(MainActivity.Sub.VIDEO, MainActivity.Sub.CONTROLS)) {
            openSub(a, s)
            val tags = all(a.window.decorView).mapNotNull { it.tag as? String }.filter { it.startsWith("tog:") && !it.endsWith(":switch") }
            assertTrue("toggles on ${s.name}", tags.isNotEmpty())
            for (t in tags) {
                if (!has(a, t)) continue
                val row = byTag(a, t)
                val sw = byTag(a, "$t:switch") as android.widget.Switch
                if (!row.isEnabled) { assertTrue("only game mode may be disabled (Android < 14)", t == "tog:game" && android.os.Build.VERSION.SDK_INT < 34); continue }
                val before = sw.isChecked
                touch(a, row)
                assertEquals("«$t» flips", !before, (byTag(a, "$t:switch") as android.widget.Switch).isChecked)
                touch(a, row)
                assertEquals("«$t» flips back", before, (byTag(a, "$t:switch") as android.widget.Switch).isChecked)
                flipped++
            }
        }
        assertTrue("flipped $flipped toggles", flipped >= 4)
        assertNull("no error while tapping", CrashLog.pending(app))
    }

    @Test fun homeOptionRowsToggle() {
        val a = launch()
        val cam = byTag(a, "opt:cam:switch") as android.widget.Switch
        val mic = byTag(a, "opt:mic:switch") as android.widget.Switch
        val c0 = cam.isChecked; val m0 = mic.isChecked
        touch(a, byTag(a, "opt:cam")); assertEquals(!c0, (byTag(a, "opt:cam:switch") as android.widget.Switch).isChecked)
        touch(a, byTag(a, "opt:mic")); assertEquals(!m0, (byTag(a, "opt:mic:switch") as android.widget.Switch).isChecked)
        touch(a, byTag(a, "opt:cam")); touch(a, byTag(a, "opt:mic"))
        assertEquals(c0, cam.isChecked); assertEquals(m0, mic.isChecked)
    }

    // ------------------------------------------------------------ every control on every page

    private fun everyChip(size: String) {
        RuntimeEnvironment.setQualifiers(size)
        val a = launch()
        val lang = setOf(app.getString(R.string.lang_fa), app.getString(R.string.lang_en))
        var tapped = 0
        val pages: List<() -> Unit> = listOf(
            { tab(a, MainActivity.Tab.HOME) },
            { tab(a, MainActivity.Tab.QUALITY); expand(a, "advanced") },
            { openSub(a, MainActivity.Sub.VIDEO) },
            { openSub(a, MainActivity.Sub.AUDIO) },
            { openSub(a, MainActivity.Sub.CONTROLS) },
        )
        for (go in pages) {
            go()
            val chips = all(a.window.decorView).filterIsInstance<RadioButton>().filter { shown(it) }
            assertTrue("chips on the page", chips.isNotEmpty())
            for (c in chips) {
                if (!shown(c) || c.text.toString() in lang) continue
                if (!c.isEnabled) { assertTrue("only game mode may be disabled (Android < 14)", android.os.Build.VERSION.SDK_INT < 34); continue }
                touch(a, c)
                assertTrue("chip «${label(c)}» is selected after a tap", c.isChecked)
                tapped++
            }
        }
        assertTrue("tapped $tapped chips", tapped > 30)
        assertNull("no error while tapping", CrashLog.pending(app))
    }

    @Test fun everyChipRespondsPhone() = everyChip(phone)
    @Test fun everyChipRespondsTablet() = everyChip(tablet)

    @Test fun homeButtonsStartTheFlow() {
        val a = launch()
        val record = byTag(a, "record")
        assertEquals(a.getString(R.string.home_start), (record as Button).text.toString())
        assertFalse("pause hidden while idle", has(a, "heroPause"))
        val test = all(a.window.decorView).first { it is Button && shown(it) && (it as Button).text == a.getString(R.string.btn_test) }
        touch(a, record)
        assertEquals("toast: ${ShadowToast.getTextOfLatestToast()}", Settings.ACTION_MANAGE_OVERLAY_PERMISSION, shadowOf(a).nextStartedActivity?.action)
        touch(a, test)
        assertEquals(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, shadowOf(a).nextStartedActivity?.action)
        assertEquals(10, prefs().getInt("await_test", 0))
        ShadowSettings.setCanDrawOverlays(true)
        touch(a, record)
        assertTrue("permissions requested or capture asked",
            shadowOf(a).lastRequestedPermission != null || shadowOf(a).nextStartedActivityForResult != null)
        home(a)
        touch(a, byTag(a, "planLine"))
        assertFalse("the plan line opens «کیفیت»", has(a, "hero"))
    }

    @Test fun permissionFixButtonsRespond() {
        val a = launch()
        openSub(a, MainActivity.Sub.PERMS)
        val fixes = all(a.window.decorView).filterIsInstance<Button>().filter { shown(it) && it.text.toString() == a.getString(R.string.perm_fix) }
        assertTrue("fix buttons", fixes.size >= 3)
        for (b in fixes) {
            touch(a, b)
            assertTrue("«${label(b)}» did something", shadowOf(a).lastRequestedPermission != null || shadowOf(a).nextStartedActivity != null)
        }
    }

    @Test fun aboutPageButtonsRespond() {
        prefs().edit().putString("last_uris", "content://media/external/video/media/7").putString("last_names", "RawRec x.mp4")
            .putLong("last_bytes", 5_000_000L).putString("last_report", "report 100% ok").commit()
        val a = launch()
        CrashLog.write(app, IllegalStateException("boom"), "test")
        (ShadowDialog.getLatestDialog() as? AlertDialog)?.dismiss()
        tab(a, MainActivity.Tab.ABOUT)
        expand(a, "report"); expand(a, "crash")
        val bs = all(a.window.decorView).filterIsInstance<Button>().filter { shown(it) }
        touch(a, bs.first { it.text.toString() == a.getString(R.string.action_copy_report) })
        assertEquals("report 100% ok", app.getSystemService(ClipboardManager::class.java)?.primaryClip?.getItemAt(0)?.text?.toString())
        touch(a, bs.first { it.text.toString() == a.getString(R.string.action_open) })
        assertEquals(Intent.ACTION_VIEW, shadowOf(a).nextStartedActivity?.action)
        touch(a, bs.first { it.text.toString() == a.getString(R.string.action_share) })
        assertEquals(Intent.ACTION_CHOOSER, shadowOf(a).nextStartedActivity?.action)
        touch(a, bs.first { it.text.toString() == a.getString(R.string.crash_copy) })
        assertTrue(app.getSystemService(ClipboardManager::class.java)?.primaryClip?.getItemAt(0)?.text?.contains("boom") == true)
        touch(a, bs.first { it.text.toString() == a.getString(R.string.crash_share) })
        assertEquals(Intent.ACTION_CHOOSER, shadowOf(a).nextStartedActivity?.action)
        touch(a, bs.first { it.text.toString() == a.getString(R.string.crash_clear) })
        assertNull(CrashLog.pending(app))
    }

    // ------------------------------------------------------------ videos list

    private fun withFakeMedia(): Activity {
        FakeMediaProvider.rows.clear()
        FakeMediaProvider.rows += arrayOf<Any?>(11L, "RawRec 2026-10-31 17-02.mp4", 1_793_000_000L, 45_000L, 156_000_000L, 1504, 2400)
        FakeMediaProvider.rows += arrayOf<Any?>(12L, "RawRec 2026-10-31 17-10 (۲).mp4", 1_793_000_600L, 12_000L, 40_000_000L, 2400, 1504)
        FakeMediaProvider.deleted = 0
        Robolectric.setupContentProvider(FakeMediaProvider::class.java, "media")
        val a = launch()
        tab(a, MainActivity.Tab.VIDEOS)
        idle()
        return a
    }

    private fun videoRows(a: Activity) = all(a.window.decorView).filter { (it.tag as? String)?.startsWith("video:") == true && shown(it) }

    @Test fun videosListIsFriendlyAndOpensTheSameFile() {
        val a = withFakeMedia()
        val rows = videoRows(a)
        assertEquals(2, rows.size)
        val texts = all(a.window.decorView).filterIsInstance<TextView>().filter { shown(it) }.joinToString("\n") { it.text.toString() }
        assertFalse("no raw URIs on screen", texts.contains("content://"))
        assertFalse("no paths on screen", texts.contains("Movies/RawRec/"))
        assertTrue("size shown", texts.contains("156 MB"))
        assertTrue("resolution shown", texts.contains("1504×2400"))
        touch(a, rows.first())
        val open = shadowOf(a).nextStartedActivity
        assertEquals(Intent.ACTION_VIEW, open?.action)
        assertEquals("video/mp4", open?.type)
        assertEquals(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY).buildUpon().appendPath("11").build(), open?.data)
        assertTrue((open!!.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0)
    }

    @Test fun videoLongPressSharesAndDeletes() {
        val a = withFakeMedia()
        touch(a, videoRows(a).first(), longPress = true)
        val menu = ShadowDialog.getLatestDialog() as AlertDialog
        shadowOf(menu).clickOnItem(0)       // share
        idle()
        assertEquals(Intent.ACTION_CHOOSER, shadowOf(a).nextStartedActivity?.action)
        touch(a, videoRows(a).first(), longPress = true)
        shadowOf(ShadowDialog.getLatestDialog() as AlertDialog).clickOnItem(1)   // delete
        idle()
        (ShadowDialog.getLatestDialog() as AlertDialog).getButton(AlertDialog.BUTTON_POSITIVE).performClick()
        idle()
        assertEquals(1, FakeMediaProvider.deleted)
        assertEquals(1, videoRows(a).size)
    }

    // ------------------------------------------------------------ language and strings

    @Test fun persianIsDefaultEvenOnAnEnglishPhone() {
        RuntimeEnvironment.setQualifiers("+en")
        val a = launch()
        assertEquals("آماده", a.getString(R.string.state_idle))
        assertEquals(View.LAYOUT_DIRECTION_RTL, a.resources.configuration.layoutDirection)
        val svc = Robolectric.buildService(RecordService::class.java).create().get()
        assertEquals("RawRec در حال ضبط", svc.getString(R.string.n_recording))
        val tile = Robolectric.buildService(RecTileService::class.java).create().get()
        assertEquals("توقفِ ضبط", tile.getString(R.string.tile_stop))
    }

    @Test fun languageSwitchToEnglishAndBack() {
        RuntimeEnvironment.setQualifiers("+en")
        val a = launch()
        openSub(a, MainActivity.Sub.LANG)
        touch(a, all(a.window.decorView).filterIsInstance<RadioButton>().first { it.text.toString() == "English" })
        assertEquals("en", prefs().getString("app_lang", ""))
        val b = launch()
        assertEquals("Ready", b.getString(R.string.state_idle))
        openSub(b, MainActivity.Sub.LANG)
        touch(b, all(b.window.decorView).filterIsInstance<RadioButton>().first { it.text.toString() == "فارسی" })
        assertEquals("fa", prefs().getString("app_lang", ""))
    }

    @Test fun oldVideoSettingsAreResetOnceIn13() {
        prefs().edit().putInt("c_preset", 3).putInt("c_br", 50).apply()
        launch()
        assertEquals(RecordConfig.BR_AUTO_HIGH, prefs().getInt("c_br", 0))
        assertEquals(RecordConfig.PRESET_SCREEN, prefs().getInt("c_preset", -1))
        prefs().edit().putInt("c_preset", 3).putInt("c_br", 50).apply()
        launch()
        assertEquals("a choice made in 1.3 is kept", 50, prefs().getInt("c_br", 0))
    }

    /** Every string resource, in both languages, with and without its format arguments. */
    @Test fun everyStringFormatsInBothLanguages() {
        val ids = R.string::class.java.fields.map { it.getInt(null) }
        assertTrue(ids.size > 250)
        for (lang in listOf("fa", "en")) {
            val ctx = app.createConfigurationContext(Configuration(app.resources.configuration).apply { setLocale(Locale.forLanguageTag(lang)) })
            for (id in ids) {
                val raw = ctx.getString(id)
                val args = Regex("%(\\d+)\\$([sd])").findAll(raw).map { it.groupValues[1].toInt() to it.groupValues[2] }
                    .sortedBy { it.first }.distinctBy { it.first }.map { if (it.second == "d") 7 as Any else "x" as Any }.toList()
                if (args.isNotEmpty()) ctx.getString(id, *args.toTypedArray())
            }
        }
        assertNotNull(app)
    }
}
