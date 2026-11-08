package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.abs

/**
 * The live chat on the owner's phone while playing, in three pieces:
 *
 *  • the feed — the viewer / like / subscriber numbers and the latest messages over the game, for
 *    reading only: touches go straight through it to the game (shooting, moving), it can never be
 *    hit by accident; by default without any background (shadowed text), old lines fade away;
 *  • the chat button — a small round button (drag it anywhere): tap it to open the panel;
 *  • the panel — the whole chat with a box to write, a tap on a message to answer, remove it or
 *    silence its writer, the giveaway and goal buttons, and «در پخش»: the owner's scenes (one tap
 *    switches the stream) and the layers of the scene on the stream, each on or off at once.
 *
 * None of it is in the stream when Android captures one app («Share one app»). With the whole
 * screen captured it would be, so then the feed is shown only if the owner put the chat on the
 * stream anyway (checked for real by [RecordService], not guessed). Main thread.
 */
class ChatHud(private val ctx: Context, private val actions: Actions) {

    interface Actions {
        fun send(text: String)
        fun delete(m: LiveChat.Msg)
        fun timeout(m: LiveChat.Msg, seconds: Int)
        fun giveawayStart()
        fun giveawayDraw()
        fun giveawayStop()
        fun goalStep(d: Int)
        /** Switch the stream to the owner's scene [id]. */
        fun onScene(id: String)
        /** A layer of the scene on the stream shown to viewers or not. */
        fun onLayer(id: String, on: Boolean)
    }

    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val d = ctx.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val prefs = ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)

    private val sizeLevel = LiveExtras.hudSize(ctx)
    private val panelW = dp(intArrayOf(270, 320, 380)[sizeLevel])
    private val panelH = dp(intArrayOf(250, 310, 380)[sizeLevel])
    private val feedW = dp(intArrayOf(240, 290, 340)[sizeLevel])
    private val feedLines = intArrayOf(4, 6, 8)[sizeLevel]
    private val bgAlpha = intArrayOf(120, 175, 230)[LiveExtras.hudAlpha(ctx)]
    /** Over the game: 0 no background, 1 faint, 2 bubbles, 3 one line each (see LiveExtras.hudStyle). */
    private val style = LiveExtras.hudStyle(ctx)
    private val feedOpacity = floatArrayOf(0.7f, 0.85f, 1f)[LiveExtras.hudAlpha(ctx)]
    /** No number line of its own over the game: the owner sees the counters viewers see (the scene's own, on the screen too). */
    private val showStats = false
    private val textSp = floatArrayOf(12.5f, 13.5f, 14.5f)[sizeLevel]
    private val bubbleSize = dp(44)

    private var shown = false
    private var open = false
    /** null = not known yet; false = the whole screen is captured (viewers would see what is here). */
    private var private: Boolean? = null
    private var chatOnStream = false
    private var unread = 0
    private val items = ArrayList<Pair<LiveChat.Msg, TextView>>()
    /** Persian translations of viewers' messages (by message id), shown instead of the original. */
    private val translations = HashMap<String, String>()
    private var selected: LiveChat.Msg? = null
    private var canSend = false
    private var focusable = false
    private var screenW = 0
    private var screenH = 0

    private fun overlay(flags: Int) = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, flags, PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.LEFT }

    private val lpBubble = overlay(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE).apply {
        x = SafePrefs.int(prefs, "hud_x", dp(12)); y = SafePrefs.int(prefs, "hud_y", dp(96))
    }
    /** Not touchable: every touch on it goes to the game underneath. */
    private val lpFeed = overlay(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
        .apply { alpha = OverlayWindows.passThroughAlpha(ctx) }   // (Android 12+: a more opaque one would stop the touch)
    private val lpPanel = overlay(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH).apply { softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN }

    // ---------------------------------------------------------------- views

    private fun glass(radius: Int, alpha: Int = bgAlpha) = GradientDrawable().apply {
        cornerRadius = dp(radius).toFloat()
        setColor(Color.argb(alpha, 16, 18, 24))
        setStroke(dp(1), Color.argb(60, 255, 255, 255))
    }

    private fun label(sizeSp: Float, color: Int = Color.WHITE, bold: Boolean = false) = TextView(ctx).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    /** The stream's own address on YouTube (copied with a tap, to watch it or send it to friends). */
    private var link: String? = null
    internal val linkBtn: ImageView by lazy {
        iconBtn(R.drawable.ic_link, ctx.getString(R.string.hud_link)) {
            val l = link ?: run { note(ctx.getString(R.string.hud_link_none)); return@iconBtn }
            ctx.getSystemService(android.content.ClipboardManager::class.java)?.setPrimaryClip(android.content.ClipData.newPlainText("live", l))
            note(ctx.getString(R.string.hud_link_copied_fmt, l))
        }.apply { alpha = 0.45f; tag = "hud:link" }
    }

    fun setLink(url: String?) {
        link = url
        linkBtn.alpha = if (url != null) 1f else 0.45f
    }

    private fun iconBtn(res: Int, desc: String, click: () -> Unit) = ImageView(ctx).apply {
        setImageResource(res)
        imageTintList = ColorStateList.valueOf(Color.WHITE)
        setPadding(dp(8), dp(8), dp(8), dp(8))
        contentDescription = desc
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.argb(40, 255, 255, 255)) }
        setOnClickListener { click() }
        layoutParams = LinearLayout.LayoutParams(dp(34), dp(34)).apply { marginStart = dp(6) }
    }

    private fun chip(text: String, color: Int = Color.argb(46, 255, 255, 255), click: () -> Unit) = TextView(ctx).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
        setTextColor(Color.WHITE)
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        setPadding(dp(12), 0, dp(12), 0)
        background = GradientDrawable().apply { cornerRadius = dp(15).toFloat(); setColor(color) }
        setOnClickListener { click() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(30)).apply { marginEnd = dp(6) }
    }

    private fun row(vararg v: View) = HorizontalScrollView(ctx).apply {
        isHorizontalScrollBarEnabled = false
        addView(LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; v.forEach { addView(it) } })
        visibility = View.GONE
    }

    // ---- the button
    private val bubbleCount = label(11f, Color.WHITE, true).apply {
        gravity = Gravity.CENTER
        background = GradientDrawable().apply { cornerRadius = dp(9).toFloat(); setColor(Color.rgb(255, 59, 71)) }
        setPadding(dp(5), 0, dp(5), 0)
        minWidth = dp(18)
        visibility = View.GONE
    }
    private val bubbleRing = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.argb(215, 16, 18, 24)); setStroke(dp(2), Color.argb(90, 255, 255, 255)) }
    internal val bubble = FrameLayout(ctx).apply {
        background = bubbleRing
        alpha = 0.75f
        contentDescription = ctx.getString(R.string.hud_open)
        addView(ImageView(ctx).apply {
            setImageResource(R.drawable.ic_chat)
            imageTintList = ColorStateList.valueOf(Color.WHITE)
        }, FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
        addView(bubbleCount, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, dp(18), Gravity.TOP or Gravity.END))
    }

    // ---- the feed (read only, touches pass through): the numbers on top, then the latest messages
    internal val statsLine = TextView(ctx).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, textSp - 0.5f)
        setTextColor(Color.WHITE)
        typeface = Typeface.DEFAULT_BOLD
        maxLines = 1
        visibility = View.GONE
    }
    /** A scene of its own is on the stream (the game hidden from viewers): said plainly over the game. */
    internal val sceneLine = TextView(ctx).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, textSp - 0.5f)
        setTextColor(Color.WHITE)
        typeface = Typeface.DEFAULT_BOLD
        maxLines = 2
        background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(Color.argb(215, 200, 30, 45)) }
        setPadding(dp(10), dp(4), dp(10), dp(4))
        visibility = View.GONE
    }
    /** The stream is not reaching the platform (and why): said over the game, never left to silence. */
    internal val sendLine = TextView(ctx).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, textSp - 0.5f)
        setTextColor(Color.WHITE)
        typeface = Typeface.DEFAULT_BOLD
        maxLines = 3
        background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(Color.argb(225, 170, 20, 30)) }
        setPadding(dp(10), dp(4), dp(10), dp(4))
        visibility = View.GONE
    }
    internal val feed = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
    internal val feedRoot = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        alpha = feedOpacity
        addView(sendLine, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(4) })
        addView(sceneLine, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(4) })
        addView(statsLine, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        addView(feed, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }

    // ---- the panel
    private val stats = label(12f, Color.argb(235, 255, 255, 255), true).apply { maxLines = 1 }
    private val header = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(10), dp(6), dp(6), dp(6))
        addView(stats, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        addView(linkBtn)
        addView(iconBtn(R.drawable.ic_eye, ctx.getString(R.string.hud_on_stream)) { toggle(streamRow) })
        addView(iconBtn(R.drawable.ic_gift, ctx.getString(R.string.hud_tools)) { toggle(tools) })
        addView(iconBtn(R.drawable.ic_close, ctx.getString(R.string.hud_close)) { setOpen(false) })
    }
    private val warn = label(11.5f, Color.rgb(255, 176, 32)).apply {
        text = ctx.getString(R.string.hud_whole_screen)
        setPadding(dp(10), dp(2), dp(10), dp(4))
        visibility = View.GONE
    }
    private val state = label(11.5f, Color.argb(200, 255, 255, 255)).apply {
        setPadding(dp(10), dp(2), dp(10), dp(4))
        visibility = View.GONE
    }
    // «در پخش»: the scenes (one tap switches the stream) and the layers of the one on the stream
    private val sceneChips = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
    private val layerChips = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
    private val streamRow = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(8), 0, dp(8), dp(4))
        addView(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(sceneChips) })
        addView(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(layerChips) },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })
        visibility = View.GONE
    }
    private val giveBtn = chip(ctx.getString(R.string.hud_give_start)) { actions.giveawayStart() }
    private val drawBtn = chip(ctx.getString(R.string.hud_give_draw_fmt, 0), Color.argb(90, 106, 166, 255)) { actions.giveawayDraw() }
    private val endBtn = chip(ctx.getString(R.string.hud_give_end)) { actions.giveawayStop() }
    private val tools = row(
        giveBtn, drawBtn, endBtn,
        chip(ctx.getString(R.string.hud_goal_minus)) { actions.goalStep(-1) },
        chip(ctx.getString(R.string.hud_goal_plus)) { actions.goalStep(1) },
    ).apply { setPadding(dp(8), 0, dp(8), dp(4)) }
    private val selInfo = label(11.5f, Color.argb(220, 255, 255, 255)).apply { maxLines = 1; setPadding(dp(10), dp(2), dp(10), dp(2)); visibility = View.GONE }
    private val modRow = row(
        chip(ctx.getString(R.string.hud_m_reply)) { selected?.let { reply(it) }; select(null) },
        chip(ctx.getString(R.string.hud_m_delete), Color.argb(110, 255, 59, 71)) { selected?.let { actions.delete(it) }; select(null) },
        chip(ctx.getString(R.string.hud_m_timeout)) { selected?.let { actions.timeout(it, 300) }; select(null) },
        chip(ctx.getString(R.string.hud_m_ban), Color.argb(110, 255, 59, 71)) { selected?.let { actions.timeout(it, 0) }; select(null) },
        chip("✕") { select(null) },
    ).apply { setPadding(dp(8), 0, dp(8), dp(4)) }
    private val list = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(2), dp(10), dp(4)) }
    private val scroll = ScrollView(ctx).apply { isVerticalScrollBarEnabled = false; addView(list) }
    private val input = EditText(ctx).apply {
        hint = ctx.getString(R.string.hud_hint)
        setHintTextColor(Color.argb(140, 255, 255, 255))
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
        setSingleLine()
        imeOptions = EditorInfo.IME_ACTION_SEND
        background = GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setColor(Color.argb(50, 255, 255, 255)) }
        setPadding(dp(12), dp(6), dp(12), dp(6))
        setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_SEND) { sendNow(); true } else false }
    }
    private val sendBtn = iconBtn(R.drawable.ic_send, ctx.getString(R.string.hud_send)) { sendNow() }
    /** The language the owner's Persian goes out in (FA = as written): a tap opens every language right here. */
    internal val langChip = chip("") { toggleLangs() }.apply {
        contentDescription = ctx.getString(R.string.tr_chip_desc)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(30)).apply { marginEnd = dp(6) }
    }
    private val readOnly = label(11.5f, Color.argb(170, 255, 255, 255)).apply {
        text = ctx.getString(R.string.hud_read_only)
        setPadding(dp(10), dp(4), dp(10), dp(8))
    }
    private val langRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    internal val langScroll = HorizontalScrollView(ctx).apply {
        isHorizontalScrollBarEnabled = false
        setPadding(dp(8), dp(2), dp(8), dp(2))
        addView(langRow)
        visibility = View.GONE
    }
    /** While typing (translator on): exactly what will be sent, so a wrong translation is seen before it goes. */
    internal val trPreview = label(12f, Color.argb(225, 170, 205, 255)).apply {
        setPadding(dp(14), 0, dp(14), dp(6))
        maxLines = 3
        visibility = View.GONE
    }
    private val previewR = Runnable { previewNow() }
    private val inputRow = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(8), dp(4), dp(6), dp(8))
        addView(langChip)
        addView(input, LinearLayout.LayoutParams(0, dp(36), 1f))
        addView(sendBtn)
        visibility = View.GONE
    }
    /** The grip on top of the chat: drag it to put the chat anywhere; it stays there (also when opened again). */
    internal val grip = FrameLayout(ctx).apply {
        tag = "hud:grip"
        contentDescription = ctx.getString(R.string.hud_grip)
        addView(View(ctx).apply { background = GradientDrawable().apply { cornerRadius = dp(3).toFloat(); setColor(Color.argb(150, 255, 255, 255)) } },
            FrameLayout.LayoutParams(dp(44), dp(5), Gravity.CENTER))
    }
    internal val panel = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        background = glass(16, maxOf(bgAlpha, 200))
        addView(grip, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(22)))
        addView(header)
        addView(warn)
        addView(state)
        addView(streamRow)
        addView(tools)
        addView(selInfo)
        addView(modRow)
        addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        addView(langScroll)
        addView(inputRow)
        addView(trPreview)
        addView(readOnly)
    }
    private val panelRoot = FrameLayout(ctx).apply { addView(panel, FrameLayout.LayoutParams(panelW, panelH)) }

    init {
        dragBubble()
        dragChat()
        input.setOnTouchListener { _, e -> if (e.action == MotionEvent.ACTION_DOWN) setFocusable(true); false }
        panelRoot.setOnTouchListener { _, e -> if (e.action == MotionEvent.ACTION_OUTSIDE && focusable) setFocusable(false); false }
        val back = View.OnKeyListener { _, code, e ->
            if (code == KeyEvent.KEYCODE_BACK && e.action == KeyEvent.ACTION_UP) { if (focusable) setFocusable(false) else setOpen(false); true } else false
        }
        panelRoot.isFocusableInTouchMode = true
        panelRoot.setOnKeyListener(back)
        input.setOnKeyListener(back)
        renderLang()
        input.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(e: android.text.Editable?) { input.removeCallbacks(previewR); input.postDelayed(previewR, 500) }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })
    }

    private fun previewNow() {
        val t = input.text.toString().trim()
        if (t.isEmpty() || !LiveExtras.trOut(ctx) || !ChatTranslator.isPersian(t)) { trPreview.visibility = View.GONE; return }
        val target = LiveExtras.trTarget(ctx).uppercase()
        trPreview.text = ctx.getString(R.string.tr_preview_wait)
        trPreview.visibility = View.VISIBLE
        ChatTranslator.fromPersian(ctx, t) { out ->
            input.post {
                if (input.text.toString().trim() != t) return@post
                trPreview.text = if (out != null) "→ $target: $out" else ctx.getString(R.string.tr_preview_failed)
            }
        }
    }

    private fun toggleLangs() {
        if (langScroll.visibility == View.VISIBLE) { langScroll.visibility = View.GONE; return }
        langRow.removeAllViews()
        val on = LiveExtras.trOut(ctx)
        val target = LiveExtras.trTarget(ctx)
        val sel = Color.argb(170, 106, 166, 255)
        langRow.addView(chip("FA · " + ctx.getString(R.string.tr_as_written), if (!on) sel else Color.argb(46, 255, 255, 255)) { pickLang(null) }.apply { tag = "lang:fa" })
        val recent = LiveExtras.trRecent(ctx).filter { it in ChatTranslator.LANGS }
        for (code in (listOf(target).filter { it in ChatTranslator.LANGS } + recent + ChatTranslator.LANGS).distinct())
            langRow.addView(chip(code.uppercase() + " · " + ChatTranslator.nativeName(code), if (on && code == target) sel else Color.argb(46, 255, 255, 255)) {
                pickLang(code)
            }.apply { tag = "lang:$code" })
        langScroll.visibility = View.VISIBLE
        langScroll.scrollTo(0, 0)
    }

    /** null = send what is written (Persian) as it is. */
    private fun pickLang(code: String?) {
        if (code == null) LiveExtras.put(ctx, "tr_out", false)
        else {
            LiveExtras.put(ctx, "tr_out", true)
            LiveExtras.setTrTarget(ctx, code)
            ChatTranslator.prepare(ctx)   // that language's pack, once (in the background)
        }
        langScroll.visibility = View.GONE
        renderLang()
    }

    private fun renderLang() {
        val on = LiveExtras.trOut(ctx)
        val target = LiveExtras.trTarget(ctx).uppercase()
        langChip.text = if (on) target else "FA"
        (langChip.background as? GradientDrawable)?.setColor(if (on) Color.argb(150, 106, 166, 255) else Color.argb(46, 255, 255, 255))
        input.hint = if (on) ctx.getString(R.string.hud_hint_tr_fmt, target) else ctx.getString(R.string.hud_hint)
    }

    // ---------------------------------------------------------------- public

    /** The stream's record dot is the chat button too (one circle on the screen, not two). */
    private var anchored = false

    /**
     * One circle: the panel opens next to the record dot at ([x], [y]) and this button stays off the
     * screen; null = this button again (the record dot was hidden).
     */
    fun anchorTo(x: Int?, y: Int?) {
        if (x == null || y == null) {
            if (!anchored) return
            anchored = false
            if (shown) try { OverlayWindows.add(wm, bubble, lpBubble.apply { width = bubbleSize; height = bubbleSize }) } catch (_: Exception) {}
            return
        }
        val was = anchored
        anchored = true
        lpBubble.x = x; lpBubble.y = y
        if (shown && !was) OverlayWindows.remove(wm, bubble)
        if (shown && open) { placeChat(lpPanel, panelW, panelH); OverlayWindows.update(wm, panelRoot, lpPanel) }
        updateFeed()
    }

    /** A tap on the record dot: the chat opens, or closes. */
    fun toggleOpen() { if (shown) setOpen(!open) }

    /** Messages not read yet (shown on the record dot while the chat is closed). */
    val unreadCount get() = if (open) 0 else unread

    /** The chat button (and the feed, once allowed) on the screen. */
    fun show() {
        if (shown) return
        try {
            readScreen()
            clamp()
            if (!anchored) OverlayWindows.add(wm, bubble, lpBubble.apply { width = bubbleSize; height = bubbleSize })
            shown = true
            renderBubble()
            updateFeed()
        } catch (_: Exception) { shown = false }
    }

    fun hide() {
        if (!shown) return
        setFocusable(false)
        main.removeCallbacksAndMessages(null)
        OverlayWindows.remove(wm, panelRoot)
        OverlayWindows.remove(wm, feedRoot)
        OverlayWindows.remove(wm, bubble)
        shown = false
        open = false
    }

    /** The result of the capture check: [p] false = viewers would see what is drawn here. */
    fun setPrivate(p: Boolean) {
        private = p
        warn.visibility = if (p) View.GONE else View.VISIBLE
        updateFeed()
    }

    /** The owner's scenes (the one on the stream marked) and that scene's layers with their switches. */
    fun setScenes(scenes: List<Pair<String, String>>, active: String, layers: List<Triple<String, String, Boolean>>) {
        sceneChips.removeAllViews()
        for ((id, name) in scenes) {
            val on = id == active
            sceneChips.addView(chip((if (on) "▶ " else "") + name, if (on) Color.argb(170, 255, 59, 71) else Color.argb(46, 255, 255, 255)) {
                if (!on) actions.onScene(id)
            })
        }
        layerChips.removeAllViews()
        for ((id, name, visible) in layers) {
            layerChips.addView(chip((if (visible) "● " else "○ ") + name, if (visible) Color.argb(120, 106, 166, 255) else Color.argb(46, 255, 255, 255)) {
                actions.onLayer(id, !visible)
            })
        }
    }

    /** A chat layer is in the stream: decides the phone's chat in a whole-screen capture, and the button's red ring. */
    fun setChatOnStream(on: Boolean) {
        chatOnStream = on
        bubbleRing.setStroke(dp(2), if (on) Color.rgb(255, 59, 71) else Color.argb(90, 255, 255, 255))
        updateFeed()
    }

    fun setCanSend(b: Boolean) {
        if (canSend == b) return
        canSend = b
        inputRow.visibility = if (b) View.VISIBLE else View.GONE
        readOnly.visibility = if (b) View.GONE else View.VISIBLE
    }

    fun setStats(viewers: Long, likes: Long, subs: Long) {
        val parts = ArrayList<String>()
        if (viewers >= 0) parts += ctx.getString(R.string.hud_viewers_fmt, Num.compact(viewers))
        if (likes >= 0) parts += ctx.getString(R.string.hud_likes_fmt, Num.compact(likes))
        if (subs >= 0) parts += ctx.getString(R.string.hud_subs_fmt, Num.compact(subs))
        stats.text = if (parts.isEmpty()) ctx.getString(R.string.hud_title) else parts.joinToString("  ·  ")
        // the same numbers over the game, read only
        statsLine.text = parts.joinToString("   ")
        statsLine.visibility = if (showStats && !mirrorStats && parts.isNotEmpty()) View.VISIBLE else View.GONE
        styleLine(statsLine, null)
        // the numbers in a small dark pill of their own, so they read as one thing on any game
        statsLine.background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(Color.argb(150, 14, 15, 20)) }
        statsLine.setPadding(dp(10), dp(3), dp(10), dp(3))
        updateFeed()
    }

    /**
     * [text] = why the stream does not reach the platform now (null once it does). Shown while
     * nothing goes out, so no viewer sees it even with the whole screen in the picture.
     */
    fun setSendState(text: String?) {
        if (sendLine.text.toString() == (text ?: "") && (sendLine.visibility == View.VISIBLE) == (text != null)) return
        sendLine.text = text ?: ""
        sendLine.visibility = if (text != null) View.VISIBLE else View.GONE
        updateFeed()
    }

    /** [name] = the scene on the stream when it hides the game; null when the game is on the stream. */
    fun setLiveScene(name: String?) {
        sceneLine.text = name?.let { ctx.getString(R.string.hud_scene_live_fmt, it) } ?: ""
        sceneLine.visibility = if (name != null) View.VISIBLE else View.GONE
        updateFeed()
    }

    private var mirrorChat = false
    private var mirrorStats = false

    /**
     * The stream's own chat / counters are on the screen already (where they are on the stream):
     * the feed and the number line over the game step aside, so nothing is there twice.
     */
    fun setMirror(chat: Boolean, stats: Boolean) {
        if (chat == mirrorChat && stats == mirrorStats) return
        mirrorChat = chat; mirrorStats = stats
        feed.visibility = if (chat) View.GONE else View.VISIBLE
        statsLine.visibility = if (showStats && !stats && statsLine.text.isNotEmpty()) View.VISIBLE else View.GONE
        updateFeed()
    }

    fun setState(text: String?) {
        state.text = text ?: ""
        state.visibility = if (text.isNullOrBlank()) View.GONE else View.VISIBLE
    }

    fun setGiveaway(open: Boolean, entries: Int) {
        giveBtn.visibility = if (open) View.GONE else View.VISIBLE
        drawBtn.visibility = if (open) View.VISIBLE else View.GONE
        endBtn.visibility = if (open) View.VISIBLE else View.GONE
        drawBtn.text = ctx.getString(R.string.hud_give_draw_fmt, entries)
    }

    private var mineSeq = 0

    /**
     * The owner's own message, at once and like everyone's (name in yellow with 👑, the text white;
     * Persian written and sent translated: the Persian, the sent words under it). The copy YouTube
     * sends back a few seconds later takes this line's place instead of showing twice.
     */
    fun addMine(sent: String, original: String?) {
        val me = LiveExtras.ytChannel(ctx).ifBlank { ctx.getString(R.string.hud_me) }
        val m = LiveChat.Msg("mine:" + mineSeq++, LiveChat.Platform.YOUTUBE, "", me, sent, LiveChat.Kind.CHAT, null,
            owner = true, mod = false, member = false, history = false)
        if (original != null && original != sent) translations[m.id] = original
        add(m)
    }

    fun add(m: LiveChat.Msg) {
        // YouTube's copy of the owner's own message: it takes the place of the line shown at once
        if (m.owner && !m.id.startsWith("mine:")) {
            val i = items.indexOfFirst { it.first.id.startsWith("mine:") && it.first.text.trim() == m.text.trim() }
            if (i >= 0) {
                val (old, tv) = items[i]
                translations.remove(old.id)?.let { translations[m.id] = it }
                items[i] = m to tv
                tv.text = line(m, withOriginal = translations.containsKey(m.id))
                return
            }
        }
        // the panel's full list
        val tv = label(textSp).apply {
            text = line(m, withOriginal = m.owner && translations.containsKey(m.id))
            setPadding(0, dp(3), 0, dp(3))
            if (m.kind != LiveChat.Kind.CHAT) {
                background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(kindColor(m.kind, 60)) }
                setPadding(dp(8), dp(5), dp(8), dp(5))
            }
            setOnClickListener { select(if (selected === m) null else m) }
        }
        val atBottom = !scroll.canScrollVertically(1)
        list.addView(tv, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(2) })
        items += m to tv
        while (items.size > 80) { list.removeView(items.removeAt(0).second) }
        if (atBottom) scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
        if (m.history) return
        // the feed over the game: the newest few, each fading after a while
        addFeedLine(m)
        if (!open) { unread++; renderBubble() }
    }

    /** A viewer's message in Persian: replaces the original on the phone (the panel keeps the original under it). */
    fun setTranslation(id: String, fa: String) {
        translations[id] = fa
        items.firstOrNull { it.first.id == id }?.let { (m, tv) -> tv.text = line(m, withOriginal = true) }
        for (j in 0 until feed.childCount) {
            val v = feed.getChildAt(j) as? TextView ?: continue
            if (v.tag == id) items.firstOrNull { it.first.id == id }?.let { v.text = line(it.first) }
        }
        feed.post { updateFeed() }
    }

    fun remove(id: String) {
        val i = items.indexOfFirst { it.first.id == id }
        if (i >= 0) list.removeView(items.removeAt(i).second)
        for (j in feed.childCount - 1 downTo 0) if (feed.getChildAt(j).tag == id) feed.removeViewAt(j)
        updateFeed()
    }

    /** A short line from the app (an action that failed, the giveaway winner…). */
    fun note(text: String) {
        val tv = label(textSp - 0.5f, Color.argb(200, 255, 176, 32)).apply { this.text = text; setPadding(0, dp(3), 0, dp(3)) }
        list.addView(tv)
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    // ---------------------------------------------------------------- feed

    /** The feed is seen when nothing here is in the stream, or when the chat is meant to be in it anyway. */
    private val feedAllowed: Boolean get() = private == true || (private == false && chatOnStream)

    private fun updateFeed() {
        if (!shown) return
        val sending = sendLine.visibility == View.VISIBLE
        val want = !open && ((feedAllowed && ((feed.childCount > 0 && !mirrorChat) || statsLine.visibility == View.VISIBLE || sceneLine.visibility == View.VISIBLE)) || sending)
        if (want) {
            placeChat(lpFeed, feedW, feedHeight())
            if (feedRoot.isAttachedToWindow) OverlayWindows.update(wm, feedRoot, lpFeed)
            else try { OverlayWindows.add(wm, feedRoot, lpFeed.apply { width = feedW; height = WindowManager.LayoutParams.WRAP_CONTENT }) } catch (_: Exception) {}
        } else OverlayWindows.remove(wm, feedRoot)
    }

    private fun feedHeight(): Int = feedRoot.height.takeIf { it > 0 } ?: dp(30) * (feed.childCount + 1)

    /**
     * The look of a line over the game. Without a background the text keeps a dark outline-like
     * shadow, so it reads on bright and dark game scenes alike without hiding the game.
     */
    private fun styleLine(tv: TextView, kind: LiveChat.Kind?) {
        val paid = kind != null && kind != LiveChat.Kind.CHAT
        when (style) {
            0, 3 -> {
                tv.background = null
                tv.setShadowLayer(dp(3).toFloat(), 0f, 0f, Color.argb(255, 0, 0, 0))
                tv.setPadding(dp(2), dp(1), dp(2), dp(1))
                if (paid) tv.setTextColor(kindColor(kind!!, 255))
            }
            else -> {
                tv.setShadowLayer(dp(2).toFloat(), 0f, dp(1).toFloat(), Color.argb(200, 0, 0, 0))
                val a = if (style == 1) 70 else bgAlpha
                tv.background = GradientDrawable().apply {
                    cornerRadius = dp(10).toFloat()
                    setColor(if (!paid) Color.argb(a, 12, 14, 18) else kindColor(kind!!, maxOf(a, 120)))
                }
                tv.setPadding(dp(9), dp(4), dp(9), dp(5))
            }
        }
        if (style == 3) { tv.maxLines = 1; tv.ellipsize = android.text.TextUtils.TruncateAt.END }
    }

    private fun addFeedLine(m: LiveChat.Msg) {
        val tv = label(if (style == 3) textSp - 1f else textSp).apply {
            tag = m.id
            text = line(m)
            maxLines = 3
            if (style == 0 || style == 3) typeface = Typeface.DEFAULT_BOLD
        }
        styleLine(tv, m.kind)
        feed.addView(tv, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(if (style == 0 || style == 3) 1 else 3) })
        while (feed.childCount > feedLines) feed.removeViewAt(0)
        // Read in peace, then it leaves (paid messages stay longer).
        val stay = if (m.kind == LiveChat.Kind.CHAT) 20_000L else 40_000L
        main.postDelayed({
            tv.animate().alpha(0f).setDuration(600).withEndAction { feed.removeView(tv); updateFeed() }.start()
        }, stay)
        updateFeed()
        feed.post { updateFeed() }   // the real height after layout (the feed grows upwards near the bottom)
    }

    // ---------------------------------------------------------------- panel

    private fun setOpen(o: Boolean) {
        if (open == o) return
        open = o
        if (o) {
            unread = 0
            readScreen()
            placeChat(lpPanel, panelW, panelH)
            try { OverlayWindows.add(wm, panelRoot, lpPanel) } catch (_: Exception) { open = false }
            scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
        } else {
            setFocusable(false)
            select(null)
            OverlayWindows.remove(wm, panelRoot)
        }
        renderBubble()
        updateFeed()
    }

    private fun renderBubble() {
        bubbleCount.text = if (unread > 99) "99+" else unread.toString()
        bubbleCount.visibility = if (unread > 0 && !open) View.VISIBLE else View.GONE
    }

    private fun line(m: LiveChat.Msg, withOriginal: Boolean = false): CharSequence {
        val sb = SpannableStringBuilder()
        val tr = translations[m.id]
        val tag = when {
            m.owner -> "👑 "
            m.mod -> "🛡 "
            m.member -> "★ "
            else -> ""
        }
        if (m.platform == LiveChat.Platform.TWITCH) sb.append("Tw ")
        sb.append(tag)
        val s = sb.length
        sb.append(m.author.ifBlank { "?" })
        sb.setSpan(ForegroundColorSpan(nameColor(m)), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        sb.setSpan(StyleSpan(Typeface.BOLD), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        val extra = when (m.kind) {
            LiveChat.Kind.SUPER -> " 💰 ${m.amount ?: ""}"
            LiveChat.Kind.MEMBER -> " ★ " + ctx.getString(R.string.hud_k_member)
            LiveChat.Kind.SUB -> " ★ " + ctx.getString(R.string.hud_k_sub) + (m.amount?.let { " ($it)" } ?: "")
            LiveChat.Kind.GIFT -> " 🎁 " + ctx.getString(R.string.hud_k_gift_fmt, m.amount ?: "1")
            LiveChat.Kind.CHEER -> " ◆ ${m.amount ?: ""}"
            LiveChat.Kind.RAID -> " ⚑ " + ctx.getString(R.string.hud_k_raid_fmt, m.amount ?: "")
            else -> ""
        }
        if (extra.isNotEmpty()) {
            val e = sb.length
            sb.append(extra)
            sb.setSpan(ForegroundColorSpan(kindColor(m.kind, 255)), e, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        if (m.text.isNotBlank()) sb.append(if (m.kind == LiveChat.Kind.GIFT && m.platform == LiveChat.Platform.TWITCH) " → " else ": ").append(tr ?: m.text)
        if (tr != null) {
            sb.append(" 🌐")
            if (withOriginal) {
                val o = sb.length
                sb.append("\n").append(m.text)
                sb.setSpan(ForegroundColorSpan(Color.argb(150, 255, 255, 255)), o, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                sb.setSpan(android.text.style.RelativeSizeSpan(0.85f), o, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
        }
        return sb
    }

    private fun kindColor(k: LiveChat.Kind, a: Int) = when (k) {
        LiveChat.Kind.SUPER -> Color.argb(a, 255, 176, 32)
        LiveChat.Kind.MEMBER, LiveChat.Kind.SUB -> Color.argb(a, 61, 214, 140)
        LiveChat.Kind.GIFT, LiveChat.Kind.CHEER -> Color.argb(a, 186, 120, 255)
        LiveChat.Kind.RAID -> Color.argb(a, 106, 166, 255)
        else -> Color.argb(a, 255, 255, 255)
    }

    private fun select(m: LiveChat.Msg?) {
        selected = m
        val show = m != null
        selInfo.visibility = if (show) View.VISIBLE else View.GONE
        selInfo.text = if (m == null) "" else "${m.author}: ${m.text}"
        // Moderation is YouTube's (Twitch is read only); replying needs the send box.
        modRow.visibility = if (show && (m!!.canModerate || canSend)) View.VISIBLE else View.GONE
        if (m != null) {
            val ll = (modRow.getChildAt(0) as LinearLayout)
            ll.getChildAt(0).visibility = if (canSend) View.VISIBLE else View.GONE
            for (i in 1..3) ll.getChildAt(i).visibility = if (m.canModerate) View.VISIBLE else View.GONE
        }
    }

    private fun reply(m: LiveChat.Msg) {
        if (!canSend) return
        input.setText("@${m.author} ")
        input.setSelection(input.text.length)
        setFocusable(true)
    }

    private fun sendNow() {
        val t = input.text.toString().trim()
        if (t.isEmpty()) return
        actions.send(t)
        input.setText("")
        trPreview.visibility = View.GONE
        setFocusable(false)
    }

    private fun toggle(v: View) { v.visibility = if (v.visibility == View.VISIBLE) View.GONE else View.VISIBLE }

    private fun setFocusable(f: Boolean) {
        if (focusable == f) return
        focusable = f
        lpPanel.flags = if (f) lpPanel.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
        else lpPanel.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        if (open) OverlayWindows.update(wm, panelRoot, lpPanel)
        val imm = ctx.getSystemService(InputMethodManager::class.java)
        if (f) input.post { input.requestFocus(); imm?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT) }
        else { imm?.hideSoftInputFromWindow(input.windowToken, 0); input.clearFocus() }
    }

    // ---------------------------------------------------------------- placing

    private fun readScreen() = DisplayInfo.read(ctx).let { screenW = it.width; screenH = it.height }

    private fun clamp() {
        lpBubble.x = lpBubble.x.coerceIn(0, maxOf(0, screenW - bubbleSize))
        lpBubble.y = lpBubble.y.coerceIn(0, maxOf(0, screenH - bubbleSize))
    }

    /** Where the owner put the chat (its top-left corner); -1 = not yet: beside the button. */
    private var chatX = SafePrefs.int(prefs, "hud_chat_x", -1)
    private var chatY = SafePrefs.int(prefs, "hud_chat_y", -1)

    /** The chat where the owner put it (kept on the screen), else beside the button. */
    private fun placeChat(lp: WindowManager.LayoutParams, w: Int, h: Int) {
        if (chatX < 0 || chatY < 0) { placeNearBubble(lp, w, h); return }
        lp.x = chatX.coerceIn(0, maxOf(0, screenW - w))
        lp.y = chatY.coerceIn(0, maxOf(0, screenH - h))
    }

    /** Dragging the grip moves the chat; where it is let go is remembered (the button no longer carries it). */
    @SuppressLint("ClickableViewAccessibility")
    private fun dragChat() {
        var sx = 0f; var sy = 0f; var ox = 0; var oy = 0
        grip.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { sx = e.rawX; sy = e.rawY; ox = lpPanel.x; oy = lpPanel.y; readScreen() }
                MotionEvent.ACTION_MOVE -> {
                    lpPanel.x = (ox + (e.rawX - sx).toInt()).coerceIn(0, maxOf(0, screenW - panelW))
                    lpPanel.y = (oy + (e.rawY - sy).toInt()).coerceIn(0, maxOf(0, screenH - panelH))
                    if (open) OverlayWindows.update(wm, panelRoot, lpPanel)
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    chatX = lpPanel.x; chatY = lpPanel.y
                    prefs.edit().putInt("hud_chat_x", chatX).putInt("hud_chat_y", chatY).apply()
                    updateFeed()
                }
            }
            true
        }
    }

    /** Beside the button: on its side of the screen, below it in the upper half, above it in the lower half. */
    private fun placeNearBubble(lp: WindowManager.LayoutParams, w: Int, h: Int) {
        val gap = dp(6)
        val leftHalf = lpBubble.x + bubbleSize / 2 < screenW / 2
        lp.x = if (leftHalf) lpBubble.x else lpBubble.x + bubbleSize - w
        lp.y = if (lpBubble.y + bubbleSize / 2 < screenH / 2) lpBubble.y + bubbleSize + gap else lpBubble.y - gap - h
        lp.x = lp.x.coerceIn(0, maxOf(0, screenW - w))
        lp.y = lp.y.coerceIn(0, maxOf(0, screenH - h))
    }

    /** Drag the button anywhere (the feed and the panel follow); a tap opens or closes the panel. */
    @SuppressLint("ClickableViewAccessibility")
    private fun dragBubble() {
        val slop = ViewConfiguration.get(ctx).scaledTouchSlop
        var sx = 0f; var sy = 0f; var ox = 0; var oy = 0; var moved = false
        bubble.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { sx = e.rawX; sy = e.rawY; ox = lpBubble.x; oy = lpBubble.y; moved = false; readScreen(); true }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - sx; val dy = e.rawY - sy
                    if (!moved && (abs(dx) > slop || abs(dy) > slop)) moved = true
                    if (moved) {
                        lpBubble.x = ox + dx.toInt(); lpBubble.y = oy + dy.toInt(); clamp()
                        OverlayWindows.update(wm, bubble, lpBubble)
                        if (open) { placeChat(lpPanel, panelW, panelH); OverlayWindows.update(wm, panelRoot, lpPanel) }
                        updateFeed()
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (moved) prefs.edit().putInt("hud_x", lpBubble.x).putInt("hud_y", lpBubble.y).apply() else setOpen(!open)
                    true
                }
                else -> false
            }
        }
    }

    /** For the preview pictures: open the panel as a tap on the button does. */
    internal fun openForPreview() = setOpen(true)

    companion object {
        const val ON_CHAT = "ov_chat"
        const val ON_ALERTS = "ov_alerts"
        const val ON_SUBS = "ov_subs"
        const val ON_VIEWERS = "ov_viewers"
        const val ON_GOAL = "ov_goal"

        private val NAME_COLORS = intArrayOf(
            Color.rgb(255, 138, 128), Color.rgb(255, 209, 128), Color.rgb(204, 255, 144), Color.rgb(128, 216, 255),
            Color.rgb(179, 136, 255), Color.rgb(255, 128, 171), Color.rgb(167, 255, 235), Color.rgb(255, 255, 141),
        )

        /** The same colour for a name on the phone and on the stream. */
        fun nameColor(m: LiveChat.Msg): Int = when {
            m.owner -> Color.rgb(255, 196, 64)
            m.mod -> Color.rgb(106, 166, 255)
            m.member -> Color.rgb(61, 214, 140)
            else -> NAME_COLORS[(m.authorId.hashCode() and 0x7fffffff) % NAME_COLORS.size]
        }
    }
}
