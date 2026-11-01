package com.vil3ntec.rawrec

import android.Manifest
import android.animation.AnimatorSet
import android.animation.ArgbEvaluator
import android.animation.LayoutTransition
import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.provider.MediaStore
import android.provider.Settings
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextUtils
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StyleSpan
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.util.concurrent.Executors

/**
 * RawRec's screen (1.5 design). Five destinations — «ضبط», «ویدیوها», «کیفیت», «تنظیمات» (a list
 * of sub-pages with back) and «درباره» — in a bottom bar on phones and in a navigation rail on the
 * start side when the window is wide (tablets, landscape). Every screen is built once and swapped
 * in place; the 500 ms refresh only updates texts and state.
 *
 * Look: res/values/colors.xml (palette), dimens.xml (spacing, radii, type sizes), styles.xml
 * (type scale, chips, buttons) and the drawable/ic_* icon set (design/icons.py). No colour is
 * written here as a number.
 */
class MainActivity : Activity() {

    enum class Tab { HOME, QUALITY, VIDEOS, SETTINGS, ABOUT }
    enum class Sub { NONE, VIDEO, AUDIO, CONTROLS, STORAGE, PERMS, LANG }

    override fun attachBaseContext(newBase: Context) = super.attachBaseContext(AppLang.wrap(newBase))

    private val REQ_CAPTURE = 10
    private val REQ_PERMS = 11
    private val REQ_ONE = 12
    private val REQ_DELETE = 13

    private val prefs by lazy { getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE) }
    private val ui = Handler(Looper.getMainLooper())
    private val tickR = Runnable { tick() }
    private val bg = Executors.newSingleThreadExecutor()

    private lateinit var disp: DisplayInfo
    private var cfg = RecordConfig()
    private var plan: CapturePlan? = null
    private var pendingTest = 0
    private var built = false
    private var resetNote = false
    private var tab = Tab.HOME
    private var sub = Sub.NONE

    // window classes (decided once per configuration; rotation recreates the activity)
    private var tablet = false          // smallest width ≥ 600 dp
    private var rail = false            // navigation rail instead of the bottom bar
    private var twoPane = false         // home: the stage beside the quick settings
    private var compactHeight = false   // landscape phone: smaller dial
    private var contentWidthDp = 0

    private lateinit var content: FrameLayout
    private var navBar: View? = null
    private val navItems = LinkedHashMap<Tab, View>()
    private val screens = HashMap<Tab, View>()
    private val subPages = HashMap<Sub, View>()

    // home
    private lateinit var stateDetail: TextView
    private lateinit var btnRecord: Button
    private lateinit var btnTest: Button
    private lateinit var planLine: TextView
    private lateinit var gameHint: TextView
    // quality
    private lateinit var planText: TextView
    private lateinit var altButton: Button
    // settings pages
    private lateinit var storageFree: TextView
    private lateinit var storageUsed: TextView
    private lateinit var storageMinutes: TextView
    private lateinit var storageMeter: LinearLayout
    private lateinit var permBox: LinearLayout
    private val subValues = HashMap<Sub, TextView>()
    // videos
    private lateinit var videoBox: LinearLayout
    private lateinit var videosEmpty: View
    private lateinit var videosSummary: TextView
    // about
    private lateinit var versionText: TextView
    private lateinit var deviceText: TextView
    private lateinit var reportStats: LinearLayout
    private lateinit var reportText: TextView
    private lateinit var reportActions: View
    private lateinit var crashText: TextView
    private lateinit var crashButtons: View

    private val rows = HashMap<String, Row>()
    private val toggles = HashMap<String, Toggle>()
    private var resValues = intArrayOf(0)
    private var lookImage: android.widget.ImageView? = null
    private var lookCaption: TextView? = null
    private var lookSummary: TextView? = null
    private var lookShown: String? = null
    private var fpsValues = intArrayOf(0)
    private val brValues = intArrayOf(RecordConfig.BR_AUTO_HIGH, RecordConfig.BR_AUTO_BALANCED, RecordConfig.BR_MAX, 6, 10, 15, 20, 30, 50)
    private val gains = floatArrayOf(0.5f, 0.75f, 1f, 1.5f, 2f, 3f)
    private val countdowns = intArrayOf(0, 3, 5, 10)

    private val presetIcons = listOf(R.drawable.ic_bolt, R.drawable.ic_speed, R.drawable.ic_leaf, R.drawable.ic_tune)
    private val orientIcons = listOf(R.drawable.ic_rotate, R.drawable.ic_portrait, R.drawable.ic_gamepad)
    private val audioIcons = listOf(R.drawable.ic_volume_off, R.drawable.ic_gamepad, R.drawable.ic_mic, R.drawable.ic_headset)

    // ------------------------------------------------------------ lifecycle

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            disp = DisplayInfo.read(this)
            runCatching { Encoders.probeAv1Muxer(this) }
            // Only real reductions: 1440p on a 1504 px screen resampled every pixel by 4 % — the whole
            // video softer for 8 % less data.
            resValues = (listOf(0) + (if (maxOf(disp.width, disp.height) < 3840) listOf(RecordConfig.RES_4K) else emptyList()) +
                listOf(1440, 1080, 720).filter { it <= minOf(disp.width, disp.height) * 0.8 }).toIntArray()
            fpsValues = (listOf(0) + listOf(30, 60, 90, 120, 144, 165, 240).filter { it < disp.refresh }).toIntArray()
            cfg = loadConfig()
            setContentView(buildUi())
            built = true
            savedInstanceState?.let { b ->
                tab = runCatching { Tab.valueOf(b.getString("tab") ?: "HOME") }.getOrDefault(Tab.HOME)
                sub = runCatching { Sub.valueOf(b.getString("sub") ?: "NONE") }.getOrDefault(Sub.NONE)
                if (b.getInt("segment", 0) == 1 && tab == Tab.HOME) tab = Tab.VIDEOS   // state saved by 1.4
            }
            show(tab, sub)
            refreshAll()
        } catch (e: Throwable) {
            failed(e, "onCreate")
            return
        }
        if (resetNote) toast(R.string.settings_reset_note)
        if (savedInstanceState == null) handleIntent(intent)
        CrashLog.pending(this)?.let { showPreviousCrash(it) }
        AppLang.syncSystem(this)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("tab", tab.name)
        outState.putString("sub", sub.name)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        safely("onNewIntent") { handleIntent(intent) }
    }

    private fun handleIntent(i: Intent?) {
        if (i?.getBooleanExtra("autostart", false) == true && !RecordService.isRecording) onStartClicked(0)
        if (i?.getBooleanExtra("show_report", false) == true) ui.post { show(Tab.ABOUT); showReportDialog() }
    }

    override fun onResume() {
        super.onResume()
        safely("onResume") {
            if (SafePrefs.bool(prefs, "await_overlay", false)) {
                prefs.edit().putBoolean("await_overlay", false).apply()
                val test = SafePrefs.int(prefs, "await_test", 0)
                if (Settings.canDrawOverlays(this)) onStartClicked(test) else toast(R.string.toast_overlay_denied)
            }
            refreshAll()
            ReadyNotice.show(this)
            IdleBubble.hide(this)   // RawRec itself is open: its own big button is right here
            IdleBubble.undismiss()
            if (tab == Tab.VIDEOS) refreshVideos()
            if (tab == Tab.ABOUT) refreshAbout()
            tick()
            // the report opens by itself after a test recording, or when a recording ended by itself
            // (screen locked, storage full, encoder lost …) so the owner sees why
            if (SafePrefs.bool(prefs, RecordService.K_REPORT_UNSEEN, false) && RecordService.state == RecordService.State.IDLE &&
                (SafePrefs.bool(prefs, RecordService.K_LAST_IS_TEST, false) || runCatching { RecordService.lastStopUnexpected(this) }.getOrDefault(false))) showReportDialog()
        }
    }

    override fun onStop() {
        super.onStop()
        // Left RawRec (to a game): the floating record button is there.
        if (RecordService.state == RecordService.State.IDLE) IdleBubble.show(this)
    }

    override fun onPause() {
        super.onPause()
        ui.removeCallbacks(tickR)
    }

    override fun onDestroy() {
        bg.shutdownNow()
        pulseAnim?.cancel()
        blinkAnim?.cancel()
        super.onDestroy()
    }

    /** Back: sub-page → settings list → «ضبط» → leave. */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            !built -> @Suppress("DEPRECATION") super.onBackPressed()
            sub != Sub.NONE -> show(Tab.SETTINGS, Sub.NONE)
            tab != Tab.HOME -> show(Tab.HOME)
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    // ------------------------------------------------------------ safety net

    private fun failed(e: Throwable, where: String) {
        runCatching { CrashLog.write(this, e, "MainActivity.$where") }
        built = false
        ui.removeCallbacks(tickR)
        setContentView(crashView(CrashLog.pending(this) ?: e.toString(), now = true))
    }

    /** Every tap goes through here: an exception becomes a toast plus an error-report entry, never silence. */
    private fun act(name: String, f: () -> Unit) {
        try { f() } catch (e: Throwable) {
            runCatching { CrashLog.write(this, e, "tap: $name", handled = true) }
            runCatching { Toast.makeText(this, str(R.string.error_action_fmt, e.javaClass.simpleName + (e.message?.let { ": $it" } ?: "")), Toast.LENGTH_LONG).show() }
        }
    }

    private fun View.onTap(name: String, f: () -> Unit) = setOnClickListener { act(name, f) }

    private inline fun safely(where: String, block: () -> Unit) {
        if (!built) return
        try { block() } catch (e: Throwable) { failed(e, where) }
    }

    private fun crashView(trace: String, now: Boolean): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(40), dp(20), dp(24))
            setBackgroundColor(col(R.color.bg))
        }
        root.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_bug)
            imageTintList = ColorStateList.valueOf(col(R.color.error))
            background = roundBg(col(R.color.error_soft), 16)
            scaleType = ImageView.ScaleType.CENTER
        }, LinearLayout.LayoutParams(dp(56), dp(56)))
        root.addView(text(str(if (now) R.string.crash_now_title else R.string.crash_title), R.style.Text_Headline), lp(16))
        root.addView(text(str(if (now) R.string.crash_now_desc else R.string.crash_desc), R.style.Text_Body), lp(6))
        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(smallButton(R.string.crash_copy, R.drawable.ic_copy) { copyText(trace) })
            addView(smallButton(R.string.crash_share, R.drawable.ic_share) { shareText(trace) }, LinearLayout.LayoutParams(WRAP_CONTENT, dp(48)).apply { marginStart = dp(8) })
        }, lp(16))
        root.addView(text(trace, R.style.Text_Mono).apply {
            setBackgroundResource(R.drawable.bg_inset)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            textDirection = View.TEXT_DIRECTION_LTR
        }, lp(16))
        return ScrollView(this).apply { setBackgroundColor(col(R.color.bg)); addView(root) }
    }

    private fun showPreviousCrash(trace: String) {
        AlertDialog.Builder(this)
            .setIcon(icon(R.drawable.ic_bug, 24, tint(R.color.error)))
            .setTitle(if (trace.contains("(app kept running)")) R.string.error_title else R.string.crash_title)
            .setMessage(str(R.string.crash_desc) + "\n\n" + trace.take(3000))
            .setPositiveButton(R.string.crash_copy) { _, _ -> act("crash copy") { copyText(trace); CrashLog.clear(this) } }
            .setNeutralButton(R.string.crash_share) { _, _ -> act("crash share") { shareText(trace); CrashLog.clear(this) } }
            .setNegativeButton(R.string.crash_close) { _, _ -> CrashLog.clear(this) }
            .show()
    }

    private fun copyText(t: String) {
        runCatching { getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("RawRec", t)) }
        toast(R.string.toast_copied)
    }

    private fun shareText(t: String) {
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, t), str(R.string.crash_share)))
    }

    // ------------------------------------------------------------ settings

    private fun loadConfig(): RecordConfig {
        val p = prefs
        val i = { k: String, d: Int -> SafePrefs.int(p, k, d) }
        var base = RecordConfig.fromPrefs(p)
        // 1.3 changed the size model: video settings saved by earlier versions (e.g. a «50 Mbps»
        // chip tapped while trying 1.2.2) go back to the new default once; audio/controls are kept.
        if (i("cfg_ver", 0) < 3) {
            if (p.contains("c_preset")) resetNote = true
            base = RecordConfig.withPreset(base, RecordConfig.PRESET_SCREEN)
            p.edit().putInt("cfg_ver", 3).apply()
            cfg = base
            saveConfigOf(base)
        }
        // 1.9: on screens faster than 60 Hz, «مثلِ صفحه (حداکثر)» recorded games at 120/165 fps: two to
        // three times the frames per second for the same bits, so fights, fast turns and explosions
        // turned blocky, the phone got hot and the files big. 60 fps keeps every frame sharp at the
        // full resolution. Moved once; choosing «مثلِ صفحه» again afterwards is kept.
        if (i("cfg_ver", 0) < 4) {
            if (base.preset == RecordConfig.PRESET_SCREEN && DisplayInfo.read(this).refresh > 60) {
                base = RecordConfig.withPreset(base, RecordConfig.PRESET_60)
            }
            p.edit().putInt("cfg_ver", 4).apply()
            cfg = base
            saveConfigOf(base)
        }
        // 2.3: a size just below the screen's (e.g. 1440p on a 1504 px screen) blurred every pixel:
        // back to the screen's own size once.
        if (i("cfg_ver", 0) < 5) {
            val d = DisplayInfo.read(this)
            if (base.resShort > 0 && base.resShort != RecordConfig.RES_4K && base.resShort > minOf(d.width, d.height) * 0.8) base = base.copy(resShort = 0)
            p.edit().putInt("cfg_ver", 5).apply()
            cfg = base
            saveConfigOf(base)
        }
        // 2.4: «جزئیاتِ دور» is new; a look already in use gets it at medium, once.
        if (i("cfg_ver", 0) < 6) {
            if (base.lookSharp > 0 && base.lookClarity == 0) base = base.copy(lookClarity = 2)
            p.edit().putInt("cfg_ver", 6).apply()
            cfg = base
            saveConfigOf(base)
        }
        // 2.6: the six-button control is on the screen during a recording again (the owner could not
        // find it with «کنترل در ویدیو دیده نشود» on and had to stop from the notification). It opens
        // full and shrinks to a small dot after 5 s; one tap opens it.
        if (i("cfg_ver", 0) < 7) {
            base = base.copy(ghostControl = false, invisibleControl = false, floatingButton = true)
            p.edit().putInt("cfg_ver", 7).apply()
            cfg = base
            saveConfigOf(base)
        }
        // 2.9: «سفارشی» at 120 fps with a fixed 50 Mbps and sharpening off made game text blocky and soft
        // (the owner's screenshots). Once: the best for games — the screen's own size, 60 fps, automatic
        // high bit rate, «زنده برای بازی». Everything can be chosen again afterwards.
        if (i("cfg_ver", 0) < 8) {
            val bad = base.fps > 60 || base.bitrate > 0 || base.lookSharp == 0 || base.preset == RecordConfig.PRESET_CUSTOM
            if (bad) {
                base = RecordConfig.withPreset(base, RecordConfig.PRESET_60).let { if (it.lookSharp == 0) it.withLook(2) else it }
                if (base.resShort != RecordConfig.RES_4K) base = base.copy(resShort = 0)
            }
            p.edit().putInt("cfg_ver", 8).apply()
            cfg = base
            saveConfigOf(base)
        }
        // 2.9: the owner wants Android's «کلِ صفحه یا یک برنامه» window before each recording: «هر بار
        // بپرس» once; «فقط بارِ اول» stays one tap away in the settings.
        if (i("cfg_ver", 0) < 9) {
            p.edit().putBoolean(RecordService.PREF_INSTANT, false).putInt("cfg_ver", 9).apply()
            if (RecordService.instantReady) try { startService(Intent(this, RecordService::class.java).setAction(RecordService.ACTION_RELEASE)) } catch (_: Exception) {}
        }
        return if (base.preset == RecordConfig.PRESET_CUSTOM) base else RecordConfig.withPreset(base, base.preset)
    }

    private fun saveConfig() = saveConfigOf(cfg)

    private fun saveConfigOf(c: RecordConfig) {
        prefs.edit()
            .putInt("c_preset", c.preset).putInt("c_res", c.resShort).putInt("c_orient", c.orient)
            .putInt("c_fps", c.fps).putInt("c_codec", c.codec).putInt("c_br", c.bitrate).putInt("c_mode", c.mode)
            .putInt("c_audio", c.audioMode).putFloat("c_gg", c.gameGain).putFloat("c_mg", c.micGain)
            .putInt("c_cd", c.countdown).putBoolean("c_shake", c.shakeStop).putInt("c_cam", c.facecam)
            .putBoolean("c_float", c.floatingButton).putBoolean("c_invis", c.invisibleControl).putBoolean("c_ghost", c.ghostControl)
            .putBoolean("c_smart", c.smartStart).putBoolean("c_game", c.gameMode).putBoolean("c_rotnew", c.rotateNewFile)
            .putInt("c_lk_sharp", c.lookSharp).putInt("c_lk_con", c.lookContrast).putInt("c_lk_col", c.lookColor)
            .putInt("c_lk_bri", c.lookBright).putInt("c_lk_warm", c.lookWarm).putInt("c_lk_cla", c.lookClarity)
            .apply()
    }

    /** A video-quality change while a preset is active turns the preset into «سفارشی». */
    private fun change(videoQuality: Boolean, f: (RecordConfig) -> RecordConfig) {
        var c = f(cfg)
        if (videoQuality) c = c.copy(preset = RecordConfig.PRESET_CUSTOM)
        cfg = c
        saveConfig()
        refreshAll()
    }

    // ------------------------------------------------------------ design-system builders

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun dpf(v: Float) = v * resources.displayMetrics.density
    private fun col(id: Int) = getColor(id)
    private fun csl(id: Int): ColorStateList = getColorStateList(id)
    private fun tint(id: Int): ColorStateList = ColorStateList.valueOf(col(id))

    /**
     * getString(id, *args) always runs String.format, even with no args: a literal "%" in a resource
     * ("100% means unchanged.") then throws (the 1.2 launch crash). Format only when there are args.
     */
    private fun str(id: Int, vararg a: Any): String = if (a.isEmpty()) getString(id) else getString(id, *a)
    private fun text(s: CharSequence, style: Int): TextView = TextView(this, null, 0, style).apply { text = s }
    private fun lp(top: Int = 0) = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(top) }
    private fun wrap(top: Int = 0) = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(top) }
    private fun square(sizeDp: Int) = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))

    private fun roundBg(color: Int, radiusDp: Int, stroke: Int = 0, strokeColor: Int = 0) = GradientDrawable().apply {
        cornerRadius = dpf(radiusDp.toFloat()); setColor(color); if (stroke > 0) setStroke(dp(stroke), strokeColor)
    }

    private fun oval(color: Int) = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }

    /** A copy of an icon sized for a compound drawable; [tint] null leaves it to the view's drawableTint. */
    private fun icon(res: Int, sizeDp: Int = 20, tint: ColorStateList? = null): Drawable? =
        getDrawable(res)?.mutate()?.apply {
            setBounds(0, 0, dp(sizeDp), dp(sizeDp))
            if (tint != null) setTintList(tint)
        }

    /** Text size from the type scale in dimens.xml. */
    private fun TextView.sizeRes(id: Int) = setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, resources.getDimension(id))

    private fun <T : TextView> T.startIcon(res: Int, sizeDp: Int = 18, tint: ColorStateList? = null, padDp: Int = 8): T {
        setCompoundDrawablesRelative(icon(res, sizeDp, tint), null, null, null)
        compoundDrawablePadding = dp(padDp)
        return this
    }

    private fun iconView(res: Int, tintRes: Int): ImageView = ImageView(this).apply {
        setImageResource(res)
        imageTintList = tint(tintRes)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    /** 40 dp rounded tile with a 20 dp icon at the start of a row; blue while [View.isActivated]. */
    private fun iconTile(res: Int): ImageView = ImageView(this).apply {
        setImageResource(res)
        setBackgroundResource(R.drawable.bg_icon_tile)
        imageTintList = csl(R.color.tile_icon)
        setPadding(dp(10), dp(10), dp(10), dp(10))
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    /** The red brand tile with the record-in-frame mark (same drawing as the launcher icon). */
    private fun logoTile(sizeDp: Int): ImageView = ImageView(this).apply {
        setImageResource(R.drawable.ic_logo_mark)
        setBackgroundResource(R.drawable.bg_logo)
        imageTintList = tint(R.color.on_accent)
        val p = dp(sizeDp) / 5
        setPadding(p, p, p, p)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    /** A 48 dp round icon button; the description is what TalkBack reads. */
    private fun iconButton(res: Int, desc: String, tag: String, filled: Boolean = false, click: () -> Unit): ImageView = ImageView(this).apply {
        setImageResource(res)
        imageTintList = tint(R.color.text_primary)
        setBackgroundResource(if (filled) R.drawable.bg_icon_btn_filled else R.drawable.bg_icon_btn)
        scaleType = ImageView.ScaleType.CENTER
        contentDescription = desc
        this.tag = tag
        isClickable = true
        isFocusable = true
        onTap(tag) { click() }
    }

    private fun badge(label: String, fg: Int, bgc: Int, ic: Int = 0): TextView = text(label, R.style.Badge).apply {
        backgroundTintList = tint(bgc)
        setTextColor(col(fg))
        if (ic != 0) startIcon(ic, 14, tint(fg), 4)
    }

    private fun divider(startDp: Int = 0, endDp: Int = 0, top: Int = 0): View = View(this).apply {
        setBackgroundColor(col(R.color.stroke))
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, dp(1)).apply { marginStart = dp(startDp); marginEnd = dp(endDp); topMargin = dp(top) }
    }

    private fun cardTitle(title: String, ic: Int = 0): TextView = text(title, R.style.Text_Title).apply {
        gravity = Gravity.CENTER_VERTICAL
        if (ic != 0) startIcon(ic, 20, tint(R.color.sel), 10)
    }

    private fun card(parent: LinearLayout, title: Int?, ic: Int = 0, top: Int = 12): LinearLayout {
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.bg_card)
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        if (title != null) c.addView(cardTitle(str(title), ic))
        parent.addView(c, lp(top))
        return c
    }

    /** Keeps a button's icon right beside its centred label, whatever the button's width. */
    private fun Button.centerIcon() {
        addOnLayoutChangeListener { v, l, _, r, _, _, _, _, _ ->
            val b = v as Button
            val d = b.compoundDrawablesRelative[0] ?: return@addOnLayoutChangeListener
            val textW = b.paint.measureText(b.text.toString())
            val content = textW + d.bounds.width() + b.compoundDrawablePadding
            val pad = ((r - l - content) / 2f).toInt().coerceAtLeast(dp(16))
            if (b.paddingStart != pad || b.paddingEnd != pad) b.post { b.setPaddingRelative(pad, b.paddingTop, pad, b.paddingBottom) }
        }
    }

    private fun button(label: String, style: Int, ic: Int = 0, h: Int = 48, top: Int = 12): Button = Button(this, null, 0, style).apply {
        text = label
        if (ic != 0) { setCompoundDrawablesRelative(icon(ic, 20), null, null, null); centerIcon() }
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, dp(h)).apply { topMargin = dp(top) }
    }

    private fun smallButton(label: Int, ic: Int, click: () -> Unit) = Button(this, null, 0, R.style.Button_Small).apply {
        text = str(label)
        setCompoundDrawablesRelative(icon(ic, 18), null, null, null)
        onTap(str(label)) { click() }
    }

    private fun buttonRow(vararg b: Button): View = HorizontalScrollView(this).apply {
        isHorizontalScrollBarEnabled = false
        addView(LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            b.forEachIndexed { i, x -> addView(x, LinearLayout.LayoutParams(WRAP_CONTENT, dp(48)).apply { if (i > 0) marginStart = dp(8) }) }
        })
    }

    /** An icon + sentence line (storage facts, notes); the icon sits on the first line. */
    private fun infoLine(ic: Int, s: CharSequence, style: Int = R.style.Text_Body, iconTint: Int = R.color.text_tertiary): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(iconView(ic, iconTint), LinearLayout.LayoutParams(dp(18), dp(18)).apply { topMargin = dp(1); marginEnd = dp(12) })
            addView(text(s, style), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        }

    private val LinearLayout.lineText get() = getChildAt(1) as TextView

    /** A titled group of selectable chips with a one-line explanation. Vertical = full-width choice cards. */
    private inner class Row(
        parent: LinearLayout, title: String, desc: String, labels: List<CharSequence>,
        vertical: Boolean = false, ic: Int = 0, chipIcons: List<Int>? = null, top: Int = 20,
        private val onPick: (Int) -> Unit,
    ) {
        val descView: TextView = text(desc, R.style.Text_Caption)
        private val group = RadioGroup(this@MainActivity).apply { orientation = if (vertical) RadioGroup.VERTICAL else RadioGroup.HORIZONTAL }
        val buttons = ArrayList<RadioButton>()
        private var silent = false
        val root = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL }

        init {
            if (title.isNotEmpty()) root.addView(text(title, R.style.Text_Label).apply {
                if (ic != 0) startIcon(ic, 18, tint(R.color.text_secondary), 8)
                gravity = Gravity.CENTER_VERTICAL
            }, lp(top))
            if (desc.isNotEmpty()) root.addView(descView, lp(4))
            for ((i, l) in labels.withIndex()) {
                val b = RadioButton(this@MainActivity, null, 0, if (vertical) R.style.Chip_Wide else R.style.Chip)
                b.id = View.generateViewId()
                b.isClickable = true
                b.isFocusable = true
                b.text = l
                val chipIcon = chipIcons?.getOrNull(i) ?: 0
                if (vertical) b.setCompoundDrawablesRelative(if (chipIcon != 0) icon(chipIcon, 24) else null, null, icon(R.drawable.radio_mark, 22), null)
                else if (chipIcon != 0) b.setCompoundDrawablesRelative(icon(chipIcon, 18), null, null, null)
                if (vertical) group.addView(b, RadioGroup.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(8) })
                else group.addView(b, RadioGroup.LayoutParams(WRAP_CONTENT, dp(48)).apply { marginEnd = dp(8) })
                buttons += b
            }
            group.setOnCheckedChangeListener { _, id ->
                if (!silent) { val i = buttons.indexOfFirst { it.id == id }; if (i >= 0) act(title.ifEmpty { "choice" }) { onPick(i) } }
            }
            if (vertical) root.addView(group, lp(if (title.isEmpty() && desc.isEmpty()) 0 else 12))
            else root.addView(HorizontalScrollView(this@MainActivity).apply { isHorizontalScrollBarEnabled = false; addView(group) }, lp(8))
            parent.addView(root)
        }

        fun select(i: Int) {
            silent = true
            if (i in buttons.indices) { if (!buttons[i].isChecked) group.check(buttons[i].id) } else group.clearCheck()
            silent = false
        }
    }

    /** Icon tile, title, one-line description and a switch; the whole row toggles it. */
    private inner class Toggle(parent: LinearLayout, tag: String, ic: Int, title: String, desc: String, top: Int = 4, private val onChange: (Boolean) -> Unit) {
        val sw = Switch(this@MainActivity).apply {
            this.tag = "$tag:switch"
            isClickable = false   // the whole row toggles it
            isFocusable = false
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        private val tile = iconTile(ic)
        val descView: TextView = text(desc, R.style.Text_Caption)
        val root: LinearLayout = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.bg_row)
            setPadding(dp(8), dp(10), dp(8), dp(10))
            minimumHeight = dp(64)
            isClickable = true
            isFocusable = true
            this.tag = tag
            addView(tile, square(40))
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(title, R.style.Text_Label))
                addView(descView, lp(2))
            }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = dp(14); marginEnd = dp(12) })
            addView(sw, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
            onTap(tag) { onChange(!sw.isChecked) }
        }

        init { parent.addView(root, lp(top)) }

        fun set(on: Boolean) {
            if (sw.isChecked != on) sw.isChecked = on
            tile.isActivated = on
            if (Build.VERSION.SDK_INT >= 30) root.stateDescription = str(if (on) R.string.on else R.string.off)
        }

        fun enable(e: Boolean) {
            root.isEnabled = e
            root.isClickable = e
            sw.isEnabled = e
            tile.isEnabled = e
        }
    }

    private fun onOff() = listOf(str(R.string.off), str(R.string.on))

    private class Page(val scroll: ScrollView, val col: LinearLayout, val sub: TextView)

    /** A scrolling page with a large title (and a back button on the settings sub-pages). */
    private fun page(title: Int, subtitle: Int = 0, back: Boolean = false): Page {
        val side = if (contentWidthDp > 760) (contentWidthDp - 720) / 2 else 16
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPaddingRelative(dp(side), dp(8), dp(side), dp(32))
        }
        val subView = text(if (subtitle != 0) str(subtitle) else "", R.style.Text_Body).apply {
            visibility = if (subtitle != 0) View.VISIBLE else View.GONE
        }
        col.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(64)
            if (back) addView(iconButton(R.drawable.ic_back, str(R.string.back), "back") { show(Tab.SETTINGS, Sub.NONE) },
                LinearLayout.LayoutParams(dp(48), dp(48)).apply { marginEnd = dp(8); marginStart = -dp(8) })
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(str(title), if (back) R.style.Text_Title else R.style.Text_Headline).apply { if (back) sizeRes(R.dimen.text_subpage_title) })
                addView(subView, lp(2))
            }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        })
        val sv = ScrollView(this).apply { setBackgroundColor(col(R.color.bg)); isFillViewport = true; addView(col) }
        return Page(sv, col, subView)
    }

    // ------------------------------------------------------------ frame: navigation bar / rail

    private fun buildUi(): View {
        val c = resources.configuration
        tablet = c.smallestScreenWidthDp >= 600
        rail = c.screenWidthDp >= 600
        contentWidthDp = c.screenWidthDp - if (rail) 88 else 0
        twoPane = contentWidthDp >= 720
        compactHeight = c.screenHeightDp < 520
        screens[Tab.HOME] = buildHome()
        screens[Tab.VIDEOS] = buildVideos()
        screens[Tab.QUALITY] = buildQuality()
        screens[Tab.SETTINGS] = buildSettings()
        screens[Tab.ABOUT] = buildAbout()
        subPages[Sub.VIDEO] = buildSubVideo()
        subPages[Sub.AUDIO] = buildSubAudio()
        subPages[Sub.CONTROLS] = buildSubControls()
        subPages[Sub.STORAGE] = buildSubStorage()
        subPages[Sub.PERMS] = buildSubPerms()
        subPages[Sub.LANG] = buildSubLang()
        content = FrameLayout(this).apply { setBackgroundColor(col(R.color.bg)) }
        val root = LinearLayout(this).apply {
            setBackgroundColor(col(R.color.bg))
            layoutDirection = if (resources.getBoolean(R.bool.force_rtl)) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LOCALE
        }
        if (rail) {
            root.orientation = LinearLayout.HORIZONTAL
            root.addView(buildRail(), LinearLayout.LayoutParams(dp(88), MATCH_PARENT))
            root.addView(content, LinearLayout.LayoutParams(0, MATCH_PARENT, 1f))
        } else {
            root.orientation = LinearLayout.VERTICAL
            root.addView(content, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
            val bar = buildBottomBar()
            navBar = bar
            root.addView(bar, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener { v, insets ->
                val sb = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
                if (rail) v.setPadding(sb.left, sb.top, sb.right, sb.bottom)
                else { v.setPadding(sb.left, sb.top, sb.right, 0); navBar?.setPadding(0, 0, 0, sb.bottom) }
                insets
            }
        } else {
            @Suppress("DEPRECATION")
            window.navigationBarColor = col(if (rail) R.color.bg else R.color.surface)
        }
        return root
    }

    private val navOrder get() = listOf(
        Triple(Tab.HOME, R.string.tab_record, R.drawable.ic_rec),
        Triple(Tab.VIDEOS, R.string.tab_videos, R.drawable.ic_library),
        Triple(Tab.QUALITY, R.string.tab_quality, R.drawable.ic_quality),
        Triple(Tab.SETTINGS, R.string.tab_settings, R.drawable.ic_settings),
        Triple(Tab.ABOUT, R.string.tab_about, R.drawable.ic_info),
    )

    /** One destination: icon in a pill indicator (blue when selected) over a short label. */
    private fun navItem(t: Tab, label: Int, ic: Int): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundResource(R.drawable.bg_nav_item)
        isClickable = true
        isFocusable = true
        tag = "nav:${t.name}"
        contentDescription = str(label)
        addView(FrameLayout(this@MainActivity).apply {
            setBackgroundResource(R.drawable.bg_nav_indicator)
            addView(ImageView(this@MainActivity).apply {
                setImageResource(ic)
                imageTintList = csl(R.color.nav_tint)
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER))
        }, LinearLayout.LayoutParams(dp(56), dp(32)))
        addView(text(str(label), R.style.Text_Nav).apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO },
            LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(4) })
        onTap("nav ${t.name}") { show(t) }
        navItems[t] = this
    }

    private fun buildBottomBar(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setBackgroundResource(R.drawable.bg_navbar)
        tag = "navbar"
        val inner = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(4), dp(4), dp(4), dp(4))
            for ((t, label, ic) in navOrder) addView(navItem(t, label, ic), LinearLayout.LayoutParams(0, dp(64), 1f).apply { marginStart = dp(2); marginEnd = dp(2) })
        }
        addView(inner, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }

    private fun buildRail(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setBackgroundResource(R.drawable.bg_rail)
        tag = "rail"
        setPadding(dp(4), dp(if (compactHeight) 8 else 20), dp(4), dp(8))
        if (!compactHeight) addView(logoTile(40), LinearLayout.LayoutParams(dp(40), dp(40)).apply { bottomMargin = dp(20) })
        for ((t, label, ic) in navOrder) addView(navItem(t, label, ic), LinearLayout.LayoutParams(MATCH_PARENT, dp(if (compactHeight) 64 else 72)).apply { topMargin = dp(2) })
    }

    /** Switch to a destination (or a settings sub-page). */
    private fun show(t: Tab, s: Sub = Sub.NONE) {
        tab = t
        sub = if (t == Tab.SETTINGS) s else Sub.NONE
        val v = (if (sub != Sub.NONE) subPages[sub] else screens[t]) ?: return
        attach(v)
        (v as? ScrollView)?.scrollTo(0, 0)
        for ((k, item) in navItems) item.isSelected = k == t
        when (t) {
            Tab.VIDEOS -> refreshVideos()
            Tab.ABOUT -> refreshAbout()
            else -> {}
        }
    }

    private fun attach(v: View?) {
        v ?: return
        if (content.getChildAt(0) !== v) {
            content.removeAllViews()
            (v.parent as? ViewGroup)?.removeView(v)
            content.addView(v, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        }
    }

    // ------------------------------------------------------------ «ضبط»: the stage and quick settings

    private lateinit var hero: FrameLayout
    private lateinit var sheet: LinearLayout
    private lateinit var timerPill: TextView
    private lateinit var dialCaption: TextView
    private lateinit var circle: FrameLayout
    private lateinit var pulse1: View
    private lateinit var pulse2: View
    private lateinit var ringBg: GradientDrawable
    private lateinit var glow: GradientDrawable
    private lateinit var statusChip: LinearLayout
    private lateinit var statusDot: View
    private lateinit var statusText: TextView
    private lateinit var heroStatus: TextView
    private lateinit var heroPause: ImageView
    private lateinit var camToggle: Toggle
    private lateinit var micToggle: Toggle
    private var pulseAnim: AnimatorSet? = null
    private var blinkAnim: ObjectAnimator? = null
    private var stageAnim: ValueAnimator? = null
    private var ringFill = 0
    private var ringStroke = 0
    private var glowColor = 0

    private fun buildHome(): View {
        hero = buildStage()
        sheet = buildQuick()
        if (twoPane) {
            val start = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), dp(8), dp(8), dp(16))
                addView(topBar())
                addView(hero, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f).apply { topMargin = dp(8) })
            }
            val end = ScrollView(this).apply {
                isVerticalScrollBarEnabled = false
                setPadding(dp(8), dp(16), dp(16), dp(16))
                clipToPadding = false
                addView(sheet)
            }
            val paneW = minOf(440, contentWidthDp * 45 / 100)
            return LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setBackgroundColor(col(R.color.bg))
                addView(start, LinearLayout.LayoutParams(0, MATCH_PARENT, 1f))
                addView(end, LinearLayout.LayoutParams(dp(paneW), MATCH_PARENT))
            }
        }
        val colView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(4), dp(16), dp(24))
            addView(topBar())
            addView(hero, lp(8))
            addView(sheet, lp(16))
        }
        return ScrollView(this).apply {
            setBackgroundColor(col(R.color.bg))
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(colView)
        }
    }

    private fun topBar(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(56)
        if (!rail) addView(logoTile(36), LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(12) })
        addView(LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            addView(text(str(R.string.app_name), R.style.Text_Title))
            addView(text(str(R.string.tagline_short), R.style.Text_Caption).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END })
        }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        addView(text(str(R.string.version_fmt, BuildInfo.version(this@MainActivity)), R.style.Badge).apply { tag = "version" })
    }

    /** The record stage: status chip, dial with the timer, the record / stop pill and the plan line. */
    private fun buildStage(): FrameLayout {
        val ringDp = when { compactHeight -> 128; tablet -> 216; else -> 168 }
        val frameDp = (ringDp * 1.3f).toInt()
        glowColor = col(R.color.glow_idle)
        glow = GradientDrawable().apply {
            gradientType = GradientDrawable.RADIAL_GRADIENT
            gradientRadius = dpf(ringDp * 1.2f)
            setGradientCenter(0.5f, 0.38f)
            cornerRadius = dpf(28f)
            colors = intArrayOf(glowColor, col(R.color.transparent))
        }
        val stage = FrameLayout(this).apply {
            tag = "hero"
            background = LayerDrawable(arrayOf(getDrawable(R.drawable.bg_stage)!!, glow))
        }
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(20), dp(if (compactHeight) 12 else 20), dp(20), dp(if (compactHeight) 12 else 20))
        }

        statusDot = View(this).apply { setBackgroundResource(R.drawable.bg_dot); backgroundTintList = tint(R.color.success) }
        statusText = text(str(R.string.state_idle), R.style.Text_Label).apply { sizeRes(R.dimen.text_small) }
        statusChip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.bg_badge)
            backgroundTintList = tint(R.color.surface_3)
            setPaddingRelative(dp(12), dp(6), dp(14), dp(6))
            tag = "status"
            addView(statusDot, LinearLayout.LayoutParams(dp(8), dp(8)))
            addView(statusText, wrap().apply { marginStart = dp(8) })
        }
        c.addView(statusChip, wrap())

        // dial: ring with the timer inside, two pulse rings behind it while recording
        circle = FrameLayout(this).apply { tag = "circle"; importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }
        pulse1 = View(this).apply { background = oval(col(R.color.accent_soft)); alpha = 0f }
        pulse2 = View(this).apply { background = oval(col(R.color.accent_soft)); alpha = 0f }
        ringFill = col(R.color.dial_fill)
        ringStroke = col(R.color.stroke_strong)
        ringBg = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(ringFill); setStroke(dp(2), ringStroke) }
        circle.addView(pulse1, FrameLayout.LayoutParams(dp(ringDp), dp(ringDp), Gravity.CENTER))
        circle.addView(pulse2, FrameLayout.LayoutParams(dp(ringDp), dp(ringDp), Gravity.CENTER))
        circle.addView(View(this).apply { background = ringBg }, FrameLayout.LayoutParams(dp(ringDp), dp(ringDp), Gravity.CENTER))
        timerPill = text("00:00:00", R.style.Text_Timer).apply {
            tag = "timer"
            textSize = ringDp * 0.19f
            setTextColor(col(R.color.text_secondary))
            maxLines = 1
        }
        dialCaption = text("", R.style.Text_Caption).apply {
            textAlignment = View.TEXT_ALIGNMENT_CENTER
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        circle.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            addView(timerPill, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(dialCaption, lp(2))
        }, FrameLayout.LayoutParams(dp(ringDp - 28), WRAP_CONTENT, Gravity.CENTER))
        c.addView(circle, LinearLayout.LayoutParams(dp(frameDp), dp(frameDp)).apply { topMargin = dp(if (compactHeight) 0 else 4) })

        // the record / stop pill and, while recording, a round pause button beside it
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        btnRecord = Button(this, null, 0, R.style.Button_Record).apply {
            text = str(R.string.home_start)
            minWidth = dp(208)
            tag = "record"
            setCompoundDrawablesRelative(icon(R.drawable.ic_rec, 22), null, null, null)
            centerIcon()
            onTap("record") { onRecordClicked() }
        }
        actions.addView(btnRecord, LinearLayout.LayoutParams(WRAP_CONTENT, dp(56)))
        heroPause = iconButton(R.drawable.ic_pause, str(R.string.pill_pause), "heroPause", filled = true) {
            togglePauseRecording(); ui.postDelayed({ tick() }, 150)
        }.apply { visibility = View.GONE }
        actions.addView(heroPause, LinearLayout.LayoutParams(dp(56), dp(56)).apply { marginStart = dp(12) })
        c.addView(actions, wrap(if (compactHeight) 4 else 12))

        // what will be recorded; tap = «کیفیت»
        heroStatus = text("", R.style.Text_Body).apply {
            sizeRes(R.dimen.text_small)
            setLineSpacing(0f, 1.2f)
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.bg_inset_button)
            setPaddingRelative(dp(14), dp(10), dp(12), dp(10))
            minHeight = dp(48)
            compoundDrawablePadding = dp(12)
            tag = "planLine"
            isClickable = true
            isFocusable = true
            onTap("plan line") { if (RecordService.state == RecordService.State.IDLE) show(Tab.QUALITY) }
        }
        setPlanLineIcons(true)
        c.addView(heroStatus, lp(16))
        // keep the old names working for the shared refresh code
        stateDetail = heroStatus
        planLine = heroStatus

        if (twoPane) {
            stage.addView(ScrollView(this).apply {
                isFillViewport = true
                isVerticalScrollBarEnabled = false
                addView(FrameLayout(this@MainActivity).apply {
                    addView(c, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.CENTER))
                })
            }, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        } else stage.addView(c, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        return stage
    }

    private var planLineIdle: Boolean? = null

    private fun setPlanLineIcons(idle: Boolean) {
        if (planLineIdle == idle) return
        planLineIdle = idle
        heroStatus.setCompoundDrawablesRelative(
            icon(if (idle) R.drawable.ic_tune else R.drawable.ic_info, 20, tint(R.color.text_secondary)), null,
            if (idle) icon(R.drawable.ic_chevron, 18, tint(R.color.text_tertiary)) else null, null,
        )
    }

    /** «تنظیماتِ سریع»: facecam, voice, quality preset, orientation, the 10-second test. */
    private fun buildQuick(): LinearLayout {
        val s = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.bg_card)
            setPadding(dp(12), dp(16), dp(12), dp(16))
            tag = "sheet"
        }
        s.addView(cardTitle(str(R.string.quick_title), R.drawable.ic_tune).apply { setPaddingRelative(dp(4), 0, dp(4), 0) })
        camToggle = Toggle(s, "opt:cam", R.drawable.ic_face, str(R.string.opt_cam_title), str(R.string.opt_cam_desc), top = 8) { onOptionRow("opt:cam") }
        micToggle = Toggle(s, "opt:mic", R.drawable.ic_mic, str(R.string.opt_mic_title), str(R.string.opt_mic_desc)) { onOptionRow("opt:mic") }
        val chips = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPaddingRelative(dp(4), 0, dp(4), 0) }
        s.addView(chips)
        rows["homePreset"] = Row(chips, str(R.string.opt_preset_title), str(R.string.home_preset_desc),
            listOf(str(R.string.preset_screen), str(R.string.preset_60), str(R.string.preset_light), str(R.string.preset_custom)),
            ic = R.drawable.ic_quality, chipIcons = presetIcons, top = 16) { i ->
            if (i == RecordConfig.PRESET_CUSTOM) change(false) { it.copy(preset = i) } else change(false) { RecordConfig.withPreset(it, i) }
        }
        rows["homeOrient"] = Row(chips, str(R.string.opt_orient_title), str(R.string.home_orient_desc),
            listOf(str(R.string.orient_auto), str(R.string.orient_portrait), str(R.string.orient_landscape_game)),
            ic = R.drawable.ic_rotate, chipIcons = orientIcons) { i -> change(false) { it.copy(orient = i) } }
        btnTest = button(str(R.string.btn_test), R.style.Button_Secondary, R.drawable.ic_timer, top = 20).apply {
            onTap("test 10 s") { onStartClicked(10) }
        }
        chips.addView(btnTest)
        gameHint = text("", R.style.Text_Caption).apply {
            setBackgroundResource(R.drawable.bg_inset)
            setPaddingRelative(dp(12), dp(10), dp(12), dp(10))
            startIcon(R.drawable.ic_lightbulb, 18, tint(R.color.warning), 10)
        }
        chips.addView(gameHint, lp(12))
        return s
    }

    private fun onOptionRow(tag: String) {
        when (tag) {
            "opt:cam" -> change(false) { it.copy(facecam = if (it.facecam > 0) 0 else 2) }
            "opt:mic" -> change(false) {
                it.copy(audioMode = when (it.audioMode) {
                    RecordConfig.AUDIO_NONE -> RecordConfig.AUDIO_MIC
                    RecordConfig.AUDIO_INTERNAL -> RecordConfig.AUDIO_BOTH
                    RecordConfig.AUDIO_MIC -> RecordConfig.AUDIO_NONE
                    else -> RecordConfig.AUDIO_INTERNAL
                })
            }
        }
    }

    /** A closed card with a chevron; tapping the header opens it with an animation. */
    private inner class Section(parent: LinearLayout, key: String, private val title: Int, desc: Int, ic: Int) {
        val body = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            tag = "section:$key:body"
            setPadding(dp(10), 0, dp(10), dp(12))
        }
        private val chevron = iconView(R.drawable.ic_expand, R.color.text_secondary)
        private val tile = iconTile(ic)
        val header: LinearLayout = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(64)
            isClickable = true
            isFocusable = true
            tag = "section:$key"
            contentDescription = str(title) + " — " + str(R.string.expand)
            setBackgroundResource(R.drawable.bg_row)
            setPadding(dp(10), dp(10), dp(10), dp(10))
            addView(tile, square(40))
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(str(title), R.style.Text_Label))
                addView(text(str(desc), R.style.Text_Caption), lp(2))
            }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = dp(14); marginEnd = dp(8) })
            addView(chevron, square(24))
            onTap("section $key") { toggle() }
        }
        val open get() = body.visibility == View.VISIBLE

        init {
            val card = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundResource(R.drawable.bg_card)
                setPadding(dp(6), dp(6), dp(6), dp(6))
                layoutTransition = LayoutTransition().apply { enableTransitionType(LayoutTransition.CHANGING) }
            }
            card.addView(header)
            card.addView(body)
            parent.addView(card, lp(12))
        }

        fun toggle() {
            val show = !open
            body.visibility = if (show) View.VISIBLE else View.GONE
            tile.isActivated = show
            chevron.animate().rotation(if (show) 180f else 0f).setDuration(200).start()
            header.contentDescription = str(title) + " — " + str(if (show) R.string.collapse else R.string.expand)
        }
    }

    // ------------------------------------------------------------ «ویدیوها»

    private fun buildVideos(): View {
        val pg = page(R.string.tab_videos, R.string.page_videos_sub)
        videosSummary = pg.sub
        val root = pg.col
        root.addView(infoLine(R.drawable.ic_info, str(R.string.videos_hint), R.style.Text_Caption), lp(4))
        videosEmpty = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundResource(R.drawable.bg_card)
            setPadding(dp(24), dp(32), dp(24), dp(24))
            tag = "videosEmpty"
            addView(ImageView(this@MainActivity).apply {
                setImageResource(R.drawable.ic_library)
                imageTintList = tint(R.color.sel)
                background = oval(col(R.color.sel_soft))
                scaleType = ImageView.ScaleType.FIT_CENTER
                setPadding(dp(20), dp(20), dp(20), dp(20))
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, square(72))
            addView(text(str(R.string.videos_empty_title), R.style.Text_Title).apply { textAlignment = View.TEXT_ALIGNMENT_CENTER }, wrap(16))
            addView(text(str(R.string.videos_empty), R.style.Text_Body).apply { textAlignment = View.TEXT_ALIGNMENT_CENTER; gravity = Gravity.CENTER }, lp(4))
            addView(Button(this@MainActivity, null, 0, R.style.Button_Tonal).apply {
                text = str(R.string.videos_empty_action)
                setCompoundDrawablesRelative(icon(R.drawable.ic_rec, 18), null, null, null)
                setPaddingRelative(dp(18), 0, dp(22), 0)
                onTap("empty: go record") { show(Tab.HOME) }
            }, LinearLayout.LayoutParams(WRAP_CONTENT, dp(48)).apply { topMargin = dp(20) })
        }
        root.addView(videosEmpty, lp(16))
        videoBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(videoBox, lp(4))
        return pg.scroll
    }

    private val thumbCache = HashMap<Long, android.graphics.Bitmap?>()
    private val fpsCache = HashMap<Long, Double?>()

    private fun refreshVideos() {
        if (!::videoBox.isInitialized) return
        val items = VideoLibrary.query(this)
        videoBox.removeAllViews()
        videosEmpty.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        videosSummary.text = if (items.isEmpty()) str(R.string.page_videos_sub)
        else str(R.string.videos_count_fmt, items.size, Fmt.bytes(items.sumOf { it.bytes }))
        val lang = AppLang.get(this)
        for (it in items) videoBox.addView(videoRow(it, lang), lp(10))
    }

    private fun videoSubtitle(v: VideoItem, fps: Double?): String {
        val parts = ArrayList<String>()
        parts += Fmt.bytes(v.bytes)
        if (v.width > 0 && v.height > 0) {
            parts += Fmt.size(v.width, v.height)
            fps?.let { parts += Fmt.fps(Math.round(it).toInt()) }
        } else parts += str(R.string.unknown_value)
        return parts.joinToString(" • ")
    }

    /** A video card: 16:9 thumbnail with duration and a play mark, date, size • resolution • fps, and ⋮. */
    private fun videoRow(v: VideoItem, lang: String): View {
        val thumb = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER
            setImageResource(R.drawable.ic_movie)
            imageTintList = tint(R.color.text_tertiary)
            contentDescription = null
        }
        val thumbBox = FrameLayout(this).apply {
            setBackgroundResource(R.drawable.bg_thumb)
            clipToOutline = true
            addView(thumb, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            addView(ImageView(this@MainActivity).apply {
                setImageResource(R.drawable.ic_play)
                imageTintList = tint(R.color.on_accent)
                setBackgroundResource(R.drawable.bg_scrim_pill)
                scaleType = ImageView.ScaleType.FIT_CENTER
                setPadding(dp(8), dp(8), dp(7), dp(8))
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, FrameLayout.LayoutParams(dp(32), dp(32), Gravity.CENTER))
            addView(text(Fmt.iso(VideoLibrary.duration(v.durationMs)), R.style.Badge).apply {
                setBackgroundResource(R.drawable.bg_scrim_pill)
                backgroundTintList = null
                setTextColor(col(R.color.on_accent))
                sizeRes(R.dimen.text_micro)
                setPadding(dp(6), dp(2), dp(6), dp(2))
            }, FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.BOTTOM or Gravity.END).apply { setMargins(dp(6), dp(6), dp(6), dp(6)) })
        }
        val sub = text(videoSubtitle(v, fpsCache[v.id]), R.style.Text_Caption)
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.bg_row_card)
            setPaddingRelative(dp(10), dp(10), dp(4), dp(10))
            minimumHeight = dp(96)
            isClickable = true
            isLongClickable = true
            isFocusable = true
            tag = "video:${v.id}"
            addView(thumbBox, LinearLayout.LayoutParams(dp(if (tablet) 160 else 128), dp(if (tablet) 90 else 72)))
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(VideoLibrary.title(v, lang), R.style.Text_Label).apply { maxLines = 2; ellipsize = TextUtils.TruncateAt.END })
                addView(sub, lp(4))
            }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = dp(14); marginEnd = dp(4) })
            addView(iconButton(R.drawable.ic_more, str(R.string.video_more), "video-more:${v.id}") { videoMenu(v) }.apply {
                imageTintList = tint(R.color.text_secondary)
            }, square(48))
            onTap("open video") { startActivity(Media.viewIntent(v.uri)) }
            setOnLongClickListener { act("video menu") { videoMenu(v) }; true }
        }
        fun setThumb(bmp: android.graphics.Bitmap) {
            thumb.scaleType = ImageView.ScaleType.CENTER_CROP
            thumb.setImageBitmap(bmp)
            thumb.imageTintList = null
        }
        thumbCache[v.id]?.let { setThumb(it) }
        if (!thumbCache.containsKey(v.id) || !fpsCache.containsKey(v.id)) {
            val px = dp(160)
            bg.execute {
                val bmp = if (thumbCache.containsKey(v.id)) thumbCache[v.id] else VideoLibrary.thumbnail(this, v, px)
                val fps = if (fpsCache.containsKey(v.id)) fpsCache[v.id] else VideoLibrary.fps(this, v)
                ui.post {
                    thumbCache[v.id] = bmp
                    fpsCache[v.id] = fps
                    if (bmp != null) setThumb(bmp)
                    sub.text = videoSubtitle(v, fps)
                }
            }
        }
        return row
    }

    /** Share / delete, each with its icon; delete is red. */
    private fun videoMenu(v: VideoItem) {
        val items = listOf(R.string.action_share to R.drawable.ic_share, R.string.video_delete to R.drawable.ic_delete)
        val adapter = object : ArrayAdapter<String>(this, android.R.layout.select_dialog_item, android.R.id.text1, items.map { str(it.first) }) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val tv = super.getView(position, convertView, parent) as TextView
                val danger = position == 1
                tv.setCompoundDrawablesRelative(icon(items[position].second, 22, tint(if (danger) R.color.error else R.color.text_secondary)), null, null, null)
                tv.compoundDrawablePadding = dp(16)
                tv.setTextColor(col(if (danger) R.color.error else R.color.text_primary))
                return tv
            }
        }
        AlertDialog.Builder(this)
            .setIcon(icon(R.drawable.ic_library, 24, tint(R.color.sel)))
            .setTitle(VideoLibrary.title(v, AppLang.get(this)))
            .setAdapter(adapter) { _, which ->
                act("video menu item") {
                    if (which == 0) startActivity(Media.shareChooser(this, listOf(v.uri))) else confirmDelete(v)
                }
            }
            .show()
    }

    private fun confirmDelete(v: VideoItem) {
        val d = AlertDialog.Builder(this)
            .setIcon(icon(R.drawable.ic_delete, 24, tint(R.color.error)))
            .setTitle(R.string.video_delete)
            .setMessage(str(R.string.video_delete_confirm_fmt, VideoLibrary.title(v, AppLang.get(this))))
            .setPositiveButton(R.string.video_delete) { _, _ ->
                act("delete video") {
                    if (VideoLibrary.delete(this, v)) {
                        toast(R.string.video_deleted)
                        refreshVideos()
                    } else if (Build.VERSION.SDK_INT >= 30) {
                        val req = MediaStore.createDeleteRequest(contentResolver, listOf(v.uri))
                        @Suppress("DEPRECATION") startIntentSenderForResult(req.intentSender, REQ_DELETE, null, 0, 0, 0)
                    }
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
        d.getButton(AlertDialog.BUTTON_POSITIVE)?.setTextColor(col(R.color.error))
    }

    // ------------------------------------------------------------ «کیفیت»: presets visible, the technical part in a closed section

    private fun buildQuality(): View {
        val pg = page(R.string.tab_quality, R.string.page_quality_sub)
        val root = pg.col
        val qc = card(root, R.string.preset_title, R.drawable.ic_quality, top = 8)
        qc.addView(text(str(R.string.preset_desc), R.style.Text_Caption), lp(6))
        val presets = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        qc.addView(presets, lp(12))
        rows["preset"] = Row(presets, "", "", listOf("", "", "", ""), vertical = true, chipIcons = presetIcons) { i ->
            if (i == RecordConfig.PRESET_CUSTOM) change(false) { it.copy(preset = i) } else change(false) { RecordConfig.withPreset(it, i) }
        }
        qc.addView(text(str(R.string.plan_title), R.style.Text_Overline).apply { startIcon(R.drawable.ic_info, 16, tint(R.color.text_tertiary), 6) }, lp(8))
        planText = text("", R.style.Text_Body).apply {
            setBackgroundResource(R.drawable.bg_inset)
            setPaddingRelative(dp(14), dp(12), dp(14), dp(12))
        }
        qc.addView(planText, lp(8))
        altButton = button("", R.style.Button_Tonal, R.drawable.ic_resolution).apply {
            visibility = View.GONE
            onTap("alternative size") {
                val p = plan ?: return@onTap
                if (p.altWidth > 0) change(true) { it.copy(resShort = minOf(p.altWidth, p.altHeight), fps = 0) }
            }
        }
        qc.addView(altButton)

        // «ظاهرِ ویدیو»: the edit happens while recording (LookFilter), the file comes out edited.
        val lc = card(root, R.string.look_title, R.drawable.ic_sparkle, top = 12)
        lc.addView(text(str(R.string.look_desc), R.style.Text_Caption), lp(6))
        // The picture: a piece of the last recording, left as recorded, right with this look.
        lookImage = android.widget.ImageView(this).apply {
            adjustViewBounds = true
            scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
            setBackgroundResource(R.drawable.bg_inset)
            contentDescription = str(R.string.look_preview_caption)
        }
        lc.addView(lookImage, lp(10))
        lookCaption = text(str(R.string.look_preview_caption), R.style.Text_Caption)
        lc.addView(lookCaption, lp(4))
        lookSummary = text("", R.style.Text_Body).apply {
            setBackgroundResource(R.drawable.bg_inset)
            setPaddingRelative(dp(14), dp(10), dp(14), dp(10))
        }
        lc.addView(lookSummary, lp(8))
        rows["look"] = Row(lc, "", str(R.string.look_presets_desc), listOf(str(R.string.look_natural), str(R.string.look_clear), str(R.string.look_game), str(R.string.look_cinema)), top = 8) { i ->
            change(false) { it.withLook(i) }
        }
        rows["lk_sharp"] = Row(lc, str(R.string.look_sharp), str(R.string.look_sharp_desc), listOf(str(R.string.lv_off), str(R.string.lv_low), str(R.string.lv_mid), str(R.string.lv_high)), top = 12) { i ->
            change(false) { it.copy(lookSharp = i) }
        }
        rows["lk_cla"] = Row(lc, str(R.string.look_clarity), str(R.string.look_clarity_desc), listOf(str(R.string.lv_off), str(R.string.lv_low), str(R.string.lv_mid), str(R.string.lv_high)), top = 12) { i ->
            change(false) { it.copy(lookClarity = i) }
        }
        rows["lk_con"] = Row(lc, str(R.string.look_contrast), str(R.string.look_contrast_desc), listOf(str(R.string.lv_less), str(R.string.lv_as_is), str(R.string.lv_more), str(R.string.lv_much)), top = 12) { i ->
            change(false) { it.copy(lookContrast = i) }
        }
        rows["lk_col"] = Row(lc, str(R.string.look_color), str(R.string.look_color_desc), listOf(str(R.string.lv_calm), str(R.string.lv_as_is), str(R.string.lv_vivid), str(R.string.lv_very_vivid)), top = 12) { i ->
            change(false) { it.copy(lookColor = i) }
        }
        rows["lk_bri"] = Row(lc, str(R.string.look_bright), str(R.string.look_bright_desc), listOf(str(R.string.lv_darker), str(R.string.lv_as_is), str(R.string.lv_brighter)), top = 12) { i ->
            change(false) { it.copy(lookBright = i) }
        }
        rows["lk_warm"] = Row(lc, str(R.string.look_warm), str(R.string.look_warm_desc), listOf(str(R.string.lv_cooler), str(R.string.lv_as_is), str(R.string.lv_warmer)), top = 12) { i ->
            change(false) { it.copy(lookWarm = i) }
        }

        val adv = Section(root, "advanced", R.string.sec_advanced, R.string.sec_advanced_desc, R.drawable.ic_tune).body
        val av1 = Build.VERSION.SDK_INT >= 34 && Encoders.hardwareFor(Encoders.AV1) != null && Encoders.av1MuxOk
        rows["codec"] = Row(adv, str(R.string.codec_title), str(R.string.codec_desc),
            listOf(str(R.string.codec_auto), "HEVC / H.265", "H.264 / AVC", if (av1) "AV1" else str(R.string.codec_av1_missing)),
            ic = R.drawable.ic_memory, chipIcons = listOf(R.drawable.ic_sparkle), top = 8) { i -> change(true) { it.copy(codec = i) } }
        rows["br"] = Row(adv, str(R.string.br_title), str(R.string.br_desc), brValues.map {
            when (it) {
                RecordConfig.BR_AUTO_HIGH -> str(R.string.br_auto_high)
                RecordConfig.BR_AUTO_BALANCED -> str(R.string.br_auto_light)
                RecordConfig.BR_MAX -> str(R.string.br_auto_max)
                else -> "$it Mbps"
            }
        }, ic = R.drawable.ic_bitrate, chipIcons = listOf(R.drawable.ic_sparkle, R.drawable.ic_sparkle, R.drawable.ic_sparkle)) { i -> change(true) { it.copy(bitrate = brValues[i]) } }
        rows["fps"] = Row(adv, str(R.string.fps_title), str(R.string.fps_desc),
            fpsValues.map { if (it == 0) str(R.string.fps_screen_fmt, Fmt.num(disp.refresh)) else Fmt.num(it) },
            ic = R.drawable.ic_speed, chipIcons = listOf(R.drawable.ic_sparkle)) { i -> change(true) { it.copy(fps = fpsValues[i]) } }
        rows["res"] = Row(adv, str(R.string.res_title), str(R.string.res_desc_fmt, Fmt.size(maxOf(disp.width, disp.height), minOf(disp.width, disp.height))),
            resValues.map { when (it) { 0 -> str(R.string.res_native); RecordConfig.RES_4K -> str(R.string.res_4k); else -> "${it}p" } }, ic = R.drawable.ic_resolution, chipIcons = listOf(R.drawable.ic_sparkle)) { i -> change(true) { it.copy(resShort = resValues[i]) } }
        rows["mode"] = Row(adv, str(R.string.mode_title), str(R.string.mode_desc), listOf("VBR", "CBR", "CQ"), ic = R.drawable.ic_chart) { i -> change(true) { it.copy(mode = i) } }
        return pg.scroll
    }

    // ------------------------------------------------------------ «تنظیمات»: grouped list of sub-pages

    private fun buildSettings(): View {
        val pg = page(R.string.tab_settings, R.string.page_settings_sub)
        group(pg.col, R.string.settings_group_rec, listOf(
            Triple(Sub.VIDEO, R.string.sub_video to R.string.sub_video_desc, R.drawable.ic_rotate),
            Triple(Sub.AUDIO, R.string.sub_audio to R.string.sub_audio_desc, R.drawable.ic_volume),
            Triple(Sub.CONTROLS, R.string.sub_controls to R.string.sub_controls_desc, R.drawable.ic_float),
        ))
        group(pg.col, R.string.settings_group_app, listOf(
            Triple(Sub.STORAGE, R.string.sub_storage to R.string.sub_storage_desc, R.drawable.ic_storage),
            Triple(Sub.PERMS, R.string.sub_perms to R.string.sub_perms_desc, R.drawable.ic_shield),
            Triple(Sub.LANG, R.string.sub_lang to R.string.sub_lang_desc, R.drawable.ic_translate),
        ))
        return pg.scroll
    }

    private fun group(parent: LinearLayout, title: Int, items: List<Triple<Sub, Pair<Int, Int>, Int>>) {
        parent.addView(text(str(title), R.style.Text_Overline), lp(16).apply { marginStart = dp(4) })
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.bg_card)
            setPadding(dp(6), dp(6), dp(6), dp(6))
        }
        items.forEachIndexed { i, (s, t, ic) ->
            if (i > 0) c.addView(divider(startDp = 64, endDp = 10))
            c.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setBackgroundResource(R.drawable.bg_row)
                setPadding(dp(10), dp(12), dp(10), dp(12))
                minimumHeight = dp(68)
                isClickable = true
                isFocusable = true
                tag = "sub:${s.name}"
                addView(iconTile(ic), square(40))
                addView(LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text(str(t.first), R.style.Text_Label))
                    addView(text(str(t.second), R.style.Text_Caption), lp(2))
                }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = dp(14); marginEnd = dp(8) })
                val value = text("", R.style.Text_Caption).apply {
                    maxLines = 1
                    maxWidth = dp(112)
                    ellipsize = TextUtils.TruncateAt.END
                    setTextColor(col(R.color.text_secondary))
                }
                subValues[s] = value
                addView(value, wrap().apply { marginEnd = dp(6) })
                addView(iconView(R.drawable.ic_chevron, R.color.text_tertiary), square(20))
                onTap("settings ${s.name}") { show(Tab.SETTINGS, s) }
            }, lp(0))
        }
        parent.addView(c, lp(8))
    }

    private fun buildSubVideo(): View {
        val pg = page(R.string.sub_video, back = true)
        val c = card(pg.col, null, top = 8)
        rows["orient"] = Row(c, str(R.string.orient_title), str(R.string.orient_desc),
            listOf(str(R.string.orient_auto), str(R.string.orient_portrait), str(R.string.orient_landscape_game)),
            ic = R.drawable.ic_rotate, chipIcons = orientIcons, top = 0) { i -> change(false) { it.copy(orient = i) } }
        c.addView(divider(top = 16))
        toggles["smart"] = Toggle(c, "tog:smart", R.drawable.ic_sparkle, str(R.string.smart_title), str(R.string.smart_desc), top = 8) { on ->
            change(false) { it.copy(smartStart = on) }
        }
        toggles["rotnew"] = Toggle(c, "tog:rotnew", R.drawable.ic_rotate, str(R.string.rotnew_title), str(R.string.rotnew_desc)) { on ->
            change(false) { it.copy(rotateNewFile = on) }
        }
        return pg.scroll
    }

    private fun buildSubAudio(): View {
        val pg = page(R.string.sub_audio, back = true)
        val c = card(pg.col, null, top = 8)
        rows["audio"] = Row(c, str(R.string.audio_title), str(R.string.audio_desc),
            listOf(str(R.string.audio_none), str(R.string.audio_internal), str(R.string.audio_mic), str(R.string.audio_both)),
            ic = R.drawable.ic_volume, chipIcons = audioIcons, top = 0) { i -> change(false) { it.copy(audioMode = i) } }
        val gainLabels = gains.map { "${(it * 100).toInt()}%" }
        rows["gg"] = Row(c, str(R.string.gg_title), str(R.string.gg_desc), gainLabels, ic = R.drawable.ic_gamepad) { i -> change(false) { it.copy(gameGain = gains[i]) } }
        rows["mg"] = Row(c, str(R.string.mg_title), str(R.string.mg_desc), gainLabels, ic = R.drawable.ic_mic) { i -> change(false) { it.copy(micGain = gains[i]) } }
        return pg.scroll
    }

    private fun buildSubControls(): View {
        val pg = page(R.string.sub_controls, back = true)
        pg.col.addView(infoLine(R.drawable.ic_info, str(R.string.bubble_explain), R.style.Text_Body, R.color.sel).apply {
            setBackgroundResource(R.drawable.bg_inset)
            setPaddingRelative(dp(14), dp(12), dp(14), dp(12))
        }, lp(8))
        val c = card(pg.col, null, top = 12).apply { setPadding(dp(8), dp(8), dp(8), dp(8)) }
        toggles["game"] = Toggle(c, "tog:game", R.drawable.ic_gamepad, str(R.string.game_title),
            if (Build.VERSION.SDK_INT >= 34) str(R.string.game_desc) else str(R.string.game_desc) + " (" + str(R.string.game_unavailable) + ")", top = 0) { on ->
            change(false) { it.copy(gameMode = on && Build.VERSION.SDK_INT >= 34) }
        }
        if (Build.VERSION.SDK_INT < 34) toggles["game"]?.enable(false)
        toggles["float"] = Toggle(c, "tog:float", R.drawable.ic_float, str(R.string.float_title), str(R.string.float_desc)) { on -> change(false) { it.copy(floatingButton = on) } }
        toggles["ghost"] = Toggle(c, "tog:ghost", R.drawable.ic_eye_off, str(R.string.ghost_title), str(R.string.ghost_desc)) { on -> change(false) { it.copy(ghostControl = on) } }
        toggles["invis"] = Toggle(c, "tog:invis", R.drawable.ic_shrink, str(R.string.invis_title), str(R.string.invis_desc)) { on -> change(false) { it.copy(invisibleControl = on) } }
        // Two plain choices (2.9): Android's «کلِ صفحه یا یک برنامه» window before every recording, or
        // only the first time («ضبطِ فوری»).
        rows["askmode"] = Row(c, str(R.string.askmode_title), str(R.string.askmode_desc),
            listOf(str(R.string.askmode_every), str(R.string.askmode_once)), ic = R.drawable.ic_sparkle, top = 4) { i ->
            val once = i == 1
            prefs.edit().putBoolean(RecordService.PREF_INSTANT, once).apply()
            if (!once && RecordService.instantReady) startService(Intent(this, RecordService::class.java).setAction(RecordService.ACTION_RELEASE))
        }
        toggles["bubble"] = Toggle(c, "tog:bubble", R.drawable.eng_ic_rec, str(R.string.bubble_title), str(R.string.bubble_desc)) { on -> IdleBubble.setEnabled(this, on) }
        toggles["ready"] = Toggle(c, "tog:ready", R.drawable.ic_bell, str(R.string.ready_title), str(R.string.ready_desc)) { on -> ReadyNotice.setEnabled(this, on) }
        toggles["shake"] = Toggle(c, "tog:shake", R.drawable.ic_vibrate, str(R.string.shake_title), str(R.string.shake_desc)) { on -> change(false) { it.copy(shakeStop = on) } }
        val c2 = card(pg.col, null, top = 12)
        rows["cd"] = Row(c2, str(R.string.cd_title), str(R.string.cd_desc),
            countdowns.map { if (it == 0) str(R.string.cd_none) else str(R.string.cd_sec_fmt, it) }, ic = R.drawable.ic_timer, chipIcons = listOf(R.drawable.ic_close), top = 0) { i -> change(false) { it.copy(countdown = countdowns[i]) } }
        rows["cam"] = Row(c2, str(R.string.cam_title), str(R.string.cam_desc),
            listOf(str(R.string.off), str(R.string.cam_s), str(R.string.cam_m), str(R.string.cam_l)), ic = R.drawable.ic_face,
            chipIcons = listOf(R.drawable.ic_videocam_off)) { i -> change(false) { it.copy(facecam = i) } }
        pg.col.addView(infoLine(R.drawable.ic_bell, str(R.string.control_note) + (if (Build.VERSION.SDK_INT >= 34) "\n" + str(R.string.control_note_34) else ""),
            R.style.Text_Caption).apply { setPaddingRelative(dp(4), 0, dp(4), 0) }, lp(16))
        return pg.scroll
    }

    private fun buildSubStorage(): View {
        val pg = page(R.string.sub_storage, back = true)
        val c = card(pg.col, null, top = 8)
        c.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(iconTile(R.drawable.ic_storage).apply { isActivated = true }, square(40))
            storageFree = text("", R.style.Text_Headline)
            addView(storageFree, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = dp(14) })
        })
        storageMeter = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundResource(R.drawable.bg_meter_track)
            tag = "storageMeter"
        }
        c.addView(storageMeter, LinearLayout.LayoutParams(MATCH_PARENT, dp(8)).apply { topMargin = dp(16) })
        storageUsed = text("", R.style.Text_Caption)
        c.addView(storageUsed, lp(8))
        val minutesLine = infoLine(R.drawable.ic_clock, "", R.style.Text_Body, R.color.sel)
        storageMinutes = minutesLine.lineText
        c.addView(minutesLine, lp(12))
        val info = card(pg.col, null, top = 12)
        info.addView(infoLine(R.drawable.ic_folder, str(R.string.storage_folder)))
        info.addView(infoLine(R.drawable.ic_layers, str(R.string.storage_parts)), lp(14))
        info.addView(infoLine(R.drawable.ic_shield, str(R.string.storage_safe)), lp(14))
        return pg.scroll
    }

    private fun buildSubPerms(): View {
        val pg = page(R.string.sub_perms, back = true)
        pg.col.addView(text(str(R.string.perms_desc), R.style.Text_Caption).apply { setPaddingRelative(dp(4), 0, dp(4), 0) }, lp(4))
        val c = card(pg.col, null, top = 12).apply { setPadding(dp(8), dp(4), dp(8), dp(4)) }
        permBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        c.addView(permBox)
        return pg.scroll
    }

    private fun buildSubLang(): View {
        val pg = page(R.string.sub_lang, back = true)
        val c = card(pg.col, null, top = 8)
        val langRow = Row(c, str(R.string.card_lang), str(R.string.lang_desc), listOf(str(R.string.lang_fa), str(R.string.lang_en)),
            vertical = true, ic = R.drawable.ic_translate, chipIcons = listOf(R.drawable.ic_translate, R.drawable.ic_translate), top = 0) { i ->
            val want = if (i == 1) AppLang.EN else AppLang.FA
            if (want != AppLang.get(this)) AppLang.set(this, want)
        }
        langRow.select(if (AppLang.get(this) == AppLang.EN) 1 else 0)
        return pg.scroll
    }

    // ------------------------------------------------------------ «درباره»: identity, report card, device, error log

    private fun buildAbout(): View {
        val pg = page(R.string.tab_about, R.string.page_about_sub)
        val root = pg.col
        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.bg_card)
            setPadding(dp(16), dp(16), dp(16), dp(16))
            addView(logoTile(56), square(56))
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(str(R.string.app_name), R.style.Text_Title))
                versionText = text("", R.style.Text_Body).apply { startIcon(R.drawable.ic_tag, 16, tint(R.color.text_tertiary), 6) }
                addView(versionText, lp(2))
                addView(text(str(R.string.about_made_by), R.style.Text_Caption), lp(2))
            }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = dp(16) })
        }, lp(8))
        root.addView(text(str(R.string.tagline), R.style.Text_Caption).apply { setPaddingRelative(dp(4), 0, dp(4), 0) }, lp(10))

        val rc = Section(root, "report", R.string.about_report, R.string.sec_report_desc, R.drawable.ic_report).body
        reportStats = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; tag = "reportStats" }
        rc.addView(reportStats, lp(4))
        reportText = text("", R.style.Text_Mono).apply {
            setBackgroundResource(R.drawable.bg_inset)
            setPaddingRelative(dp(14), dp(12), dp(14), dp(12))
        }
        rc.addView(reportText, lp(12))
        reportActions = buttonRow(
            smallButton(R.string.action_copy_report, R.drawable.ic_copy) { copyReport() },
            smallButton(R.string.action_open, R.drawable.ic_play) { openLast() },
            smallButton(R.string.action_share, R.drawable.ic_share) { shareLast() },
        )
        rc.addView(reportActions, lp(12))
        val dc = Section(root, "device", R.string.card_device, R.string.sec_device_desc, R.drawable.ic_portrait).body
        deviceText = text("", R.style.Text_Body).apply { setLineSpacing(0f, 1.3f) }
        dc.addView(deviceText, lp(4))
        val cc = Section(root, "crash", R.string.about_crash, R.string.sec_crash_desc, R.drawable.ic_bug).body
        crashText = text("", R.style.Text_Mono).apply {
            setBackgroundResource(R.drawable.bg_inset)
            setPaddingRelative(dp(14), dp(12), dp(14), dp(12))
            textDirection = View.TEXT_DIRECTION_LTR
        }
        cc.addView(crashText, lp(4))
        crashButtons = buttonRow(
            smallButton(R.string.crash_copy, R.drawable.ic_copy) { CrashLog.pending(this)?.let { copyText(it) } },
            smallButton(R.string.crash_share, R.drawable.ic_share) { CrashLog.pending(this)?.let { shareText(it) } },
            smallButton(R.string.crash_clear, R.drawable.ic_delete) { CrashLog.clear(this); refreshAbout() },
        )
        cc.addView(crashButtons, lp(12))
        root.addView(infoLine(R.drawable.ic_folder, str(R.string.footer), R.style.Text_Caption).apply {
            setPaddingRelative(dp(4), 0, dp(4), 0)
        }, lp(20))
        return pg.scroll
    }

    private fun refreshAbout() {
        if (!::versionText.isInitialized) return
        versionText.text = str(R.string.about_version_fmt, BuildInfo.version(this))
        deviceText.text = runCatching { deviceSummary() }.getOrElse { str(R.string.unknown_value) }
        val report = SafePrefs.str(prefs, RecordService.K_LAST_REPORT)
        reportText.text = report.ifEmpty { str(R.string.about_no_report) }
        reportStats.removeAllViews()
        ReportStats.load(this, report)?.let { reportStats.addView(statsView(it, SafePrefs.bool(prefs, RecordService.K_LAST_IS_TEST, false)), lp(0)) }
        reportStats.visibility = if (reportStats.childCount > 0) View.VISIBLE else View.GONE
        val crash = CrashLog.pending(this)
        crashText.text = crash ?: str(R.string.about_no_crash)
        crashButtons.visibility = if (crash == null) View.GONE else View.VISIBLE
    }

    /**
     * «گزارشِ ضبط» as a stats card: a verdict badge (smooth / long gaps / stopped by itself / error),
     * why it ended (RecordService's StopReason), then six tiles — duration, size, average fps, real
     * bitrate, size per minute, frames.
     */
    private fun statsView(m: Map<String, String>, test: Boolean): View {
        fun l(k: String) = m[k]?.toLongOrNull() ?: 0L
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val gaps = l("gaps")
        val failed = m["error"] == "1"
        val stop = runCatching { StopReason.of(m["stop"]) }.getOrNull()
        val byUser = m["stopByUser"]?.toBooleanStrictOrNull() ?: stop?.byUser ?: true
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(when {
            stop != null && !byUser -> badge(str(R.string.report_stopped_itself), R.color.warning, R.color.warning_soft, R.drawable.ic_alert)
            failed -> badge(str(R.string.report_failed), R.color.error, R.color.error_soft, R.drawable.ic_alert)
            gaps > 0 -> badge(str(R.string.report_gaps_fmt, gaps.toInt()), R.color.warning, R.color.warning_soft, R.drawable.ic_alert)
            else -> badge(str(R.string.report_smooth), R.color.success, R.color.success_soft, R.drawable.ic_check_circle)
        })
        if (test) head.addView(badge(str(R.string.report_test), R.color.sel, R.color.sel_soft, R.drawable.ic_timer), wrap().apply { marginStart = dp(6) })
        val spec = listOfNotNull(m["codec"], if (l("w") > 0) Fmt.size(l("w").toInt(), l("h").toInt()) else null).joinToString(" • ")
        head.addView(text(Fmt.iso(spec), R.style.Text_Caption).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END },
            LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = dp(8) })
        box.addView(head)
        if (stop != null) {
            val why = runCatching { str(stop.text) }.getOrDefault("")
            if (why.isNotEmpty()) box.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setBackgroundResource(R.drawable.bg_inset)
                backgroundTintList = if (byUser) null else tint(R.color.warning_soft)
                setPaddingRelative(dp(12), dp(10), dp(12), dp(10))
                tag = "reportStop"
                addView(iconView(if (byUser) R.drawable.ic_stop else R.drawable.ic_alert, if (byUser) R.color.text_secondary else R.color.warning),
                    LinearLayout.LayoutParams(dp(18), dp(18)).apply { topMargin = dp(2); marginEnd = dp(12) })
                addView(LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text(str(R.string.report_why), R.style.Text_Caption))
                    addView(text(why, R.style.Text_Body).apply { setTextColor(col(R.color.text_primary)) }, lp(2))
                }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            }, lp(10))
        }

        val parts = l("parts")
        val tiles = listOf(
            Triple(R.drawable.ic_clock, str(R.string.stat_duration), Fmt.hms(l("dur")) to (if (parts > 1) str(R.string.stat_parts_fmt, Fmt.num(parts)) else "")),
            Triple(R.drawable.ic_file, str(R.string.stat_size), Fmt.bytes(l("bytes")) to ""),
            Triple(R.drawable.ic_speed, str(R.string.stat_fps), Fmt.iso("${m["fpsAvg"] ?: "0"} fps") to
                str(R.string.stat_fps_sub_fmt, Fmt.fps(l("fpsSet").toInt()), Fmt.iso("${m["fpsMax"] ?: "0"} fps"))),
            Triple(R.drawable.ic_bitrate, str(R.string.stat_bitrate), Fmt.mbps(l("brAvg").toDouble()) to str(R.string.stat_br_sub_fmt, Fmt.iso(m["brTarget"] ?: ""))),
            Triple(R.drawable.ic_chart, str(R.string.stat_permin), Fmt.mbPerMin(l("perMin")) to str(R.string.stat_permin_sub_fmt, Fmt.bytes(l("perMin") * 30))),
            Triple(R.drawable.ic_movie, str(R.string.stat_frames), Fmt.iso(Fmt.num(l("frames"))) to
                str(R.string.stat_frames_sub_fmt, Fmt.iso(Fmt.num(l("expected"))), Fmt.iso(Fmt.num(l("maxGapMs"))))),
        )
        val cols = if (contentWidthDp >= 600) 3 else 2
        tiles.chunked(cols).forEach { rowTiles ->
            box.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                rowTiles.forEachIndexed { i, (ic, label, v) ->
                    addView(statTile(ic, label, v.first, v.second), LinearLayout.LayoutParams(0, MATCH_PARENT, 1f).apply { if (i > 0) marginStart = dp(8) })
                }
                repeat(cols - rowTiles.size) { addView(View(this@MainActivity), LinearLayout.LayoutParams(0, 0, 1f).apply { marginStart = dp(8) }) }
            }, lp(8))
        }
        return box
    }

    private fun statTile(ic: Int, label: String, value: String, subText: String): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundResource(R.drawable.bg_inset)
        setPaddingRelative(dp(12), dp(10), dp(12), dp(12))
        addView(text(label, R.style.Text_Caption).apply { startIcon(ic, 16, tint(R.color.sel), 6); maxLines = 1; ellipsize = TextUtils.TruncateAt.END })
        addView(text(value, R.style.Text_Stat).apply { maxLines = 1 }, lp(6))
        if (subText.isNotEmpty()) addView(text(subText, R.style.Text_Caption).apply { sizeRes(R.dimen.text_micro); maxLines = 2 }, lp(2))
    }

    // ------------------------------------------------------------ refresh

    /** Title in bold, explanation, then what the preset would really apply on this phone. */
    private fun presetLabel(title: Int, desc: Int, p: CapturePlan?): CharSequence {
        val sb = SpannableStringBuilder()
        val t = str(title)
        sb.append(t)
        sb.setSpan(StyleSpan(Typeface.BOLD), 0, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        sb.setSpan(RelativeSizeSpan(1.06f), 0, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        val start = sb.length
        sb.append('\n').append(str(desc))
        sb.setSpan(RelativeSizeSpan(0.88f), start, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        sb.setSpan(ForegroundColorSpan(col(R.color.text_secondary)), start, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        if (p != null) {
            val s2 = sb.length
            sb.append('\n').append(Fmt.iso("${Fmt.size(p.width, p.height)} • ${p.fps} fps • ${p.codecLabel} • ≈ ${Fmt.mbPerMin(p.bytesPerMinute(cfg.hasAudio))}/min"))
            sb.setSpan(RelativeSizeSpan(0.84f), s2, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            sb.setSpan(ForegroundColorSpan(col(R.color.sel)), s2, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return sb
    }

    private fun refreshAll() {
        val c = cfg
        rows["preset"]?.let { r ->
            val titles = intArrayOf(R.string.preset_screen, R.string.preset_60, R.string.preset_light, R.string.preset_custom)
            val descs = intArrayOf(R.string.preset_screen_desc, R.string.preset_60_desc, R.string.preset_light_desc, R.string.preset_custom_desc)
            for (i in 0..3) {
                val p = runCatching {
                    if (i == RecordConfig.PRESET_CUSTOM) (if (c.preset == i) Planner.plan(c, disp) else null)
                    else Planner.plan(RecordConfig.withPreset(c, i), disp)
                }.getOrNull()
                r.buttons[i].text = presetLabel(titles[i], descs[i], p)
            }
            r.select(c.preset)
        }
        rows["orient"]?.select(c.orient)
        rows["homeOrient"]?.select(c.orient)
        rows["homePreset"]?.select(c.preset)
        if (::camToggle.isInitialized) { camToggle.set(c.facecam > 0); micToggle.set(c.usesMic) }
        toggles["smart"]?.set(c.smartStart)
        toggles["rotnew"]?.set(c.rotateNewFile)
        rows["res"]?.select(resValues.indexOf(c.resShort))
        rows["fps"]?.select(fpsValues.indexOf(c.fps).let { if (it < 0 && c.fps >= disp.refresh) 0 else it })
        rows["codec"]?.select(c.codec)
        rows["br"]?.select(brValues.indexOf(c.bitrate))
        rows["mode"]?.select(c.mode)
        rows["look"]?.select(c.lookPreset)
        updateLook(c)
        rows["lk_sharp"]?.select(c.lookSharp)
        rows["lk_cla"]?.select(c.lookClarity)
        rows["lk_con"]?.select(c.lookContrast)
        rows["lk_col"]?.select(c.lookColor)
        rows["lk_bri"]?.select(c.lookBright)
        rows["lk_warm"]?.select(c.lookWarm)
        rows["audio"]?.select(c.audioMode)
        rows["gg"]?.select(gains.indexOfFirst { it == c.gameGain })
        rows["mg"]?.select(gains.indexOfFirst { it == c.micGain })
        toggles["game"]?.set(c.gameMode)
        toggles["float"]?.set(c.floatingButton)
        toggles["invis"]?.set(c.invisibleControl)
        toggles["ghost"]?.set(c.ghostControl)
        toggles["shake"]?.set(c.shakeStop)
        toggles["ready"]?.set(ReadyNotice.enabled(this))
        toggles["bubble"]?.set(IdleBubble.enabled(this))
        rows["askmode"]?.select(if (RecordService.instantEnabled(this)) 1 else 0)
        rows["cd"]?.select(countdowns.indexOf(c.countdown))
        rows["cam"]?.select(c.facecam)
        rows["gg"]?.root?.visibility = if (c.usesInternal) View.VISIBLE else View.GONE
        rows["mg"]?.root?.visibility = if (c.usesMic) View.VISIBLE else View.GONE
        toggles["ghost"]?.root?.visibility = if (c.floatingButton && !c.gameMode) View.VISIBLE else View.GONE
        toggles["invis"]?.root?.visibility = if (c.floatingButton && !c.gameMode && !c.ghostControl) View.VISIBLE else View.GONE

        val p = runCatching { Planner.plan(c, disp) }.getOrNull()
        plan = p
        rows["mode"]?.buttons?.getOrNull(2)?.let { cq ->
            val ok = runCatching { p != null && Encoders.find(p.encoder, p.mime)?.let { Encoders.supportsMode(it, p.mime, Planner.codecMode(RecordConfig.MODE_CQ)) } == true }.getOrDefault(false)
            cq.text = if (ok) "CQ" else str(R.string.mode_cq_missing)
        }
        planText.text = planSummary(c, p)
        altButton.visibility = if (p != null && p.altWidth > 0) View.VISIBLE else View.GONE
        if (p != null && p.altWidth > 0) altButton.text = str(R.string.alt_button_fmt, Fmt.size(p.altWidth, p.altHeight), Fmt.fps(p.requestedFps))
        planLineText = if (p == null) str(R.string.no_encoder) else str(R.string.plan_line_fmt, Texts.short(p), Fmt.mbPerMin(p.bytesPerMinute(c.hasAudio)))
        if (RecordService.state == RecordService.State.IDLE) planLine.text = planLineText
        dialCaption.text = if (p == null) "" else Fmt.iso("${Fmt.size(p.width, p.height)} • ${p.fps} fps")
        gameHint.text = str(if (c.gameMode) R.string.home_game_hint else R.string.home_tip)
        refreshStorage(p?.bytesPerMinute(c.hasAudio) ?: 0L)
        refreshPerms()
        refreshSettingsValues(c)
    }

    private fun refreshStorage(perMin: Long) {
        val free = Storage.free(this)
        val total = runCatching { StatFs((getExternalFilesDir(null) ?: filesDir).path).totalBytes }.getOrDefault(0L)
        val known = free != Long.MAX_VALUE && total > 0
        storageFree.text = if (free == Long.MAX_VALUE) str(R.string.unknown_value) else str(R.string.storage_free_fmt, Fmt.bytes(free))
        storageUsed.text = if (known) str(R.string.storage_used_fmt, Fmt.bytes((total - free).coerceAtLeast(0)), Fmt.bytes(total)) else ""
        storageUsed.visibility = if (known) View.VISIBLE else View.GONE
        storageMinutes.text = str(R.string.storage_minutes_fmt, if (perMin > 0) ((free - Storage.RESERVE).coerceAtLeast(0) / perMin).toInt() else 0)
        val used = if (known) ((total - free).toDouble() / total).coerceIn(0.0, 1.0).toFloat() else 0f
        storageMeter.removeAllViews()
        storageMeter.addView(View(this).apply {
            setBackgroundResource(R.drawable.bg_meter_fill)
            backgroundTintList = tint(if (used > 0.9f) R.color.warning else R.color.sel)
        }, LinearLayout.LayoutParams(0, MATCH_PARENT, used.coerceAtLeast(0.02f)))
        storageMeter.addView(View(this), LinearLayout.LayoutParams(0, MATCH_PARENT, (1f - used).coerceAtLeast(0.0001f)))
    }

    /** Short current values at the end of the settings rows. */
    /** The look picture and the one-line summary of what will come out; redrawn only when something changed. */
    private fun updateLook(c: RecordConfig) {
        val p = runCatching { Planner.plan(c, disp) }.getOrNull()
        val lookName = when (c.lookPreset) {
            0 -> str(R.string.look_natural); 1 -> str(R.string.look_clear); 2 -> str(R.string.look_game); 3 -> str(R.string.look_cinema)
            else -> str(R.string.look_custom)
        }
        lookSummary?.text = if (p != null) str(R.string.look_summary_fmt, Fmt.size(p.width, p.height), Fmt.num(p.fps), p.codecLabel,
            Fmt.num(p.bitrate / 1_000_000), lookName) else lookName
        val iv = lookImage ?: return
        val key = c.look().toString() + SafePrefs.str(prefs, RecordService.K_LAST_URIS)
        if (key == lookShown) return
        lookShown = key
        val look = c.look()
        val app = applicationContext
        Thread {
            val bmp = try {
                val (src, fromVideo) = LookPreview.source(app, 720, 420)
                LookPreview.render(src, look) to fromVideo
            } catch (_: Throwable) { null }
            ui.post {
                if (bmp != null && lookShown == key) {
                    iv.setImageBitmap(bmp.first)
                    lookCaption?.text = str(if (bmp.second) R.string.look_preview_caption else R.string.look_preview_sample)
                }
            }
        }.start()
    }

    private fun refreshSettingsValues(c: RecordConfig) {
        subValues[Sub.VIDEO]?.text = str(when (c.orient) {
            RecordConfig.ORIENT_AUTO -> R.string.orient_auto
            1 -> R.string.orient_portrait
            else -> R.string.orient_landscape_game
        })
        subValues[Sub.AUDIO]?.text = Texts.audioSource(this, c.audioMode)
        subValues[Sub.CONTROLS]?.text = if (c.countdown > 0) str(R.string.cd_sec_fmt, c.countdown) else ""
        subValues[Sub.STORAGE]?.text = Storage.free(this).let { if (it == Long.MAX_VALUE) "" else str(R.string.storage_free_fmt, Fmt.bytes(it)) }
        subValues[Sub.LANG]?.text = str(if (AppLang.get(this) == AppLang.EN) R.string.lang_en else R.string.lang_fa)
        subValues[Sub.PERMS]?.let { v ->
            val missing = missingPermissions(c)
            v.text = if (missing == 0) str(R.string.perms_all_ok) else str(R.string.perms_missing_fmt, missing)
            v.setTextColor(col(if (missing == 0) R.color.success else R.color.warning))
        }
    }

    private fun planSummary(c: RecordConfig, p: CapturePlan?): String {
        if (p == null) return str(R.string.no_encoder)
        val sb = StringBuilder(str(R.string.plan_applies_fmt, Texts.short(p))).append('\n')
        val perMin = p.bytesPerMinute(c.hasAudio)
        val free = Storage.free(this)
        val minutes = if (perMin > 0) ((free - Storage.RESERVE).coerceAtLeast(0) / perMin).toInt() else 0
        sb.append(when (p.mode) {
            RecordConfig.MODE_VBR -> str(R.string.plan_vbr_fmt, Fmt.mbPerMin(perMin), Fmt.bytes(perMin * 30))
            RecordConfig.MODE_CBR -> str(R.string.plan_cbr_fmt, Fmt.mbPerMin(perMin), Fmt.bytes(perMin * 30))
            else -> str(R.string.plan_cq_fmt, Fmt.mbPerMin(perMin))
        })
        sb.append('\n').append(str(R.string.plan_free_fmt, Fmt.bytes(free), minutes))
        val ref = Planner.referenceRange(p.width, p.height, p.fps, p.mime)
        sb.append('\n').append(str(R.string.rep_ref_fmt, Fmt.iso("${ref.first}–${ref.second} Mbps")))
        sb.append('\n').append(str(R.string.plan_report_note))
        if (c.bitrate == RecordConfig.BR_MAX) sb.append('\n').append(str(R.string.plan_max_warn_fmt, Fmt.mbPerMin(perMin), minutes))
        for (n in Texts.notes(this, p)) sb.append('\n').append(n)
        return sb.toString()
    }

    private fun deviceSummary(): String {
        val sb = StringBuilder()
        sb.append(str(R.string.dev_display_fmt, Fmt.size(disp.width, disp.height), Fmt.num(disp.refresh), Fmt.num(disp.dpi))).append('\n')
        if (disp.rendersBelowPanel) sb.append(str(R.string.dev_below_panel_fmt, Fmt.size(disp.physicalLong, disp.physicalShort),
            Fmt.size(maxOf(disp.width, disp.height), minOf(disp.width, disp.height)))).append('\n')
        if (disp.modes.isNotEmpty()) sb.append(str(R.string.dev_modes_fmt, disp.modes.joinToString(" • ") { Fmt.iso(it) })).append('\n')
        sb.append('\n').append(str(R.string.dev_encoders_title)).append('\n')
        var any = false
        for ((m, name) in listOf(Encoders.AV1 to "AV1", Encoders.HEVC to "HEVC", Encoders.AVC to "H.264")) {
            for (hw in runCatching { Encoders.encodersFor(m).filter(Encoders::isHardware) }.getOrDefault(emptyList())) {
                any = true
                val line = runCatching {
                    val f = Encoders.fit(hw, m, disp.width, disp.height)
                    val fps = Encoders.sustainableFps(hw, m, f.width, f.height, maxOf(disp.refresh, 240))
                    val cq = Encoders.supportsMode(hw, m, Planner.codecMode(RecordConfig.MODE_CQ))
                    str(R.string.dev_encoder_fmt, name, Fmt.iso(hw.name),
                        Fmt.size(f.width, f.height) + if (f.scaled) " " + str(R.string.dev_scaled) else "",
                        Fmt.fps(fps), Fmt.mbps(Encoders.maxBitrate(hw, m)), str(if (cq) R.string.yes else R.string.no))
                }.getOrElse { "• $name ${Fmt.iso(hw.name)}: " + str(R.string.unknown_value) }
                sb.append(line).append('\n')
            }
        }
        if (!any) sb.append(str(R.string.dev_none)).append('\n')
        sb.append('\n').append(str(R.string.dev_claims_note)).append('\n').append(str(R.string.dev_refresh_note))
        return sb.toString()
    }

    private class PermRow(val desc: TextView, val badge: TextView, val fix: Button, val tile: ImageView)
    private val permRows = HashMap<String, PermRow>()

    private fun permList(c: RecordConfig): List<Triple<String?, Pair<Int, Int>, Pair<Int, Boolean>>> = listOfNotNull(
        if (Build.VERSION.SDK_INT >= 33) Triple(Manifest.permission.POST_NOTIFICATIONS, R.string.perm_notif to R.string.perm_notif_desc, R.drawable.ic_bell to true) else null,
        Triple(Manifest.permission.RECORD_AUDIO, R.string.perm_mic to R.string.perm_mic_desc, R.drawable.ic_mic to c.hasAudio),
        Triple(Manifest.permission.CAMERA, R.string.perm_cam to R.string.perm_cam_desc, R.drawable.ic_camera to (c.facecam > 0)),
        Triple(null, R.string.perm_overlay to R.string.perm_overlay_desc, R.drawable.ic_overlay to c.wantsOverlay),
    )

    private fun granted(perm: String?) = if (perm == null) Settings.canDrawOverlays(this) else checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED

    private fun missingPermissions(c: RecordConfig) = permList(c).count { (perm, _, x) -> x.second && !granted(perm) }

    private fun refreshPerms() {
        for ((perm, names, x) in permList(cfg)) permRow(perm, names.first, names.second, x.first, x.second)
    }

    private fun permRow(perm: String?, name: Int, desc: Int, ic: Int, needed: Boolean) {
        val key = perm ?: "overlay"
        val r = permRows.getOrPut(key) {
            val tile = iconTile(ic)
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(72)
                setPadding(dp(8), dp(10), dp(8), dp(10))
            }
            row.addView(tile, square(40))
            val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            texts.addView(text(str(name), R.style.Text_Label))
            val d = text("", R.style.Text_Caption)
            texts.addView(d, lp(2))
            row.addView(texts, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = dp(14); marginEnd = dp(8) })
            val badge = badge(str(R.string.perm_ok), R.color.success, R.color.success_soft, R.drawable.ic_check)
            row.addView(badge)
            val fix = Button(this, null, 0, R.style.Button_Small).apply {
                text = str(R.string.perm_fix)
                setCompoundDrawablesRelative(icon(R.drawable.ic_shield, 18), null, null, null)
                compoundDrawableTintList = csl(R.color.btn_text_tonal)
                setBackgroundResource(R.drawable.bg_btn_tonal)
                setTextColor(csl(R.color.btn_text_tonal))
                onTap("permission $key") { fixPermission(perm) }
            }
            row.addView(fix, LinearLayout.LayoutParams(WRAP_CONTENT, dp(48)))
            if (permBox.childCount > 0) permBox.addView(divider(startDp = 62, endDp = 8))
            permBox.addView(row, lp(0))
            PermRow(d, badge, fix, tile)
        }
        val ok = granted(perm)
        r.desc.text = if (!ok && needed) str(R.string.perm_needed_fmt, str(desc)) else str(desc)
        r.desc.setTextColor(col(if (!ok && needed) R.color.warning else R.color.text_tertiary))
        r.badge.visibility = if (ok) View.VISIBLE else View.GONE
        r.fix.visibility = if (ok) View.GONE else View.VISIBLE
        r.tile.isActivated = ok
    }

    private fun fixPermission(perm: String?) {
        if (perm == null) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            return
        }
        val asked = SafePrefs.bool(prefs, "asked_$perm", false)
        if (asked && !shouldShowRequestPermissionRationale(perm)) {
            toast(R.string.perm_denied_settings)
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        } else {
            prefs.edit().putBoolean("asked_$perm", true).apply()
            requestPermissions(arrayOf(perm), REQ_ONE)
        }
    }

    // ------------------------------------------------------------ live state

    private var stageState: RecordService.State? = null
    private var blinkOn = true

    private fun tick() = safely("tick") { tickInner() }

    private fun tickInner() {
        val s = RecordService.state
        val recording = s == RecordService.State.RECORDING || s == RecordService.State.PAUSED
        val paused = s == RecordService.State.PAUSED
        when (s) {
            RecordService.State.IDLE -> {
                timerPill.text = "00:00:00"
                heroStatus.text = planLineText
            }
            RecordService.State.PREPARING -> {
                timerPill.text = if (RecordService.countdownLeft > 0) Fmt.num(RecordService.countdownLeft) else "00:00:00"
                heroStatus.text = (if (RecordService.countdownLeft > 0) str(R.string.state_countdown_fmt, RecordService.countdownLeft) else str(R.string.state_preparing)) +
                    (if (RecordService.notice.isNotEmpty()) "\n" + RecordService.notice else "")
            }
            RecordService.State.RECORDING, RecordService.State.PAUSED -> {
                val now = if (paused) RecordService.pausedSince else System.currentTimeMillis()
                val sec = if (RecordService.startedAt > 0) (now - RecordService.startedAt) / 1000 else 0
                timerPill.text = Fmt.hms(sec)
                heroStatus.text = (if (paused) str(R.string.state_paused) + " • " else "") +
                    (RecordService.applied.lineSequence().firstOrNull() ?: "") +
                    (if (RecordService.notice.isNotEmpty()) "\n" + RecordService.notice else "")
            }
            RecordService.State.SAVING -> {
                timerPill.text = "00:00:00"
                heroStatus.text = str(R.string.state_saving)
            }
        }
        applyStage(s)
        if (s == RecordService.State.PREPARING) statusText.text = str(if (RecordService.countdownLeft > 0) R.string.status_countdown else R.string.status_preparing)
        // a paused timer blinks, like a camera's
        blinkOn = !blinkOn
        timerPill.alpha = if (paused && !blinkOn) 0.35f else 1f
        btnTest.visibility = if (s == RecordService.State.IDLE) View.VISIBLE else View.GONE
        if (s == RecordService.State.IDLE && lastShownState != null && lastShownState != RecordService.State.IDLE) {
            if (tab == Tab.VIDEOS) refreshVideos()
            if (tab == Tab.ABOUT) refreshAbout()
        }
        lastShownState = s
        if (!recording) heroPause.visibility = View.GONE
        ui.removeCallbacks(tickR)
        ui.postDelayed(tickR, 500)
    }

    private var planLineText: CharSequence = ""

    /**
     * Stage look per recorder state, applied only when the state changes (re-setting a background
     * every 500 ms would reset the pressed / ripple state under the user's finger).
     *   idle: green "ready" dot, neutral ring, red «شروعِ ضبط» pill
     *   countdown / preparing / saving: blue
     *   recording: red ring and glow, pulsing rings, blinking dot, light «توقفِ ضبط» pill + pause
     *   paused: amber ring and glow, play button
     */
    private fun applyStage(s: RecordService.State) {
        if (stageState == s) return
        stageState = s
        val recording = s == RecordService.State.RECORDING
        val paused = s == RecordService.State.PAUSED
        data class Look(val label: Int, val dot: Int, val chip: Int, val fill: Int, val stroke: Int, val strokeDp: Int, val glow: Int, val timer: Int)
        val look = when (s) {
            RecordService.State.IDLE -> Look(R.string.state_idle, R.color.success, R.color.surface_3, R.color.dial_fill, R.color.stroke_strong, 2, R.color.glow_idle, R.color.text_secondary)
            RecordService.State.PREPARING -> Look(if (RecordService.countdownLeft > 0) R.string.status_countdown else R.string.status_preparing,
                R.color.sel, R.color.sel_soft, R.color.dial_fill, R.color.sel, 2, R.color.sel_glow, R.color.text_primary)
            RecordService.State.RECORDING -> Look(R.string.state_recording, R.color.accent, R.color.accent_soft, R.color.dial_fill_rec, R.color.accent, 3, R.color.accent_glow, R.color.text_primary)
            RecordService.State.PAUSED -> Look(R.string.state_paused, R.color.warning, R.color.warning_soft, R.color.dial_fill_paused, R.color.warning, 3, R.color.warning_glow, R.color.text_primary)
            RecordService.State.SAVING -> Look(R.string.status_saving, R.color.sel, R.color.sel_soft, R.color.dial_fill, R.color.sel, 2, R.color.sel_glow, R.color.text_secondary)
        }
        statusText.text = str(look.label)
        statusDot.backgroundTintList = tint(look.dot)
        statusChip.backgroundTintList = tint(look.chip)
        timerPill.setTextColor(col(look.timer))
        animateStage(col(look.fill), col(look.stroke), dp(look.strokeDp), col(look.glow))

        // the record / stop pill
        when (s) {
            RecordService.State.IDLE -> setRecordButton(R.string.home_start, R.drawable.bg_btn_record, R.drawable.ic_rec, csl(R.color.btn_text_on_accent), true)
            RecordService.State.PREPARING -> setRecordButton(R.string.btn_cancel, R.drawable.bg_btn_secondary, R.drawable.ic_close, csl(R.color.btn_text), true)
            RecordService.State.RECORDING, RecordService.State.PAUSED ->
                setRecordButton(R.string.home_stop, R.drawable.bg_btn_stop, R.drawable.ic_stop, tint(R.color.text_on_light), true, iconTint = tint(R.color.accent))
            RecordService.State.SAVING -> setRecordButton(R.string.btn_wait, R.drawable.bg_btn_secondary, 0, csl(R.color.btn_text), false)
        }
        heroPause.visibility = if (recording || paused) View.VISIBLE else View.GONE
        heroPause.setImageResource(if (paused) R.drawable.ic_play else R.drawable.ic_pause)
        heroPause.contentDescription = str(if (paused) R.string.pill_resume else R.string.pill_pause)
        setPlanLineIcons(s == RecordService.State.IDLE)

        // motion: pulse rings while recording, blinking status dot
        if (recording && pulseAnim == null) {
            fun ring(v: View, delay: Long) = ObjectAnimator.ofPropertyValuesHolder(v,
                PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.28f),
                PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.28f),
                PropertyValuesHolder.ofFloat(View.ALPHA, 0.9f, 0f),
            ).apply { duration = 1800; startDelay = delay; repeatCount = ValueAnimator.INFINITE }
            pulseAnim = AnimatorSet().apply { playTogether(ring(pulse1, 0), ring(pulse2, 900)); start() }
            blinkAnim = ObjectAnimator.ofFloat(statusDot, View.ALPHA, 1f, 0.2f).apply {
                duration = 700; repeatCount = ValueAnimator.INFINITE; repeatMode = ValueAnimator.REVERSE; start()
            }
        } else if (!recording && pulseAnim != null) {
            pulseAnim?.cancel(); pulseAnim = null
            blinkAnim?.cancel(); blinkAnim = null
            pulse1.alpha = 0f; pulse2.alpha = 0f
            statusDot.alpha = 1f
        }
    }

    private fun animateStage(fill: Int, stroke: Int, strokePx: Int, glowTo: Int) {
        stageAnim?.cancel()
        val f0 = ringFill; val s0 = ringStroke; val g0 = glowColor
        val ev = ArgbEvaluator()
        stageAnim = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 350
            addUpdateListener { a ->
                val t = a.animatedFraction
                ringFill = ev.evaluate(t, f0, fill) as Int
                ringStroke = ev.evaluate(t, s0, stroke) as Int
                glowColor = ev.evaluate(t, g0, glowTo) as Int
                ringBg.setColor(ringFill)
                ringBg.setStroke(strokePx, ringStroke)
                glow.colors = intArrayOf(glowColor, col(R.color.transparent))
            }
            start()
        }
    }

    private fun setRecordButton(label: Int, bgRes: Int, ic: Int, textColor: ColorStateList, enabled: Boolean, iconTint: ColorStateList = textColor) {
        btnRecord.text = str(label)
        btnRecord.setBackgroundResource(bgRes)
        btnRecord.setTextColor(textColor)
        btnRecord.compoundDrawableTintList = iconTint
        btnRecord.setCompoundDrawablesRelative(if (ic != 0) icon(ic, 22) else null, null, null, null)
        btnRecord.isEnabled = enabled
        btnRecord.requestLayout()
    }

    private var lastShownState: RecordService.State? = null

    private fun onRecordClicked() {
        when (RecordService.state) {
            RecordService.State.IDLE -> onStartClicked(0)
            RecordService.State.SAVING -> toast(R.string.toast_saving)
            else -> stopRecording()
        }
        ui.postDelayed({ tick() }, 200)
    }

    // ------------------------------------------------------------ start flow

    private fun onStartClicked(test: Int) {
        if (!built) return
        if (RecordService.state != RecordService.State.IDLE) { toast(R.string.toast_already); return }
        if (plan == null) { toast(R.string.toast_no_encoder); return }
        if (Storage.free(this) < Storage.RESERVE + 200L * 1024 * 1024) { toast(R.string.toast_low_storage); return }
        pendingTest = test
        val need = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            need += Manifest.permission.POST_NOTIFICATIONS
        if (cfg.hasAudio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            need += Manifest.permission.RECORD_AUDIO
        if (cfg.facecam > 0 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            need += Manifest.permission.CAMERA
        if (cfg.wantsOverlay && !Settings.canDrawOverlays(this)) {
            // Come back here after the settings screen and continue automatically (onResume).
            prefs.edit().putBoolean("await_overlay", true).putInt("await_test", test).apply()
            toast(R.string.toast_overlay_go)
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            return
        }
        if (need.isNotEmpty()) {
            for (p in need) prefs.edit().putBoolean("asked_$p", true).apply()
            requestPermissions(need.toTypedArray(), REQ_PERMS)
        } else askCapture()
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, perms, results)
        if (!built) return
        if (code == REQ_ONE) { safely("perms") { refreshPerms(); refreshSettingsValues(cfg) }; return }
        if (code != REQ_PERMS) return
        if (cfg.hasAudio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            toast(R.string.toast_mic_silent)
        act("ask capture") { askCapture() }
    }

    private fun askCapture() {
        if (RecordService.instantReady) {
            // «ضبطِ فوری»: the permission is still held — straight to the recording, no dialog.
            act("start instant") {
                val svc = Intent(this, RecordService::class.java).setAction(RecordService.ACTION_START)
                cfg.copy(testSeconds = pendingTest, gameMode = false).putInto(svc)
                svc.putExtra(RecordService.EXTRA_CODE, RESULT_OK)
                startForegroundService(svc)
                ui.postDelayed({ moveTaskToBack(true) }, 400)
            }
            return
        }
        if (cfg.gameMode && Build.VERSION.SDK_INT >= 34) {
            // «حالتِ بازی»: the system dialog offers «یک برنامه»; we explain what to pick first.
            AlertDialog.Builder(this)
                .setIcon(icon(R.drawable.ic_gamepad, 24, tint(R.color.sel)))
                .setTitle(R.string.game_dialog_title)
                .setMessage(R.string.game_dialog_msg)
                .setPositiveButton(R.string.continue_) { _, _ -> act("capture") { launchCapture() } }
                .setNegativeButton(R.string.cancel, null)
                .show()
        } else launchCapture()
    }

    private fun launchCapture() {
        val mpm = getSystemService(MediaProjectionManager::class.java) ?: return
        // Both choices in Android's dialog: «کلِ صفحه» or «یک برنامه» (2.7).
        val ask = mpm.createScreenCaptureIntent()
        @Suppress("DEPRECATION") startActivityForResult(ask, REQ_CAPTURE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_DELETE) { safely("deleted") { refreshVideos() }; return }
        if (requestCode != REQ_CAPTURE) return
        if (resultCode != RESULT_OK || data == null) { toast(R.string.toast_capture_denied); return }
        act("start service") {
            val svc = Intent(this, RecordService::class.java).setAction(RecordService.ACTION_START)
            cfg.copy(testSeconds = pendingTest).putInto(svc)
            svc.putExtra(RecordService.EXTRA_CODE, resultCode)
            svc.putExtra(RecordService.EXTRA_DATA, data)
            startForegroundService(svc)
            ui.postDelayed({ moveTaskToBack(true) }, 400)
        }
    }

    // ------------------------------------------------------------ last recording / report

    private fun lastUris(): List<Uri> = SafePrefs.str(prefs, RecordService.K_LAST_URIS)
        .split('\n').filter { it.isNotBlank() }.map { Uri.parse(it) }

    private fun openLast() {
        val u = lastUris().firstOrNull() ?: return
        try { startActivity(Media.viewIntent(u)) } catch (_: Exception) { toast(R.string.toast_open_failed) }
    }

    private fun shareLast() {
        val us = lastUris()
        if (us.isEmpty()) return
        try { startActivity(Media.shareChooser(this, us)) } catch (_: Exception) { toast(R.string.toast_share_failed) }
    }

    private fun copyReport() {
        val r = SafePrefs.str(prefs, RecordService.K_LAST_REPORT)
        if (r.isEmpty()) return
        getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("RawRec report", r))
        toast(R.string.toast_copied)
    }

    /** After a test recording (or from the notification): the stats card, the full text folded below. */
    private fun showReportDialog() {
        val r = SafePrefs.str(prefs, RecordService.K_LAST_REPORT)
        prefs.edit().putBoolean(RecordService.K_REPORT_UNSEEN, false).apply()
        if (r.isEmpty()) return
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), dp(4))
        }
        val full = text(r, R.style.Text_Mono).apply {
            setBackgroundResource(R.drawable.bg_inset)
            setPaddingRelative(dp(12), dp(10), dp(12), dp(10))
        }
        val stats = ReportStats.load(this, r)
        if (stats != null) {
            box.addView(statsView(stats, SafePrefs.bool(prefs, RecordService.K_LAST_IS_TEST, false)))
            full.visibility = View.GONE
            val chevron = icon(R.drawable.ic_expand, 18, tint(R.color.text_secondary))
            box.addView(text(str(R.string.report_full), R.style.Text_Label).apply {
                setTextColor(col(R.color.text_secondary))
                setCompoundDrawablesRelative(icon(R.drawable.ic_report, 18, tint(R.color.text_secondary)), null, chevron, null)
                compoundDrawablePadding = dp(10)
                gravity = Gravity.CENTER_VERTICAL
                minHeight = dp(48)
                setBackgroundResource(R.drawable.bg_row)
                setPaddingRelative(dp(4), 0, dp(4), 0)
                isClickable = true
                onTap("report full text") { full.visibility = if (full.visibility == View.VISIBLE) View.GONE else View.VISIBLE }
            }, lp(8))
        }
        box.addView(full, lp(4))
        AlertDialog.Builder(this)
            .setIcon(icon(R.drawable.ic_report, 24, tint(R.color.sel)))
            .setTitle(R.string.report_title)
            .setView(ScrollView(this).apply { addView(box) })
            .setPositiveButton(R.string.dialog_copy) { _, _ -> act("report copy") { copyReport() } }
            .setNeutralButton(R.string.dialog_open) { _, _ -> act("report open") { openLast() } }
            .setNegativeButton(R.string.dialog_close, null)
            .show()
    }

    private fun toast(id: Int) = Toast.makeText(this, getString(id), Toast.LENGTH_LONG).show()
}
