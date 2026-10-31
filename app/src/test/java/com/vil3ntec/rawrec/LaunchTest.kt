package com.vil3ntec.rawrec

import android.content.Context
import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaFormat
import android.view.Display
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.shadows.MediaCodecInfoBuilder
import org.robolectric.shadows.ShadowDialog
import org.robolectric.shadows.ShadowDisplayManager
import org.robolectric.shadows.ShadowMediaCodecList

/**
 * Launches MainActivity the way a phone does and fails if the app falls back to its crash screen
 * (MainActivity.failed writes last_crash.txt). Every test runs on Android 10, 13, 14 and 15.
 * Run: gradle :app:testDebugUnitTest
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 33, 34, 35])
class LaunchTest {

    private val app: Context get() = RuntimeEnvironment.getApplication()
    private fun prefs() = app.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)

    @Before
    fun phone() {
        // A 1440×3200, 165 Hz phone like the owner's (≈ 411×914 dp at 560 dpi).
        RuntimeEnvironment.setQualifiers("w411dp-h914dp-560dpi")
        ShadowDisplayManager.setSupportedModes(
            Display.DEFAULT_DISPLAY,
            Display.Mode(0, 1440, 3200, 165f), Display.Mode(2, 1440, 3200, 60f), Display.Mode(3, 1080, 2400, 120f),
        )
        ShadowMediaCodecList.reset()
        Encoders.clearCache()   // app singletons survive between tests in one Robolectric sandbox
    }

    private fun encoder(name: String, mime: String, maxW: Int, maxH: Int, profile: Int, level: Int, hw: Boolean = true) {
        val caps = MediaCodecInfoBuilder.CodecCapabilitiesBuilder.newBuilder()
            .setMediaFormat(MediaFormat.createVideoFormat(mime, maxW, maxH))
            .setIsEncoder(true)
            .setProfileLevels(arrayOf(CodecProfileLevel().apply { this.profile = profile; this.level = level }))
            .setColorFormats(intArrayOf(MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface))
            .build()
        ShadowMediaCodecList.addCodec(
            MediaCodecInfoBuilder.newBuilder().setName(name).setIsEncoder(true)
                .setIsHardwareAccelerated(hw).setIsSoftwareOnly(!hw).setIsVendor(hw)
                .setCapabilities(caps).build()
        )
    }

    private fun typicalEncoders() {
        encoder("c2.qti.hevc.encoder", MediaFormat.MIMETYPE_VIDEO_HEVC, 4096, 2176, CodecProfileLevel.HEVCProfileMain, CodecProfileLevel.HEVCMainTierLevel51)
        encoder("c2.qti.avc.encoder", MediaFormat.MIMETYPE_VIDEO_AVC, 4096, 2176, CodecProfileLevel.AVCProfileHigh, CodecProfileLevel.AVCLevel52)
        encoder("c2.android.hevc.encoder", MediaFormat.MIMETYPE_VIDEO_HEVC, 1920, 1088, CodecProfileLevel.HEVCProfileMain, CodecProfileLevel.HEVCMainTierLevel41, hw = false)
    }

    private fun launch(locale: String): ActivityController<MainActivity> {
        // The app language is the app's own setting (default Persian); the system locale is set too.
        prefs().edit().putString("app_lang", locale).commit()
        RuntimeEnvironment.setQualifiers("+$locale")
        val c = Robolectric.buildActivity(MainActivity::class.java).setup()
        assertNoCrash("launch $locale")
        return c
    }

    private fun assertNoCrash(where: String) {
        assertNull("$where: app fell back to its crash screen", CrashLog.pending(app))
    }

    @Test fun launchPersian() { typicalEncoders(); launch("fa").pause().stop().destroy() }

    @Test fun launchEnglish() { typicalEncoders(); launch("en").pause().stop().destroy() }

    @Test fun rotateAndRecreate() {
        typicalEncoders()
        val c = launch("fa")
        RuntimeEnvironment.setQualifiers("+land")
        c.configurationChange()
        assertNoCrash("rotate")
        c.recreate()
        assertNoCrash("recreate")
        RuntimeEnvironment.setQualifiers("+port")
        c.configurationChange()
        assertNoCrash("rotate back")
    }

    @Test fun prefsLeftFromVersion10() {
        typicalEncoders()
        prefs().edit().putInt("res", 0).putInt("fps", 165).putInt("codec", 0).putInt("br", 100).putInt("mode", 0)
            .putInt("audio", 1).putInt("orient", 0).putInt("gvol", 3).putInt("mvol", 3).putInt("cd", 1)
            .putInt("cam", 0).putInt("shake", 0).putInt("float", 0).apply()
        launch("fa").destroy()
        launch("en").destroy()
    }

    @Test fun prefsLeftFromVersion11() {
        typicalEncoders()
        prefs().edit().putInt("c_preset", 1).putInt("c_res", 0).putInt("c_orient", 0).putInt("c_fps", 60)
            .putInt("c_codec", 0).putInt("c_br", -2).putInt("c_mode", 0).putInt("c_audio", 3)
            .putFloat("c_gg", 1.5f).putFloat("c_mg", 2f).putInt("c_cd", 3).putBoolean("c_shake", true)
            .putInt("c_cam", 2).putBoolean("c_float", true).putBoolean("c_invis", true)
            .putString("last_uris", "content://media/external/video/media/1").putString("last_names", "RawRec_1.mp4")
            .putLong("last_bytes", 123456789L).putString("last_report", "report 100% ok").putBoolean("report_unseen", true)
            .putBoolean("last_is_test", true).putFloat("float_fx", 1f).putFloat("float_fy", 0.35f).apply()
        launch("fa").destroy()
    }

    @Test fun prefsWithWrongTypesAreReset() {
        typicalEncoders()
        prefs().edit().putString("c_preset", "x").putInt("c_float", 1).putString("c_gg", "1.0")
            .putInt("last_report", 5).putString("last_bytes", "big").putInt("await_overlay", 1).apply()
        launch("en").destroy()
        assertFalse(prefs().all["c_preset"] is String)
    }

    @Test fun noEncodersAtAll() { launch("fa").destroy(); launch("en").destroy() }

    @Test fun encoderSmallerThanScreen() {
        encoder("c2.vendor.hevc.encoder", MediaFormat.MIMETYPE_VIDEO_HEVC, 1920, 1088, CodecProfileLevel.HEVCProfileMain, CodecProfileLevel.HEVCMainTierLevel41)
        encoder("c2.vendor.avc.encoder", MediaFormat.MIMETYPE_VIDEO_AVC, 1920, 1088, CodecProfileLevel.AVCProfileHigh, CodecProfileLevel.AVCLevel42)
        launch("fa").destroy()
    }

    @Test fun softwareEncodersOnly() {
        encoder("c2.android.avc.encoder", MediaFormat.MIMETYPE_VIDEO_AVC, 2048, 2048, CodecProfileLevel.AVCProfileBaseline, CodecProfileLevel.AVCLevel41, hw = false)
        launch("en").destroy()
    }

    @Test fun previousCrashIsShownOnNextLaunch() {
        typicalEncoders()
        CrashLog.write(app, IllegalStateException("test crash"), "test")
        Robolectric.buildActivity(MainActivity::class.java).setup()
        assertNotNull("crash dialog", ShadowDialog.getLatestDialog())
    }

    @Test fun planUsesNativeSizeAndDeviceFps() {
        // An encoder that takes 3200-pixel-tall frames: the portrait screen is recorded at native size.
        encoder("c2.big.hevc.encoder", MediaFormat.MIMETYPE_VIDEO_HEVC, 8192, 4320, CodecProfileLevel.HEVCProfileMain, CodecProfileLevel.HEVCMainTierLevel62)
        val p = Planner.plan(RecordConfig(), DisplayInfo(1440, 3200, 560, 165))
        assertNotNull(p)
        assertEquals(1440, p!!.contentWidth)
        assertEquals(3200, p.contentHeight)
        assertFalse(p.scaled)
    }

    @Test fun portraitTooTallForEncoderIsScaledAndReported() {
        // A 4096×2176 encoder can't take 1440×3200 portrait: scaled (and the UI says so); landscape stays native.
        typicalEncoders()
        val portrait = Planner.plan(RecordConfig(), DisplayInfo(1440, 3200, 560, 165))!!
        assertEquals(true, portrait.scaled)
        val landscape = Planner.plan(RecordConfig(), DisplayInfo(3200, 1440, 560, 165))!!
        assertFalse(landscape.scaled)
        assertEquals(3200, landscape.contentWidth)
    }
}
