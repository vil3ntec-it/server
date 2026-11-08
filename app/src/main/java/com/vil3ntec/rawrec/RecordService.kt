package com.vil3ntec.rawrec

import android.Manifest
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.display.DisplayManager
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.service.quicksettings.TileService
import android.view.Display
import android.widget.Toast
import java.lang.ref.WeakReference
import kotlin.math.abs

/**
 * Why a recording ended. Saved with the recording and shown in «گزارشِ ضبط» in plain words, so the
 * owner can see why a video stopped. [byUser]: the owner asked for it; the others ended by themselves.
 */
enum class StopReason(val text: Int, val byUser: Boolean) {
    CONTROL(R.string.eng_reason_control, true),
    APP(R.string.eng_reason_app, true),
    NOTIFICATION(R.string.eng_reason_notification, true),
    TILE(R.string.eng_reason_tile, true),
    SHAKE(R.string.eng_reason_shake, true),
    TEST_DONE(R.string.eng_reason_test, true),
    DELETED(R.string.eng_reason_deleted, true),
    LOW_STORAGE(R.string.eng_reason_low_storage, false),
    SCREEN_LOCKED(R.string.eng_reason_screen_locked, false),
    PROJECTION_ENDED(R.string.eng_reason_projection, false),
    DISPLAY_STOPPED(R.string.eng_reason_display, false),
    ENCODER_ERROR(R.string.eng_reason_encoder, false),
    WRITE_ERROR(R.string.eng_reason_write, false),
    START_FAILED(R.string.eng_reason_start, false),
    SERVICE_ENDED(R.string.eng_reason_service, false),
    CRASH(R.string.eng_reason_crash, false),
    PROCESS_DIED(R.string.eng_reason_killed, false),
    LIVE_FAILED(R.string.eng_reason_live, false);

    companion object {
        fun of(name: String?): StopReason? = values().firstOrNull { it.name == name }
    }
}

/**
 * «تکان دادن = توقف», deliberate shakes only. 1.4 counted any 2.7 g reading of the raw
 * accelerometer (gravity included) three times within about a second, so running, a bumpy ride,
 * putting the phone down hard or an intense game could end a recording. Now gravity is taken out
 * and it needs four strong swings in alternating directions on one axis within 1.2 s; footsteps,
 * bumps and taps push one way only. Ignored until [armedAtMs] (start / resume).
 */
internal class ShakeGesture(
    private val threshold: Float = 2.0f * SensorManager.GRAVITY_EARTH,
    private val swingsNeeded: Int = 4,
) {
    private val g = FloatArray(3)
    private var hasGravity = false
    private var swings = 0
    private var firstAt = 0L
    private var lastAt = 0L
    private var lastAxis = -1
    private var lastSign = 0
    var armedAtMs = 0L

    /** One accelerometer sample (m/s², gravity included) at [tMs]; true when the gesture is complete. */
    fun onSample(x: Float, y: Float, z: Float, tMs: Long): Boolean {
        if (!hasGravity) { g[0] = x; g[1] = y; g[2] = z; hasGravity = true; return false }
        // Slow low-pass = gravity; what is left is the hand's movement.
        g[0] += 0.08f * (x - g[0]); g[1] += 0.08f * (y - g[1]); g[2] += 0.08f * (z - g[2])
        val lx = x - g[0]; val ly = y - g[1]; val lz = z - g[2]
        val axis = if (abs(lx) >= abs(ly) && abs(lx) >= abs(lz)) 0 else if (abs(ly) >= abs(lz)) 1 else 2
        val v = when (axis) { 0 -> lx; 1 -> ly; else -> lz }
        if (abs(v) < threshold || tMs < armedAtMs) return false
        val sign = if (v > 0) 1 else -1
        if (axis == lastAxis && sign == lastSign && tMs - lastAt < 250) { lastAt = tMs; return false }   // the same swing
        if (swings > 0 && tMs - firstAt <= 1_200 && axis == lastAxis && sign != lastSign) swings++
        else { swings = 1; firstAt = tMs }
        lastAt = tMs; lastAxis = axis; lastSign = sign
        if (swings >= swingsNeeded) { swings = 0; lastAxis = -1; return true }
        return false
    }
}

class RecordService : Service(), Recorder.Events {

    enum class State { IDLE, PREPARING, RECORDING, PAUSED, SAVING }

    companion object {
        const val ACTION_START = "rawrec.START"
        const val ACTION_STOP = "rawrec.STOP"
        const val ACTION_PAUSE = "rawrec.PAUSE"
        const val ACTION_SHOW_CONTROL = "rawrec.SHOW_CONTROL"
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
        /** «پخشِ زنده»: server address, stream key (in memory only) and the chosen video bit rate. */
        const val EXTRA_LIVE_URL = "live_url"
        const val EXTRA_LIVE_KEY = "live_key"
        const val EXTRA_LIVE_NAME = "live_name"
        /** Several platforms at once (the same order in all three). */
        const val EXTRA_LIVE_URLS = "live_urls"
        const val EXTRA_LIVE_KEYS = "live_keys"
        const val EXTRA_LIVE_NAMES = "live_names"

        /** The live stream's state for the app's «زنده» page; null when not live. */
        @Volatile var liveStatus: RtmpSink.Status? = null; private set
        /** Each platform's own state while streaming to several at once (empty for one). */
        @Volatile var liveDests: List<Pair<String, RtmpSink.Status?>> = emptyList(); private set
        @Volatile var isLive = false; private set
        @Volatile var liveCovered = false; private set
        /** The stream on YouTube while live (title, picture, health), and the latest counts; null otherwise. */
        @Volatile var ytInfo: LiveChat.YtInfo? = null; private set
        @Volatile var liveViewers = -1L; private set
        @Volatile var liveLikes = -1L; private set
        /** The latest note for the «زنده» page (title / thumbnail set or refused). */
        @Volatile var liveNote: String? = null; private set
        /** Who asked to stop (ACTION_STOP): [SRC_APP], [SRC_NOTIFICATION] or [SRC_TILE]. */
        const val EXTRA_SRC = "src"
        const val SRC_APP = "app"
        const val SRC_NOTIFICATION = "notification"
        const val SRC_TILE = "tile"
        const val PREFS = "rawrec"
        private const val CH_REC = "rec"
        private const val CH_DONE = "done"
        private const val NOTIF_REC = 1
        private const val NOTIF_DONE = 2
        /** Ghost mode: how long after the panel is taken down the recording continues. */
        private const val GHOST_RESUME_MS = 350L
        private const val GEOMETRY_WATCH_MS = 1_500L

        // Keys of the last finished recording (read by the activity).
        const val K_LAST_URIS = "last_uris"
        const val K_LAST_NAMES = "last_names"
        const val K_LAST_BYTES = "last_bytes"
        const val K_LAST_REPORT = "last_report"
        const val K_LAST_ERROR = "last_error"
        const val K_LAST_IS_TEST = "last_is_test"
        const val K_REPORT_UNSEEN = "report_unseen"
        /** [StopReason] name of the last recording. */
        const val K_LAST_STOP_REASON = "last_stop_reason"
        /** The same in plain words, in the app language at the time it ended. */
        const val K_LAST_STOP_TEXT = "last_stop_text"
        /** Technical detail (exception, codec error), may be empty. */
        const val K_LAST_STOP_DETAIL = "last_stop_detail"
        const val K_LAST_STOP_BY_USER = "last_stop_by_user"

        @Volatile var state = State.IDLE; private set
        @Volatile var startedAt = 0L; private set
        @Volatile var pausedSince = 0L; private set
        @Volatile var countdownLeft = 0; private set
        @Volatile var applied = ""; private set
        @Volatile var notice = ""; private set

        val isRecording get() = state != State.IDLE

        /**
         * «ضبطِ فوری»: the capture permission of the last recording is still held, so the next one
         * starts without Android's dialog (ACTION_START without EXTRA_DATA).
         */
        @Volatile var instantReady = false; private set
        const val ACTION_RELEASE = "rawrec.RELEASE"
        const val PREF_INSTANT = "c_instant"
        fun instantEnabled(ctx: Context) = SafePrefs.bool(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE), PREF_INSTANT, true)
        val isPaused get() = state == State.PAUSED

        /** Why the last recording ended, in plain words ("" before the first one). */
        fun lastStopReason(ctx: Context): String =
            SafePrefs.str(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE), K_LAST_STOP_TEXT)

        /** True when the last recording ended by itself (not by the owner): worth showing its report. */
        fun lastStopUnexpected(ctx: Context): Boolean {
            val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return SafePrefs.str(p, K_LAST_STOP_REASON).isNotEmpty() && !SafePrefs.bool(p, K_LAST_STOP_BY_USER, true)
        }

        /** Saves why a recording ended ([commit] when the process may die right after). */
        internal fun saveStop(ctx: Context, reason: StopReason, detail: String?, commit: Boolean = false) {
            val e = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(K_LAST_STOP_REASON, reason.name)
                .putString(K_LAST_STOP_TEXT, ctx.getString(reason.text))
                .putString(K_LAST_STOP_DETAIL, detail ?: "")
                .putBoolean(K_LAST_STOP_BY_USER, reason.byUser)
            if (commit) e.commit() else e.apply()
            RecLog.add(ctx, "stop: ${reason.name}" + if (detail.isNullOrEmpty()) "" else " ($detail)")
        }

        @Volatile private var current: WeakReference<RecordService>? = null

        /** «چیدمانِ پخش» changed: a running stream takes the new places and switches at once. */
        fun layoutChanged() { current?.get()?.let { s -> s.main.post { s.layoutChanged() } } }

        /** From the crash handler: finish a running recording so its file is saved before the process dies. */
        internal fun onProcessCrash(e: Throwable) {
            current?.get()?.emergencyFinish(e)
        }
    }

    internal val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    @Volatile private var projection: MediaProjection? = null
    @Volatile private var recorder: Recorder? = null
    private class LiveTarget(val url: String, val key: String, val name: String)
    private var live: LiveTarget? = null
    private var liveSink: MediaSink? = null
    /** Where the stream goes (one or several platforms). */
    private var liveTargets: List<LiveSettings.Dest> = emptyList()
    private val failedDests = HashSet<String>()
    private var coverManual = false
    private var coverAuto = false
    private var micBeforeCover = false
    /** «ضبطِ فوری»: the virtual display kept (detached) between recordings of the same permission. */
    private var keptDisplay: android.hardware.display.VirtualDisplay? = null
    private var cfg: RecordConfig? = null
    @Volatile private var stopping = false
    private var facecam: FacecamOverlay? = null
    private var control: FloatingControl? = null
    private var controlHidden = false
    private var countdownView: CountdownOverlay? = null
    private var cdToast: Toast? = null
    private var sensorManager: SensorManager? = null
    private var displayListener: DisplayManager.DisplayListener? = null
    private var screenReceiver: BroadcastReceiver? = null
    private var screenOffAt = 0L
    private var wakeLock: PowerManager.WakeLock? = null
    private var lowSpaceWarned = false
    private var lastSpaceBytes = 0L
    private var lastSpaceAt = 0L
    @Volatile private var crashHandled = false

    override fun attachBaseContext(newBase: Context) = super.attachBaseContext(AppLang.wrap(newBase))

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        current = WeakReference(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> begin(intent)
            ACTION_STOP -> if (state == State.IDLE) stopSelf() else finishRecording(when (intent.getStringExtra(EXTRA_SRC)) {
                SRC_NOTIFICATION -> StopReason.NOTIFICATION
                SRC_TILE -> StopReason.TILE
                else -> StopReason.APP
            })
            ACTION_PAUSE -> togglePause()
            ACTION_RELEASE -> if (state == State.IDLE) releaseInstant()
            ACTION_SHOW_CONTROL -> showControlAgain()
        }
        return START_NOT_STICKY
    }

    // ------------------------------------------------------------ start

    private fun begin(intent: Intent) {
        createChannels()
        if (state != State.IDLE) {
            // Already running (and already in the foreground), so this extra start needs nothing more.
            Toast.makeText(this, getString(R.string.toast_already), Toast.LENGTH_LONG).show()
            return
        }
        Encoders.probeAv1Muxer(this)
        val c0 = RecordConfig.from(intent)
        val urls = intent.getStringArrayExtra(EXTRA_LIVE_URLS)
        val keys = intent.getStringArrayExtra(EXTRA_LIVE_KEYS)
        val names = intent.getStringArrayExtra(EXTRA_LIVE_NAMES)
        liveTargets = if (urls != null && keys != null && names != null && urls.size == keys.size && urls.size == names.size)
            urls.indices.filter { urls[it].isNotBlank() }.map { LiveSettings.Dest(-1, names[it], urls[it], keys[it]) }
        else intent.getStringExtra(EXTRA_LIVE_URL)?.takeIf { it.isNotBlank() }?.let {
            listOf(LiveSettings.Dest(-1, intent.getStringExtra(EXTRA_LIVE_NAME) ?: "", it, intent.getStringExtra(EXTRA_LIVE_KEY) ?: ""))
        } ?: emptyList()
        live = liveTargets.firstOrNull()?.let { LiveTarget(it.url, it.key, liveTargets.joinToString(" + ") { d -> d.name }) }
        liveDests = emptyList(); failedDests.clear()
        isLive = live != null
        liveStatus = null
        liveSink = null
        coverManual = false; coverAuto = false; liveCovered = false
        val micOk = granted(Manifest.permission.RECORD_AUDIO)
        val overlayOk = Settings.canDrawOverlays(this)
        val camOk = c0.facecam > 0 && granted(Manifest.permission.CAMERA) && overlayOk
        var c = c0.copy(
            audioMode = if (c0.hasAudio && !micOk) RecordConfig.AUDIO_NONE else c0.audioMode,
            facecam = if (camOk) c0.facecam else 0,
            floatingButton = c0.floatingButton && overlayOk,
        )
        notices.clear()
        if (c0.hasAudio && !micOk) notices["mic"] = getString(R.string.toast_mic_silent)
        notice = notices.values.joinToString("\n")
        stopping = false
        crashHandled = false
        controlHidden = false
        recoveries = 0
        startedAt = 0L; pausedSince = 0L; applied = ""; lowSpaceWarned = false
        state = State.PREPARING
        ReadyNotice.hide(this)
        IdleBubble.hide(this)

        var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        if (c.hasAudio) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        // Camera type also when the face cam is off but allowed, so the pill can turn it on later.
        camAllowed = granted(Manifest.permission.CAMERA) && overlayOk
        if (c.facecam > 0 || camAllowed) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        try {
            startForeground(NOTIF_REC, recordingNotification(), type)
        } catch (e: Exception) {
            // A permission changed between the check and now (Android 14+ checks microphone and
            // camera when the service goes to the foreground): record the screen only.
            c = c.copy(audioMode = RecordConfig.AUDIO_NONE, facecam = 0)
            camAllowed = false
            try {
                startForeground(NOTIF_REC, recordingNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            } catch (e2: Exception) {
                cfg = c
                finishRecording(StopReason.START_FAILED, "startForeground: ${e2.message ?: e2.javaClass.simpleName}")
                return
            }
        }
        cfg = c

        val code = intent.getIntExtra(EXTRA_CODE, 0)
        val data: Intent? = if (Build.VERSION.SDK_INT >= 34)
            intent.getParcelableExtra(EXTRA_DATA, Intent::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_DATA)
        // «ضبطِ فوری»: the permission of the last recording is still held — no dialog this time.
        val reuse = data == null && projection != null && keptDisplay != null
        instantReady = false
        if (data == null && !reuse) { finishRecording(StopReason.START_FAILED, getString(R.string.err_no_projection)); return }

        if (!reuse) try {
            // A new permission replaces one still held.
            keptDisplay?.let { d -> try { d.release() } catch (_: Exception) {} }
            keptDisplay = null
            projection?.let { old -> try { old.stop() } catch (_: Exception) {} }
            projection = null
            val mpm = getSystemService(MediaProjectionManager::class.java) ?: throw IllegalStateException("no MediaProjectionManager")
            val p = mpm.getMediaProjection(code, data!!) ?: throw IllegalStateException("projection is null")
            projection = p
            p.registerCallback(object : MediaProjection.Callback() {
                // Android ended the capture: the screen locked (Android 15+), «Stop sharing» in the
                // status bar, another app started a capture or cast, or the recorded app went away.
                override fun onStop() {
                    main.post {
                        // While only held for «ضبطِ فوری» (no recording): let it go quietly.
                        if (state == State.IDLE) releaseInstant() else finishRecording(projectionStopReason())
                    }
                }
                // Rotation is NOT taken from onCapturedContentResize any more: in 1.2.2 it guessed an
                // orientation from the reported size, was not debounced, and asked for a switch the
                // wrong way. The debounced display listener is the only source now.

                // Android 14+ single-app capture: the recorded app left the screen; nothing new is
                // captured until it returns (the video holds the last picture). Said in the notice.
                override fun onCapturedContentVisibilityChanged(isVisible: Boolean) {
                    main.post {
                        if (state == State.IDLE || stopping) return@post
                        if (live != null) { coverAuto = !isVisible; applyCover(); return@post }
                        if (isVisible) removeNotice("hidden") else addNotice("hidden", getString(R.string.eng_notice_content_hidden))
                    }
                }
            }, main)
        } catch (e: Exception) {
            finishRecording(StopReason.START_FAILED, e.message ?: e.javaClass.simpleName)
            return
        }

        // Overlays go up before the countdown so they are in place from the first frame.
        try {
            if (c.facecam > 0) facecam = FacecamOverlay(this, c.facecam).also { it.show() }
        } catch (_: Exception) { facecam = null }
        if (c.floatingButton && !ghostOf(c)) control = makeControl(c)
        registerDisplayListener()
        registerScreenReceiver()
        keepScreenOn()
        countdown(c.countdown)
    }

    /** «حالتِ بازی» (single-app capture): the control is not in the video, so it never needs to shrink at once. */
    private fun makeControl(c: RecordConfig): FloatingControl? = try {
        FloatingControl(this, c.invisibleControl && !c.gameMode && !ghostOf(c), pillActions, ghost = ghostOf(c)).also {
            it.setMic(on = c.usesMic && recorder?.micMuted != true, available = c.usesMic)
            it.setCam(on = facecam != null, available = camAllowed)
            it.setPaused(state == State.PAUSED)
            it.show()
            if (state == State.RECORDING || state == State.PAUSED) it.setRecording(true)
        }
    } catch (_: Exception) { null }

    private val countdownStep = Runnable { countdown(countdownLeft - 1) }
    private val startAfterCountdown = Runnable { if (!stopping) startRecorder() }
    private val testDone = Runnable { if (state == State.RECORDING || state == State.PAUSED) finishRecording(StopReason.TEST_DONE) }

    private fun countdown(left: Int) {
        if (stopping) return
        countdownLeft = left
        if (left <= 0) {
            countdownView?.hide(); countdownView = null
            cdToast?.cancel()
            // Small gap so the last number has left the screen before the first frame.
            main.postDelayed(startAfterCountdown, 300)
            return
        }
        if (Settings.canDrawOverlays(this)) {
            try { (countdownView ?: CountdownOverlay(this, if (ghost) getString(R.string.eng_ghost_hint) else null).also { countdownView = it }).set(left) } catch (_: Exception) {}
        } else {
            cdToast?.cancel()
            cdToast = Toast.makeText(this, "⏺ $left", Toast.LENGTH_SHORT).also { it.show() }
        }
        notifyRecording()
        main.postDelayed(countdownStep, 1000)
    }

    private fun startRecorder() {
        val p = projection ?: return
        val c = cfg ?: return
        try {
            val plan = Planner.plan(c, DisplayInfo.read(this)) ?: throw IllegalStateException(getString(R.string.toast_no_encoder))
            val lv = live
            val r = if (lv != null) Recorder(this, p, c, plan, this, null, keepDisplay = false,
                sinkFactory = {
                    (if (liveTargets.size > 1) MultiSink(liveTargets, plan.bitrate, liveListener) else RtmpSink(lv.url, lv.key, plan.bitrate, liveListener))
                        .also { liveSink = it }
                }, forceLook = true)
            else Recorder(this, p, c, plan, this, keptDisplay, keepDisplay = instantEnabled(this))
            if (lv == null) ActiveRec.begin(this)
            try { r.start() } catch (e: Exception) { ActiveRec.end(this); throw e }
            recorder = r
            if (lv == null && instantEnabled(this)) keptDisplay = r.virtualDisplay
            startedAt = System.currentTimeMillis()
            recordStartWall = startedAt
            requestedSource = plan.sourceWidth to plan.sourceHeight
            policy = RotationPolicy(auto = c.orient == RecordConfig.ORIENT_AUTO, smartStart = c.smartStart, newFileOnRotate = c.rotateNewFile).also {
                it.start(plan.contentWidth > plan.contentHeight)
            }
            applied = Texts.applied(this, c, plan, r.droppedOptions, r.audioKbps, c.hasAudio)
            RecLog.add(this, "start: ${plan.encoder} ${plan.width}x${plan.height}@${plan.fps} ${plan.bitrate / 1_000_000} Mbps " +
                "level ${Encoders.levelName(plan.mime, plan.level)} • Android ${Build.VERSION.SDK_INT}")
            state = State.RECORDING
            control?.setRecording(true)
            main.post(pillTick)
            notifyRecording()
            refreshTile()
            if (c.shakeStop || ghostOf(c)) startShakeDetector(ghostOf(c))
            startThermalWatch()
            lastSpaceAt = 0L
            main.postDelayed(spaceCheck, 2000)
            if (c.testSeconds > 0) main.postDelayed(testDone, c.testSeconds * 1000L)
            if (lv != null) try { startLiveExtras(r) } catch (e: Exception) { RecLog.add(this, "live extras: ${e.message}") }
        } catch (e: Exception) {
            finishRecording(StopReason.START_FAILED, e.message ?: e.javaClass.simpleName)
        }
    }

    // ------------------------------------------------------------ rotation and size

    private fun registerDisplayListener() {
        val dm = getSystemService(DisplayManager::class.java) ?: return
        val l = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(id: Int) {}
            override fun onDisplayRemoved(id: Int) {}
            override fun onDisplayChanged(id: Int) {
                if (id != Display.DEFAULT_DISPLAY) return
                // Only a new size or orientation counts. A refresh-rate change arrives here too —
                // on an adaptive 60/120/165 Hz screen, in a game, many times a second — and in 1.5
                // each one pushed the rotation decision back again: the switch came late or never,
                // and the landscape game was recorded small inside the portrait video with black bars.
                onGeometryMaybeChanged()
            }
        }
        lastGeometry = geometry()
        dm.registerDisplayListener(l, main)
        main.removeCallbacks(geometryWatch)
        main.postDelayed(geometryWatch, GEOMETRY_WATCH_MS)
        displayListener = l
    }

    private var policy: RotationPolicy? = null
    private var lastGeometry = 0L

    /** The screen's current size in pixels, packed (width, height): rotation and resolution only. */
    private fun geometry(): Long {
        val d = getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY) ?: return 0L
        val m = android.util.DisplayMetrics()
        @Suppress("DEPRECATION") d.getRealMetrics(m)
        return (m.widthPixels.toLong() shl 32) or m.heightPixels.toLong()
    }

    private fun onGeometryMaybeChanged() {
        val g = geometry()
        if (g == lastGeometry || g == 0L) return
        lastGeometry = g
        facecam?.onDisplayChanged()
        control?.onDisplayChanged()
        holdIfSwitching()
        // A rotation fires several size changes: wait until it settles, then decide once.
        main.removeCallbacks(followRotation)
        main.postDelayed(followRotation, 400)
    }

    /**
     * Safety net: a display event that never came (a game that takes the screen in landscape, a
     * vendor skin) must not leave the recording in the wrong orientation; the size is checked again
     * every [GEOMETRY_WATCH_MS] while recording. Reading the size is cheap.
     */
    private val geometryWatch = object : Runnable {
        override fun run() {
            if (stopping || state == State.IDLE) return
            onGeometryMaybeChanged()
            main.postDelayed(this, GEOMETRY_WATCH_MS)
        }
    }

    /**
     * The screen is turning (or changing size) and the recording will switch to it: from this moment
     * the old part gets no more frames, so it does not end with the new picture squeezed into it.
     */
    private fun holdIfSwitching() {
        val r = recorder ?: return
        val c = cfg ?: return
        val pol = policy ?: return
        val d = DisplayInfo.read(this)
        val (tw, th) = Planner.targetSize(c, d)
        val (sw, sh) = requestedSource
        val resized = sw > 0 && !(tw == sw && th == sh) && !(tw == sh && th == sw)
        if (pol.follows(d.landscape, System.currentTimeMillis() - recordStartWall, resized)) r.holdFramesFrom(System.nanoTime() / 1000)
    }
    private var recordStartWall = 0L
    /** Screen size (before encoder fitting) the recording is in or is being switched to. */
    private var requestedSource = 0 to 0

    private val followRotation = Runnable {
        val r = recorder ?: return@Runnable
        val c = cfg ?: return@Runnable
        val d = DisplayInfo.read(this)
        val (tw, th) = Planner.targetSize(c, d)
        val (sw, sh) = requestedSource
        // Not a rotation (same pixels, other way round) but a new size: a foldable, a resolution change.
        val resized = sw > 0 && !(tw == sw && th == sh) && !(tw == sh && th == sw)
        val action = policy?.onDisplay(d.landscape, System.currentTimeMillis() - recordStartWall, resized)
        if (action == RotationPolicy.Action.RESTART || action == RotationPolicy.Action.NEW_PART) {
            requestedSource = tw to th
            if (!r.switchOrientation(d, restart = action == RotationPolicy.Action.RESTART)) r.releaseHold()
            if (resized) addNotice("rotate", getString(R.string.eng_notice_resized_fmt, Fmt.size(tw, th)))
        } else {
            // Turned back before the decision, or not a switch after all: keep writing.
            r.releaseHold()
        }
    }

    private fun unregisterDisplayListener() {
        val l = displayListener ?: return
        try { getSystemService(DisplayManager::class.java)?.unregisterDisplayListener(l) } catch (_: Exception) {}
        displayListener = null
    }

    // ------------------------------------------------------------ screen on / off

    /**
     * The screen is kept on (it may dim) while a recording is open. When the phone locks, Android 15+
     * ends every screen capture, which cut recordings off whenever the screen timed out on a quiet
     * screen; older versions went on recording a black screen.
     */
    @Suppress("DEPRECATION")
    private fun keepScreenOn() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(PowerManager::class.java) ?: return
        wakeLock = try {
            pm.newWakeLock(PowerManager.SCREEN_DIM_WAKE_LOCK, "RawRec:recording").apply {
                setReferenceCounted(false)
                acquire(12 * 60 * 60 * 1000L)
            }
        } catch (_: Exception) { null }
    }

    private fun releaseScreen() {
        try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
        wakeLock = null
    }

    private fun registerScreenReceiver() {
        if (screenReceiver != null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) { screenOffAt = SystemClock.elapsedRealtime() }
        }
        val f = IntentFilter(Intent.ACTION_SCREEN_OFF)
        try {
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(r, f)
            screenReceiver = r
        } catch (_: Exception) {}
    }

    private fun unregisterScreenReceiver() {
        val r = screenReceiver ?: return
        try { unregisterReceiver(r) } catch (_: Exception) {}
        screenReceiver = null
    }

    private fun screenIsOff(): Boolean {
        val pm = getSystemService(PowerManager::class.java)
        val km = getSystemService(KeyguardManager::class.java)
        return pm?.isInteractive == false || km?.isKeyguardLocked == true ||
            (screenOffAt > 0 && SystemClock.elapsedRealtime() - screenOffAt < 5_000)
    }

    private fun projectionStopReason() = if (screenIsOff()) StopReason.SCREEN_LOCKED else StopReason.PROJECTION_ENDED

    // ------------------------------------------------------------ storage

    private val spaceCheck = object : Runnable {
        override fun run() {
            val r = recorder ?: return
            if (state != State.RECORDING && state != State.PAUSED) return
            val free = Storage.free(this@RecordService)
            val now = SystemClock.elapsedRealtime()
            val bytes = r.bytesWritten
            // Measured write rate; until there is a measurement use the configured peak.
            val rate = if (lastSpaceAt > 0 && now > lastSpaceAt && bytes > lastSpaceBytes)
                (bytes - lastSpaceBytes) * 1000 / (now - lastSpaceAt) else r.plan.peakBitrate / 8L
            lastSpaceAt = now; lastSpaceBytes = bytes
            if (free < Storage.RESERVE + rate * 5) {
                finishRecording(StopReason.LOW_STORAGE)
                return
            }
            val secondsLeft = (free - Storage.RESERVE) / maxOf(rate, 1L)
            if (secondsLeft < 180 && !lowSpaceWarned) {
                lowSpaceWarned = true
                addNotice("space", getString(R.string.low_space_warn_fmt, (secondsLeft / 60 + 1).toInt()))
            }
            main.postDelayed(this, 5000)
        }
    }

    // ------------------------------------------------------------ pause / stop

    private fun togglePause() {
        if (stopping) return
        if (live != null) { coverManual = !coverManual; applyCover(); return }   // live: «برمی‌گردم», the stream keeps flowing
        val r = recorder ?: return
        if (r.paused && ghost && control != null) { ghostClose(); return }
        if (r.paused) {
            r.resume()
            startedAt += System.currentTimeMillis() - pausedSince
            state = State.RECORDING
            shake?.armedAtMs = SystemClock.elapsedRealtime() + 3_000
        } else {
            r.pause()
            pausedSince = System.currentTimeMillis()
            state = State.PAUSED
        }
        control?.setPaused(state == State.PAUSED)
        notifyRecording()
    }

    // ------------------------------------------------------------ live

    private val liveListener = object : RtmpSink.Listener {
        override fun onStatus(s: RtmpSink.Status) {
            main.post {
                liveStatus = s
                val multi = liveSink as? MultiSink
                liveDests = multi?.dests?.map { it.name to it.status } ?: emptyList()
                // one platform gave up while the others go on: said once
                multi?.dests?.filter { it.status?.state == RtmpSink.State.FAILED && failedDests.add(it.name) }?.forEach {
                    addNotice("live_" + it.name, getString(R.string.live_n_dest_failed_fmt, it.name, it.status?.error ?: ""))
                }
                if (stopping || live == null) return@post
                when (s.state) {
                    RtmpSink.State.FAILED -> finishRecording(StopReason.LIVE_FAILED, s.error)
                    RtmpSink.State.RECONNECTING -> addNotice("live", getString(R.string.live_n_reconnecting_fmt, s.reconnects))
                    else -> removeNotice("live")
                }
                notifyRecording()
            }
        }
        override fun onBitrate(bps: Int) { recorder?.setVideoBitrate(bps) }
    }

    /** «برمی‌گردم» on or off: by the owner (panel, notification) or because the game left the screen. */
    private fun applyCover() {
        val r = recorder ?: return
        val on = coverManual || coverAuto
        if (on == liveCovered) { control?.setPaused(on); return }
        liveCovered = on
        val sr = scenes
        if (on) {
            micBeforeCover = r.micMuted
            r.micMuted = true
            if (sr != null) sr.setAway(true) else r.setCover(coverPicture(r.plan.width, r.plan.height))
        } else {
            r.micMuted = micBeforeCover
            if (sr != null) sr.setAway(false) else r.setCover(null)
        }
        control?.setPaused(on)
        notifyRecording()
    }

    /** The «برمی‌گردم» picture at the stream's size. */
    private fun coverPicture(w: Int, h: Int): android.graphics.Bitmap {
        val b = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(b)
        val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        p.shader = android.graphics.LinearGradient(0f, 0f, w.toFloat(), h.toFloat(),
            android.graphics.Color.rgb(20, 22, 30), android.graphics.Color.rgb(46, 22, 30), android.graphics.Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), p)
        p.shader = null
        p.color = getColor(R.color.eng_rec_red)
        c.drawCircle(w / 2f, h * 0.36f, h * 0.06f, p)
        p.color = android.graphics.Color.WHITE
        p.textAlign = android.graphics.Paint.Align.CENTER
        p.textSize = h * 0.09f
        p.isFakeBoldText = true
        c.drawText(getString(R.string.live_brb), w / 2f, h * 0.58f, p)
        p.isFakeBoldText = false
        p.textSize = h * 0.045f
        p.color = android.graphics.Color.argb(200, 255, 255, 255)
        c.drawText(getString(R.string.live_brb_sub), w / 2f, h * 0.68f, p)
        live?.name?.takeIf { it.isNotBlank() }?.let {
            p.textSize = h * 0.035f
            p.color = android.graphics.Color.argb(140, 255, 255, 255)
            c.drawText(it, w / 2f, h * 0.9f, p)
        }
        return b
    }

    private fun destWord(ds: RtmpSink.Status?): String = getString(when (ds?.state) {
        RtmpSink.State.LIVE, RtmpSink.State.ENDED -> R.string.live_d_ok
        RtmpSink.State.FAILED -> R.string.live_d_failed
        RtmpSink.State.RECONNECTING -> R.string.live_d_reconnecting
        else -> R.string.live_d_connecting
    }) + (ds?.takeIf { it.reconnects > 0 }?.let { " (" + getString(R.string.live_d_reconnects_fmt, Fmt.num(it.reconnects)) + ")" } ?: "")

    private fun liveReport(c: RecordConfig, reason: StopReason, detail: String?): String {
        val s = liveSink
        val r = recorder
        val sb = StringBuilder()
        sb.append(getString(R.string.rep_title_fmt, BuildInfo.version(this))).append('\n')
        sb.append(getString(R.string.live_rep_title_fmt, live?.name ?: "")).append('\n')
        sb.append(getString(R.string.eng_rep_reason_fmt, getString(reason.text))).append('\n')
        if (!detail.isNullOrBlank()) sb.append(getString(R.string.eng_rep_detail_fmt, detail)).append('\n')
        val secs = ((System.currentTimeMillis() - startedAt) / 1000).coerceAtLeast(0)
        if (startedAt > 0) sb.append(getString(R.string.live_rep_time_fmt, String.format(java.util.Locale.US, "%d:%02d:%02d", secs / 3600, secs / 60 % 60, secs % 60))).append('\n')
        if (r != null) sb.append(Texts.short(r.plan)).append('\n')
        if (s != null) {
            val mb = s.totalBytes / 1_000_000.0
            val avg = if (secs > 0) s.totalBytes * 8 / secs / 1000 else 0
            val st = liveStatus
            sb.append(getString(R.string.live_rep_stats_fmt, String.format(java.util.Locale.US, "%.0f", mb), Fmt.num(avg / 1000),
                Fmt.num(st?.dropped ?: 0), Fmt.num(st?.reconnects ?: 0)))
            for ((name, ds) in liveDests) sb.append('\n').append(getString(R.string.live_rep_dest_fmt, name, destWord(ds)))
        }
        extrasReport?.let { sb.append('\n').append(it) }
        return sb.toString().trimEnd()
    }


    // ------------------------------------------------------------ live: chat, bot, what viewers see (3.3)

    private var chat: LiveChat? = null
    private var bot: ChatBot? = null
    private var hud: ChatHud? = null
    /** The owner's scenes and layers on the stream (null when the GPU stage is not running). */
    private var scenes: SceneRenderer? = null
    /** The scene's layers on the owner's own screen (display only). */
    private var mirror: OwnerMirror? = null
    private var probe: CaptureProbe? = null
    private var alertsShown = 0
    /** When each message came, for the stream's chat (old ones leave after 45 s). */
    private val chatTimes = HashMap<String, Long>()
    /** The capture check's answer: true = the whole screen is captured (the phone's chat is in the picture). */
    private var hudCaptured: Boolean? = null
    /** Written when the stream ends, read by the report thread. */
    @Volatile private var extrasReport: String? = null
    private var quotaAtStart = 0

    private fun startLiveExtras(r: Recorder) {
        extrasReport = null
        ytInfo = null; liveViewers = -1; liveLikes = -1; liveNote = null
        alertsShown = 0
        chatTimes.clear(); hudCaptured = null
        quotaAtStart = LiveExtras.Quota.used(this)
        val f = r.filter
        if (f != null) {
            scenes = SceneRenderer(this, f) { cover -> recorder?.setCover(cover) }.also { sr ->
                sr.data.manual = LiveExtras.goalManual(this).toLong()
                sr.onChanged = { hudScenes() }
                sr.start(r.plan.width, r.plan.height)
            }
        }
        val lc = LiveChat(this, chatListener)
        val hasChat = lc.hasYouTube || lc.hasTwitch
        if (hasChat) {
            chat = lc
            bot = ChatBot(LiveExtras.botConfig(this))
            lc.start()
            if (LiveExtras.trIn(this) || LiveExtras.trOut(this)) ChatTranslator.prepare(this)
        }
        val overlays = Settings.canDrawOverlays(this)
        if (hasChat && LiveExtras.hud(this) && overlays) {
            val h = ChatHud(this, hudActions)
            hud = h
            h.setStats(-1, -1, -1)
            h.setGiveaway(false, 0)
            h.setCanSend(false)
            hudScenes()
        }
        // the stream's chat, goal, counters… on the owner's own screen too, where they are on the stream
        val sr = scenes
        if (sr != null && overlays) mirror = OwnerMirror(this).also { m ->
            sr.onMirror = { items ->
                m.set(items)
                hud?.setMirror(chat = m.shown && items.any { it.kind == Scenes.Kind.CHAT }, stats = m.shown && items.any { it.numbers })
            }
        }
        if (f != null && (hud != null || mirror != null)) {
            // Shown once it is known for real whether viewers would see it (see CaptureProbe).
            probe = CaptureProbe(this, f, r.plan.width, r.plan.height, { liveCovered }) { captured ->
                probe = null
                RecLog.add(this, "chat panel: " + if (captured) "whole screen captured" else "only the game captured")
                if (stopping) return@CaptureProbe
                hudCaptured = captured
                hud?.show()
                hud?.setPrivate(!captured)
                mirror?.show()
                // the whole screen in the picture: what the phone shows is not drawn a second time
                scenes?.let { sr ->
                    sr.mirrorOn = mirror?.shown == true
                    sr.phoneChat = hud != null
                    sr.screenInPicture = captured
                    sr.push()
                }
            }
            main.postDelayed(startProbe, 1500)
        } else hud?.let { it.show(); it.setPrivate(false) }
        if (hasChat) main.postDelayed(botTick, 5000)
    }

    /** The editor saved while live: the scenes as they are now on the phone. */
    internal fun layoutChanged() {
        scenes?.reload()
        hudScenes()
    }

    /** The chat panel's scene and layer switches, as they are now. */
    private fun hudScenes() {
        val h = hud ?: return
        val sr = scenes
        if (sr == null) { h.setScenes(emptyList(), "", emptyList()); h.setChatOnStream(false); return }
        val sc = sr.showing
        h.setScenes(sr.project.scenes.map { it.id to it.name }, sc.id, sc.layers.map { Triple(it.id, it.name, it.visible) })
        h.setChatOnStream(sr.chatShown)
        // a scene of its own on the stream while the owner plays: viewers do not see the game, said plainly
        h.setLiveScene(if (!sc.game && !sr.isAway) sc.name else null)
    }

    private val startProbe = Runnable { if (!stopping) probe?.start() }

    private fun stopLiveExtras() {
        main.removeCallbacks(botTick)
        main.removeCallbacks(startProbe)
        try { probe?.cancel() } catch (_: Exception) {}
        probe = null
        val lc = chat
        val b = bot
        if (lc != null || alertsShown > 0) {
            val used = (LiveExtras.Quota.used(this) - quotaAtStart).coerceAtLeast(0)
            extrasReport = getString(R.string.live_rep_chat_fmt, Fmt.num(lc?.messages ?: 0), Fmt.num(lc?.newSubs ?: 0),
                Fmt.num(alertsShown), Fmt.num(b?.sent ?: 0), Fmt.num(b?.automodActions ?: 0)) +
                if (lc?.hasYouTube == true) "\n" + getString(R.string.live_rep_quota_fmt, Fmt.num(used), Fmt.num(LiveExtras.Quota.left(this))) else ""
        }
        try { lc?.stop() } catch (_: Exception) {}
        chat = null; bot = null
        ytInfo = null
        try { hud?.hide() } catch (_: Exception) {}
        hud = null
        try { scenes?.release() } catch (_: Exception) {}
        scenes = null
        try { mirror?.hide() } catch (_: Exception) {}
        mirror = null
    }

    private val botTick = object : Runnable {
        override fun run() {
            if (stopping || chat == null) return
            bot?.let { if (chat?.canSend == true) runBot(it.tick(vars())) }
            scenes?.expireChat(45_000, chatTimes)
            main.postDelayed(this, 5000)
        }
    }

    private fun vars(): ChatBot.Vars {
        val lc = chat
        val up = if (startedAt > 0) (System.currentTimeMillis() - startedAt) / 1000 else 0
        return ChatBot.Vars(viewers = lc?.viewers?.coerceAtLeast(0) ?: 0, subs = lc?.subs?.coerceAtLeast(0) ?: 0,
            likes = lc?.likes?.coerceAtLeast(0) ?: 0, uptimeS = up, goal = goalText())
    }

    /** The first goal bar of the scene on the stream, as a sentence for the bot's !goal. */
    private fun goalText(): String {
        val sr = scenes ?: return ""
        val g = sr.showing.layers.firstOrNull { it.kind == Scenes.Kind.GOAL } ?: sr.project.scenes.flatMap { it.layers }.firstOrNull { it.kind == Scenes.Kind.GOAL } ?: return ""
        val count = g.str("count", "subs")
        var v = sr.data.value(count)
        if (v >= 0 && g.bool("since", false)) v -= sr.data.base[count] ?: v
        return "${LayerPainter.vars(g.str("title"), sr.data)}: ${if (v < 0) "…" else Num.grouped(v)} / ${Num.grouped(g.int("target", 1000).toLong())}"
    }

    private fun alert(a: LayerPainter.Alert) {
        val sr = scenes ?: return
        alertsShown++
        sr.alert(a)
    }

    private val chatListener = object : LiveChat.Listener {
        override fun onMessage(m: LiveChat.Msg) { main.post { onChat(m) } }
        override fun onDeleted(id: String) {
            main.post { hud?.remove(id); scenes?.unchat(id) }
        }
        override fun onSubscriber(name: String?) {
            main.post {
                scenes?.counted(LayerPainter.AlertKind.SUBSCRIBER, 1, name ?: "")
                alert(LayerPainter.Alert(LayerPainter.AlertKind.SUBSCRIBER, name ?: ""))
            }
        }
        override fun onStats(s: LiveChat.Stats) {
            liveViewers = s.viewers; liveLikes = s.likes
            main.post {
                hud?.setStats(s.viewers, s.likes, s.subs)
                hud?.setCanSend(chat?.canSend == true)
                scenes?.stats(s.viewers, s.likes, s.subs)
            }
        }
        override fun onState(youtube: String?, twitch: String?) {
            main.post {
                val lines = listOfNotNull(youtube?.let { getString(R.string.chat_yt_fmt, it) }, twitch?.let { getString(R.string.chat_tw_fmt, it) })
                hud?.setState(lines.joinToString("\n").ifEmpty { null })
                hud?.setCanSend(chat?.canSend == true)
            }
        }
        override fun onActionFailed(text: String) { main.post { hud?.note(text) } }
        override fun onBroadcast(info: LiveChat.YtInfo) {
            ytInfo = info
            main.post { hud?.setLink(liveLink(info)) }
        }
        override fun onNote(text: String) { liveNote = text; main.post { hud?.note(text) } }
    }

    /** The stream's address on YouTube (the video itself; its chat opens beside it). */
    private fun liveLink(info: LiveChat.YtInfo) = "https://youtu.be/" + info.videoId

    private fun onChat(m: LiveChat.Msg) {
        if (stopping) return
        hud?.add(m)
        // A viewer writing in another language: shown to the owner in Persian (the stream keeps the original).
        if (hud != null && LiveExtras.trIn(this) && ChatTranslator.needsPersian(m.text)) {
            ChatTranslator.toPersian(this, m.text) { fa -> if (fa != null) main.post { hud?.setTranslation(m.id, fa); scenes?.ownerText(m.id, fa) } }
        }
        hud?.setCanSend(chat?.canSend == true)
        val b = bot
        if (m.history) { b?.markSeen(m.authorId); return }
        val text = when (m.kind) {
            LiveChat.Kind.SUPER, LiveChat.Kind.CHEER -> listOfNotNull(m.amount?.let { Num.ltr(it) }, m.text.ifBlank { null }).joinToString(" — ")
            else -> m.text
        }
        val accent = when (m.kind) {
            LiveChat.Kind.SUPER -> android.graphics.Color.argb(90, 255, 176, 32)
            LiveChat.Kind.MEMBER, LiveChat.Kind.SUB -> android.graphics.Color.argb(80, 61, 214, 140)
            LiveChat.Kind.GIFT, LiveChat.Kind.CHEER, LiveChat.Kind.RAID -> android.graphics.Color.argb(80, 186, 120, 255)
            else -> null
        }
        if (text.isNotBlank() || m.kind != LiveChat.Kind.CHAT) {
            chatTimes[m.id] = System.currentTimeMillis()
            if (chatTimes.size > 200) chatTimes.keys.take(100).forEach { chatTimes.remove(it) }
            scenes?.chat(LayerPainter.ChatLine(m.id, m.author, text, ChatHud.nameColor(m), accent))
        }
        val sr = scenes
        when (m.kind) {
            LiveChat.Kind.SUPER -> { sr?.counted(LayerPainter.AlertKind.SUPER, 1, m.author); alert(LayerPainter.Alert(LayerPainter.AlertKind.SUPER, m.author, m.amount, m.text)) }
            LiveChat.Kind.MEMBER -> { sr?.counted(LayerPainter.AlertKind.MEMBER); alert(LayerPainter.Alert(LayerPainter.AlertKind.MEMBER, m.author, m.amount)) }
            LiveChat.Kind.SUB -> { sr?.counted(LayerPainter.AlertKind.MEMBER); alert(LayerPainter.Alert(LayerPainter.AlertKind.SUBSCRIBER, m.author)) }
            LiveChat.Kind.GIFT -> {
                sr?.counted(LayerPainter.AlertKind.GIFT, m.amount?.toIntOrNull()?.coerceIn(1, 100) ?: 1)
                alert(LayerPainter.Alert(LayerPainter.AlertKind.GIFT, m.author, m.amount))
            }
            LiveChat.Kind.CHEER -> alert(LayerPainter.Alert(LayerPainter.AlertKind.CHEER, m.author, m.amount))
            LiveChat.Kind.RAID -> alert(LayerPainter.Alert(LayerPainter.AlertKind.RAID, m.author, m.amount))
            LiveChat.Kind.CHAT -> {}
        }
        if (b == null) return
        val yt = m.platform == LiveChat.Platform.YOUTUBE
        runBot(b.onMessage(ChatBot.In(m.id, m.authorId, m.author, m.text, m.owner, m.mod, m.member,
            canReply = yt && chat?.canSend == true, canModerate = m.canModerate), vars()))
        hud?.setGiveaway(b.giveawayWord != null, b.entries)
    }

    private fun runBot(outs: List<ChatBot.Out>) {
        val lc = chat ?: return
        for (o in outs) when (o) {
            is ChatBot.Out.Send -> sendOut(o.text, mine = false)
            is ChatBot.Out.Delete -> { lc.deleteId(o.id); hud?.remove(o.id); scenes?.unchat(o.id) }
            is ChatBot.Out.Timeout -> {
                // A time-out costs 200 of the day's 10 000: only while plenty is left (removing still works).
                if (LiveExtras.Quota.left(this) > 2_000) {
                    lc.timeout(o.authorId, o.seconds)
                    hud?.note(getString(R.string.hud_n_timeout_fmt, o.author, Fmt.num(o.seconds)))
                }
            }
            is ChatBot.Out.Winner -> {
                alert(LayerPainter.Alert(LayerPainter.AlertKind.GIVEAWAY, o.name, Fmt.num(o.entries)))
                hud?.note(getString(R.string.hud_n_winner_fmt, o.name, Fmt.num(o.entries)))
            }
        }
    }

    /**
     * A message into the chat. With the translator on, Persian goes out in the channel's language
     * (the owner sees what was sent); if it can't be translated the owner's message is not sent
     * as Persian by surprise (they can switch the panel's button to FA), the bot's goes as written.
     */
    private fun sendOut(text: String, mine: Boolean) {
        val lc = chat ?: return
        if (!lc.canSend) { if (mine) hud?.note(getString(R.string.hud_n_cant_send)); return }
        if (!LiveExtras.trOut(this) || !ChatTranslator.isPersian(text)) { lc.send(text); return }
        if (mine) hud?.note(getString(R.string.tr_translating))
        ChatTranslator.fromPersian(this, text) { out ->
            main.post {
                if (stopping) return@post
                when {
                    out != null -> { lc.send(out); if (mine) hud?.note(getString(R.string.tr_sent_fmt, out)) }
                    mine -> hud?.note(getString(R.string.tr_failed_fmt, ChatTranslator.error ?: ""))
                    else -> lc.send(text)
                }
            }
        }
    }

    private val hudActions = object : ChatHud.Actions {
        override fun send(text: String) = sendOut(text, mine = true)
        override fun delete(m: LiveChat.Msg) { chat?.delete(m); hud?.remove(m.id); scenes?.unchat(m.id) }
        override fun onScene(id: String) { scenes?.select(id) }
        override fun onLayer(id: String, on: Boolean) { scenes?.setLayerVisible(id, on) }
        override fun timeout(m: LiveChat.Msg, seconds: Int) {
            chat?.timeout(m, seconds)
            hud?.note(if (seconds > 0) getString(R.string.hud_n_timeout_fmt, m.author, Fmt.num(seconds)) else getString(R.string.hud_n_banned_fmt, m.author))
        }
        override fun giveawayStart() {
            val b = bot ?: return
            b.startGiveaway()?.let { if (chat?.canSend == true) chat?.send(it.text) }
            hud?.setGiveaway(true, 0)
            hud?.note(getString(R.string.hud_n_give_open_fmt, b.giveawayWord ?: ""))
        }
        override fun giveawayDraw() {
            val b = bot ?: return
            runBot(b.draw())
            hud?.setGiveaway(b.giveawayWord != null, b.entries)
        }
        override fun giveawayStop() {
            bot?.stopGiveaway()
            hud?.setGiveaway(false, 0)
        }
        override fun goalStep(d: Int) {
            val v = (LiveExtras.goalManual(this@RecordService) + d).coerceAtLeast(0)
            LiveExtras.setGoalManual(this@RecordService, v)
            scenes?.setManual(v.toLong())
            hud?.note(getString(R.string.hud_n_goal_manual_fmt, Fmt.num(v)))
        }
    }

    // ------------------------------------------------------------ floating control

    private var camAllowed = false

    private val pillActions = object : FloatingControl.Actions {
        override fun stop() = finishRecording(StopReason.CONTROL)
        override fun pauseToggle() = togglePause()
        override fun micToggle() {
            val r = recorder ?: return
            if (cfg?.usesMic != true) return
            r.micMuted = !r.micMuted
            control?.setMic(on = !r.micMuted, available = true)
        }
        override fun camToggle() {
            if (!camAllowed) return
            val f = facecam
            if (f != null) { try { f.hide() } catch (_: Exception) {}; facecam = null }
            else facecam = try { FacecamOverlay(this@RecordService, cfg?.facecam?.takeIf { it > 0 } ?: 2).also { it.show() } } catch (_: Exception) { null }
            control?.setCam(on = facecam != null, available = true)
        }
        override fun delete() { if (live == null) finishRecording(StopReason.DELETED) }
        override fun hideControl() {
            if (ghost) { ghostClose(); return }
            control?.hide()
            control = null
            controlHidden = true
            Toast.makeText(this@RecordService, R.string.eng_toast_control_hidden, Toast.LENGTH_LONG).show()
            notifyRecording()
        }
    }

    /** «نمایشِ دکمه» in the notification after the control was hidden. */
    private fun showControlAgain() {
        if (ghost) { ghostOpen(); return }
        if (!controlHidden || stopping || state == State.IDLE || state == State.SAVING) return
        val c = cfg ?: return
        if (!Settings.canDrawOverlays(this)) return
        control = makeControl(c)?.also { it.expand() }
        controlHidden = control == null
        main.removeCallbacks(pillTick)
        main.post(pillTick)
        notifyRecording()
    }

    // ------------------------------------------------------------ «کنترل در ویدیو دیده نشود»
    //
    // Android lets no ordinary app keep a window on the screen and out of a full-screen recording
    // (only the system's own recorder can). So the control is simply never on the screen while
    // frames are being written:
    //  • recording: nothing of RawRec on the screen — no panel, no dot, no invisible window;
    //  • a shake (or «نمایشِ کنترل» in the notification) pauses the recorder FIRST and only then
    //    puts the panel up — the recorder drops every frame from the pause on (Recorder.pause);
    //  • «ادامه» / «پنهان» / the header takes the panel down, and the recorder resumes
    //    [GHOST_RESUME_MS] later, when the screen without the panel has been composed. Frames older
    //    than the resume are dropped too (Recorder.resumeAtUs), so none with the panel gets in;
    //  • stop / delete on the panel end a recording that was already paused before the panel came.

    private fun ghostOf(c: RecordConfig) = c.ghostControl && c.floatingButton && !c.gameMode
    private val ghost get() = cfg?.let { ghostOf(it) } == true

    private fun ghostOpen() {
        val c = cfg ?: return
        if (!ghost || stopping || control != null) return
        if (state != State.RECORDING && state != State.PAUSED) return
        if (!Settings.canDrawOverlays(this)) return
        main.removeCallbacks(ghostResume)
        val r = recorder ?: return
        if (!r.paused) {
            r.pause()
            pausedSince = System.currentTimeMillis()
            state = State.PAUSED
        }
        control = makeControl(c)?.also { it.expand() }
        main.removeCallbacks(pillTick)
        main.post(pillTick)
        notifyRecording()
    }

    private fun ghostClose() {
        try { control?.blankThenHide() } catch (_: Exception) {}
        control = null
        main.removeCallbacks(pillTick)
        main.removeCallbacks(ghostResume)
        main.postDelayed(ghostResume, GHOST_RESUME_MS)
        notifyRecording()
    }

    private val ghostResume = Runnable {
        val r = recorder
        if (stopping || r == null || !r.paused || control != null || state != State.PAUSED) return@Runnable
        r.resume()
        startedAt += System.currentTimeMillis() - pausedSince
        state = State.RECORDING
        shake?.armedAtMs = SystemClock.elapsedRealtime() + 1_500
        notifyRecording()
    }

    private val pillTick = object : Runnable {
        override fun run() {
            val c = control ?: return
            if (state != State.RECORDING && state != State.PAUSED) return
            val now = if (state == State.PAUSED) pausedSince else System.currentTimeMillis()
            c.setTime(((now - startedAt) / 1000).coerceAtLeast(0))
            main.postDelayed(this, 1000)
        }
    }

    /** Takes every overlay window off the screen; nothing is left behind, visible or not. */
    private fun removeOverlays() {
        try { facecam?.hide() } catch (_: Exception) {}
        try { control?.hide() } catch (_: Exception) {}
        try { countdownView?.hide() } catch (_: Exception) {}
        facecam = null; control = null; countdownView = null
        cdToast?.cancel(); cdToast = null
        try { OverlayWindows.removeAll(this) } catch (_: Exception) {}
    }

    private var recoveries = 0

    /**
     * The one way a recording ends, whatever the cause. Every part is finalized as a playable MP4 and
     * [reason] is saved and written into «گزارشِ ضبط».
     */
    private fun finishRecording(reason: StopReason, detail: String? = null) {
        if (stopping) return
        stopping = true
        for (cb in listOf(pillTick, spaceCheck, followRotation, countdownStep, startAfterCountdown, testDone, ghostResume, geometryWatch)) main.removeCallbacks(cb)
        displayStop?.let { main.removeCallbacks(it) }
        displayStop = null
        stopShakeDetector()
        stopThermalWatch()
        unregisterDisplayListener()
        unregisterScreenReceiver()
        releaseScreen()
        stopLiveExtras()
        removeOverlays()
        val r = recorder
        val p = projection
        val c = cfg
        val started = r != null
        val delete = reason == StopReason.DELETED
        // «ضبطِ فوری»: a recording the owner ended keeps the permission for the next one (not after live).
        val keep = live == null && reason.byUser && instantEnabled(this) && p != null && keptDisplay != null && r != null
        val wasLive = live != null
        keepingPermission = keep
        val error: String? = if (reason.byUser) null else getString(reason.text)
        val fixes = recoveries
        state = State.SAVING
        notifyRecording()
        refreshTile()
        // A countdown cancelled by the owner recorded nothing: the last recording's reason stays.
        if (started || !reason.byUser) saveStop(this, reason, detail)
        // Finalizing big MP4 files can take a moment; do it off the main thread.
        Thread {
            var parts: List<SegMuxer.Part> = emptyList()
            var report: String? = null
            try {
                try { r?.stop() } catch (_: Throwable) {}
                try { r?.voiceMeter?.learn(this) } catch (_: Throwable) {}
                if (!keep) {
                    try { r?.virtualDisplay?.release() } catch (_: Throwable) {}
                    try { p?.stop() } catch (_: Throwable) {}
                }
                parts = r?.parts ?: emptyList()
                if (delete) {
                    // «حذفِ این ضبط» from the floating control: nothing is kept.
                    for (pt in parts) try { contentResolver.delete(pt.uri, null, null) } catch (_: Exception) {}
                    parts = emptyList()
                }
                if (r == null || r.allPartsClosed) ActiveRec.end(this)
                report = if (wasLive && c != null) liveReport(c, reason, detail)
                else if (r != null && c != null && !delete) buildReport(r, c, parts, reason, detail, fixes) else null
            } catch (_: Throwable) {
            } finally {
                main.post { afterSave(parts, report, error, c, started, delete) }
            }
        }.start()
    }

    private fun afterSave(parts: List<SegMuxer.Part>, report: String?, error: String?, c: RecordConfig?, started: Boolean, delete: Boolean) {
        try {
            if (!delete) saveLast(parts, report, error, c?.testSeconds ?: 0)
            if (isLive) showLiveDone(report, error)
            else if (delete) showDone(parts, getString(R.string.notice_deleted))
            else if (started || error != null) showDone(parts, error)
        } catch (_: Exception) {}
        state = State.IDLE
        startedAt = 0L; pausedSince = 0L; countdownLeft = 0
        recorder = null
        isLive = false; live = null; liveSink = null; liveCovered = false
        refreshTile()
        if (keepingPermission && projection != null && keptDisplay != null) {
            // «ضبطِ فوری»: stay in the foreground with the permission; the next start needs no dialog.
            instantReady = true
            try {
                startForeground(NOTIF_REC, readyNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            } catch (_: Exception) {
                releaseInstant()
                return
            }
            ReadyNotice.hide(this)
            IdleBubble.show(this)
            return
        }
        // Nothing is held on to: whatever is left of the permission goes back now.
        keptDisplay?.let { d -> try { d.release() } catch (_: Exception) {} }
        keptDisplay = null
        projection?.let { p -> try { p.stop() } catch (_: Exception) {} }
        projection = null
        instantReady = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        ReadyNotice.show(this)
        IdleBubble.show(this)
        stopSelf()
    }

    private var keepingPermission = false

    /** Gives the held capture permission back (owner's «پایان», the system's «توقفِ اشتراک», a lock). */
    private fun releaseInstant() {
        instantReady = false
        keepingPermission = false
        keptDisplay?.let { d -> try { d.release() } catch (_: Exception) {} }
        keptDisplay = null
        projection?.let { p -> try { p.stop() } catch (_: Exception) {} }
        projection = null
        if (state != State.IDLE) return
        try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Exception) {}
        ReadyNotice.show(this)
        IdleBubble.show(this)
        stopSelf()
    }

    /** While «ضبطِ فوری» holds the permission: one tap records (no dialog), «پایان» gives it back. */
    private fun readyNotification(): Notification {
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val rec = PendingIntent.getActivity(this, 12, QuickStartActivity.intent(this), flags)
        val release = PendingIntent.getService(this, 13, Intent(this, RecordService::class.java).setAction(ACTION_RELEASE), flags)
        return Notification.Builder(this, CH_REC)
            .setSmallIcon(R.drawable.eng_ic_rec)
            .setColor(getColor(R.color.eng_rec_red))
            .setContentTitle(getString(R.string.n_instant_title))
            .setContentText(getString(R.string.n_instant_text))
            .setStyle(Notification.BigTextStyle().bigText(getString(R.string.n_instant_text)))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(rec)
            .addAction(action(R.drawable.eng_ic_rec, getString(R.string.n_record), rec))
            .addAction(action(R.drawable.eng_ic_stop, getString(R.string.n_instant_release), release))
            .build()
    }

    /**
     * «گزارشِ ضبط» with the reason it ended right under the title (and why each later part began).
     * The stats card is tied to the exact report text, so its numbers are saved again for the new text.
     */
    private fun buildReport(r: Recorder, c: RecordConfig, parts: List<SegMuxer.Part>, reason: StopReason, detail: String?, fixes: Int): String? {
        val base = try {
            Texts.report(this, c, r.plan, r.stats, parts, r.videoBytes, r.droppedOptions, r.audioKbps, r.audioOk && c.hasAudio, r.muxWaitMs, null)
        } catch (_: Throwable) { null }
        val block = StringBuilder(getString(R.string.eng_rep_reason_fmt, getString(reason.text)))
        if (!detail.isNullOrBlank()) block.append('\n').append(getString(R.string.eng_rep_detail_fmt, Fmt.iso(detail)))
        for (pt in parts) {
            val why = when (pt.reason) {
                SegMuxer.REASON_SIZE -> R.string.eng_part_size
                SegMuxer.REASON_ROTATE -> R.string.eng_part_rotate
                SegMuxer.REASON_RECOVER -> R.string.eng_part_recover
                SegMuxer.REASON_RESTART -> R.string.eng_part_restart
                else -> 0
            }
            if (why != 0) block.append('\n').append(getString(R.string.eng_rep_part_fmt, pt.index, getString(why)))
        }
        if (fixes > 0) block.append('\n').append(getString(R.string.eng_rep_recovered_fmt, fixes))
        // «صدای یارها»: what each kind of sound did, and what was left out.
        r.voiceMeter?.let { m ->
            val s = m.summary()
            if (s.isNotEmpty()) {
                val parts = (VoiceSources.KINDS + VoiceSources.MIC).filter { s.containsKey(it) }.joinToString("، ") { k ->
                    getString(R.string.vs_rep_kind_fmt, getString(VoiceSources.nameRes(k)), Fmt.num(s[k]!!.first),
                        getString(if (k == VoiceSources.MIC || r.capturedKinds and k != 0) R.string.vs_in else R.string.vs_out))
                }
                block.append('\n').append(getString(R.string.vs_rep_fmt, parts))
                val missing = VoiceSources.KINDS.filter { it !in m.opened }
                if (missing.isNotEmpty()) block.append('\n').append(getString(R.string.vs_rep_not_measured_fmt,
                    missing.joinToString("، ") { getString(VoiceSources.nameRes(it)) }))
                val v = VoiceSources.voiceKind(this)
                block.append('\n').append(when {
                    v != 0 -> getString(R.string.vs_rep_voice_fmt, getString(VoiceSources.nameRes(v)),
                        getString(if (c.teamVoice) R.string.vs_team_in else R.string.vs_team_out))
                    VoiceSources.mixed(this) -> getString(R.string.vs_rep_mixed)
                    else -> getString(R.string.vs_rep_unknown)
                })
            }
        }
        when (r.aecState) {
            Recorder.AEC_ON -> block.append('\n').append(getString(R.string.vs_rep_aec_on))
            Recorder.AEC_NONE -> block.append('\n').append(getString(R.string.vs_rep_aec_none))
        }
        // «فشرده‌سازیِ هوشمند»: what the encoder reported, so the size is never a mystery.
        if (r.qpAverage > 0) block.append('\n').append(getString(R.string.eng_rep_smart_fmt, String.format(java.util.Locale.US, "%.1f", r.qpAverage),
            Fmt.num(maxOf(r.smartBitrate, 0) / 1_000_000)))
        else if (c.mode == RecordConfig.MODE_VBR) block.append('\n').append(getString(R.string.eng_rep_smart_none))
        if (base == null) return block.toString()
        val nl = base.indexOf('\n')
        val text = if (nl < 0) base + "\n" + block else base.substring(0, nl + 1) + block + "\n" + base.substring(nl + 1)
        try {
            ReportStats.load(this, base)?.let { m ->
                ReportStats.save(this, text, LinkedHashMap(m).apply {
                    remove("hash")
                    put("stop", reason.name)
                    put("stopByUser", reason.byUser.toString())
                    if (!reason.byUser) put("error", "1")
                })
            }
        } catch (_: Throwable) {}
        return text
    }

    private fun saveLast(parts: List<SegMuxer.Part>, report: String?, error: String?, test: Int) {
        val e = prefs.edit()
        e.putString(K_LAST_ERROR, error ?: "")
        if (parts.isNotEmpty()) {
            e.putString(K_LAST_URIS, parts.joinToString("\n") { it.uri.toString() })
            e.putString(K_LAST_NAMES, parts.joinToString("\n") { it.name })
            e.putLong(K_LAST_BYTES, parts.sumOf { it.bytes })
        }
        if (report != null) {
            e.putString(K_LAST_REPORT, report)
            e.putBoolean(K_LAST_IS_TEST, test > 0)
            e.putBoolean(K_REPORT_UNSEEN, true)
        }
        e.apply()
    }

    /**
     * The process is dying (uncaught exception, any thread): close the MP4 parts so the video is
     * playable, and save why. Waits at most a few seconds.
     */
    private fun emergencyFinish(e: Throwable) {
        if (crashHandled) return
        crashHandled = true
        val r = recorder ?: return
        try {
            r.emergencyStop(4_000)
            val parts = r.parts
            saveStop(this, StopReason.CRASH, e.toString(), commit = true)
            val ed = prefs.edit().putString(K_LAST_ERROR, getString(StopReason.CRASH.text))
            if (parts.isNotEmpty()) {
                ed.putString(K_LAST_URIS, parts.joinToString("\n") { it.uri.toString() })
                    .putString(K_LAST_NAMES, parts.joinToString("\n") { it.name })
                    .putLong(K_LAST_BYTES, parts.sumOf { it.bytes })
            }
            ed.commit()
            if (r.allPartsClosed) ActiveRec.end(this) else ActiveRec.reason(this, StopReason.CRASH)
        } catch (_: Throwable) {}
    }

    /** One line per kind: a repeated event replaces its line instead of piling up (1.2.2 showed «صفحه چرخید» three times). */
    private val notices = LinkedHashMap<String, String>()

    private fun addNotice(key: String, msg: String) {
        notices[key] = msg
        notice = notices.values.joinToString("\n")
        notifyRecording()
    }

    private fun removeNotice(key: String) {
        if (notices.remove(key) == null) return
        notice = notices.values.joinToString("\n")
        notifyRecording()
    }

    // ------------------------------------------------------------ Recorder.Events (any thread)

    private var displayStop: Runnable? = null

    override fun onFatal(reason: StopReason, detail: String) {
        main.post {
            if (stopping) return@post
            if (reason == StopReason.DISPLAY_STOPPED) {
                // The capture display usually stops because the projection did: let its (more
                // precise) reason come first.
                if (displayStop == null) displayStop = Runnable {
                    displayStop = null
                    finishRecording(if (screenIsOff()) StopReason.SCREEN_LOCKED else reason, detail)
                }.also { main.postDelayed(it, 300) }
            } else finishRecording(reason, detail)
        }
    }
    override fun onAudioProblem(message: String) {
        main.post {
            if (message.startsWith("rotate:")) addNotice("rotate", getString(R.string.notice_rotate_fail_fmt, message))
            else if (message.startsWith("look:")) addNotice("look", getString(R.string.eng_notice_look_fail))
            else addNotice("audio", getString(R.string.notice_audio_fmt, message))
            RecLog.add(this, "notice: $message")
        }
    }
    override fun onRotated(plan: CapturePlan, restarted: Boolean) {
        main.post {
            val c = cfg ?: return@post
            val r = recorder ?: return@post
            applied = Texts.applied(this, c, plan, r.droppedOptions, r.audioKbps, r.audioOk || !c.hasAudio)
            if (restarted) {
                // The first seconds were dropped: the file (and the timer) start now.
                startedAt = System.currentTimeMillis()
                if (state == State.PAUSED) pausedSince = startedAt
                addNotice("rotate", getString(R.string.notice_smart_restart_fmt, Fmt.size(plan.width, plan.height)))
            } else if (notices["rotate"]?.let { it == getString(R.string.eng_notice_resized_fmt, Fmt.size(plan.sourceWidth, plan.sourceHeight)) } != true) {
                addNotice("rotate", getString(R.string.notice_rotated_fmt, Fmt.size(plan.width, plan.height)))
            }
        }
    }
    override fun onPartOpened(index: Int, reason: Int) {
        if (index > 1 && reason == SegMuxer.REASON_SIZE) main.post { addNotice("split", getString(R.string.notice_split_fmt, index)) }
    }
    override fun onRecovered(count: Int, detail: String) {
        main.post {
            recoveries = count
            addNotice("recover", getString(R.string.eng_notice_recovered_fmt, count))
            RecLog.add(this, "encoder recovered #$count: $detail")
        }
    }
    override fun onWriteRecovered(detail: String) {
        main.post {
            addNotice("write", getString(R.string.eng_notice_write_recovered))
            RecLog.add(this, "write recovered: $detail")
        }
    }
    override fun onPartCreated(uri: Uri) = ActiveRec.partOpened(this, uri)
    override fun onPartFinished(uri: Uri) = ActiveRec.partClosed(this, uri)

    // ------------------------------------------------------------ heat

    /**
     * When the phone gets hot, Android slows the chip down and frames can be lost: said in the
     * notification and the report, so a dropped frame is never a mystery. Nothing is changed in the
     * recording by itself.
     */
    private var thermalListener: android.os.PowerManager.OnThermalStatusChangedListener? = null
    private var maxThermal = 0

    private fun startThermalWatch() {
        val pm = getSystemService(android.os.PowerManager::class.java) ?: return
        maxThermal = 0
        val l = android.os.PowerManager.OnThermalStatusChangedListener { s ->
            if (s > maxThermal) { maxThermal = s; RecLog.add(this, "thermal: $s") }
            if (s >= android.os.PowerManager.THERMAL_STATUS_SEVERE) addNotice("hot", getString(R.string.eng_notice_hot))
            else if (s < android.os.PowerManager.THERMAL_STATUS_MODERATE) removeNotice("hot")
        }
        try { pm.addThermalStatusListener(mainExecutor, l); thermalListener = l } catch (_: Exception) {}
    }

    private fun stopThermalWatch() {
        val l = thermalListener ?: return
        thermalListener = null
        try { getSystemService(android.os.PowerManager::class.java)?.removeThermalStatusListener(l) } catch (_: Exception) {}
    }

    // ------------------------------------------------------------ shake to stop

    private var shake: ShakeGesture? = null
    private val shakeListener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            val g = shake ?: return
            if (shakeOpens) {
                // «کنترل در ویدیو دیده نشود»: a shake brings the control (and pauses first).
                if (control != null || (state != State.RECORDING && state != State.PAUSED)) return
                if (g.onSample(e.values[0], e.values[1], e.values[2], e.timestamp / 1_000_000)) main.post { ghostOpen() }
                return
            }
            if (state != State.RECORDING) return
            if (g.onSample(e.values[0], e.values[1], e.values[2], e.timestamp / 1_000_000)) main.post { finishRecording(StopReason.SHAKE) }
        }
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }

    /** True: a shake opens the control ([ghostOpen]); false: a shake ends the recording. */
    private var shakeOpens = false

    private fun startShakeDetector(opens: Boolean) {
        val sm = getSystemService(SensorManager::class.java) ?: return
        val acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        shakeOpens = opens
        // Sensor time is elapsed-realtime based; nothing counts in the first 3 s. Opening the control
        // only pauses, so it takes a lighter shake than stopping (three swings instead of four).
        val g = if (opens) ShakeGesture(1.7f * SensorManager.GRAVITY_EARTH, 3) else ShakeGesture()
        shake = g.also { it.armedAtMs = SystemClock.elapsedRealtime() + 3_000 }
        sm.registerListener(shakeListener, acc, SensorManager.SENSOR_DELAY_GAME, main)
        sensorManager = sm
    }

    private fun stopShakeDetector() {
        try { sensorManager?.unregisterListener(shakeListener) } catch (_: Exception) {}
        sensorManager = null
        shake = null
    }

    // ------------------------------------------------------------ notifications

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CH_REC, getString(R.string.ch_rec), NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CH_DONE, getString(R.string.ch_done), NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun notifyRecording() {
        if (state == State.IDLE) return
        try { getSystemService(NotificationManager::class.java)?.notify(NOTIF_REC, recordingNotification()) } catch (_: Exception) {}
    }

    private fun action(icon: Int, title: String, pi: PendingIntent) =
        Notification.Action.Builder(Icon.createWithResource(this, icon), title, pi).build()

    private fun recordingNotification(): Notification {
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val stop = PendingIntent.getService(this, 1,
            Intent(this, RecordService::class.java).setAction(ACTION_STOP).putExtra(EXTRA_SRC, SRC_NOTIFICATION), flags)
        val pause = PendingIntent.getService(this, 4, Intent(this, RecordService::class.java).setAction(ACTION_PAUSE), flags)
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), flags)
        val s = state
        val r = recorder
        val ls = liveStatus
        val title = if (live != null && (s == State.RECORDING || s == State.PAUSED)) getString(when {
            liveCovered -> R.string.live_n_brb
            ls?.state == RtmpSink.State.RECONNECTING -> R.string.live_n_reconnecting
            ls?.state == RtmpSink.State.LIVE -> R.string.live_n_live
            else -> R.string.live_n_connecting
        }) else getString(when (s) {
            State.RECORDING -> R.string.n_recording
            State.PAUSED -> R.string.n_paused
            State.SAVING -> R.string.n_saving
            else -> R.string.n_preparing
        })
        val text = when (s) {
            State.PREPARING -> if (countdownLeft > 0) getString(R.string.n_countdown_fmt, countdownLeft) else getString(R.string.state_preparing)
            State.RECORDING, State.PAUSED -> if (live != null && ls != null)
                getString(R.string.live_n_text_fmt, String.format(java.util.Locale.US, "%.1f", ls.kbps / 1000.0), Fmt.num(ls.dropped))
            else r?.let { Texts.short(it.plan) } ?: ""
            State.SAVING -> getString(R.string.n_saving_text)
            else -> ""
        }
        val b = Notification.Builder(this, CH_REC)
            .setSmallIcon(R.drawable.eng_ic_rec)
            .setColor(getColor(R.color.eng_rec_red))
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
        if (notice.isNotEmpty()) b.setStyle(Notification.BigTextStyle().bigText(text + "\n" + notice))
        if (s == State.RECORDING) b.setUsesChronometer(true).setWhen(startedAt).setShowWhen(true)
        if (s == State.RECORDING || s == State.PAUSED) {
            if (live != null) b.addAction(action(R.drawable.ic_shield, getString(if (liveCovered) R.string.live_back else R.string.live_brb_action), pause))
            else b.addAction(action(if (s == State.PAUSED) R.drawable.eng_ic_play else R.drawable.eng_ic_pause,
                getString(if (s == State.PAUSED) R.string.n_resume else R.string.n_pause), pause))
        }
        if (s != State.SAVING) b.addAction(action(R.drawable.eng_ic_stop, getString(if (s == State.PREPARING) R.string.btn_cancel else if (live != null) R.string.live_end else R.string.n_stop), stop))
        if ((controlHidden || (ghost && control == null && (s == State.RECORDING || s == State.PAUSED))) && s != State.SAVING) {
            val show = PendingIntent.getService(this, 8, Intent(this, RecordService::class.java).setAction(ACTION_SHOW_CONTROL), flags)
            b.addAction(action(R.drawable.eng_ic_visible, getString(R.string.eng_n_show_control), show))
        }
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        return b.build()
    }

    private fun showLiveDone(report: String?, error: String?) {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val pi = PendingIntent.getActivity(this, 7, Intent(this, MainActivity::class.java).putExtra("show_report", true), flags)
        val text = error ?: report?.lines()?.drop(3)?.joinToString(" • ") ?: ""
        val b = Notification.Builder(this, CH_DONE).setSmallIcon(R.drawable.eng_ic_rec)
            .setColor(getColor(R.color.eng_rec_red)).setAutoCancel(true)
            .setContentTitle(getString(if (error == null) R.string.live_n_done else R.string.live_n_failed))
            .setContentText(text).setStyle(Notification.BigTextStyle().bigText(text)).setContentIntent(pi)
        try { nm.notify(NOTIF_DONE, b.build()) } catch (_: Exception) {}
    }

    private fun showDone(parts: List<SegMuxer.Part>, error: String?) {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        val b = Notification.Builder(this, CH_DONE).setSmallIcon(R.drawable.eng_ic_rec)
            .setColor(getColor(R.color.eng_rec_red)).setAutoCancel(true)
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val reportPi = PendingIntent.getActivity(this, 7, Intent(this, MainActivity::class.java).putExtra("show_report", true), flags)
        if (parts.isEmpty()) {
            b.setContentTitle(getString(R.string.n_not_saved))
            b.setContentText(error ?: "")
            if (!error.isNullOrEmpty()) b.setStyle(Notification.BigTextStyle().bigText(error))
            b.setContentIntent(reportPi)
        } else {
            val total = parts.sumOf { it.bytes }
            val more = if (parts.size > 1) getString(R.string.n_parts_fmt, parts.size) else ""
            val text = "${parts.first().name} • ${Fmt.bytes(total)}$more"
            b.setContentTitle(getString(if (error == null) R.string.n_saved else R.string.n_saved_err))
            b.setContentText(text)
            b.setStyle(Notification.BigTextStyle().bigText(text + (if (error != null) "\n$error" else "") + "\n" + getString(R.string.n_report_hint)))
            val view = Media.viewIntent(parts.first().uri)
            val openPi = PendingIntent.getActivity(this, 3, view, flags)
            val sharePi = PendingIntent.getActivity(this, 6, Media.shareChooser(this, parts.map { it.uri }), flags)
            b.setContentIntent(openPi)
            b.addAction(action(R.drawable.eng_ic_play, getString(R.string.action_open), openPi))
            b.addAction(action(R.drawable.eng_ic_share, getString(R.string.action_share), sharePi))
            b.addAction(action(R.drawable.eng_ic_report, getString(R.string.action_report), reportPi))
        }
        try { nm.notify(NOTIF_DONE, b.build()) } catch (_: Exception) {}
    }

    private fun refreshTile() {
        try { TileService.requestListeningState(this, ComponentName(this, RecTileService::class.java)) } catch (_: Exception) {}
    }

    override fun onDestroy() {
        // Destroyed while a recording is open (Android stopped the service): finish it properly.
        if (!stopping && state != State.IDLE) finishRecording(StopReason.SERVICE_ENDED)
        if (state == State.IDLE && instantReady) {
            instantReady = false
            keptDisplay?.let { d -> try { d.release() } catch (_: Exception) {} }
            keptDisplay = null
            projection?.let { p -> try { p.stop() } catch (_: Exception) {} }
            projection = null
        }
        removeOverlays()
        stopShakeDetector()
        stopThermalWatch()
        main.removeCallbacks(geometryWatch)
        unregisterDisplayListener()
        unregisterScreenReceiver()
        releaseScreen()
        if (!stopping) state = State.IDLE
        if (current?.get() === this) current = null
        super.onDestroy()
    }
}

/** Open and share intents for saved videos (MediaStore URIs owned by this app). */
object Media {
    fun viewIntent(uri: Uri): Intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "video/mp4")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)

    fun shareChooser(ctx: Context, uris: List<Uri>): Intent {
        val send = if (uris.size == 1) Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris.first())
        else Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
        send.type = "video/mp4"
        val clip = ClipData.newRawUri("video", uris.first())
        for (u in uris.drop(1)) clip.addItem(ClipData.Item(u))
        send.clipData = clip
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return Intent.createChooser(send, ctx.getString(R.string.share_title)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}

/** Stops the recording; [source] (RecordService.SRC_*) is saved as the reason it ended. */
fun Context.stopRecording(source: String = RecordService.SRC_APP) {
    startService(Intent(this, RecordService::class.java).setAction(RecordService.ACTION_STOP).putExtra(RecordService.EXTRA_SRC, source))
}

fun Context.togglePauseRecording() {
    startService(Intent(this, RecordService::class.java).setAction(RecordService.ACTION_PAUSE))
}
