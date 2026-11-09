package com.vil3ntec.rawrec

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * YouTube Data API v3 for the live stream: sign-in, the live broadcast, chat (read, send, delete,
 * time-out), viewers, likes, subscribers.
 *
 * Sign-in is Google's «device» flow: RawRec shows a short code, the owner enters it at
 * google.com/device (on this phone or any other), and RawRec gets a refresh token — no browser
 * inside the app, no extra Google library. It needs an OAuth client of type «TVs and Limited Input
 * devices» from the owner's own Google Cloud project (YouTube Data API v3 enabled); its id and
 * secret are entered once in the app.
 *
 * Every call is a plain HTTPS request; a 401 refreshes the access token once and retries.
 */
class YouTubeApi(
    private val clientId: String, private val clientSecret: String, var refreshToken: String,
    /** Quota units each call costs (Google's table: chat list 5, send/delete 20, ban 200, other reads 1). */
    private val spend: (Int) -> Unit = {},
) {

    class DeviceCode(val deviceCode: String, val userCode: String, val url: String, val intervalS: Int, val expiresS: Int)
    class Broadcast(
        val videoId: String, val chatId: String, val title: String,
        /** The stream's picture on YouTube (its thumbnail), the stream it is bound to, and what an update must carry. */
        val thumb: String? = null, val streamId: String? = null, val scheduled: String? = null, val description: String = "",
        /** Who can watch it (public / unlisted / private) and whether it is marked as made for kids. */
        val privacy: String = "", val kids: Boolean? = null,
        /** YouTube's stage: created, ready, testing, liveStarting, live, complete… */
        val lifeCycle: String = "",
        /** It goes live by itself when the picture arrives (a scheduled event may wait for «Go live»). */
        val autoStart: Boolean = true,
        /** It is first shown to the owner only (testing) before going live. */
        val monitor: Boolean = false,
    ) {
        val isLive: Boolean get() = lifeCycle == "live" || lifeCycle == "liveStarting"
    }
    class ChatItem(
        val id: String, val type: String, val authorId: String, val author: String, val text: String,
        val isOwner: Boolean, val isMod: Boolean, val isMember: Boolean, val amount: String?, val tier: String?,
        /** messageDeletedEvent: the message that was removed. */
        val deletedId: String? = null,
        /** membershipGiftingEvent: how many memberships were gifted. */
        val gifts: Int = 0,
    )
    class ChatPage(val items: List<ChatItem>, val next: String?, val pollMs: Long)
    class Sub(val channelId: String, val name: String)

    companion object {
        /** YouTube takes tags up to 500 characters in all (a tag with a space counts its quotes). */
        fun fitTags(tags: List<String>): List<String> {
            val out = ArrayList<String>()
            var n = 0
            for (t in tags.map { it.trim().replace(Regex("[<>]"), "") }.filter { it.isNotEmpty() }.distinct()) {
                val cost = t.length + (if (t.contains(' ')) 2 else 0) + (if (out.isEmpty()) 0 else 1)
                if (n + cost > 500) break
                out += t; n += cost
            }
            return out
        }

        const val SCOPE = "https://www.googleapis.com/auth/youtube"
        private const val API = "https://www.googleapis.com/youtube/v3/"

        fun startDevice(clientId: String): DeviceCode {
            val j = post("https://oauth2.googleapis.com/device/code", mapOf("client_id" to clientId, "scope" to SCOPE))
            return DeviceCode(j.getString("device_code"), j.getString("user_code"),
                j.optString("verification_url", j.optString("verification_uri", "https://www.google.com/device")),
                j.optInt("interval", 5), j.optInt("expires_in", 1800))
        }

        /** What [pollDevice] gives when Google asks to ask less often (wait 5 s longer from now on). */
        const val SLOW_DOWN = "slow_down"

        /** Polls once: the refresh token when the owner has approved, null while waiting; throws when refused. */
        fun pollDevice(clientId: String, secret: String, deviceCode: String): String? {
            return try {
                val j = post("https://oauth2.googleapis.com/token", mapOf(
                    "client_id" to clientId, "client_secret" to secret, "device_code" to deviceCode,
                    "grant_type" to "urn:ietf:params:oauth:grant-type:device_code"))
                j.optString("refresh_token").ifBlank { null } ?: throw IOException("no refresh token")
            } catch (e: HttpError) {
                val err = try { JSONObject(e.body).optString("error") } catch (_: Exception) { "" }
                when (err) {
                    "authorization_pending" -> null
                    "slow_down" -> SLOW_DOWN
                    else -> throw IOException(err.ifBlank { e.message })
                }
            }
        }

        class HttpError(val code: Int, val body: String) : IOException("HTTP $code: ${body.take(300)}") {
            /** Google's reason, e.g. quotaExceeded, liveChatEnded, liveChatNotFound, forbidden. */
            val reason: String get() = try {
                JSONObject(body).optJSONObject("error")?.optJSONArray("errors")?.optJSONObject(0)?.optString("reason") ?: ""
            } catch (_: Exception) { "" }
        }

        private fun post(url: String, form: Map<String, String>): JSONObject =
            JSONObject(http("POST", url, form.entries.joinToString("&") { enc(it.key) + "=" + enc(it.value) }, "application/x-www-form-urlencoded", null))

        private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

        fun httpBytes(method: String, url: String, body: ByteArray, type: String, token: String): String {
            val c = URL(url).openConnection() as HttpURLConnection
            c.requestMethod = method
            c.connectTimeout = 15_000
            c.readTimeout = 60_000
            c.setRequestProperty("Authorization", "Bearer $token")
            c.doOutput = true
            c.setRequestProperty("Content-Type", type)
            c.setFixedLengthStreamingMode(body.size)
            c.outputStream.use { it.write(body) }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            c.disconnect()
            if (code !in 200..299) throw HttpError(code, text)
            return text
        }

        /** Tests: answers in place of Google (method, url, body → response). */
        @Volatile internal var transport: ((String, String, String?) -> String)? = null

        fun http(method: String, url: String, body: String?, type: String?, token: String?): String {
            transport?.let { return it(method, url, body) }
            val c = URL(url).openConnection() as HttpURLConnection
            c.requestMethod = method
            c.connectTimeout = 15_000
            c.readTimeout = 20_000
            if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", type ?: "application/json")
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            c.disconnect()
            if (code !in 200..299) throw HttpError(code, text)
            return text
        }
    }

    private var access: String? = null
    private var accessUntil = 0L

    private fun token(): String {
        val a = access
        if (a != null && System.currentTimeMillis() < accessUntil) return a
        val j = post("https://oauth2.googleapis.com/token", mapOf(
            "client_id" to clientId, "client_secret" to clientSecret, "refresh_token" to refreshToken, "grant_type" to "refresh_token"))
        access = j.getString("access_token")
        accessUntil = System.currentTimeMillis() + (j.optLong("expires_in", 3600) - 120) * 1000
        return access!!
    }

    private fun call(method: String, path: String, body: JSONObject? = null, units: Int = 1): String {
        spend(units)
        return try {
            http(method, API + path, body?.toString(), "application/json", token())
        } catch (e: HttpError) {
            if (e.code != 401) throw e
            access = null
            http(method, API + path, body?.toString(), "application/json", token())
        }
    }

    private fun get(path: String, units: Int = 1) = JSONObject(call("GET", path, null, units))

    /** The signed-in channel's name (for the settings page). */
    fun channelTitle(): String =
        get("channels?part=snippet&mine=true").optJSONArray("items")?.optJSONObject(0)?.optJSONObject("snippet")?.optString("title") ?: ""

    /** The id of the channel's stream that takes [key] (the «stream key» RawRec sends to), or null. */
    fun streamIdForKey(key: String): String? {
        val k = key.trim().substringBefore('?')
        if (k.isEmpty()) return null
        val items = get("liveStreams?part=id,cdn&mine=true&maxResults=50").optJSONArray("items") ?: return null
        for (i in 0 until items.length()) {
            val st = items.getJSONObject(i)
            if (st.optJSONObject("cdn")?.optJSONObject("ingestionInfo")?.optString("streamName") == k) return st.optString("id").ifBlank { null }
        }
        return null
    }

    /** Whether YouTube receives the picture on stream [id] («active») and how well. */
    fun streamStatus(id: String): Pair<String, String?> {
        val st = get("liveStreams?part=status&id=${enc(id)}").optJSONArray("items")?.optJSONObject(0)?.optJSONObject("status")
        return (st?.optString("streamStatus") ?: "") to st?.optJSONObject("healthStatus")?.optString("status")?.ifBlank { null }
    }

    private fun parse(b: JSONObject): Broadcast? {
        val sn = b.getJSONObject("snippet")
        val chat = sn.optString("liveChatId")
        val th = sn.optJSONObject("thumbnails")
        val thumb = listOf("maxres", "standard", "high", "medium", "default").firstNotNullOfOrNull { th?.optJSONObject(it)?.optString("url")?.ifBlank { null } }
        val st = b.optJSONObject("status")
        val cd = b.optJSONObject("contentDetails")
        return Broadcast(b.getString("id"), chat, sn.optString("title"), thumb,
            cd?.optString("boundStreamId")?.ifBlank { null },
            sn.optString("scheduledStartTime").ifBlank { sn.optString("actualStartTime").ifBlank { null } },
            sn.optString("description"), st?.optString("privacyStatus") ?: "",
            if (st?.has("selfDeclaredMadeForKids") == true) st.optBoolean("selfDeclaredMadeForKids") else null,
            st?.optString("lifeCycleStatus") ?: "",
            cd?.optBoolean("enableAutoStart", true) ?: true,
            cd?.optJSONObject("monitorStream")?.optBoolean("enableMonitorStream", false) ?: false)
    }

    /**
     * The broadcast this stream goes to: the one bound to the stream that takes our key (live first,
     * then one waiting for the picture); without a key, only one that is live now. Never an old
     * scheduled event that merely happens to be «upcoming» on the channel.
     */
    fun currentBroadcast(streamId: String? = null): Broadcast? {
        val all = notOver()
        if (streamId != null) {
            val mine = all.filter { it.streamId == streamId && it.lifeCycle != "complete" && it.lifeCycle != "revoked" }
            (mine.firstOrNull { it.isLive } ?: mine.firstOrNull { it.lifeCycle == "testing" || it.lifeCycle == "testStarting" }
                ?: mine.firstOrNull { it.lifeCycle == "ready" })?.let { return it }
        }
        return all.firstOrNull { it.isLive && it.chatId.isNotBlank() }
    }

    /** The channel's lives that are live now or still to come. */
    private fun notOver(): List<Broadcast> {
        val all = ArrayList<Broadcast>()
        for (status in listOf("active", "upcoming")) {
            val items = get("liveBroadcasts?part=snippet,status,contentDetails&broadcastType=all&broadcastStatus=$status&maxResults=25").optJSONArray("items") ?: continue
            for (i in 0 until items.length()) parse(items.getJSONObject(i))?.let { all += it }
        }
        return all
    }

    /** Every live bound to stream [streamId] that is not over (several = the stream may feed the wrong one). */
    fun boundTo(streamId: String): List<Broadcast> =
        notOver().filter { it.streamId == streamId && it.lifeCycle != "complete" && it.lifeCycle != "revoked" }

    /** The live no longer takes the stream (it stays on the channel as it is; 50 units). */
    fun unbind(id: String) { call("POST", "liveBroadcasts/bind?id=${enc(id)}&part=id,contentDetails", null, 50) }

    /**
     * A new live on the channel, bound to stream [streamId] (the one our key goes to): it goes live by
     * itself as soon as the picture arrives (100 units). Returns its id.
     */
    fun createBroadcast(streamId: String, title: String, description: String, privacy: String, kids: Boolean?, autoStart: Boolean = true): String {
        val now = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date())
        val st = JSONObject().put("privacyStatus", privacy)
        if (kids != null) st.put("selfDeclaredMadeForKids", kids)
        val body = JSONObject()
            .put("snippet", JSONObject().put("title", title.replace("<", "").replace(">", "").take(100)).put("description", description.take(5000)).put("scheduledStartTime", now))
            .put("status", st)
            .put("contentDetails", JSONObject().put("enableAutoStart", autoStart).put("enableAutoStop", true).put("enableDvr", true)
                // normal latency: the viewers' players keep a few seconds in hand, so a slow patch is never a stall
                .put("latencyPreference", "normal")
                .put("monitorStream", JSONObject().put("enableMonitorStream", false)))
        val id = JSONObject(call("POST", "liveBroadcasts?part=snippet,status,contentDetails", body, 50)).getString("id")
        call("POST", "liveBroadcasts/bind?id=${enc(id)}&streamId=${enc(streamId)}&part=id,contentDetails", null, 50)
        return id
    }

    /** Moves the broadcast to [to] (testing / live), as «Go live» in YouTube Studio does (50 units). */
    fun transition(id: String, to: String) {
        call("POST", "liveBroadcasts/transition?broadcastStatus=${enc(to)}&id=${enc(id)}&part=status", null, 50)
    }

    fun chat(chatId: String, page: String?): ChatPage {
        val j = get("liveChat/messages?liveChatId=${enc(chatId)}&part=snippet,authorDetails&maxResults=200" + (page?.let { "&pageToken=${enc(it)}" } ?: ""), 5)
        return ChatPage(parseChat(j.optJSONArray("items") ?: JSONArray()), j.optString("nextPageToken").ifBlank { null },
            j.optLong("pollingIntervalMillis", 5000).coerceIn(2000, 30000))
    }

    fun send(chatId: String, text: String) {
        call("POST", "liveChat/messages?part=snippet", JSONObject().put("snippet", JSONObject()
            .put("liveChatId", chatId).put("type", "textMessageEvent")
            .put("textMessageDetails", JSONObject().put("messageText", text.take(200)))), 20)
    }

    fun delete(messageId: String) { call("DELETE", "liveChat/messages?id=${enc(messageId)}", null, 20) }

    /**
     * A live that never went out: taken off the channel (50 units) — only while YouTube still has it
     * waiting (created / ready / testing); one that went live, even for a moment, is never touched.
     */
    fun deleteIfNeverLive(id: String): Boolean {
        val st = get("liveBroadcasts?part=status&id=${enc(id)}").optJSONArray("items")?.optJSONObject(0)
            ?.optJSONObject("status")?.optString("lifeCycleStatus") ?: return false
        if (st !in listOf("created", "ready", "testStarting", "testing")) return false
        call("DELETE", "liveBroadcasts?id=${enc(id)}", null, 50)
        return true
    }

    /** [seconds] 0 = permanent ban. */
    fun ban(chatId: String, channelId: String, seconds: Int) {
        val s = JSONObject().put("liveChatId", chatId).put("type", if (seconds > 0) "temporary" else "permanent")
            .put("bannedUserDetails", JSONObject().put("channelId", channelId))
        if (seconds > 0) s.put("banDurationSeconds", seconds)
        call("POST", "liveChat/bans?part=snippet", JSONObject().put("snippet", s), 200)
    }

    /**
     * How YouTube receives the picture: «good», «ok», «bad», «noData» (Google's words), or null
     * when the stream is not known.
     */
    fun streamHealth(streamId: String): String? =
        get("liveStreams?part=status&id=${enc(streamId)}").optJSONArray("items")?.optJSONObject(0)
            ?.optJSONObject("status")?.optJSONObject("healthStatus")?.optString("status")?.ifBlank { null }

    /** What the owner chose for the video; null = as YouTube has it. */
    class VideoChange(
        val title: String? = null, val description: String? = null, val privacy: String? = null, val kids: Boolean? = null,
        val category: String? = null, val tags: List<String>? = null, val embeddable: Boolean? = null,
    )

    /**
     * The live video's title, description, who can watch it, «made for kids», category, tags and
     * embedding — on the video itself (the broadcast's schedule is never touched). Reads the video
     * first (1 unit) and sends one update (50 units) only when something differs; everything not
     * chosen is sent back as it was. Returns what changed.
     */
    fun updateVideo(videoId: String, c: VideoChange): Set<String> {
        val v = get("videos?part=snippet,status&id=${enc(videoId)}").optJSONArray("items")?.optJSONObject(0)
            ?: throw IllegalStateException("video not found")
        val sn = v.optJSONObject("snippet") ?: JSONObject()
        val st = v.optJSONObject("status") ?: JSONObject()
        fun clean(t: String) = t.replace("<", "").replace(">", "")
        val changed = LinkedHashSet<String>()
        val title = c.title?.let { clean(it).take(100) }?.takeIf { it.isNotBlank() && it != sn.optString("title") }?.also { changed += "title" } ?: sn.optString("title")
        val desc = c.description?.let { clean(it).take(5000) }?.takeIf { it != sn.optString("description") }?.also { changed += "description" } ?: sn.optString("description")
        val cat = c.category?.takeIf { it != sn.optString("categoryId") }?.also { changed += "category" } ?: sn.optString("categoryId").ifBlank { "20" }
        val oldTags = sn.optJSONArray("tags")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
        val tags = c.tags?.let { fitTags(it) }?.takeIf { it != oldTags }?.also { changed += "tags" } ?: oldTags
        val privacy = c.privacy?.takeIf { it != st.optString("privacyStatus") }?.also { changed += "privacy" } ?: st.optString("privacyStatus").ifBlank { "public" }
        val oldKids = if (st.has("selfDeclaredMadeForKids")) st.optBoolean("selfDeclaredMadeForKids") else null
        val kids = c.kids?.takeIf { it != oldKids }?.also { changed += "kids" } ?: oldKids
        val embed = c.embeddable?.takeIf { it != st.optBoolean("embeddable", true) }?.also { changed += "embed" } ?: st.optBoolean("embeddable", true)
        if (changed.isEmpty()) return changed
        val parts = ArrayList<String>()
        val body = JSONObject().put("id", videoId)
        if (changed.any { it in listOf("title", "description", "category", "tags") }) {
            parts += "snippet"
            val s2 = JSONObject().put("title", title).put("description", desc).put("categoryId", cat)
            if (tags.isNotEmpty()) s2.put("tags", JSONArray(tags))
            for (k in listOf("defaultLanguage", "defaultAudioLanguage")) sn.optString(k).ifBlank { null }?.let { s2.put(k, it) }
            body.put("snippet", s2)
        }
        if (changed.any { it in listOf("privacy", "kids", "embed") }) {
            parts += "status"
            val s3 = JSONObject().put("privacyStatus", privacy).put("embeddable", embed)
            st.optString("license").ifBlank { null }?.let { s3.put("license", it) }
            if (st.has("publicStatsViewable")) s3.put("publicStatsViewable", st.optBoolean("publicStatsViewable"))
            if (kids != null) s3.put("selfDeclaredMadeForKids", kids)
            body.put("status", s3)
        }
        call("PUT", "videos?part=" + parts.joinToString(","), body, 50)
        return changed
    }

    /** The stream's thumbnail (a JPEG up to 2 MB; 50 units). YouTube allows it on verified channels only. */
    fun setThumbnail(videoId: String, jpeg: ByteArray) {
        val url = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${enc(videoId)}"
        spend(50)
        try { httpBytes("POST", url, jpeg, "image/jpeg", token()) }
        catch (e: HttpError) { if (e.code != 401) throw e; access = null; httpBytes("POST", url, jpeg, "image/jpeg", token()) }
    }

    /** Concurrent viewers and likes of the live video. */
    fun videoStats(videoId: String): Pair<Long, Long> {
        val it = get("videos?part=liveStreamingDetails,statistics&id=${enc(videoId)}").optJSONArray("items")?.optJSONObject(0)
            ?: return 0L to 0L
        val viewers = it.optJSONObject("liveStreamingDetails")?.optString("concurrentViewers")?.toLongOrNull() ?: 0L
        val likes = it.optJSONObject("statistics")?.optString("likeCount")?.toLongOrNull() ?: 0L
        return viewers to likes
    }

    /** The channel's subscriber count (YouTube rounds it publicly, e.g. 1.23K). */
    fun subscriberCount(): Long =
        get("channels?part=statistics&mine=true").optJSONArray("items")?.optJSONObject(0)
            ?.optJSONObject("statistics")?.optString("subscriberCount")?.toLongOrNull() ?: 0L

    /** The latest subscribers whose subscription is public, newest first. */
    fun recentSubscribers(): List<Sub> {
        val items = get("subscriptions?part=subscriberSnippet&myRecentSubscribers=true&maxResults=20").optJSONArray("items") ?: return emptyList()
        return (0 until items.length()).mapNotNull { i ->
            val s = items.getJSONObject(i).optJSONObject("subscriberSnippet") ?: return@mapNotNull null
            Sub(s.optString("channelId"), s.optString("title"))
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun parseChat(a: JSONArray): List<ChatItem> = (0 until a.length()).map { i ->
        val m = a.getJSONObject(i)
        val sn = m.optJSONObject("snippet") ?: JSONObject()
        val au = m.optJSONObject("authorDetails") ?: JSONObject()
        val type = sn.optString("type")
        val sc = sn.optJSONObject("superChatDetails") ?: sn.optJSONObject("superStickerDetails")
        val member = sn.optJSONObject("newSponsorDetails") ?: sn.optJSONObject("memberMilestoneChatDetails")
        ChatItem(
            id = m.optString("id"), type = type, authorId = au.optString("channelId"), author = au.optString("displayName"),
            text = sn.optString("displayMessage").ifBlank { sc?.optString("userComment") ?: "" },
            isOwner = au.optBoolean("isChatOwner"), isMod = au.optBoolean("isChatModerator"), isMember = au.optBoolean("isChatSponsor"),
            amount = sc?.optString("amountDisplayString")?.ifBlank { null },
            tier = member?.optString("memberLevelName")?.ifBlank { null },
            deletedId = sn.optJSONObject("messageDeletedDetails")?.optString("deletedMessageId")?.ifBlank { null },
            gifts = sn.optJSONObject("membershipGiftingDetails")?.optInt("giftMembershipsCount") ?: 0,
        )
    }
}
