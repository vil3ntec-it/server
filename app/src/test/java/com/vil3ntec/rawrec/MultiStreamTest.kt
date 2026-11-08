package com.vil3ntec.rawrec

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** One stream to several platforms at once: which ones, how fast, and how the whole stream is told. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MultiStreamTest {
    private val app: Context get() = RuntimeEnvironment.getApplication()
    private fun st(state: RtmpSink.State, kbps: Int = 0, target: Int = 9000, err: String? = null, rec: Int = 0) =
        RtmpSink.Status(state, kbps, target, 0, rec, err)

    @Test fun theStreamLivesWhileAnyPlatformDoes() {
        val names = listOf("YouTube", "Twitch", "Kick")
        val a = MultiSink.aggregate(listOf(st(RtmpSink.State.LIVE, 6000, 8000), st(RtmpSink.State.FAILED, err = "refused"), st(RtmpSink.State.LIVE, 6100, 8000, rec = 2)), names)
        assertEquals(RtmpSink.State.LIVE, a.state)
        assertEquals("speeds added up", 12100, a.kbps)
        assertEquals(2, a.reconnects)
        assertEquals("the error says which platform", "Twitch: refused", a.error)
        // all gave up: the stream ends
        assertEquals(RtmpSink.State.FAILED, MultiSink.aggregate(listOf(st(RtmpSink.State.FAILED), st(RtmpSink.State.FAILED)), names.take(2)).state)
        // still connecting (nothing heard yet from one)
        assertEquals(RtmpSink.State.CONNECTING, MultiSink.aggregate(listOf(null, st(RtmpSink.State.CONNECTING)), names.take(2)).state)
        assertEquals(RtmpSink.State.RECONNECTING, MultiSink.aggregate(listOf(st(RtmpSink.State.RECONNECTING), st(RtmpSink.State.CONNECTING)), names.take(2)).state)
        assertNull(MultiSink.aggregate(listOf(st(RtmpSink.State.LIVE)), names.take(1)).error)
    }

    @Test fun platformsAreSwitchedOnAndTheRateFitsTheStrictest() {
        LiveSettings.setQuality(app, 1)   // 1080p60, 9 Mbps
        LiveSettings.setPlatform(app, 0)
        assertEquals("until anything is switched: the open platform", listOf(0), LiveSettings.destinations(app).map { it.platform })
        assertEquals(9, LiveSettings.mbps(app))
        LiveSettings.setOn(app, 1, true)    // + Twitch
        assertEquals(listOf(0, 1), LiveSettings.destinations(app).map { it.platform })
        assertEquals("Twitch takes up to 8", 8, LiveSettings.mbps(app))
        // opening another platform to edit it does not switch anything
        LiveSettings.setPlatform(app, 3)
        assertEquals(listOf(0, 1), LiveSettings.destinations(app).map { it.platform })
        LiveSettings.setOn(app, 1, false)
        assertEquals(listOf(0), LiveSettings.destinations(app).map { it.platform })
        // nothing on: the open one
        LiveSettings.setOn(app, 0, false)
        assertEquals(listOf(3), LiveSettings.destinations(app).map { it.platform })
        val cfg = LiveSettings.config(app, RecordConfig(), true)
        assertTrue("the encoder gets the capped rate", cfg.bitrate == LiveSettings.mbps(app))
    }
}
