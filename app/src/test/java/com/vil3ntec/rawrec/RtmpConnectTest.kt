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
        val live = Fake(false); val files = ArrayList<Fake>()
        val t = TeeSink(live, { Fake(true).also { files += it } }, startOn = true)
        val file = files.single()
        val b = java.nio.ByteBuffer.allocate(16)
        val key = android.media.MediaCodec.BUFFER_FLAG_KEY_FRAME
        assertTrue("a key frame asked by either is asked", t.submitVideo(b, 0, 16, 0, key))
        t.submitAudio(b, 0, 16, 0, 0)
        assertEquals(1, live.video); assertEquals(1, file.video); assertEquals(1, file.audio)
        assertEquals("the recording's own size", 7L, t.totalBytes)
        // the file fails (storage full), or the owner presses ⏺: the stream goes on alone
        assertTrue(t.stopFile())
        t.submitVideo(b, 0, 16, 1, 0)
        assertEquals(2, live.video); assertEquals(1, file.video)
        assertFalse(t.recording)
        // 6.2: ⏺ again mid-stream — a new file, from the next key frame only (a key frame asked for at once)
        assertTrue(t.startFile())
        assertTrue("a key frame is asked for the new file", t.submitVideo(b, 0, 16, 2, 0))
        t.submitAudio(b, 0, 16, 2, 0)
        val second = files[1]
        assertEquals("nothing before the key frame", 0, second.video); assertEquals(0, second.audio)
        t.submitVideo(b, 0, 16, 3, key); t.submitAudio(b, 0, 16, 3, 0)
        assertEquals(1, second.video); assertEquals(1, second.audio)
        assertEquals("both files' sizes", 14L, t.totalBytes)
        t.finish()
        assertTrue(live.finished); assertTrue(second.finished)
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

    @Test fun aKeyFrameEverySecondByTimeNotByFrameCount() {
        // 165 fps set, the game drawing 40: frames 25 ms apart — the next key frame is due after 1 s of video
        assertFalse(KeyClock.due(0, 500_000, 1_000_000))
        assertTrue(KeyClock.due(0, 1_000_000, 1_000_000))
        assertTrue("a frame just before the second counts (frame times jitter)", KeyClock.due(0, 985_000, 1_000_000))
        assertFalse("before the first key frame: not due", KeyClock.due(-1, 5_000_000, 1_000_000))
    }

    @Test fun shortsPutTheGameWhereTheOwnerSays() {
        // a 16:10 tablet picture in a 720×1280 tall frame
        val mid = Shorts.layout(720, 1280, 1.6f, 1, 0)
        assertEquals("the whole game across", 720, mid.game.width())
        assertEquals(450, mid.game.height())
        assertEquals("in the middle", 415, mid.game.top)
        assertEquals("room above for the title or picture", 415, mid.top!!.height())
        assertEquals("and below for the chat", 415, mid.bottom!!.height())
        val top = Shorts.layout(720, 1280, 1.6f, 0, 0)
        assertEquals(0, top.game.top); assertNull("nothing above a game at the top", top.top)
        val full = Shorts.layout(720, 1280, 1.6f, 1, 2)
        assertEquals("the whole height", 1280, full.game.height())
        assertTrue("the sides cut evenly", full.game.left < 0 && full.game.right > 720 && full.game.left == 720 - full.game.right)
        assertNull(full.top); assertNull(full.bottom)
        val big = Shorts.layout(720, 1280, 1.6f, 2, 1)
        assertEquals("at the bottom", 1280, big.game.bottom)
        assertTrue("bigger than the frame's width", big.game.width() > 720)
    }

    @Test fun theLiveChatStaysOpenWhenAsked() {
        LiveExtras.put(app, "yt_privacy", "private")
        LiveExtras.put(app, "yt_kids", "yes")
        assertTrue("on unless switched off", LiveExtras.chatOpen(app))
        assertEquals("never private (YouTube closes its chat): unlisted", "unlisted", LiveExtras.ytPrivacyToSet(app))
        assertEquals("never for kids (no chat either)", false, LiveExtras.ytKidsToSet(app))
        LiveExtras.setChatOpen(app, false)
        assertEquals("off: the owner's own choice", "private", LiveExtras.ytPrivacyToSet(app))
        assertEquals(true, LiveExtras.ytKidsToSet(app))
        LiveExtras.put(app, "yt_privacy", "")
        assertEquals("left as it is", "", LiveExtras.ytPrivacyToSet(app))
    }

    /**
     * The owner's stream cut out every 3–4 s: a link that carried less than 4.0's 40 % floor. A link
     * (bits a second, changing over time) against the encoder at the controller's rate, 100 ms steps.
     */
    private class Sim(maxBps: Int, startBps: Int = 0, val link: (Double) -> Double) {
        val rc = RateControl(maxBps, startBps = startBps)
        var drops = 0; var maxLagMs = 0L
        /** What waits to go out: 100 ms of picture each, with how many bits are still left of it. */
        private val queue = ArrayDeque<DoubleArray>()
        private var sentThisSecond = 0.0
        fun run(fromS: Double, toS: Double) {
            var t = fromS
            while (t < toS) {
                queue.addLast(doubleArrayOf(rc.target * 0.1, rc.target * 0.1))
                var room = link(t) * 0.1
                while (room > 0 && queue.isNotEmpty()) {
                    val c = queue.first(); val n = minOf(room, c[1])
                    c[1] -= n; room -= n; sentThisSecond += n
                    if (c[1] <= 0.0) queue.removeFirst()
                }
                if (((t * 10 + 0.5).toLong() % 10L) == 9L) { rc.measured(sentThisSecond.toInt()); sentThisSecond = 0.0 }
                // how long the oldest waiting picture has waited (in picture time, as RtmpSink measures it)
                val lagUs = (queue.sumOf { it[1] / it[0] } * 100_000).toLong()
                maxLagMs = maxOf(maxLagMs, lagUs / 1000)
                if (rc.step((t * 1e9).toLong(), lagUs, true) == RateControl.Act.DROP) { drops++; queue.clear() }
                t += 0.1
            }
        }
    }

    @Test fun aNarrowLinkSettlesInsteadOfCuttingOutEveryFewSeconds() {
        // 12 Mbps chosen, the VPN carries 4: down to what gets through, then steady
        val s = Sim(12_000_000) { 4_000_000.0 }
        val rc = s.rc
        s.run(0.0, 30.0)
        assertTrue("at about what the link carries: ${rc.target}", rc.target <= 4_600_000)
        val drops30 = s.drops
        // the next 3 minutes: no frames dropped, the rate never far from what the link carries
        var lowest = Int.MAX_VALUE; var highest = 0
        s.maxLagMs = 0
        var t = 30.0
        while (t < 210.0) { s.run(t, t + 1.0); lowest = minOf(lowest, rc.target); highest = maxOf(highest, rc.target); t += 1.0 }
        assertEquals("no frames dropped once settled (4.0 dropped every few seconds)", drops30, s.drops)
        // once a minute it tries 10 % more (the link may have grown) and comes back before any delay shows
        assertTrue("never far above what the link carries: highest ${highest}", highest <= 4_600_000)
        assertTrue("and not starved: lowest ${lowest}", lowest >= 2_000_000)
        assertEquals("not a single cut, not even at the start (a gentle start at 6 Mbps)", 0, s.drops)
        assertTrue("never more than the 5 s the owner accepts once settled: ${s.maxLagMs} ms", s.maxLagMs < 5_000)
    }

    @Test fun aGoodLinkKeepsTheChosenRateAndAFreedLinkClimbsBack() {
        val good = Sim(12_000_000) { 20_000_000.0 }
        good.run(0.0, 120.0)
        assertEquals("a link with room: the chosen rate, untouched", 12_000_000, good.rc.target)
        assertEquals(0, good.drops)
        // a narrow minute, then plenty again: back to the chosen rate within a few minutes, step by step
        val s = Sim(12_000_000) { t -> if (t < 60) 5_000_000.0 else 20_000_000.0 }
        s.run(0.0, 60.0)
        assertTrue(s.rc.target < 5_000_000)
        s.run(60.0, 420.0)
        assertEquals("back to the chosen rate", 12_000_000, s.rc.target)
        assertTrue("no drop once the link was free", s.drops <= 1)
    }

    @Test fun theOwnersViewLandsWhereTheStreamHasIt() {
        // a tablet lying down, the game over the whole screen: the stream is this screen
        val flat = OwnerMirror.Mapping.of(OwnerMirror.Geo(2560, 1600, floatArrayOf(0f, 0f, 1f, 1f)), 2560f, 1600f)
        assertEquals(0.85f * 2560, flat.x(0.85f), 0.5f); assertEquals(0.3f * 1600, flat.y(0.3f), 0.5f); assertEquals(1f, flat.px, 0.001f)
        // upright: the game a band in the middle, the stream shows that band (the bars cut)
        val s = 1000f / 2560f
        val r = floatArrayOf(780f / 2560f, (1600f - 1112.5f) / 1600f, s, s)
        val up = OwnerMirror.Mapping.of(OwnerMirror.Geo(2560, 1600, r), 1600f, 2560f)
        assertEquals("the picture's left edge: the screen's", 0f, up.x(0f), 1f)
        assertEquals("its top: the band's top on the upright screen", 780f, up.y(0f), 1f)
        assertEquals("its bottom: the band's bottom", 1780f, up.y(1f), 1f)
        assertEquals("the chat on the right of the picture: on the right of the band", 0.85f * 1600, up.x(0.85f), 1f)
        // no geometry: the screen itself
        val none = OwnerMirror.Mapping.of(null, 1080f, 2400f)
        assertEquals(540f, none.x(0.5f), 0.01f)
    }

    @Test fun eachLayerSaysWhoSeesIt() {
        val chat = Scenes.newLayer(app, Scenes.Kind.CHAT)
        assertEquals("the chat: viewers and me, as before", 0, Scenes.audience(chat))
        chat.p.put("who", 2)
        assertEquals("only me", 2, Scenes.audience(chat))
        chat.p.put("who", 1)
        assertEquals("viewers only", 1, Scenes.audience(chat))
        val old = Scenes.newLayer(app, Scenes.Kind.TEXT).apply { p.put("mine", false) }
        assertEquals("the old «on my screen» switch off: viewers only", 1, Scenes.audience(old))
        assertEquals("a camera is on the stream only", 1, Scenes.audience(Scenes.newLayer(app, Scenes.Kind.CAMERA)))
    }

    @Test fun noCutsOnAnyCommonLink() {
        // the owner: «up to 5 s of delay is fine, but no cuts»
        for (mbps in listOf(1.5, 2.5, 4.0, 6.0, 8.0, 20.0)) {
            val s = Sim(12_000_000) { mbps * 1_000_000 }
            s.run(0.0, 240.0)
            assertEquals("$mbps Mbps: no cut", 0, s.drops)
            assertTrue("$mbps Mbps: never 5 s behind (${s.maxLagMs} ms)", s.maxLagMs < 5_000)
        }
    }

    /**
     * 6.4: the owner's VPN at a megabit — and worse: real time kept (YouTube's player stalls when fed
     * slower than real time), the rate under what the link carries, no cut once settled.
     */
    @Test fun aLinkUnderAMegabitStaysRealTime() {
        for (kbps in listOf(1000, 600, 350)) {
            val s = Sim(12_000_000) { kbps * 1000.0 }
            s.run(0.0, 30.0)
            assertTrue("$kbps kbps: at most one cut while the start finds the link (${s.drops})", s.drops <= 1)
            val settle = s.drops
            s.maxLagMs = 0; s.run(30.0, 240.0)
            assertEquals("$kbps kbps: no cut once settled", settle, s.drops)
            assertTrue("$kbps kbps: about what the link carries, a probe of 10 % at most (${s.rc.target})", s.rc.target <= kbps * 1150)
            assertTrue("$kbps kbps: real time, never 4 s behind (${s.maxLagMs} ms)", s.maxLagMs < RateControl.HARD_US / 1000)
        }
        // remembered from the last stream: not even the one cut at the start
        val s = Sim(12_000_000, 1_200_000) { 1_000_000.0 }
        s.run(0.0, 240.0)
        assertEquals(0, s.drops)
        assertTrue("never 4 s behind (${s.maxLagMs} ms)", s.maxLagMs < RateControl.HARD_US / 1000)
    }

    /** 5.2: a stream that starts where the link was last time does not hit a narrow link at 6 Mbps. */
    @Test fun theStartIsWhereTheLinkWasLastTime() {
        val remembered = RateControl(12_000_000, startBps = 1_200_000)
        assertEquals(1_200_000, remembered.target)
        assertEquals("nothing remembered: the gentle start", RateControl.START_BPS, RateControl(12_000_000).target)
        // a break: when the connection is back the rate is halved so what waited drains, never under the floor
        val rc = RateControl(12_000_000)
        rc.lost(1L)
        assertEquals(RateControl.START_BPS / 2, rc.target)
        repeat(8) { rc.lost(1L) }
        assertEquals(RateControl.FLOOR_BPS, rc.target)
    }
}
