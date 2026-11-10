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
    val engine = Engine(Studio.load(studioFile), { session })
    private val phoneIn = engine.mixer.input("phone")
    private val micIn = engine.mixer.input("mic")
    private val desktopIn = engine.mixer.input("desktop")
    private var mic: MicCapture? = null
    private var desktop: MicCapture? = null
    val history = History()

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
        watchStats()
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

    /** A change by the owner: kept for undo (changes of the same kind in a row, as one drag, are one step). */
    fun edit(v: Studio, kind: String = "") { history.record(engine.studio, kind); studio = v }
    fun undo(): Boolean { val p = history.undo(engine.studio) ?: return false; studio = p; return true }
    fun redo(): Boolean { val n = history.redo(engine.studio) ?: return false; studio = n; return true }

    fun update(f: (Settings) -> Settings) {
        val old = settings
        settings = f(settings)
        Settings.save(settings, settingsFile)
        if (old.mic != settings.mic) restartMic()
        if (old.desktopDevice != settings.desktopDevice) restartDesktop()
        if (old.youtubeChannel != settings.youtubeChannel || old.twitchChannel != settings.twitchChannel || old.kickChannel != settings.kickChannel) watchStats()
        applySound()
    }

    private fun applySound() {
        val s = settings
        phoneIn.gain = s.phoneGain; phoneIn.fx = s.phoneFx
        micIn.gain = s.micGain; micIn.fx = s.micFx
        desktopIn.gain = s.desktopGain; desktopIn.fx = s.desktopFx
        engine.mixer.monitor = s.monitor; engine.mixer.limiter = s.limiter
        if (mic == null && s.mic.isNotBlank()) restartMic()
        if (desktop == null && s.desktopDevice.isNotBlank()) restartDesktop()
    }

    private fun restartDesktop() {
        desktop?.close(); desktop = null
        if (settings.desktopDevice.isNotBlank()) desktop = MicCapture(settings.desktopDevice, desktopIn)
    }
    val desktopError: String? get() = desktop?.error

    /** Viewers, followers and subscribers of the channels set in the chat panel (for counters and the goal bar). */
    fun watchStats() {
        val s = settings
        PlatformStats.watch(mapOf(Platform.YOUTUBE to s.youtubeChannel, Platform.TWITCH to s.twitchChannel, Platform.KICK to s.kickChannel))
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

    fun pauseRecording() { recording?.let { if (it.paused) it.resume() else it.pause() } }

    // ------------------------------------------------------------------ replay buffer, screenshots

    @Volatile var replay: ReplayBuffer? = null; private set
    @Volatile var lastSaved: String? = null; private set

    fun startReplay(): String? {
        if (replay != null) return null
        val secs = settings.replaySeconds.takeIf { it > 0 } ?: 30
        val enc = pickEncoder(settings.recEncoder) ?: return "هیچ انکودرِ ویدیویی کار نمی‌کند"
        val st = studio
        val r = ReplayBuffer(enc, st.width, st.height, st.fps, settings.recKbps.coerceAtMost(30000), secs)
        replay = r; engine.outputs.add(r)
        return null
    }
    fun stopReplay() { val r = replay ?: return; engine.outputs.remove(r); replay = null; Thread { r.stop() }.start() }
    fun saveReplay(): File? = replay?.save()?.also { lastSaved = it.name }

    fun screenshot(): File? {
        val f = File(AppPaths.videos, "RawRec ${java.text.SimpleDateFormat("yyyy-MM-dd HH-mm-ss").format(java.util.Date())}.png")
        return if (engine.screenshot(f)) f.also { lastSaved = it.name } else null
    }

    // automatic split of long recordings (a new file every N minutes, without a gap in what is recorded)
    private val splitter = Thread({
        while (true) {
            try { Thread.sleep(1000) } catch (_: InterruptedException) { break }
            val r = recording ?: continue
            val m = settings.splitMinutes
            if (m > 0 && !r.paused && System.currentTimeMillis() - r.startedAtMs >= m * 60_000L) {
                val old = r; val oldOut = recOut
                recording = null; recOut = null
                startRecording()
                oldOut?.let { engine.outputs.remove(it) }
                Thread { old.stop().also { lastRecording = it } }.start()
            }
        }
    }, "rec-split").apply { isDaemon = true; start() }

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
        stopReplay()
        desktop?.close()
        splitter.interrupt()
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
