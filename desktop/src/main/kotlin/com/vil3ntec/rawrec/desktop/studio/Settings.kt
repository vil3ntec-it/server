package com.vil3ntec.rawrec.desktop.studio

import com.vil3ntec.rawrec.desktop.AppPaths
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermission
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** A platform to go live on. The stream key is kept encrypted on disk ([Secrets]) and never shown or logged whole. */
data class Destination(
    val id: String, val platform: Platform, val name: String, val url: String,
    val keyEnc: String, val enabled: Boolean = true,
) {
    val key: String get() = Secrets.open(keyEnc) ?: ""
    /** "abcd••••wxyz": enough to recognise, never enough to use. */
    val keyHint: String get() = key.let { if (it.length <= 8) "••••" else it.take(4) + "••••" + it.takeLast(4) }

    companion object {
        /** Each platform's own ingest address (RTMPS where the platform has it). */
        fun defaultUrl(p: Platform) = when (p) {
            Platform.YOUTUBE -> "rtmps://a.rtmps.youtube.com/live2"
            Platform.TWITCH -> "rtmps://live.twitch.tv/app"
            Platform.KICK -> "rtmps://fa723fc1b171.global-contribute.live-video.net/app"
            Platform.TEST -> "rtmp://127.0.0.1/live"
        }
    }
}

/** Everything the window lets the owner choose, saved as JSON next to the studio. */
data class Settings(
    // the phone's picture over the cable
    val phoneCodec: String = "h265", val phoneMbps: Int = 40, val phoneSize: Int = 0, val phoneFps: Int = 60, val phoneAudio: Boolean = true,
    // recording
    val recEncoder: String = "", val recHeight: Int = 1080, val recKbps: Int = 16000, val recEnhance: Boolean = false,
    // live
    val liveEncoder: String = "", val liveKbps: Int = 6000, val dests: List<Destination> = emptyList(),
    // sound
    val mic: String = "", val micGain: Float = 1f, val phoneGain: Float = 1f,
    // chat
    val youtubeChannel: String = "", val twitchChannel: String = "", val kickChannel: String = "",
    val translateTo: String = "fa", val translate: Boolean = true,
    // sound, more
    val desktopDevice: String = "", val desktopGain: Float = 1f,
    val phoneFx: AudioFx = AudioFx(), val micFx: AudioFx = AudioFx(denoise = true, gate = true), val desktopFx: AudioFx = AudioFx(),
    val monitor: Boolean = false, val limiter: Boolean = true,
    // recording, more
    val replaySeconds: Int = 0, val splitMinutes: Int = 0,
) {
    fun toJson(): String = JSONObject().apply {
        put("phoneCodec", phoneCodec); put("phoneMbps", phoneMbps); put("phoneSize", phoneSize); put("phoneFps", phoneFps); put("phoneAudio", phoneAudio)
        put("recEncoder", recEncoder); put("recHeight", recHeight); put("recKbps", recKbps); put("recEnhance", recEnhance)
        put("liveEncoder", liveEncoder); put("liveKbps", liveKbps)
        put("dests", JSONArray(dests.map { d ->
            JSONObject().put("id", d.id).put("platform", d.platform.name).put("name", d.name).put("url", d.url).put("key", d.keyEnc).put("enabled", d.enabled)
        }))
        put("mic", mic); put("micGain", micGain.toDouble()); put("phoneGain", phoneGain.toDouble())
        put("youtubeChannel", youtubeChannel); put("twitchChannel", twitchChannel); put("kickChannel", kickChannel)
        put("translateTo", translateTo); put("translate", translate)
        put("desktopDevice", desktopDevice); put("desktopGain", desktopGain.toDouble())
        put("phoneFx", fxJ(phoneFx)); put("micFx", fxJ(micFx)); put("desktopFx", fxJ(desktopFx))
        put("monitor", monitor); put("limiter", limiter); put("replaySeconds", replaySeconds); put("splitMinutes", splitMinutes)
    }.toString(2)

    companion object {
        fun fxJ(f: AudioFx) = JSONObject().put("denoise", f.denoise).put("denoisePct", f.denoisePct).put("gate", f.gate).put("gateDb", f.gateDb.toDouble())
            .put("comp", f.comp).put("compDb", f.compDb.toDouble()).put("ratio", f.ratio.toDouble()).put("delayMs", f.delayMs)
        fun fxF(o: JSONObject?, d: AudioFx) = if (o == null) d else AudioFx(o.optBoolean("denoise", d.denoise), o.optInt("denoisePct", d.denoisePct),
            o.optBoolean("gate", d.gate), o.optDouble("gateDb", d.gateDb.toDouble()).toFloat(), o.optBoolean("comp", d.comp),
            o.optDouble("compDb", d.compDb.toDouble()).toFloat(), o.optDouble("ratio", d.ratio.toDouble()).toFloat(), o.optInt("delayMs", d.delayMs))

        fun fromJson(t: String): Settings {
            val o = JSONObject(t); val d = Settings()
            val ds = o.optJSONArray("dests") ?: JSONArray()
            return Settings(
                o.optString("phoneCodec", d.phoneCodec), o.optInt("phoneMbps", d.phoneMbps), o.optInt("phoneSize", d.phoneSize), o.optInt("phoneFps", d.phoneFps), o.optBoolean("phoneAudio", d.phoneAudio),
                o.optString("recEncoder", d.recEncoder), o.optInt("recHeight", d.recHeight), o.optInt("recKbps", d.recKbps), o.optBoolean("recEnhance", d.recEnhance),
                o.optString("liveEncoder", d.liveEncoder), o.optInt("liveKbps", d.liveKbps),
                (0 until ds.length()).mapNotNull { i ->
                    val x = ds.getJSONObject(i)
                    val p = runCatching { Platform.valueOf(x.getString("platform")) }.getOrNull() ?: return@mapNotNull null
                    Destination(x.getString("id"), p, x.optString("name"), x.optString("url"), x.optString("key"), x.optBoolean("enabled", true))
                },
                o.optString("mic", d.mic), o.optDouble("micGain", 1.0).toFloat(), o.optDouble("phoneGain", 1.0).toFloat(),
                o.optString("youtubeChannel"), o.optString("twitchChannel"), o.optString("kickChannel"),
                o.optString("translateTo", "fa"), o.optBoolean("translate", true),
                o.optString("desktopDevice"), o.optDouble("desktopGain", 1.0).toFloat(),
                fxF(o.optJSONObject("phoneFx"), d.phoneFx), fxF(o.optJSONObject("micFx"), d.micFx), fxF(o.optJSONObject("desktopFx"), d.desktopFx),
                o.optBoolean("monitor", false), o.optBoolean("limiter", true), o.optInt("replaySeconds", 0), o.optInt("splitMinutes", 0),
            )
        }
        val file: File get() = File(AppPaths.data, "settings.json")
        fun load(file: File = this.file): Settings = try { if (file.isFile) fromJson(file.readText()) else Settings() } catch (_: Exception) { Settings() }
        fun save(s: Settings, file: File = this.file) {
            file.parentFile.mkdirs()
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(s.toJson())
            if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
        }
    }
}

/**
 * Stream keys encrypted (AES-256-GCM) with a key made once for this computer and kept in the app's own
 * folder, readable only by this user. Not a vault — someone with this user's files can open it — but a
 * copied settings file or a screenshot never gives a key away.
 */
object Secrets {
    private val keyFile get() = File(AppPaths.data, "secret.key")
    private val key: ByteArray by lazy {
        val f = keyFile
        if (f.isFile && f.length() == 32L) f.readBytes() else ByteArray(32).also { k ->
            SecureRandom().nextBytes(k)
            f.writeBytes(k)
            try { Files.setPosixFilePermissions(f.toPath(), setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)) } catch (_: Exception) {
                f.setReadable(false, false); f.setReadable(true, true); f.setWritable(false, false); f.setWritable(true, true)
            }
        }
    }

    fun seal(plain: String): String {
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        return "v1:" + Base64.getEncoder().encodeToString(iv + c.doFinal(plain.toByteArray()))
    }

    fun open(sealed: String): String? = try {
        val b = Base64.getDecoder().decode(sealed.removePrefix("v1:"))
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, b.copyOfRange(0, 12)))
        String(c.doFinal(b.copyOfRange(12, b.size)))
    } catch (_: Exception) { null }
}
