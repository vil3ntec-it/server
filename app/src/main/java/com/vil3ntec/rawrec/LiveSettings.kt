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
        Quality(R.string.live_q_720, 720, 60, 5),
        Quality(R.string.live_q_1080, 1080, 60, 9),
        Quality(R.string.live_q_1080_30, 1080, 30, 6),
        Quality(R.string.live_q_1440, 1440, 60, 15),
    )

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

    /** The video bit rate every chosen platform takes (Mbps): the chosen quality, or less for Twitch / Kick… */
    fun mbps(ctx: Context): Int {
        val q = QUALITIES[quality(ctx)].mbps
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
