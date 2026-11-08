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
}
