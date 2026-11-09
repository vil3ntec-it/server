package com.vil3ntec.rawrec

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * «پخشِ زنده» settings. The stream key is a secret (anyone with it can stream on the owner's
 * channel): it is kept encrypted with a key from the phone's Android Keystore, never in plain text,
 * never in a log or a report.
 */
object LiveSettings {

    /**
     * A platform: its name, the server address it gives everyone (empty = it gives one per account),
     * and the most video bit rate it takes well (Mbps, 0 = no limit worth keeping to).
     */
    class Platform(val name: Int, val url: String, val help: Int, val maxMbps: Int = 0)

    val PLATFORMS = listOf(
        Platform(R.string.live_p_youtube, "rtmps://a.rtmps.youtube.com/live2", R.string.live_help_youtube),
        Platform(R.string.live_p_twitch, "rtmp://live.twitch.tv/app", R.string.live_help_twitch, 8),
        Platform(R.string.live_p_facebook, "rtmps://live-api-s.facebook.com:443/rtmp/", R.string.live_help_facebook, 9),
        Platform(R.string.live_p_kick, "", R.string.live_help_kick, 8),
        Platform(R.string.live_p_tiktok, "", R.string.live_help_tiktok, 6),
        Platform(R.string.live_p_other, "", R.string.live_help_other),
    )

    /** Quality: short side, frame rate, video Mbps. 1080p60 is what YouTube recommends for games. */
    class Quality(val label: Int, val res: Int, val fps: Int, val mbps: Int)

    val QUALITIES = listOf(
        // 4.0: what YouTube itself asks for a game in motion (9 Mbps at 1080p60 broke up into blocks)
        Quality(R.string.live_q_720, 720, 60, 7),
        Quality(R.string.live_q_1080, 1080, 60, 12),
        Quality(R.string.live_q_1080_30, 1080, 30, 8),
        Quality(R.string.live_q_1440, 1440, 60, 24),
    )

    /** The stream's bit rate when the owner picks one (Mbps; 0 = the quality's own). 51 = YouTube's most. */
    val LIVE_RATES = listOf(0, 6, 9, 12, 15, 20, 25, 30, 40, 51)
    fun liveRate(ctx: Context) = SafePrefs.int(prefs(ctx), "live_mbps", 0).takeIf { it in LIVE_RATES } ?: 0
    fun setLiveRate(ctx: Context, m: Int) = prefs(ctx).edit().putInt("live_mbps", m).apply()

    /** What the automatic rate settled at last time (kbps; 0 = not known): the next stream starts there, not at 6 Mbps. */
    fun lastRateKbps(ctx: Context) = SafePrefs.int(prefs(ctx), "live_last_kbps", 0)
    fun setLastRateKbps(ctx: Context, kbps: Int) = prefs(ctx).edit().putInt("live_last_kbps", kbps).apply()
    /** Where the automatic rate starts (bits a second): a fifth above last time's, between 800 kbps and 6 Mbps; 0 = unknown. */
    fun startBps(ctx: Context): Int = lastRateKbps(ctx).takeIf { it > 0 }?.let { (it * 1200L).coerceIn(800_000L, 6_000_000L).toInt() } ?: 0

    /**
     * The game left the screen («one app» shared, and another app in front): «برمی‌گردم» on the stream
     * (true) or the game's last picture stays (false, 4.1: the banner looked like the stream was broken).
     */
    fun awayBanner(ctx: Context) = SafePrefs.bool(prefs(ctx), "live_away_banner", false)
    fun setAwayBanner(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("live_away_banner", on).apply()

    // ---- Shorts (YouTube «Dual stream», Encoder): a 9:16 picture with the vertical stream key
    fun shortsOn(ctx: Context) = SafePrefs.bool(prefs(ctx), "shorts_on", false)
    fun setShortsOn(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("shorts_on", on).apply()
    fun shortsKey(ctx: Context): String = open(SafePrefs.str(prefs(ctx), "shorts_key"))
    fun setShortsKey(ctx: Context, key: String) {
        val e = prefs(ctx).edit()
        if (key.isBlank()) { e.remove("shorts_key").apply(); return }
        seal(key.trim())?.let { e.putString("shorts_key", it).apply() }
    }
    /** 0 = 720×1280 (cooler), 1 = 1080×1920. */
    fun shortsSize(ctx: Context) = SafePrefs.int(prefs(ctx), "shorts_size", 0).coerceIn(0, Shorts.SIZES.size - 1)
    /** The game in the tall picture: 0 top, 1 middle, 2 bottom. */
    fun shortsPlace(ctx: Context) = SafePrefs.int(prefs(ctx), "shorts_place", 1).coerceIn(0, 2)
    /** 0 the whole game, 1 bigger (sides cut), 2 the whole height. */
    fun shortsZoom(ctx: Context) = SafePrefs.int(prefs(ctx), "shorts_zoom", 0).coerceIn(0, 2)
    /** Above the game: 0 nothing, 1 the stream's title, 2 a picture. */
    fun shortsTop(ctx: Context) = SafePrefs.int(prefs(ctx), "shorts_top", 1).coerceIn(0, 2)
    /** The chat below the game. */
    fun shortsChat(ctx: Context) = SafePrefs.bool(prefs(ctx), "shorts_chat", true)
    fun setShortsInt(ctx: Context, k: String, v: Int) = prefs(ctx).edit().putInt(k, v).apply()
    fun setShortsChat(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("shorts_chat", on).apply()
    /** The tall picture's bit rate: YouTube's own advice for each size. */
    fun shortsBitrate(ctx: Context) = if (shortsSize(ctx) == 0) 4_500_000 else 8_000_000
    /** Shorts go out: switched on, a key given, and YouTube among the platforms. */
    fun shortsReady(ctx: Context) = shortsOn(ctx) && shortsKey(ctx).isNotBlank() && destinations(ctx).any { it.platform == 0 }

    /**
     * Automatic quality (on unless switched off): the rate follows what the internet carries, so the
     * stream never stops. Off: the chosen rate exactly — smooth only if the upload carries it.
     */
    fun autoQuality(ctx: Context) = SafePrefs.bool(prefs(ctx), "live_auto_quality", true)
    fun setAutoQuality(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("live_auto_quality", on).apply()

    /** Record on the phone while live too: the very same pictures (no second encoder, so no extra heat). */
    fun recordToo(ctx: Context) = SafePrefs.bool(prefs(ctx), "live_record", false)
    fun setRecordToo(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("live_record", on).apply()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)

    /** The platform open on the page (its address and key are edited there). */
    fun platform(ctx: Context) = SafePrefs.int(prefs(ctx), "live_platform", 0).coerceIn(0, PLATFORMS.size - 1)
    fun setPlatform(ctx: Context, i: Int) {
        // the switches as they are now are kept (until 3.6 the open platform was the one streamed to)
        val e = prefs(ctx).edit()
        for (p in PLATFORMS.indices) if (!prefs(ctx).contains("live_on_$p")) e.putBoolean("live_on_$p", isOn(ctx, p))
        e.putInt("live_platform", i).apply()
    }

    /** Streamed to: every platform switched on at once (the same picture and sound to each). */
    fun isOn(ctx: Context, p: Int) = SafePrefs.bool(prefs(ctx), "live_on_$p", p == platform(ctx))
    fun setOn(ctx: Context, p: Int, on: Boolean) {
        val e = prefs(ctx).edit()
        for (q in PLATFORMS.indices) if (!prefs(ctx).contains("live_on_$q")) e.putBoolean("live_on_$q", isOn(ctx, q))
        e.putBoolean("live_on_$p", on).apply()
    }

    class Dest(val platform: Int, val name: String, val url: String, val key: String)

    /** Where the stream goes: each platform switched on (the open one when none is). */
    fun destinations(ctx: Context): List<Dest> {
        val on = PLATFORMS.indices.filter { isOn(ctx, it) }.ifEmpty { listOf(platform(ctx)) }
        return on.map { Dest(it, ctx.getString(PLATFORMS[it].name), url(ctx, it), key(ctx, it)) }
    }

    /** What a failed connection means, in words the owner can act on. */
    fun whyText(ctx: Context, why: RtmpPublisher.Why?): String? = when (why) {
        RtmpPublisher.Why.DNS -> ctx.getString(R.string.live_why_dns)
        RtmpPublisher.Why.BLOCKED -> ctx.getString(R.string.live_why_blocked)
        RtmpPublisher.Why.UNREACHABLE -> ctx.getString(R.string.live_why_unreachable)
        RtmpPublisher.Why.PROXY -> ctx.getString(R.string.live_why_proxy)
        RtmpPublisher.Why.NOT_RTMP -> ctx.getString(R.string.live_why_not_rtmp)
        RtmpPublisher.Why.REJECTED -> ctx.getString(R.string.live_why_rejected)
        RtmpPublisher.Why.KEY -> ctx.getString(R.string.live_why_key)
        null -> null
    }

    /**
     * Why the stream is not reaching [name] now, or null while it is (or while it is still simply
     * connecting, the first [graceMs] after the start).
     */
    fun sendProblem(ctx: Context, s: RtmpSink.Status?, name: String, sinceStartMs: Long, graceMs: Long = 12_000L): String? {
        if (s?.state == RtmpSink.State.LIVE || s?.state == RtmpSink.State.ENDED) return null
        val why = whyText(ctx, s?.why) ?: if (s?.noPicture == true) ctx.getString(R.string.live_why_no_picture) else null
        if (why == null && sinceStartMs < graceMs) return null
        return ctx.getString(R.string.live_send_fmt, name, why ?: (s?.error ?: ctx.getString(R.string.live_s_connecting)))
    }

    /** How the stream goes, in words («از راهِ پراکسیِ گوشی» / «مستقیم»). */
    fun routeText(ctx: Context, route: String?): String =
        ctx.getString(if (route?.startsWith("proxy") == true) R.string.live_route_proxy else R.string.live_route_direct)

    /** The video bit rate every chosen platform takes (Mbps): the chosen quality, or less for Twitch / Kick… */
    fun mbps(ctx: Context): Int {
        val q = liveRate(ctx).takeIf { it > 0 } ?: QUALITIES[quality(ctx)].mbps
        val caps = destinations(ctx).map { PLATFORMS[it.platform].maxMbps }.filter { it > 0 }
        return if (caps.isEmpty()) q else minOf(q, caps.min())
    }
    fun url(ctx: Context, p: Int) = SafePrefs.str(prefs(ctx), "live_url_$p").ifBlank { PLATFORMS[p].url }
    fun setUrl(ctx: Context, p: Int, u: String) = prefs(ctx).edit().putString("live_url_$p", u.trim()).apply()
    fun quality(ctx: Context) = SafePrefs.int(prefs(ctx), "live_quality", 1).coerceIn(0, QUALITIES.size - 1)
    fun setQuality(ctx: Context, i: Int) = prefs(ctx).edit().putInt("live_quality", i).apply()
    fun teamVoice(ctx: Context) = SafePrefs.bool(prefs(ctx), "live_team", false)
    fun setTeamVoice(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("live_team", on).apply()
    fun mic(ctx: Context) = SafePrefs.bool(prefs(ctx), "live_mic", true)
    fun setMic(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("live_mic", on).apply()

    fun key(ctx: Context, p: Int): String = open(SafePrefs.str(prefs(ctx), "live_key_$p"))

    fun setKey(ctx: Context, p: Int, key: String) {
        val e = prefs(ctx).edit()
        if (key.isBlank()) { e.remove("live_key_$p").apply(); return }
        seal(key.trim())?.let { e.putString("live_key_$p", it).apply() }
    }

    /** [plain] encrypted with the phone's Keystore key (AES-GCM), as text; null when the Keystore fails. */
    fun seal(plain: String): String? = try {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, secret())
        val ct = c.doFinal(plain.toByteArray(Charsets.UTF_8))
        Base64.encodeToString(c.iv + ct, Base64.NO_WRAP)
    } catch (_: Exception) { null }

    /** The text [seal] made; "" when empty or not readable. */
    fun open(sealed: String): String = try {
        if (sealed.isBlank()) "" else {
            val all = Base64.decode(sealed, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, all, 0, 12))
            String(c.doFinal(all, 12, all.size - 12), Charsets.UTF_8)
        }
    } catch (_: Exception) { "" }

    private fun secret(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey("rawrec_live", null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder("rawrec_live", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
        return g.generateKey()
    }

    /** The recording settings turned into a live stream: H.264 (what every platform takes), steady bit rate. */
    fun config(ctx: Context, base: RecordConfig, micAllowed: Boolean): RecordConfig {
        val q = QUALITIES[quality(ctx)]
        val audio = when {
            base.audioMode == RecordConfig.AUDIO_NONE -> RecordConfig.AUDIO_NONE
            mic(ctx) && micAllowed -> RecordConfig.AUDIO_BOTH
            else -> RecordConfig.AUDIO_INTERNAL
        }
        return base.copy(
            preset = RecordConfig.PRESET_CUSTOM, codec = RecordConfig.CODEC_AVC, mode = RecordConfig.MODE_CBR,
            bitrate = mbps(ctx), fps = q.fps, resShort = q.res, orient = RecordConfig.ORIENT_LANDSCAPE,
            smartStart = false, rotateNewFile = false, ghostControl = false, invisibleControl = true,
            countdown = 0, testSeconds = 0, teamVoice = teamVoice(ctx), audioMode = audio,
        )
    }
}
