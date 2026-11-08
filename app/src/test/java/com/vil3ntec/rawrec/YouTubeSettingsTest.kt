package com.vil3ntec.rawrec

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What RawRec sends YouTube for the video's settings: only what changes, nothing else wiped. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class YouTubeSettingsTest {
    private val calls = ArrayList<Triple<String, String, String?>>()

    private fun fake() {
        YouTubeApi.transport = { m, u, b ->
            calls += Triple(m, u, b)
            when {
                u.contains("oauth2.googleapis.com/token") -> """{"access_token":"t","expires_in":3600}"""
                m == "GET" && u.contains("videos?part=snippet,status") -> """{"items":[{"id":"v1","snippet":{"title":"T","description":"D",
                    "categoryId":"24","tags":["old"],"defaultAudioLanguage":"fa"},"status":{"privacyStatus":"unlisted","license":"youtube",
                    "publicStatsViewable":true,"embeddable":true,"selfDeclaredMadeForKids":false}}]}"""
                else -> "{}"
            }
        }
    }

    @After fun reset() { YouTubeApi.transport = null }

    private fun lastPut() = calls.last { it.first == "PUT" }

    @Test fun whoCanWatchAndTheRest() {
        fake()
        val api = YouTubeApi("c", "s", "r")
        val b = YouTubeApi.Broadcast("v1", "chat", "Old title", null, null, "2026-11-08T10:00:00Z", "Old desc", "public", false)
        // private: only the status part, «made for kids» kept as it was
        val nb = api.updateBroadcast(b, null, null, "private", null)
        assertTrue(lastPut().second.contains("liveBroadcasts?part=status"))
        val st = JSONObject(lastPut().third!!).getJSONObject("status")
        assertEquals("private", st.getString("privacyStatus"))
        assertEquals(false, st.getBoolean("selfDeclaredMadeForKids"))
        assertFalse("the title is not touched", JSONObject(lastPut().third!!).has("snippet"))
        assertEquals("private", nb.privacy)
        // a new title keeps the description and the start time
        api.updateBroadcast(nb, "New", null, null, null)
        val sn = JSONObject(lastPut().third!!).getJSONObject("snippet")
        assertEquals("New", sn.getString("title"))
        assertEquals("Old desc", sn.getString("description"))
        assertEquals("2026-11-08T10:00:00Z", sn.getString("scheduledStartTime"))
        // category, tags, embedding: everything else as it was
        api.updateVideo("v1", "20", listOf("pubg", "delta force"), false)
        assertTrue(lastPut().second.contains("videos?part=snippet,status"))
        val v = JSONObject(lastPut().third!!)
        val vs = v.getJSONObject("snippet")
        assertEquals("T", vs.getString("title")); assertEquals("D", vs.getString("description"))
        assertEquals("20", vs.getString("categoryId")); assertEquals("fa", vs.getString("defaultAudioLanguage"))
        assertEquals(listOf("pubg", "delta force"), (0 until vs.getJSONArray("tags").length()).map { vs.getJSONArray("tags").getString(it) })
        val vt = v.getJSONObject("status")
        assertEquals("unlisted", vt.getString("privacyStatus")); assertEquals(false, vt.getBoolean("embeddable"))
        assertEquals("youtube", vt.getString("license")); assertEquals(true, vt.getBoolean("publicStatsViewable"))
        assertEquals(false, vt.getBoolean("selfDeclaredMadeForKids"))
        // nothing chosen: nothing sent
        val before = calls.size
        api.updateVideo("v1", null, null, null)
        assertEquals(before, calls.size)
    }

    @Test fun tagsFitYouTubesLimit() {
        val f = YouTubeApi.fitTags((1..300).map { "tag number $it" } + listOf("<bad>"))
        assertTrue(f.sumOf { it.length + 2 } + f.size <= 501)
        assertTrue(f.isNotEmpty() && f.none { it.contains('<') })
    }
}
