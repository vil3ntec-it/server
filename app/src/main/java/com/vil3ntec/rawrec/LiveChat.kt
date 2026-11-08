package com.vil3ntec.rawrec

import android.content.Context
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import kotlin.random.Random

/**
 * The live chat while streaming: YouTube (read, send, delete, time-out; viewers, likes, subscriber
 * count and new subscribers by name) and Twitch (read only). Runs on its own threads; everything
 * reaches the service through [Listener] (any thread).
 *
 * YouTube's daily allowance (10 000 units, reading the chat costs 5 each time) decides the pace:
 * the chat is read as often as YouTube allows, but never faster than what keeps the allowance for
 * three more hours of streaming, with a reserve kept for the owner's own messages and moderation.
 */
class LiveChat(private val ctx: Context, private val l: Listener) {

    enum class Kind { CHAT, SUPER, MEMBER, GIFT, SUB, CHEER, RAID }
    enum class Platform { YOUTUBE, TWITCH }

    class Msg(
        val id: String, val platform: Platform, val authorId: String, val author: String, val text: String,
        val kind: Kind, val amount: String?, val owner: Boolean, val mod: Boolean, val member: Boolean,
        /** Old messages that were in the chat before RawRec joined: shown, but no alert and no bot. */
        val history: Boolean,
    ) {
        val canModerate: Boolean get() = platform == Platform.YOUTUBE && !owner
    }

    class Stats(val viewers: Long, val likes: Long, val subs: Long)

    /** What the «زنده» page shows about the stream on YouTube. */
    data class YtInfo(val videoId: String, val title: String, val thumb: String?, val health: String?)

    interface Listener {
        fun onMessage(m: Msg)
        fun onDeleted(id: String)
        /** A new subscriber; [name] null when only the count went up (subscription not public). */
        fun onSubscriber(name: String?)
        fun onStats(s: Stats)
        /** A short line about the state of each chat, null = fine. */
        fun onState(youtube: String?, twitch: String?)
        /** An action (send, delete, time-out) failed. */
        fun onActionFailed(text: String)
        /** The YouTube stream: found, or its title / health / picture changed. */
        fun onBroadcast(info: YtInfo) {}
        /** Something the owner should know (title or thumbnail set or refused). */
        fun onNote(text: String) {}
    }

    private val yt: YouTubeApi? = LiveExtras.youTube(ctx)
    private val twChannel = LiveExtras.twChannel(ctx)
    val hasYouTube get() = yt != null
    val hasTwitch get() = twChannel.isNotEmpty()

    @Volatile private var running = false
    @Volatile var chatId: String? = null; private set
    @Volatile private var videoId: String? = null
    @Volatile private var bc: YouTubeApi.Broadcast? = null
    @Volatile var ytInfo: YtInfo? = null; private set
    private var health: String? = null
    @Volatile private var ytState: String? = null
    @Volatile private var twState: String? = null
    private var threads = ArrayList<Thread>()
    @Volatile private var twSocket: Socket? = null
    private val actions: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "rawrec-chat-act") }

    @Volatile var viewers = -1L; private set
    @Volatile var likes = -1L; private set
    @Volatile var subs = -1L; private set
    @Volatile var messages = 0; private set
    @Volatile var newSubs = 0; private set

    /** True when messages can be sent (YouTube chat found). */
    val canSend: Boolean get() = yt != null && chatId != null

    fun start() {
        if (running) return
        running = true
        if (yt != null) { ytState = ctx.getString(R.string.chat_yt_looking); threads += Thread({ ytLoop(yt) }, "rawrec-chat-yt").apply { start() } }
        if (twChannel.isNotEmpty()) { twState = ctx.getString(R.string.chat_tw_joining); threads += Thread({ twLoop() }, "rawrec-chat-tw").apply { start() } }
        state()
    }

    fun stop() {
        running = false
        try { twSocket?.close() } catch (_: Exception) {}
        for (t in threads) t.interrupt()
        threads.clear()
        actions.shutdownNow()
    }

    // ------------------------------------------------------------ actions (YouTube)

    fun send(text: String) {
        val api = yt ?: return
        val chat = chatId ?: return
        val t = text.trim().take(200)
        if (t.isEmpty()) return
        act(R.string.chat_f_send, 20) { api.send(chat, t) }
    }

    fun delete(m: Msg) {
        val api = yt ?: return
        if (!m.canModerate || m.id.isEmpty()) return
        act(R.string.chat_f_delete, 20) { api.delete(m.id) }
    }

    /** [seconds] 0 = ban for good. */
    fun timeout(m: Msg, seconds: Int) {
        val api = yt ?: return
        val chat = chatId ?: return
        if (!m.canModerate || m.authorId.isEmpty()) return
        act(R.string.chat_f_ban, 200) { api.ban(chat, m.authorId, seconds) }
    }

    /** For the bot's time-outs, by channel id. */
    fun timeout(authorId: String, seconds: Int) {
        val api = yt ?: return
        val chat = chatId ?: return
        act(R.string.chat_f_ban, 200) { api.ban(chat, authorId, seconds) }
    }

    fun deleteId(id: String) {
        val api = yt ?: return
        act(R.string.chat_f_delete, 20) { api.delete(id) }
    }

    private fun act(what: Int, units: Int, block: () -> Unit) {
        if (LiveExtras.Quota.left(ctx) < units) { l.onActionFailed(ctx.getString(R.string.chat_quota_out)); return }
        try {
            actions.execute {
                try { block() } catch (e: YouTubeApi.Companion.HttpError) {
                    if (quotaGone(e)) LiveExtras.Quota.exhaust(ctx)
                    l.onActionFailed(ctx.getString(what) + " — " + friendly(e))
                } catch (e: Exception) {
                    l.onActionFailed(ctx.getString(what) + " — " + (e.message ?: e.javaClass.simpleName))
                }
            }
        } catch (_: Exception) {}
    }

    // ------------------------------------------------------------ YouTube

    private fun ytLoop(api: YouTubeApi) {
        var page: String? = null
        var first = true
        var nextStats = 0L
        var nextSubs = 0L
        val startedAt = System.currentTimeMillis()
        var knownSubs: HashSet<String>? = null
        var maxSubs = -1L
        while (running) {
            try {
                if (LiveExtras.Quota.left(ctx) < RESERVE) {
                    setYt(ctx.getString(R.string.chat_quota_out))
                    sleep(60_000); continue
                }
                if (chatId == null) {
                    val b = api.currentBroadcast()
                    if (b == null) {
                        setYt(ctx.getString(R.string.chat_yt_looking))
                        sleep(if (System.currentTimeMillis() - startedAt < 120_000) 10_000 else 30_000); continue
                    }
                    chatId = b.chatId; videoId = b.videoId; bc = b
                    page = null; first = true
                    setYt(null)
                    publish()
                    applyOwnerChoices(api, b)
                }
                val now = System.currentTimeMillis()
                if (now >= nextStats) {
                    nextStats = now + 30_000
                    videoId?.let { v -> val (a, b) = api.videoStats(v); viewers = a; likes = b }
                    l.onStats(Stats(viewers, likes, subs))
                    bc?.streamId?.let { sid -> val h = try { api.streamHealth(sid) } catch (_: Exception) { null }; if (h != health) { health = h; publish() } }
                }
                if (now >= nextSubs) {
                    nextSubs = now + 60_000
                    val count = api.subscriberCount()
                    val recent = api.recentSubscribers()
                    var named = 0
                    val known = knownSubs
                    if (known == null) knownSubs = recent.map { it.channelId }.toHashSet()
                    else for (s in recent.reversed()) if (known.add(s.channelId)) { named++; newSubs++; l.onSubscriber(s.name) }
                    // Small channels: YouTube gives the exact count, so a rise without a public name is still thanked.
                    if (maxSubs in 0 until count && count < 1000 && named == 0) {
                        repeat(((count - maxSubs).toInt()).coerceAtMost(3)) { newSubs++; l.onSubscriber(null) }
                    }
                    if (count > maxSubs) maxSubs = count
                    subs = count
                    l.onStats(Stats(viewers, likes, subs))
                }
                val chat = chatId ?: continue
                val p = api.chat(chat, page)
                page = p.next
                for (it in p.items) dispatch(it, first)
                first = false
                sleep(pace(p.pollMs))
            } catch (e: YouTubeApi.Companion.HttpError) {
                when {
                    quotaGone(e) -> { LiveExtras.Quota.exhaust(ctx); setYt(ctx.getString(R.string.chat_quota_out)) }
                    e.reason in listOf("liveChatEnded", "liveChatNotFound", "liveChatDisabled") -> {
                        chatId = null; page = null; first = true
                        setYt(ctx.getString(R.string.chat_yt_ended))
                    }
                    e.body.contains("invalid_grant") -> {
                        setYt(ctx.getString(R.string.chat_yt_signin_again))
                        LiveExtras.setYtToken(ctx, null)
                        return
                    }
                    e.reason == "rateLimitExceeded" -> {}
                    else -> setYt(ctx.getString(R.string.chat_yt_error_fmt, friendly(e)))
                }
                sleep(30_000)
            } catch (_: InterruptedException) {
                return
            } catch (e: IOException) {
                setYt(ctx.getString(R.string.chat_net))
                sleep(10_000)
            } catch (e: Exception) {
                setYt(ctx.getString(R.string.chat_yt_error_fmt, e.message ?: e.javaClass.simpleName))
                sleep(30_000)
            }
        }
    }

    private fun publish() {
        val b = bc ?: return
        ytInfo = YtInfo(b.videoId, b.title, b.thumb, health)
        l.onBroadcast(ytInfo!!)
    }

    /**
     * The title and thumbnail the owner chose in the app, set on this stream once (each costs 50
     * of the day's units). A thumbnail needs a verified YouTube channel: YouTube's refusal is shown.
     */
    private fun applyOwnerChoices(api: YouTubeApi, b: YouTubeApi.Broadcast) {
        val p = ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)
        val title = LiveExtras.ytTitle(ctx)
        if (title.isNotBlank() && title != b.title) {
            try {
                api.setTitle(b, title)
                bc = YouTubeApi.Broadcast(b.videoId, b.chatId, title, b.thumb, b.streamId, b.scheduled, b.description)
                publish()
                l.onNote(ctx.getString(R.string.yt_title_set_fmt, title))
            } catch (e: Exception) {
                l.onNote(ctx.getString(R.string.yt_title_failed_fmt, (e as? YouTubeApi.Companion.HttpError)?.let { friendly(it) } ?: e.message ?: ""))
            }
        }
        val thumb = LiveExtras.ytThumbFile(ctx)
        val stamp = "${b.videoId}:${thumb?.lastModified()}"
        if (thumb != null && SafePrefs.str(p, "yt_thumb_done") != stamp) {
            try {
                api.setThumbnail(b.videoId, thumb.readBytes())
                p.edit().putString("yt_thumb_done", stamp).apply()
                l.onNote(ctx.getString(R.string.yt_thumb_set))
            } catch (e: Exception) {
                val why = (e as? YouTubeApi.Companion.HttpError)?.let { if (it.code == 403) ctx.getString(R.string.yt_thumb_verify) else friendly(it) } ?: e.message ?: ""
                l.onNote(ctx.getString(R.string.yt_thumb_failed_fmt, why))
            }
        }
    }

    /** As often as YouTube asks, but slow enough that the allowance lasts [HORIZON_S] more seconds. */
    private fun pace(serverMs: Long): Long {
        val left = (LiveExtras.Quota.left(ctx) - RESERVE).coerceAtLeast(1)
        val needMs = 5L * HORIZON_S * 1000 / left
        return maxOf(serverMs, needMs).coerceIn(2_000, 60_000)
    }

    private fun dispatch(c: YouTubeApi.ChatItem, history: Boolean) {
        val kind = when (c.type) {
            "textMessageEvent" -> Kind.CHAT
            "superChatEvent", "superStickerEvent" -> Kind.SUPER
            "newSponsorEvent", "memberMilestoneChatEvent" -> Kind.MEMBER
            "membershipGiftingEvent" -> Kind.GIFT
            "messageDeletedEvent" -> { c.deletedId?.let { l.onDeleted(it) }; return }
            "chatEndedEvent" -> { chatId = null; setYt(ctx.getString(R.string.chat_yt_ended)); return }
            else -> return
        }
        val amount = when (kind) { Kind.SUPER -> c.amount; Kind.MEMBER -> c.tier; Kind.GIFT -> c.gifts.toString(); else -> null }
        messages++
        l.onMessage(Msg(c.id, Platform.YOUTUBE, c.authorId, c.author, c.text, kind, amount, c.isOwner, c.isMod, c.isMember, history))
    }

    private fun setYt(s: String?) { if (ytState != s) { ytState = s; state() } }
    private fun setTw(s: String?) { if (twState != s) { twState = s; state() } }
    private fun state() = l.onState(if (yt != null) ytState else null, if (twChannel.isNotEmpty()) twState else null)

    // ------------------------------------------------------------ Twitch (read only)

    private fun twLoop() {
        var backoff = 2_000L
        while (running) {
            var sock: SSLSocket? = null
            try {
                val raw = Socket()
                raw.connect(InetSocketAddress(TwitchIrc.HOST, TwitchIrc.PORT), 10_000)
                sock = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(raw, TwitchIrc.HOST, TwitchIrc.PORT, true) as SSLSocket
                sock.sslParameters = sock.sslParameters.apply { endpointIdentificationAlgorithm = "HTTPS" }
                sock.soTimeout = 400_000   // Twitch pings about every five minutes
                sock.startHandshake()
                twSocket = sock
                val out = sock.outputStream
                write(out, TwitchIrc.hello(twChannel, 10_000 + Random.nextInt(89_999)))
                val rd = BufferedReader(InputStreamReader(sock.inputStream, Charsets.UTF_8))
                var first = true
                while (running) {
                    val line = rd.readLine() ?: break
                    val ev = TwitchIrc.parse(line)?.let { TwitchIrc.event(it) } ?: continue
                    when (ev) {
                        is TwitchIrc.Ev.Ping -> write(out, "PONG :${ev.arg}\r\n")
                        is TwitchIrc.Ev.Reconnect -> break
                        is TwitchIrc.Ev.Joined -> { setTw(null); backoff = 2_000L; first = false }
                        is TwitchIrc.Ev.Notice -> if (ev.id.startsWith("msg_channel_suspended") || ev.id == "msg_banned")
                            setTw(ctx.getString(R.string.chat_tw_problem_fmt, ev.text))
                        is TwitchIrc.Ev.Deleted -> l.onDeleted(ev.id)
                        is TwitchIrc.Ev.Msg -> {
                            val kind = when (ev.kind) { "cheer" -> Kind.CHEER; "sub" -> Kind.SUB; "gift" -> Kind.GIFT; "raid" -> Kind.RAID; else -> Kind.CHAT }
                            messages++
                            l.onMessage(Msg(ev.id, Platform.TWITCH, ev.authorId, ev.author, ev.text, kind, ev.amount, ev.owner, ev.mod, ev.member, first))
                        }
                    }
                }
            } catch (_: InterruptedException) {
                return
            } catch (_: Exception) {
                if (!running) return
                setTw(ctx.getString(R.string.chat_net))
            } finally {
                try { sock?.close() } catch (_: Exception) {}
                twSocket = null
            }
            if (!running) return
            if (!sleep(backoff)) return
            backoff = (backoff * 2).coerceAtMost(60_000)
        }
    }

    private fun write(out: OutputStream, s: String) { out.write(s.toByteArray(Charsets.UTF_8)); out.flush() }

    /** False when interrupted (stopping). */
    private fun sleep(ms: Long): Boolean = try { Thread.sleep(ms); true } catch (_: InterruptedException) { running = false; false }

    private fun quotaGone(e: YouTubeApi.Companion.HttpError) = e.reason == "quotaExceeded" || e.reason == "dailyLimitExceeded"

    private fun friendly(e: YouTubeApi.Companion.HttpError): String = when {
        e.reason == "forbidden" || e.reason == "insufficientPermissions" -> ctx.getString(R.string.chat_e_forbidden)
        quotaGone(e) -> ctx.getString(R.string.chat_quota_out)
        e.reason.isNotEmpty() -> e.reason
        else -> "HTTP ${e.code}"
    }

    companion object {
        /** Units kept back for the owner's messages and moderation. */
        const val RESERVE = 600
        /** The allowance is spread over this many more seconds of streaming. */
        const val HORIZON_S = 3 * 3600L
    }
}
