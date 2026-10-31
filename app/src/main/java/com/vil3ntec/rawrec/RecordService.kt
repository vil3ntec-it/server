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
    PROCESS_DIED(R.string.eng_reason_killed, false);

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

        /** From the crash handler: finish a running recording so its file is saved before the process dies. */
        internal fun onProcessCrash(e: Throwable) {
            current?.get()?.emergencyFinish(e)
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    @Volatile private var projection: MediaProjection? = null
    @Volatile private var recorder: Recorder? = null
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
        if (data == null) { finishRecording(StopReason.START_FAILED, getString(R.string.err_no_projection)); return }

        try {
            val mpm = getSystemService(MediaProjectionManager::class.java) ?: throw IllegalStateException("no MediaProjectionManager")
            val p = mpm.getMediaProjection(code, data) ?: throw IllegalStateException("projection is null")
            projection = p
            p.registerCallback(object : MediaProjection.Callback() {
                // Android ended the capture: the screen locked (Android 15+), «Stop sharing» in the
                // status bar, another app started a capture or cast, or the recorded app went away.
                override fun onStop() { main.post { finishRecording(projectionStopReason()) } }
                // Rotation is NOT taken from onCapturedContentResize any more: in 1.2.2 it guessed an
                // orientation from the reported size, was not debounced, and asked for a switch the
                // wrong way. The debounced display listener is the only source now.

                // Android 14+ single-app capture: the recorded app left the screen; nothing new is
                // captured until it returns (the video holds the last picture). Said in the notice.
                override fun onCapturedContentVisibilityChanged(isVisible: Boolean) {
                    main.post {
                        if (state == State.IDLE || stopping) return@post
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
            val r = Recorder(this, p, c, plan, this)
            ActiveRec.begin(this)
            try { r.start() } catch (e: Exception) { ActiveRec.end(this); throw e }
            recorder = r
            startedAt = System.currentTimeMillis()
            recordStartWall = startedAt
            requestedSource = plan.sourceWidth to plan.sourceHeight
            policy = RotationPolicy(auto = c.orient == RecordConfig.ORIENT_AUTO, smartStart = c.smartStart).also {
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
        if (pol.follows(d.landscape) || resized) r.holdFramesFrom(System.nanoTime() / 1000)
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
        override fun delete() = finishRecording(StopReason.DELETED)
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
        removeOverlays()
        val r = recorder
        val p = projection
        val c = cfg
        val started = r != null
        val delete = reason == StopReason.DELETED
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
                try { p?.stop() } catch (_: Throwable) {}
                parts = r?.parts ?: emptyList()
                if (delete) {
                    // «حذفِ این ضبط» from the floating control: nothing is kept.
                    for (pt in parts) try { contentResolver.delete(pt.uri, null, null) } catch (_: Exception) {}
                    parts = emptyList()
                }
                if (r == null || r.allPartsClosed) ActiveRec.end(this)
                report = if (r != null && c != null && !delete) buildReport(r, c, parts, reason, detail, fixes) else null
            } catch (_: Throwable) {
            } finally {
                main.post { afterSave(parts, report, error, c, started, delete) }
            }
        }.start()
    }

    private fun afterSave(parts: List<SegMuxer.Part>, report: String?, error: String?, c: RecordConfig?, started: Boolean, delete: Boolean) {
        try {
            if (!delete) saveLast(parts, report, error, c?.testSeconds ?: 0)
            if (delete) showDone(parts, getString(R.string.notice_deleted))
            else if (started || error != null) showDone(parts, error)
        } catch (_: Exception) {}
        state = State.IDLE
        startedAt = 0L; pausedSince = 0L; countdownLeft = 0
        recorder = null
        projection = null
        refreshTile()
        stopForeground(STOP_FOREGROUND_REMOVE)
        ReadyNotice.show(this)
        stopSelf()
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
        val title = getString(when (s) {
            State.RECORDING -> R.string.n_recording
            State.PAUSED -> R.string.n_paused
            State.SAVING -> R.string.n_saving
            else -> R.string.n_preparing
        })
        val text = when (s) {
            State.PREPARING -> if (countdownLeft > 0) getString(R.string.n_countdown_fmt, countdownLeft) else getString(R.string.state_preparing)
            State.RECORDING, State.PAUSED -> r?.let { Texts.short(it.plan) } ?: ""
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
            b.addAction(action(if (s == State.PAUSED) R.drawable.eng_ic_play else R.drawable.eng_ic_pause,
                getString(if (s == State.PAUSED) R.string.n_resume else R.string.n_pause), pause))
        }
        if (s != State.SAVING) b.addAction(action(R.drawable.eng_ic_stop, getString(if (s == State.PREPARING) R.string.btn_cancel else R.string.n_stop), stop))
        if ((controlHidden || (ghost && control == null && (s == State.RECORDING || s == State.PAUSED))) && s != State.SAVING) {
            val show = PendingIntent.getService(this, 8, Intent(this, RecordService::class.java).setAction(ACTION_SHOW_CONTROL), flags)
            b.addAction(action(R.drawable.eng_ic_visible, getString(R.string.eng_n_show_control), show))
        }
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        return b.build()
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
