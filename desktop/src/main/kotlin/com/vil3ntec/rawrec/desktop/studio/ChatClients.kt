package com.vil3ntec.rawrec.desktop.studio

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.WebSocket
import java.time.Duration
import java.util.concurrent.CompletionStage
import java.util.concurrent.atomic.AtomicBoolean

/** One platform's chat, read without the owner's password: what viewers write, pay and give. */
abstract class ChatClient(val platform: Platform, val channel: String) : AutoCloseable {
    @Volatile var status: String = "در حالِ وصل شدن…"; protected set
    @Volatile var connected = false; protected set
    @Volatile var received = 0L; protected set
    protected val running = AtomicBoolean(true)
    protected val http: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build()
    protected fun emit(m: ChatMessage) { received++; ChatHub.add(m) }
    abstract fun start()
    override fun close() { running.set(false) }

    companion object {
        const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    }
}

// =====================================================================================  YouTube

/**
 * YouTube's live chat read the way youtube.com's own page reads it — not through the Data API, so no
 * daily quota is spent at all (the phone app's 10 000 units a day ran out). Super Chats, Super
 * Stickers, new members and gifted memberships come as alerts. Accepts a channel (@name or link) —
 * its current live is found — or a video link/ID.
 */
class YouTubeChat(channel: String) : ChatClient(Platform.YOUTUBE, channel) {
    private var thread: Thread? = null
    /** For checks: the last answer of the chat endpoint. */
    @Volatile var lastHttp = 0; private set
    @Volatile var lastBody: String? = null; private set

    override fun start() { thread = Thread({ run() }, "chat-youtube").apply { isDaemon = true; start() } }

    private fun get(url: String): String = http.send(HttpRequest.newBuilder(URI(url)).header("User-Agent", UA).header("Accept-Language", "en-US,en;q=0.9")
        .header("Cookie", "CONSENT=YES+1; SOCS=CAI").timeout(Duration.ofSeconds(15)).GET().build(), HttpResponse.BodyHandlers.ofString()).body()

    private fun run() {
        while (running.get()) {
            try {
                // a channel: its current live video; then that video's own chat page (or the live page itself, when
                // YouTube shows the chat there but hides the video's address — it does to some networks)
                val chanPage = if (videoId(channel) == null) get(watchUrl(channel)) else null
                val vid = videoId(channel) ?: chanPage?.let(::liveVideoOf)
                if (vid == null && chanPage?.contains("liveChatRenderer") != true) { status = "پخشِ زنده‌ای در این کانال پیدا نشد (هنوز شروع نشده؟)"; connected = false; sleep(20_000); continue }
                val popout = vid?.let { get("https://www.youtube.com/live_chat?is_popout=1&v=$it") }?.takeIf { it.contains("INNERTUBE_API_KEY") }
                val page = popout ?: chanPage
                if (page == null) { status = "صفحهٔ چتِ این پخش باز نشد"; connected = false; sleep(20_000); continue }
                if (System.getProperty("rawrec.debugChat") == "1") println("youtube: video=$vid chat page=${if (popout != null) "popout" else "channel live page"}")
                val key = Regex("\"INNERTUBE_API_KEY\":\"([^\"]+)\"").find(page)?.groupValues?.get(1)
                val ver = Regex("\"INNERTUBE_CLIENT_VERSION\":\"([^\"]+)\"").find(page)?.groupValues?.get(1) ?: "2.20240101.00.00"
                val visitor = Regex("\"VISITOR_DATA\":\"([^\"]+)\"").find(page)?.groupValues?.get(1)
                var cont = initialData(page)?.let(::allChatContinuation)
                if (key == null || cont == null) { status = "چتِ این پخش بسته است یا پیدا نشد"; connected = false; sleep(20_000); continue }
                status = "وصل"; connected = true
                while (running.get() && cont != null) {
                    val client = JSONObject().put("clientName", "WEB").put("clientVersion", ver).put("hl", "en")
                    if (visitor != null) client.put("visitorData", visitor)
                    val body = JSONObject().put("context", JSONObject().put("client", client)).put("continuation", cont).toString()
                    val rb = HttpRequest.newBuilder(URI("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=$key&prettyPrint=false"))
                        .header("User-Agent", UA).header("Content-Type", "application/json").header("Origin", "https://www.youtube.com")
                        .header("X-Youtube-Client-Name", "1").header("X-Youtube-Client-Version", ver).timeout(Duration.ofSeconds(15))
                    if (visitor != null) rb.header("X-Goog-Visitor-Id", visitor)
                    val r = http.send(rb.POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString())
                    lastHttp = r.statusCode()
                    if (r.statusCode() != 200) { status = "یوتیوب پاسخ نداد (${r.statusCode()})"; lastBody = r.body().take(300); break }
                    val (msgs, next, wait) = parse(JSONObject(r.body()))
                    msgs.forEach(::emit)
                    cont = next
                    sleep(wait.coerceIn(1000, 8000))
                }
                connected = false
                if (running.get()) { if (lastHttp == 200 || lastHttp == 0) status = "پخش تمام شد یا قطع شد؛ دوباره می‌گردم…"; sleep(10_000) }
            } catch (e: InterruptedException) { return } catch (e: Exception) {
                connected = false; status = "اینترنت یا یوتیوب: ${e.message ?: e.javaClass.simpleName}"; sleep(10_000)
            }
        }
    }

    private fun sleep(ms: Long) { try { Thread.sleep(ms) } catch (_: InterruptedException) { running.set(false) } }

    override fun close() { super.close(); thread?.interrupt() }

    companion object {
        /** A video ID in what the owner typed (a watch/live/shorts/youtu.be link, or the bare ID); null for a channel. */
        fun videoId(s: String): String? {
            val t = s.trim()
            Regex("(?:v=|youtu\\.be/|/live/|/shorts/)([A-Za-z0-9_-]{11})").find(t)?.let { return it.groupValues[1] }
            return t.takeIf { Regex("^[A-Za-z0-9_-]{11}$").matches(it) }
        }

        /** A channel (handle, link, name) as its «live now» page. */
        fun watchUrl(s: String): String {
            val h = s.trim().removePrefix("https://").removePrefix("http://").removePrefix("www.").removePrefix("m.").removePrefix("youtube.com/").trimEnd('/')
                .removeSuffix("/live").removeSuffix("/streams").removeSuffix("/featured")
            val path = when { h.startsWith("@") || h.startsWith("channel/") || h.startsWith("c/") || h.startsWith("user/") -> h; else -> "@$h" }
            return "https://www.youtube.com/$path/live"
        }

        /** The video a channel's «live» page leads to, only when it is really live now. */
        fun liveVideoOf(page: String): String? {
            val id = Regex("<link rel=\"canonical\" href=\"https://www\\.youtube\\.com/watch\\?v=([A-Za-z0-9_-]{11})\"").find(page)?.groupValues?.get(1)
                ?: Regex("\"videoDetails\":\\{\"videoId\":\"([A-Za-z0-9_-]{11})\"").find(page)?.groupValues?.get(1)
                // the endpoint nests other objects ({"commandMetadata":{…}}) before its watchEndpoint, so look ahead a bounded stretch
                ?: Regex("\"currentVideoEndpoint\":\\{[\\s\\S]{0,1500}?\"videoId\":\"([A-Za-z0-9_-]{11})\"").find(page)?.groupValues?.get(1)
                ?: Regex("\"currentVideoEndpoint\":\\{[\\s\\S]{0,1500}?/watch\\?v=([A-Za-z0-9_-]{11})").find(page)?.groupValues?.get(1)
                ?: Regex("<meta itemprop=\"(?:videoId|identifier)\" content=\"([A-Za-z0-9_-]{11})\"").find(page)?.groupValues?.get(1)
                ?: return null
            return id.takeIf { page.contains("\"isLive\":true") || page.contains("\"isLiveNow\":true") || page.contains("liveChatRenderer") }
        }

        /** The page's own data (ytInitialData) as JSON. */
        fun initialData(page: String): JSONObject? {
            val m = Regex("(?:var ytInitialData|window\\[\"ytInitialData\"\\])\\s*=\\s*").find(page) ?: return null
            return try { org.json.JSONTokener(page.substring(m.range.last + 1)).nextValue() as? JSONObject } catch (_: Exception) { null }
        }

        private fun find(o: Any?, key: String): JSONObject? = when (o) {
            is JSONObject -> o.optJSONObject(key) ?: o.keySet().firstNotNullOfOrNull { find(o.opt(it), key) }
            is JSONArray -> (0 until o.length()).firstNotNullOfOrNull { find(o.opt(it), key) }
            else -> null
        }

        /**
         * Where every message starts: «Live chat» (everything), not the default «Top chat» (filtered);
         * the chat's own first continuation when the menu is missing.
         */
        fun allChatContinuation(data: JSONObject): String? {
            val lcr = find(data, "liveChatRenderer") ?: return null
            val items = find(lcr, "sortFilterSubMenuRenderer")?.optJSONArray("subMenuItems")
            if (items != null && items.length() > 0) {
                val pick = (0 until items.length()).map { items.getJSONObject(it) }
                    .firstOrNull { it.optString("title").contains("Live chat", true) && !it.optString("title").contains("Top", true) } ?: items.getJSONObject(items.length() - 1)
                pick.optJSONObject("continuation")?.optJSONObject("reloadContinuationData")?.optString("continuation")?.takeIf { it.isNotBlank() }?.let { return it }
            }
            val conts = lcr.optJSONArray("continuations") ?: return null
            if (conts.length() == 0) return null
            val k = conts.getJSONObject(0)
            val d = k.optJSONObject("invalidationContinuationData") ?: k.optJSONObject("timedContinuationData") ?: k.optJSONObject("reloadContinuationData")
            return d?.optString("continuation")?.takeIf { it.isNotBlank() }
        }

        /** Messages in a get_live_chat answer, the next continuation, and how long YouTube asks to wait. */
        fun parse(o: JSONObject): Triple<List<ChatMessage>, String?, Long> {
            val c = o.optJSONObject("continuationContents")?.optJSONObject("liveChatContinuation") ?: return Triple(emptyList(), null, 5000)
            val out = ArrayList<ChatMessage>()
            val acts = c.optJSONArray("actions") ?: JSONArray()
            for (i in 0 until acts.length()) {
                val item = acts.getJSONObject(i).optJSONObject("addChatItemAction")?.optJSONObject("item") ?: continue
                item(item)?.let(out::add)
            }
            var next: String? = null; var wait = 3000L
            val conts = c.optJSONArray("continuations")
            if (conts != null && conts.length() > 0) {
                val k = conts.getJSONObject(0)
                val d = k.optJSONObject("invalidationContinuationData") ?: k.optJSONObject("timedContinuationData") ?: k.optJSONObject("reloadContinuationData")
                next = d?.optString("continuation")?.takeIf { it.isNotBlank() }
                wait = d?.optLong("timeoutMs", 3000) ?: 3000
            }
            return Triple(out, next, wait)
        }

        private fun text(o: JSONObject?): String {
            if (o == null) return ""
            o.optString("simpleText").takeIf { it.isNotEmpty() }?.let { return it }
            val runs = o.optJSONArray("runs") ?: return ""
            val sb = StringBuilder()
            for (i in 0 until runs.length()) {
                val r = runs.getJSONObject(i)
                when {
                    r.has("text") -> sb.append(r.getString("text"))
                    r.has("emoji") -> {
                        val e = r.getJSONObject("emoji")
                        // a standard emoji's id is the character itself; a channel's own emoji keeps its :name:
                        val id = e.optString("emojiId")
                        if (id.isNotEmpty() && id.codePoints().allMatch { it > 0x2000 }) sb.append(id)
                        else sb.append(e.optJSONArray("shortcuts")?.optString(0) ?: "")
                    }
                }
            }
            return sb.toString()
        }

        private fun item(it: JSONObject): ChatMessage? {
            it.optJSONObject("liveChatTextMessageRenderer")?.let { r ->
                return ChatMessage(r.optString("id"), Platform.YOUTUBE, text(r.optJSONObject("authorName")), text(r.optJSONObject("message")))
            }
            it.optJSONObject("liveChatPaidMessageRenderer")?.let { r ->
                return ChatMessage(r.optString("id"), Platform.YOUTUBE, text(r.optJSONObject("authorName")), text(r.optJSONObject("message")),
                    ChatMessage.Kind.SUPERCHAT, text(r.optJSONObject("purchaseAmountText")))
            }
            it.optJSONObject("liveChatPaidStickerRenderer")?.let { r ->
                return ChatMessage(r.optString("id"), Platform.YOUTUBE, text(r.optJSONObject("authorName")), "Super Sticker",
                    ChatMessage.Kind.SUPERCHAT, text(r.optJSONObject("purchaseAmountText")))
            }
            it.optJSONObject("liveChatMembershipItemRenderer")?.let { r ->
                return ChatMessage(r.optString("id"), Platform.YOUTUBE, text(r.optJSONObject("authorName")),
                    text(r.optJSONObject("headerSubtext")).ifBlank { text(r.optJSONObject("message")) }, ChatMessage.Kind.MEMBER)
            }
            it.optJSONObject("liveChatSponsorshipsGiftPurchaseAnnouncementRenderer")?.let { r ->
                val h = r.optJSONObject("header")?.optJSONObject("liveChatSponsorshipsHeaderRenderer")
                return ChatMessage(r.optString("id"), Platform.YOUTUBE, text(h?.optJSONObject("authorName")), text(h?.optJSONObject("primaryText")), ChatMessage.Kind.GIFT)
            }
            return null
        }
    }
}

// =====================================================================================  Twitch

/** Twitch chat over its own IRC-over-WebSocket, logged in anonymously (read only): cheers (bits), subs, gifts, raids. */
class TwitchChat(channel: String) : ChatClient(Platform.TWITCH, channel.trim().removePrefix("https://").removePrefix("www.").removePrefix("twitch.tv/").trim('/').lowercase()) {
    private var ws: WebSocket? = null
    private val buf = StringBuilder()

    override fun start() { Thread({ loop() }, "chat-twitch").apply { isDaemon = true; start() } }

    private fun loop() {
        while (running.get()) {
            val done = java.util.concurrent.CompletableFuture<Unit>()
            try {
                ws = http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(10)).buildAsync(URI("wss://irc-ws.chat.twitch.tv:443"), object : WebSocket.Listener {
                    override fun onOpen(w: WebSocket) {
                        w.sendText("CAP REQ :twitch.tv/tags twitch.tv/commands", true)
                        w.sendText("NICK justinfan${(10000..99999).random()}", true)
                        w.sendText("JOIN #$channel", true)
                        status = "وصل"; connected = true
                        w.request(1)
                    }
                    override fun onText(w: WebSocket, data: CharSequence, last: Boolean): CompletionStage<*>? {
                        buf.append(data)
                        if (last) {
                            for (line in buf.split("\r\n")) if (line.isNotBlank()) {
                                if (line.startsWith("PING")) w.sendText("PONG :tmi.twitch.tv", true)
                                else parse(line)?.let(::emit)
                            }
                            buf.setLength(0)
                        }
                        w.request(1); return null
                    }
                    override fun onClose(w: WebSocket, code: Int, reason: String): CompletionStage<*>? { done.complete(Unit); return null }
                    override fun onError(w: WebSocket, error: Throwable) { status = "توییچ: ${error.message}"; done.complete(Unit) }
                }).get()
                done.get()
            } catch (_: Exception) {}
            connected = false
            if (running.get()) { status = "قطع شد؛ دوباره وصل می‌شوم…"; Thread.sleep(5000) }
        }
    }

    override fun close() { super.close(); ws?.sendClose(WebSocket.NORMAL_CLOSURE, "bye") }

    companion object {
        /** One IRC line → a message (PRIVMSG, with bits when cheered) or an event (USERNOTICE: sub, gift, raid). */
        fun parse(line: String): ChatMessage? {
            var rest = line
            val tags = HashMap<String, String>()
            if (rest.startsWith("@")) {
                val sp = rest.indexOf(' ')
                for (kv in rest.substring(1, sp).split(';')) { val e = kv.indexOf('='); if (e > 0) tags[kv.substring(0, e)] = unescape(kv.substring(e + 1)) }
                rest = rest.substring(sp + 1)
            }
            val parts = rest.split(' ', limit = 4)
            if (parts.size < 3) return null
            val cmd = parts[1]
            val text = parts.getOrNull(3)?.removePrefix(":") ?: ""
            val user = tags["display-name"]?.ifBlank { null } ?: parts[0].removePrefix(":").substringBefore('!')
            val color = tags["color"]?.takeIf { it.length == 7 }?.let { (0xFF000000 or it.substring(1).toLong(16)).toInt() }
            val id = tags["id"] ?: "${System.nanoTime()}"
            return when (cmd) {
                "PRIVMSG" -> {
                    val bits = tags["bits"]?.toIntOrNull()
                    val clean = if (text.startsWith("\u0001ACTION ")) text.removePrefix("\u0001ACTION ").removeSuffix("\u0001") else text
                    if (bits != null && bits > 0) ChatMessage(id, Platform.TWITCH, user, clean, ChatMessage.Kind.BITS, "$bits bits", color)
                    else ChatMessage(id, Platform.TWITCH, user, clean, authorColor = color)
                }
                "USERNOTICE" -> {
                    val kind = when (tags["msg-id"]) {
                        "sub", "resub" -> ChatMessage.Kind.MEMBER
                        "subgift", "submysterygift", "anonsubgift", "anonsubmysterygift" -> ChatMessage.Kind.GIFT
                        "raid" -> ChatMessage.Kind.RAID
                        else -> return null
                    }
                    ChatMessage(id, Platform.TWITCH, user, tags["system-msg"] ?: text, kind, null, color)
                }
                else -> null
            }
        }
        private fun unescape(v: String) = v.replace("\\s", " ").replace("\\:", ";").replace("\\\\", "\\").replace("\\r", "").replace("\\n", "")
    }
}

// =====================================================================================  Kick

/**
 * Kick's chat as kick.com itself reads it, no login. Kick names its realtime service at connect time
 * (web.kick.com/api/v1/realtime/connection): since October 2026 that is Centrifugo with a guest token, before it a Pusher
 * key that Kick rotates. Both are spoken here; the key is never hard-wired to one value.
 */
class KickChat(channel: String) : ChatClient(Platform.KICK, channel.trim().removePrefix("https://").removePrefix("www.").removePrefix("kick.com/").trim('/').lowercase().replace('_', '-')) {
    @Volatile private var ws: WebSocket? = null
    private var debugFrames = 0
    private val debug get() = System.getProperty("rawrec.debugChat") == "1"
    override fun start() { Thread({ loop() }, "chat-kick").apply { isDaemon = true; start() } }

    private fun post(url: String, body: JSONObject): HttpResponse<String> = http.send(HttpRequest.newBuilder(URI(url))
        .header("User-Agent", UA).header("Accept", "application/json").header("Content-Type", "application/json")
        .header("Origin", "https://kick.com").header("Referer", "https://kick.com/").timeout(Duration.ofSeconds(15))
        .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build(), HttpResponse.BodyHandlers.ofString())

    private fun chatroomId(): Long? {
        channel.toLongOrNull()?.let { return it }   // a chatroom number typed directly
        val r = http.send(HttpRequest.newBuilder(URI("https://kick.com/api/v2/channels/" + URLEncoder.encode(channel, "UTF-8")))
            .header("User-Agent", UA).header("Accept", "application/json").timeout(Duration.ofSeconds(15)).GET().build(), HttpResponse.BodyHandlers.ofString())
        if (r.statusCode() != 200) { status = "کیک اجازه نداد (${r.statusCode()}): شمارهٔ چت‌روم را به جای نام بنویس"; return null }
        return JSONObject(r.body()).optJSONObject("chatroom")?.optLong("id")
    }

    /** What Kick names for this client: ("centrifugo", url) or ("pusher", "key|cluster"); known fallbacks after. */
    private fun services(clientId: String): List<Pair<String, String>> {
        val out = ArrayList<Pair<String, String>>()
        try {
            val r = post("https://web.kick.com/api/v1/realtime/connection", JSONObject()
                .put("client", JSONObject().put("id", clientId).put("type", "web"))
                .put("capabilities", JSONObject().put("accepted_providers", JSONArray().put(JSONObject().put("provider", "centrifugo")).put(JSONObject().put("provider", "pusher")))))
            if (debug) println("kick realtime/connection ${r.statusCode()}: ${r.body().take(400)}")
            if (r.statusCode() == 200) {
                val conns = JSONObject(r.body()).optJSONObject("data")?.optJSONArray("connections") ?: JSONArray()
                for (i in 0 until conns.length()) {
                    val c = conns.getJSONObject(i); val cr = c.optJSONObject("credentials") ?: continue
                    when (c.optString("provider")) {
                        "centrifugo" -> cr.optString("url").takeIf { it.startsWith("wss://") }?.let { out.add("centrifugo" to it) }
                        "pusher" -> cr.optString("app_key").takeIf { it.isNotBlank() }?.let { out.add("pusher" to "$it|${cr.optString("cluster", "us2")}") }
                    }
                }
            }
        } catch (e: Exception) { if (debug) println("kick realtime/connection: ${e.message}") }
        out.add("centrifugo" to "wss://realtime.us-west-2.platform.kick.com")
        out.add("pusher" to "34bf7a0ff419a2a775b9|us2")
        return out.distinct()
    }

    private fun guestToken(clientId: String): Pair<String, Long>? {
        val r = post("https://web.kick.com/api/v1/realtime/auth/connection", JSONObject().put("client_id", clientId))
        if (debug) println("kick realtime/auth ${r.statusCode()}: ${r.body().take(120)}")
        if (r.statusCode() != 200) return null
        val d = JSONObject(r.body()).optJSONObject("data") ?: return null
        val t = d.optString("token").takeIf { it.isNotBlank() } ?: return null
        return t to d.optLong("ttl", 2700)
    }

    private fun loop() {
        var failures = 0
        while (running.get()) {
            try {
                val room = chatroomId()
                if (room == null) { Thread.sleep(30_000); continue }
                val clientId = java.util.UUID.randomUUID().toString()
                var ok = false
                for ((kind, where) in services(clientId)) {
                    if (!running.get()) return
                    ok = if (kind == "centrifugo") centrifugo(where, clientId, room) else pusher(where.substringBefore('|'), where.substringAfter('|'), room)
                    if (ok) break
                }
                failures = if (ok) 0 else failures + 1
                connected = false
                if (!ok) status = "کیک وصل نشد؛ دوباره امتحان می‌کنم…"
                if (running.get()) Thread.sleep(if (failures > 3) 120_000L else 5000L)
            } catch (_: InterruptedException) { return } catch (e: Exception) { connected = false; status = "کیک: ${e.message}"; Thread.sleep(10_000) }
        }
    }

    /** One Centrifugo session; true when it carried the chat (it ends when the connection does). */
    private fun centrifugo(url: String, clientId: String, room: Long): Boolean {
        val (token, ttl) = guestToken(clientId) ?: return false
        val done = java.util.concurrent.CompletableFuture<Boolean>()
        val sb = StringBuilder()
        var subscribed = false
        val refresher = java.util.concurrent.Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "kick-refresh").apply { isDaemon = true } }
        try {
            ws = http.newWebSocketBuilder().header("Origin", "https://kick.com").header("User-Agent", UA).buildAsync(URI(url), object : WebSocket.Listener {
                override fun onOpen(w: WebSocket) {
                    w.sendText(JSONObject().put("connect", JSONObject().put("token", token).put("name", "js")).put("id", 1).toString(), true)
                    w.sendText(JSONObject().put("subscribe", JSONObject().put("channel", "chatrooms.$room.v2")).put("id", 2).toString(), true)
                    w.request(1)
                }
                override fun onText(w: WebSocket, data: CharSequence, last: Boolean): CompletionStage<*>? {
                    sb.append(data)
                    if (last) {
                        val all = sb.toString(); sb.setLength(0)
                        for (line in all.split('\n')) {
                            val t = line.trim(); if (t.isEmpty()) continue
                            if (debug && debugFrames++ < 10) println("kick frame: ${t.take(400)}")
                            if (t == "{}") { w.sendText("{}", true); continue }      // the server's ping
                            val o = try { JSONObject(t) } catch (_: Exception) { continue }
                            o.optJSONObject("error")?.let { status = "کیک: ${it.optString("message")}"; if (!subscribed) { w.sendClose(WebSocket.NORMAL_CLOSURE, "error"); done.complete(false) } }
                            if (o.optInt("id") == 2 && o.has("subscribe")) { subscribed = true; status = "وصل"; connected = true }
                            if (o.optInt("id") == 1 && o.has("connect")) {
                                // a fresh guest token before this one runs out, on the same connection
                                val life = o.optJSONObject("connect")?.optLong("ttl", ttl)?.takeIf { it > 60 } ?: ttl
                                refresher.scheduleAtFixedRate({
                                    guestToken(clientId)?.let { (nt, _) -> ws?.sendText(JSONObject().put("refresh", JSONObject().put("token", nt)).put("id", 3).toString(), true) }
                                }, life * 3 / 4, life * 3 / 4, java.util.concurrent.TimeUnit.SECONDS)
                            }
                            val pub = o.optJSONObject("push")?.optJSONObject("pub")?.optJSONObject("data") ?: o.optJSONObject("pub")?.optJSONObject("data")
                            if (pub != null) parse(pub.toString())?.let(::emit)
                        }
                    }
                    w.request(1); return null
                }
                override fun onClose(w: WebSocket, code: Int, reason: String): CompletionStage<*>? { if (debug) println("kick closed $code $reason"); done.complete(subscribed); return null }
                override fun onError(w: WebSocket, error: Throwable) { status = "کیک: ${error.message}"; done.complete(subscribed) }
            }).get(20, java.util.concurrent.TimeUnit.SECONDS)
            return done.get()
        } catch (e: java.util.concurrent.ExecutionException) { if (debug) println("kick centrifugo: ${e.cause?.message}"); return false
        } finally { refresher.shutdownNow() }
    }

    /** One Pusher session with the key Kick named; false when the key is refused. */
    private fun pusher(key: String, cluster: String, room: Long): Boolean {
        val done = java.util.concurrent.CompletableFuture<Boolean>()
        val sb = StringBuilder()
        var good = false
        ws = http.newWebSocketBuilder().buildAsync(URI("wss://ws-$cluster.pusher.com/app/$key?protocol=7&client=js&version=8.4.0&flash=false"), object : WebSocket.Listener {
            override fun onOpen(w: WebSocket) {
                w.sendText(JSONObject().put("event", "pusher:subscribe").put("data", JSONObject().put("auth", "").put("channel", "chatrooms.$room.v2")).toString(), true)
                w.request(1)
            }
            override fun onText(w: WebSocket, data: CharSequence, last: Boolean): CompletionStage<*>? {
                sb.append(data)
                if (last) {
                    val t = sb.toString(); sb.setLength(0)
                    if (debug && debugFrames++ < 10) println("kick frame: ${t.take(300)}")
                    when {
                        t.contains("\"code\":4001") || t.contains("not in this cluster") -> { w.sendClose(WebSocket.NORMAL_CLOSURE, "next"); done.complete(false) }
                        t.contains("pusher_internal:subscription_succeeded") -> { good = true; status = "وصل"; connected = true }
                        t.contains("pusher:ping") -> w.sendText("{\"event\":\"pusher:pong\",\"data\":{}}", true)
                        else -> parse(t)?.let(::emit)
                    }
                }
                w.request(1); return null
            }
            override fun onClose(w: WebSocket, code: Int, reason: String): CompletionStage<*>? { done.complete(good); return null }
            override fun onError(w: WebSocket, error: Throwable) { status = "کیک: ${error.message}"; done.complete(good) }
        }).get(20, java.util.concurrent.TimeUnit.SECONDS)
        return done.get()
    }

    override fun close() { super.close(); ws?.sendClose(WebSocket.NORMAL_CLOSURE, "bye") }

    companion object {
        /** A push frame → a chat message, gift or new subscriber (the event's data is JSON, often itself in a string). */
        fun parse(frame: String): ChatMessage? = try {
            val o = JSONObject(frame)
            val ev = o.optString("event")
            val d = o.optJSONObject("data") ?: JSONObject(o.optString("data"))
            fun user(x: JSONObject?) = x?.optJSONObject("sender")?.optString("username")?.takeIf { it.isNotBlank() }
                ?: x?.optString("username")?.takeIf { it.isNotBlank() } ?: x?.optJSONObject("user")?.optString("username")?.takeIf { it.isNotBlank() }
            when {
                ev.endsWith("ChatMessageEvent") -> {
                    val s = d.optJSONObject("sender")
                    val col = s?.optJSONObject("identity")?.optString("color")?.takeIf { it.length == 7 }?.let { (0xFF000000 or it.substring(1).toLong(16)).toInt() }
                    // Kick's emotes come as [emote:ID:name]: the name is kept
                    val content = d.optString("content").replace(Regex("\\[emote:\\d+:([^\\]]+)]"), ":$1:")
                    ChatMessage(d.optString("id"), Platform.KICK, s?.optString("username") ?: "?", content, authorColor = col)
                }
                ev.endsWith("GiftedSubscriptionsEvent") -> ChatMessage(d.optString("chatroom_id") + System.nanoTime(), Platform.KICK,
                    d.optString("gifter_username").ifBlank { user(d) ?: "?" }, "${d.optJSONArray("gifted_usernames")?.length() ?: 1} اشتراکِ هدیه", ChatMessage.Kind.GIFT)
                ev.endsWith("SubscriptionEvent") -> ChatMessage("sub" + System.nanoTime(), Platform.KICK, user(d) ?: "?",
                    d.optInt("months", 1).let { if (it > 1) "$it ماه اشتراک" else "اشتراکِ تازه" }, ChatMessage.Kind.MEMBER)
                ev.contains("KicksGifted") -> {
                    val g = d.optJSONObject("gift")
                    val n = g?.optInt("amount") ?: d.optInt("amount")
                    ChatMessage("kicks" + System.nanoTime(), Platform.KICK, user(d) ?: "?", d.optString("message").ifBlank { g?.optString("name") ?: "" },
                        ChatMessage.Kind.GIFT, amount = if (n > 0) "$n Kicks" else null)
                }
                else -> null
            }
        } catch (_: Exception) { null }
    }
}
