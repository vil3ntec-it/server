package com.vil3ntec.rawrec

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What RawRec asks YouTube: the right broadcast, and only what changes on the video. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class YouTubeSettingsTest {
    private val calls = ArrayList<Triple<String, String, String?>>()

    private val video = """{"items":[{"id":"v1","snippet":{"title":"T","description":"D","categoryId":"24","tags":["old"],
        "defaultAudioLanguage":"fa"},"status":{"privacyStatus":"unlisted","license":"youtube","publicStatsViewable":true,
        "embeddable":true,"selfDeclaredMadeForKids":false}}]}"""

    /** An old scheduled event (May) and the stream that is really going out, bound to our key. */
    private val upcoming = """{"items":[
        {"id":"old","snippet":{"title":"Old","liveChatId":"c-old","scheduledStartTime":"2026-05-10T19:55:00Z"},
         "status":{"lifeCycleStatus":"ready","privacyStatus":"public"},"contentDetails":{"boundStreamId":"s-other","enableAutoStart":false}},
        {"id":"ours","snippet":{"title":"Ours","liveChatId":"c-ours"},
         "status":{"lifeCycleStatus":"testing","privacyStatus":"public"},"contentDetails":{"boundStreamId":"s-ours","enableAutoStart":false,
         "monitorStream":{"enableMonitorStream":true}}}]}"""

    private fun fake(active: String = """{"items":[]}""", ownStream: Boolean = false) {
        YouTubeApi.transport = { m, u, b ->
            calls += Triple(m, u, b)
            when {
                u.contains("oauth2.googleapis.com/token") -> """{"access_token":"t","expires_in":3600}"""
                // the channel's streams: Studio's default key, and the app's own stream when it was made before
                m == "GET" && u.contains("liveStreams?part=id,snippet,cdn&mine=true") -> """{"items":[
                    {"id":"s-ours","snippet":{"title":"Default stream key"},"cdn":{"ingestionInfo":{"streamName":"kkkk-2222","rtmpsIngestionAddress":"rtmps://a.rtmps.youtube.com/live2"}}}""" +
                    (if (ownStream) """,{"id":"s-own","snippet":{"title":"RawRec"},"cdn":{"ingestionInfo":{"streamName":"own-1111","rtmpsIngestionAddress":"rtmps://a.rtmps.youtube.com/live2"}}}""" else "") + "]}"
                m == "POST" && u.contains("liveStreams?part=snippet,cdn,contentDetails") -> """{"id":"s-new","snippet":{"title":"RawRec"},
                    "cdn":{"ingestionInfo":{"streamName":"new-3333","rtmpsIngestionAddress":"rtmps://a.rtmps.youtube.com/live2"}}}"""
                u.contains("liveStreams?part=id,cdn") -> """{"items":[{"id":"s-other","cdn":{"ingestionInfo":{"streamName":"aaaa-1111"}}},
                    {"id":"s-ours","cdn":{"ingestionInfo":{"streamName":"kkkk-2222"}}}]}"""
                u.contains("broadcastStatus=active") -> active
                u.contains("broadcastStatus=upcoming") -> upcoming
                m == "GET" && u.contains("videos?part=snippet,status") -> video
                m == "POST" && u.contains("liveBroadcasts?part=snippet,status,contentDetails") -> """{"id":"new1"}"""
                // Studio's live for the key, as YouTube gives it: a monitor (its preview), auto-start off, the bound stream told
                u.contains("liveBroadcasts?part=contentDetails&id=studio") -> """{"items":[{"id":"studio","contentDetails":{"boundStreamId":"s-ours",
                    "boundStreamLastUpdateTimeMs":"1762655000000","monitorStream":{"enableMonitorStream":true,"broadcastStreamDelayMs":0,"embedHtml":"<iframe/>"},
                    "enableEmbed":true,"enableDvr":true,"recordFromStart":true,"enableClosedCaptions":false,"closedCaptionsType":"closedCaptionsDisabled",
                    "enableContentEncryption":false,"startWithSlate":false,"enableAutoStart":false,"enableAutoStop":true,"enableLowLatency":false,
                    "latencyPreference":"normal","projection":"rectangular"}}]}"""
                u.contains("liveBroadcasts?part=snippet,status,contentDetails&id=ours") -> """{"items":[{"id":"ours","snippet":{"title":"Ours","liveChatId":"c-ours"},
                    "status":{"lifeCycleStatus":"testing"},"contentDetails":{"boundStreamId":"s-ours","monitorStream":{"enableMonitorStream":true}}}]}"""
                else -> "{}"
            }
        }
    }

    @After fun reset() { YouTubeApi.transport = null }

    private fun lastPut() = calls.last { it.first == "PUT" }

    @Test fun theBroadcastIsTheOneOurKeyGoesTo() {
        fake()
        val api = YouTubeApi("c", "s", "r")
        val sid = api.streamIdForKey("kkkk-2222")
        assertEquals("s-ours", sid)
        val b = api.currentBroadcast(sid)!!
        assertEquals("never the old scheduled event", "ours", b.videoId)
        assertEquals("testing", b.lifeCycle)
        assertTrue(!b.isLive && b.monitor)
        // without our key: only a broadcast that is live now (none here)
        assertNull(api.currentBroadcast(null))
        // going live is asked of YouTube like «Go live» in Studio
        api.transition("ours", "live")
        assertTrue(calls.last().second.contains("liveBroadcasts/transition?broadcastStatus=live&id=ours"))
    }

    @Test fun aLiveIsMadeForOurKeyWhenThereIsNone() {
        fake()
        val api = YouTubeApi("c", "s", "r")
        assertEquals("new1", api.createBroadcast("s-ours", "VIL3N <live>", "", "unlisted", false))
        val ins = calls.first { it.first == "POST" && it.second.contains("liveBroadcasts?part=snippet,status,contentDetails") }
        val j = JSONObject(ins.third!!)
        assertEquals("goes live by itself when the picture arrives", true, j.getJSONObject("contentDetails").getBoolean("enableAutoStart"))
        assertEquals(false, j.getJSONObject("contentDetails").getJSONObject("monitorStream").getBoolean("enableMonitorStream"))
        assertEquals("viewers keep a few seconds in hand: no stalls", "normal", j.getJSONObject("contentDetails").getString("latencyPreference"))
        assertEquals("unlisted", j.getJSONObject("status").getString("privacyStatus"))
        assertEquals("VIL3N live", j.getJSONObject("snippet").getString("title"))
        assertTrue("tied to our stream", calls.last().second.contains("liveBroadcasts/bind?id=new1&streamId=s-ours"))
    }

    @Test fun onlyWhatChangesIsSentToTheVideo() {
        fake()
        val api = YouTubeApi("c", "s", "r")
        // private + gaming + new tags: one update, everything else as it was
        val changed = api.updateVideo("v1", YouTubeApi.VideoChange(privacy = "private", category = "20", tags = listOf("pubg", "delta force"), embeddable = false))
        assertEquals(setOf("privacy", "category", "tags", "embed"), changed)
        assertTrue(lastPut().second.contains("videos?part=snippet,status"))
        val v = JSONObject(lastPut().third!!)
        val vs = v.getJSONObject("snippet")
        assertEquals("T", vs.getString("title")); assertEquals("D", vs.getString("description"))
        assertEquals("20", vs.getString("categoryId")); assertEquals("fa", vs.getString("defaultAudioLanguage"))
        assertEquals(listOf("pubg", "delta force"), (0 until vs.getJSONArray("tags").length()).map { vs.getJSONArray("tags").getString(it) })
        val vt = v.getJSONObject("status")
        assertEquals("private", vt.getString("privacyStatus")); assertEquals(false, vt.getBoolean("embeddable"))
        assertEquals("youtube", vt.getString("license")); assertEquals(true, vt.getBoolean("publicStatsViewable"))
        assertEquals(false, vt.getBoolean("selfDeclaredMadeForKids"))
        assertTrue("no broadcast (schedule) update", calls.none { it.first == "PUT" && it.second.contains("liveBroadcasts") })
        // a title alone: only the snippet; «<>» taken out (YouTube refuses them)
        api.updateVideo("v1", YouTubeApi.VideoChange(title = "VIL3N <live>"))
        assertTrue(lastPut().second.endsWith("videos?part=snippet"))
        assertEquals("VIL3N live", JSONObject(lastPut().third!!).getJSONObject("snippet").getString("title"))
        // the same as YouTube has: nothing sent at all
        val puts = calls.count { it.first == "PUT" }
        assertEquals(emptySet<String>(), api.updateVideo("v1", YouTubeApi.VideoChange(title = "T", privacy = "unlisted", category = "24")))
        assertEquals(puts, calls.count { it.first == "PUT" })
    }

    @Test fun tagsFitYouTubesLimit() {
        val f = YouTubeApi.fitTags((1..300).map { "tag number $it" } + listOf("<bad>"))
        assertTrue(f.sumOf { it.length + 2 } + f.size <= 501)
        assertTrue(f.isNotEmpty() && f.none { it.contains('<') })
    }

    /** 4.4: lives waiting on our key are found (the stream must feed only one), unbinding keeps them on the channel. */
    @Test fun livesWaitingOnOurKeyAreFoundAndCanBeLetGo() {
        fake()
        val api = YouTubeApi("c", "s", "r")
        assertEquals(listOf("ours"), api.boundTo("s-ours").map { it.videoId })
        api.unbind("old")
        val u = calls.last()
        assertEquals("POST", u.first)
        assertTrue("let go of the stream, not deleted", u.second.contains("liveBroadcasts/bind?id=old") && !u.second.contains("streamId"))
    }

    /** 4.6: the live YouTube holds back is started by itself from now on: its settings go back as they were, only auto-start changes. */
    @Test fun autoStartIsTurnedOnWithoutTouchingTheRest() {
        fake()
        val api = YouTubeApi("c", "s", "r")
        assertTrue(api.setAutoStart("studio"))
        val put = lastPut()
        assertTrue(put.second.endsWith("liveBroadcasts?part=contentDetails"))
        val j = JSONObject(put.third!!)
        assertEquals("studio", j.getString("id"))
        val cd = j.getJSONObject("contentDetails")
        assertEquals(true, cd.getBoolean("enableAutoStart"))
        assertEquals("the preview stays", true, cd.getJSONObject("monitorStream").getBoolean("enableMonitorStream"))
        assertEquals("normal", cd.getString("latencyPreference")); assertEquals(true, cd.getBoolean("enableDvr")); assertEquals(true, cd.getBoolean("enableAutoStop"))
        for (k in listOf("boundStreamId", "boundStreamLastUpdateTimeMs", "enableContentEncryption", "enableLowLatency", "enableClosedCaptions"))
            assertTrue("$k is YouTube's to tell, not ours to send", !cd.has(k))
        assertTrue(!cd.getJSONObject("monitorStream").has("embedHtml"))
        // the live read afresh for each step
        val b = api.broadcast("ours")!!
        assertEquals("testing", b.lifeCycle); assertTrue(b.monitor)
    }

    /** 4.7: the stream goes to the app's own stream on the channel (made once, then found again): never Studio's waiting live. */
    @Test fun theAppsOwnStreamIsMadeOnceAndFoundAgain() {
        fake()
        val api = YouTubeApi("c", "s", "r")
        val made = api.ownStream()
        val ins = calls.last { it.first == "POST" && it.second.contains("liveStreams?part=snippet,cdn,contentDetails") }
        val j = JSONObject(ins.third!!)
        assertEquals("RawRec", j.getJSONObject("snippet").getString("title"))
        assertEquals("variable", j.getJSONObject("cdn").getString("resolution")); assertEquals("variable", j.getJSONObject("cdn").getString("frameRate"))
        assertEquals("rtmp", j.getJSONObject("cdn").getString("ingestionType"))
        assertEquals(true, j.getJSONObject("contentDetails").getBoolean("isReusable"))
        assertEquals("s-new", made.id); assertEquals("new-3333", made.key); assertEquals("rtmps://a.rtmps.youtube.com/live2", made.url)
        // made before: found, not made again
        calls.clear(); fake(ownStream = true)
        val found = YouTubeApi("c", "s", "r").ownStream()
        assertEquals("s-own", found.id); assertEquals("own-1111", found.key)
        assertTrue("nothing made", calls.none { it.first == "POST" && it.second.contains("liveStreams") })
    }

    /** 4.6: step by step to live — never given up on, never a wrong step. */
    @Test fun theStepsToLive() {
        assertEquals("loose: bound first", GoLive.BIND, GoLive.step("created", false))
        assertEquals("a monitor (Studio's preview): testing first", GoLive.TESTING, GoLive.step("ready", true))
        assertEquals("no monitor: straight to live", GoLive.LIVE, GoLive.step("ready", false))
        assertEquals(GoLive.LIVE, GoLive.step("testing", true))
        assertNull("YouTube between stages: wait", GoLive.step("testStarting", true))
        assertNull(GoLive.step("liveStarting", false))
        assertNull(GoLive.step("live", false)); assertNull(GoLive.step("complete", false))
        // YouTube said «invalidTransition»: the other way round
        assertEquals(GoLive.LIVE, GoLive.step("ready", true, flip = true))
        assertEquals(GoLive.TESTING, GoLive.step("ready", false, flip = true))
        // tried again at 5 s, 10, 20, 40, a minute; five minutes after ten refusals or with no right to do it
        assertEquals(listOf(5_000L, 10_000L, 20_000L, 40_000L, 60_000L, 60_000L), (1..6).map { GoLive.retryMs(it) })
        assertEquals(300_000L, GoLive.retryMs(10)); assertEquals(300_000L, GoLive.retryMs(1, "forbidden"))
        assertEquals(300_000L, GoLive.retryMs(2, "insufficientPermissions"))
    }

    /** 4.6: of several lives waiting on the key, the one meant for now stays — not next week's event. */
    @Test fun theLiveMeantForNowIsKept() {
        val now = GoLive.parse("2026-11-09T02:12:30Z")!!
        val lives = listOf("week" to "2026-11-16T18:00:00Z", "studio" to "2026-11-09T02:12:05.000Z", "old" to "2026-05-10T19:55:00Z", "none" to null)
        assertEquals("studio", GoLive.nearest(lives, { it.second }, now)!!.first)
        assertEquals("the stamp parsed", 1794190350000L, now)
        assertNull(GoLive.parse("soon"))
        assertNull(GoLive.nearest(emptyList<Pair<String, String?>>(), { it.second }, now))
    }
}
