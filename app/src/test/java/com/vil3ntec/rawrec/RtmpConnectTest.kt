package com.vil3ntec.rawrec

import android.content.Context
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.ServerSocket
import java.net.SocketAddress
import java.net.URI
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

/** The way to the platform's server: through the phone's proxy, each failure with its reason, said to the owner. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RtmpConnectTest {
    private val app: Context get() = RuntimeEnvironment.getApplication()
    private val before: ProxySelector? = ProxySelector.getDefault()

    @After fun restore() { ProxySelector.setDefault(before) }

    @Test fun aFilterIsToldApartFromNoInternet() {
        assertTrue("Iran's filter page", RtmpPublisher.filtered(InetAddress.getByName("10.10.34.36")))
        assertTrue(RtmpPublisher.filtered(InetAddress.getByName("127.0.0.1")))
        assertFalse("a real ingest address", RtmpPublisher.filtered(InetAddress.getByName("142.250.180.12")))
        assertEquals(RtmpPublisher.Why.DNS, RtmpPublisher.classify(UnknownHostException("a.rtmps.youtube.com"), null, proxy = false))
        assertEquals("cut at the secure handshake", RtmpPublisher.Why.BLOCKED, RtmpPublisher.classify(SSLHandshakeException("reset"), null, proxy = false))
        assertEquals(RtmpPublisher.Why.BLOCKED, RtmpPublisher.classify(java.net.SocketException("Connection reset"), null, proxy = false))
        assertEquals(RtmpPublisher.Why.UNREACHABLE, RtmpPublisher.classify(java.net.SocketTimeoutException("connect timed out"), null, proxy = false))
        assertEquals(RtmpPublisher.Why.BLOCKED, RtmpPublisher.classify(IOException("x"), InetAddress.getByName("10.10.34.35"), proxy = false))
        assertEquals(RtmpPublisher.Why.PROXY, RtmpPublisher.classify(IOException("the proxy said: HTTP/1.1 403"), null, proxy = true))
    }

    @Test fun aConnectionCutAtOnceIsBlocked() {
        // a «filter»: takes the connection and resets it as soon as the client speaks
        val srv = ServerSocket(0)
        val t = Thread {
            try { srv.accept().use { s -> s.getInputStream().read(); s.setSoLinger(true, 0) } } catch (_: Exception) {}
        }.apply { isDaemon = true; start() }
        val e = try { RtmpPublisher("rtmps://127.0.0.1:${srv.localPort}/live2", "abcd-1234", 3_000).probe(); null } catch (x: RtmpPublisher.Failure) { x }
        srv.close(); t.join(2_000)
        assertEquals(RtmpPublisher.Why.BLOCKED, e?.why)
        assertFalse("the key is never in the report", e?.message.orEmpty().contains("abcd-1234"))
    }

    @Test fun thePhonesProxyIsTakenFirst() {
        // the phone's proxy (a VPN in proxy mode): asked for the way with CONNECT; it says no here
        val srv = ServerSocket(0)
        var asked = ""
        val t = Thread {
            try {
                srv.accept().use { s ->
                    val head = StringBuilder()
                    val inp = s.getInputStream()
                    while (!head.endsWith("\r\n\r\n")) { val c = inp.read(); if (c < 0) break; head.append(c.toChar()) }
                    asked = head.lineSequence().first()
                    s.getOutputStream().apply { write("HTTP/1.1 403 Forbidden\r\n\r\n".toByteArray()); flush() }
                }
            } catch (_: Exception) {}
        }.apply { isDaemon = true; start() }
        ProxySelector.setDefault(object : ProxySelector() {
            override fun select(uri: URI?) = listOf(Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", srv.localPort)))
            override fun connectFailed(uri: URI?, sa: SocketAddress?, ioe: IOException?) {}
        })
        // a name only the proxy could reach (none here): the proxy's «no» is the reason given
        val e = try { RtmpPublisher("rtmps://ingest.invalid/live2", "abcd-1234", 3_000).probe(); null } catch (x: RtmpPublisher.Failure) { x }
        srv.close(); t.join(2_000)
        assertEquals("CONNECT ingest.invalid:443 HTTP/1.1", asked)
        assertEquals(RtmpPublisher.Why.PROXY, e?.why)
        assertTrue(e?.message.orEmpty().contains("403"))
    }

    @Test fun theOwnerIsToldWhyNothingGoesOut() {
        fun st(state: RtmpSink.State, why: RtmpPublisher.Why? = null, err: String? = null, noPic: Boolean = false) =
            RtmpSink.Status(state, 0, 9000, 0, 0, err, why, null, noPic)
        assertNull("live: nothing to say", LiveSettings.sendProblem(app, st(RtmpSink.State.LIVE), "YouTube", 60_000))
        assertNull("the first seconds of connecting are not a problem", LiveSettings.sendProblem(app, st(RtmpSink.State.CONNECTING), "YouTube", 3_000))
        val blocked = LiveSettings.sendProblem(app, st(RtmpSink.State.CONNECTING, RtmpPublisher.Why.BLOCKED, "Connection reset"), "YouTube", 3_000)!!
        assertTrue(blocked.contains("YouTube") && blocked.contains(app.getString(R.string.live_why_blocked)))
        val slow = LiveSettings.sendProblem(app, st(RtmpSink.State.CONNECTING), "YouTube", 20_000)!!
        assertTrue("still nothing after a while: said", slow.contains("YouTube"))
        assertTrue(LiveSettings.sendProblem(app, st(RtmpSink.State.CONNECTING, noPic = true), "YouTube", 8_000)!!
            .contains(app.getString(R.string.live_why_no_picture)))
        // several platforms: the reason comes with the platform that has it
        val agg = MultiSink.aggregate(listOf(st(RtmpSink.State.CONNECTING, RtmpPublisher.Why.DNS, "no name"), st(RtmpSink.State.CONNECTING)), listOf("YouTube", "Twitch"))
        assertEquals(RtmpPublisher.Why.DNS, agg.why)
        assertEquals(app.getString(R.string.live_route_proxy), LiveSettings.routeText(app, "proxy 127.0.0.1:10809"))
        assertEquals(app.getString(R.string.live_route_direct), LiveSettings.routeText(app, "direct 142.250.180.12"))
    }

    @Test fun bitRatesGoUpToWhatThePhoneTakes() {
        val c = Encoders.bitrateChoices(160)
        assertTrue("past 50", c.containsAll(listOf(50, 60, 80, 100, 120, 150)))
        assertEquals("the phone's own most is the last", 160, c.last())
        assertFalse(c.any { it > 160 })
        assertEquals("unknown phone: the usual ones", listOf(6, 10, 15, 20, 30, 50), Encoders.bitrateChoices(0))
        assertEquals("a most that is a step itself is not twice", 1, Encoders.bitrateChoices(200).count { it == 200 })
    }

    @Test fun recordingWhileLiveUsesTheSameFrames() {
        class Fake(val wantsKey: Boolean) : MediaSink {
            var video = 0; var audio = 0; var finished = false
            override fun submitVideo(src: java.nio.ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int): Boolean { video++; src.position(src.limit()); return wantsKey }
            override fun submitAudio(src: java.nio.ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int) { audio++ }
            override fun videoFormat(f: android.media.MediaFormat) {}
            override fun audioFormat(f: android.media.MediaFormat) {}
            override fun newPart(discardCurrent: Boolean) {}
            override fun encoderReplaced() {}
            override fun dropAudio() {}
            override fun finish() { finished = true }
            override fun emergencyFinish(timeoutMs: Long) { finished = true }
            override fun parts(): List<SegMuxer.Part> = emptyList()
            override val allClosed = true
            override val totalBytes = 7L
            override val videoBytes = 7L
            override val waitNs = 0L
        }
        val live = Fake(false); val file = Fake(true)
        val t = TeeSink(live, file)
        val b = java.nio.ByteBuffer.allocate(16)
        assertTrue("a key frame asked by either is asked", t.submitVideo(b, 0, 16, 0, 0))
        t.submitAudio(b, 0, 16, 0, 0)
        assertEquals(1, live.video); assertEquals(1, file.video); assertEquals(1, file.audio)
        assertEquals("the recording's own size", 7L, t.totalBytes)
        // the file fails (storage full): the stream goes on alone
        t.stopFile()
        t.submitVideo(b, 0, 16, 1, 0)
        assertEquals(2, live.video); assertEquals(1, file.video)
        t.finish()
        assertTrue(live.finished)
    }

    @Test fun theGameFillsTheStreamWhenTheTabletIsUpright() {
        // the owner's screenshot: an upright screen (game in a band in the middle) put whole into the
        // landscape picture — the game was 784×492 of 1999×1253 (39 %); a record dot on a bar too
        val w = 160; val h = 100
        fun frame(lit: (Int, Int) -> Boolean) = ByteArray(w * h * 4).also { px ->
            for (y in 0 until h) for (x in 0 until w) if (lit(x, y)) { val i = (y * w + x) * 4; px[i] = 90; px[i + 1] = 80; px[i + 2] = 70; px[i + 3] = -1 }
        }
        val band = frame { x, y -> (x in 49..110 && y in 30..68) || (x in 50..53 && y in 8..12) }
        val r = LookFilter.barsRegion(band, w, h)!!
        assertEquals("from the band's left", 0.306f, r[0], 0.02f)
        assertEquals(0.30f, r[1], 0.02f)
        assertEquals("the band fills the picture", 0.39f, r[2], 0.02f)
        assertEquals("the frame's own shape (not stretched)", r[2], r[3], 0.0001f)
        // the game over the whole screen: nothing cut
        assertEquals(listOf(0f, 0f, 1f, 1f), LookFilter.barsRegion(frame { _, _ -> true }, w, h)!!.toList())
        // a dark sky only at the top (not bars on both sides): nothing cut
        assertEquals(listOf(0f, 0f, 1f, 1f), LookFilter.barsRegion(frame { _, y -> y < 75 }, w, h)!!.toList())
        // all black: no answer (the picture stays as it is)
        assertNull(LookFilter.barsRegion(frame { _, _ -> false }, w, h))
    }
}
