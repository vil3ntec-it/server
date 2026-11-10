package com.vil3ntec.rawrec.desktop.studio

import com.vil3ntec.rawrec.LiveSettings
import com.vil3ntec.rawrec.RtmpSink
import com.vil3ntec.rawrec.desktop.*
import java.io.File

/**
 * Everything the window drives, without the window: the phone, the scenes (the [Engine]), the sound,
 * a recording and a live stream (both at once if wanted, from the same picture), and what is saved.
 * The self-test drives the very same object.
 */
class StudioApp(val adb: Adb?, private val studioFile: File = File(AppPaths.data, "studio.json"), private val settingsFile: File = Settings.file) : AutoCloseable {
    @Volatile var settings: Settings = Settings.load(settingsFile); private set
    val session: Session? = adb?.let { Session(it) }
    val engine = Engine(Studio.load(studioFile)) { session }
    private val phoneIn = engine.mixer.input("phone")
    private val micIn = engine.mixer.input("mic")
    private var mic: MicCapture? = null

    @Volatile var recording: Recording? = null; private set
    private var recOut: Output? = null
    @Volatile var lastRecording: Recording.Result? = null; private set

    @Volatile var live: LiveOutput? = null; private set
    @Volatile var liveStatus: RtmpSink.Status? = null; private set
    @Volatile var liveStartedMs = 0L; private set

    /** The chats being read now (YouTube, Twitch, Kick), each on its own connection. */
    @Volatile var chats: List<ChatClient> = emptyList(); private set
    private val translateHook: (ChatMessage) -> Unit = { m -> val s = settings; if (s.translate && m.translated == null && m.platform != Platform.TEST) Translator.translate(m, s.translateTo) }

    init {
        session?.onAudio = { pcm -> phoneIn.push(pcm) }
        applySound()
        ChatHub.listeners.add(translateHook)
    }

    /** Reads every chat whose channel is set (and only those); again from the start when called again. */
    fun connectChats() {
        disconnectChats()
        val s = settings
        chats = listOfNotNull(
            s.youtubeChannel.takeIf { it.isNotBlank() }?.let { YouTubeChat(it) },
            s.twitchChannel.takeIf { it.isNotBlank() }?.let { TwitchChat(it) },
            s.kickChannel.takeIf { it.isNotBlank() }?.let { KickChat(it) },
        ).onEach { it.start() }
    }
    fun disconnectChats() { chats.forEach { it.close() }; chats = emptyList() }

    var studio: Studio
        get() = engine.studio
        set(v) { engine.studio = v; saveSoon() }

    fun update(f: (Settings) -> Settings) {
        val old = settings
        settings = f(settings)
        Settings.save(settings, settingsFile)
        if (old.mic != settings.mic) restartMic()
        applySound()
    }

    private fun applySound() {
        phoneIn.gain = settings.phoneGain
        micIn.gain = settings.micGain
        if (mic == null && settings.mic.isNotBlank()) restartMic()
    }

    private fun restartMic() {
        mic?.close(); mic = null
        if (settings.mic.isNotBlank()) mic = MicCapture(settings.mic, micIn)
    }
    val micError: String? get() = mic?.error

    // ------------------------------------------------------------------ phone

    fun connect(serial: String) {
        val s = settings
        Thread { session?.connect(serial, PhoneLink.Options(s.phoneCodec, s.phoneMbps, s.phoneSize, s.phoneFps, s.phoneAudio)) }.start()
    }
    fun disconnect() { Thread { session?.disconnect(); phoneIn.clear() }.start() }

    // ------------------------------------------------------------------ recording

    /** Records the program (what the scene shows), with the chosen encoder, size and rate. */
    fun startRecording(): String? {
        if (recording != null) return null
        val enc = pickEncoder(settings.recEncoder) ?: return "هیچ انکودرِ ویدیویی کار نمی‌کند"
        val st = studio
        val h = settings.recHeight.coerceAtMost(4320).let { if (it <= 0) st.height else it } and 1.inv()
        val r = Recording(enc, h, st.fps, settings.recKbps, withAudio = true)
        val o = object : Output {
            override fun video(f: VideoFrame) = r.video(f)
            override fun audio(pcm: ByteArray, ptsUs: Long) = r.audio(pcm, ptsUs)
        }
        r.start()
        recording = r; recOut = o
        engine.outputs.add(o)
        return null
    }

    fun stopRecording(): Recording.Result? {
        val r = recording ?: return null
        recOut?.let { engine.outputs.remove(it) }
        recording = null; recOut = null
        return r.stop().also { lastRecording = it }
    }

    // ------------------------------------------------------------------ live

    fun startLive(): String? {
        if (live != null) return null
        val dests = settings.dests.filter { it.enabled && it.url.isNotBlank() && it.key.isNotBlank() }
        if (dests.isEmpty()) return "هیچ پلتفرمی با کلیدِ پخش روشن نیست"
        val enc = pickEncoder(settings.liveEncoder, Encoders.Family.H264) ?: return "هیچ انکودرِ H.264 کار نمی‌کند"
        val st = studio
        val l = LiveOutput(enc, st.width, st.height, st.fps, settings.liveKbps,
            dests.mapIndexed { i, d -> LiveSettings.Dest(i, d.name.ifBlank { d.platform.label }, d.url, d.key) }) { s -> liveStatus = s }
        live = l; liveStartedMs = System.currentTimeMillis(); liveStatus = null
        engine.outputs.add(l)
        return null
    }

    fun stopLive() {
        val l = live ?: return
        engine.outputs.remove(l)
        live = null
        Thread { l.stop() }.start()
    }

    private fun pickEncoder(name: String, family: Encoders.Family? = null): Encoders.Encoder? =
        Encoders.available().firstOrNull { it.name == name && (family == null || it.family == family) } ?: Encoders.best(family ?: Encoders.Family.H264)

    // ------------------------------------------------------------------ saving

    @Volatile private var dirtyAt = 0L
    private val saver = Thread({
        while (true) {
            try { Thread.sleep(500) } catch (_: InterruptedException) { break }
            val d = dirtyAt
            if (d != 0L && System.currentTimeMillis() - d > 400) { dirtyAt = 0; try { Studio.save(engine.studio, studioFile) } catch (_: Exception) {} }
        }
    }, "studio-save").apply { isDaemon = true; start() }
    private fun saveSoon() { dirtyAt = System.currentTimeMillis() }

    override fun close() {
        disconnectChats()
        ChatHub.listeners.remove(translateHook)
        stopRecording()
        stopLive()
        Studio.save(engine.studio, studioFile)
        session?.disconnect()
        mic?.close()
        engine.close()
        saver.interrupt()
    }
}
