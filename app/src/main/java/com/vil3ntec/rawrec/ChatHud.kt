package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
 * The live chat on the owner's phone: messages, viewers / likes / subscribers, a box to write in,
 * and a tap on a message to answer, remove it or silence its writer. A floating window over the
 * game that is NOT in the stream when Android captures a single app («Share one app»); with the
 * whole screen captured it would be, so then it stays a small bubble and says so when opened
 * (checked for real by [RecordService], not guessed). Main thread.
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
    }

    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val d = ctx.resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private val prefs = ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)

    private val sizeLevel = LiveExtras.hudSize(ctx)
    private val panelW = dp(intArrayOf(260, 320, 380)[sizeLevel])
    private val panelH = dp(intArrayOf(230, 300, 380)[sizeLevel])
    private val bgAlpha = intArrayOf(150, 195, 235)[LiveExtras.hudAlpha(ctx)]
    private val textSp = floatArrayOf(12.5f, 13.5f, 14.5f)[sizeLevel]

    private var expanded = false
    private var shown = false
    /** null = not known yet; false = the whole screen is captured (viewers would see this). */
    private var private: Boolean? = null
    private var unread = 0
    private val items = ArrayList<Pair<LiveChat.Msg, TextView>>()
    private var selected: LiveChat.Msg? = null
    private var canSend = false
    private var focusable = false

    private val lp = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.LEFT
        x = SafePrefs.int(prefs, "hud_x", dp(16)); y = SafePrefs.int(prefs, "hud_y", dp(64))
        softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN
    }

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

    private fun iconBtn(res: Int, desc: String, click: () -> Unit) = ImageView(ctx).apply {
        setImageResource(res)
        imageTintList = android.content.res.ColorStateList.valueOf(Color.WHITE)
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

    private val root = FrameLayout(ctx)

    // collapsed: a round bubble with the unread count
    private val bubbleCount = label(11f, Color.WHITE, true).apply {
        gravity = Gravity.CENTER
        background = GradientDrawable().apply { cornerRadius = dp(9).toFloat(); setColor(Color.rgb(255, 59, 71)) }
        setPadding(dp(5), 0, dp(5), 0)
        minWidth = dp(18)
        visibility = View.GONE
    }
    private val bubble = FrameLayout(ctx).apply {
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.argb(220, 16, 18, 24)); setStroke(dp(1), Color.argb(80, 255, 255, 255)) }
        addView(ImageView(ctx).apply {
            setImageResource(R.drawable.ic_chat)
            imageTintList = android.content.res.ColorStateList.valueOf(Color.WHITE)
            contentDescription = ctx.getString(R.string.hud_open)
        }, FrameLayout.LayoutParams(dp(26), dp(26), Gravity.CENTER))
        addView(bubbleCount, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, dp(18), Gravity.TOP or Gravity.END))
    }

    // expanded
    private val stats = label(12f, Color.argb(235, 255, 255, 255), true).apply { maxLines = 1 }
    private val dot = View(ctx).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.rgb(255, 59, 71)) } }
    private val header = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(10), dp(6), dp(6), dp(6))
        addView(dot, LinearLayout.LayoutParams(dp(9), dp(9)).apply { marginEnd = dp(8) })
        addView(stats, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        addView(iconBtn(R.drawable.ic_gift, ctx.getString(R.string.hud_tools)) { toggleTools() })
        addView(iconBtn(R.drawable.eng_ic_minimize, ctx.getString(R.string.hud_close)) { setExpanded(false) })
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
    private val readOnly = label(11.5f, Color.argb(170, 255, 255, 255)).apply {
        text = ctx.getString(R.string.hud_read_only)
        setPadding(dp(10), dp(4), dp(10), dp(8))
    }
    private val inputRow = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(8), dp(4), dp(6), dp(8))
        addView(input, LinearLayout.LayoutParams(0, dp(36), 1f))
        addView(sendBtn)
        visibility = View.GONE
    }
    private val panel = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        background = glass(16)
        addView(header)
        addView(warn)
        addView(state)
        addView(tools)
        addView(selInfo)
        addView(modRow)
        addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        addView(inputRow)
        addView(readOnly)
    }

    init {
        dragWith(header)
        dragWith(bubble, tap = { setExpanded(true) })
        input.setOnTouchListener { _, e -> if (e.action == MotionEvent.ACTION_DOWN) setFocusable(true); false }
        root.setOnTouchListener { _, e -> if (e.action == MotionEvent.ACTION_OUTSIDE && focusable) setFocusable(false); false }
        root.isFocusableInTouchMode = true
        val back = View.OnKeyListener { _, code, e -> if (code == KeyEvent.KEYCODE_BACK && e.action == KeyEvent.ACTION_UP && focusable) { setFocusable(false); true } else false }
        root.setOnKeyListener(back)
        input.setOnKeyListener(back)
    }

    // ---------------------------------------------------------------- public

    fun show() {
        if (shown) return
        try {
            OverlayWindows.add(wm, root, lp)
            shown = true
            render()
        } catch (_: Exception) { shown = false }
    }

    fun hide() {
        if (!shown) return
        setFocusable(false)
        OverlayWindows.remove(wm, root)
        shown = false
    }

    /** The result of the capture check: [p] false = viewers would see the panel. */
    fun setPrivate(p: Boolean) {
        private = p
        warn.visibility = if (p) View.GONE else View.VISIBLE
        // Private: open as the owner left it; otherwise stays a bubble until opened knowingly.
        if (p && SafePrefs.bool(prefs, "hud_open", true)) setExpanded(true, remember = false)
        render()
    }

    fun setCanSend(b: Boolean) {
        if (canSend == b) return
        canSend = b
        inputRow.visibility = if (b) View.VISIBLE else View.GONE
        readOnly.visibility = if (b) View.GONE else View.VISIBLE
    }

    fun setStats(viewers: Long, likes: Long, subs: Long) {
        val parts = ArrayList<String>()
        if (viewers >= 0) parts += ctx.getString(R.string.hud_viewers_fmt, StreamOverlay.compact(viewers))
        if (likes >= 0) parts += ctx.getString(R.string.hud_likes_fmt, StreamOverlay.compact(likes))
        if (subs >= 0) parts += ctx.getString(R.string.hud_subs_fmt, StreamOverlay.compact(subs))
        stats.text = if (parts.isEmpty()) ctx.getString(R.string.hud_title) else parts.joinToString("  ·  ")
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

    fun add(m: LiveChat.Msg) {
        val tv = label(textSp).apply {
            text = line(m)
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
        if (!expanded && !m.history) { unread++; renderBubble() }
    }

    fun remove(id: String) {
        val i = items.indexOfFirst { it.first.id == id }
        if (i < 0) return
        list.removeView(items.removeAt(i).second)
    }

    /** A short line from the app (an action that failed, the giveaway winner…). */
    fun note(text: String) {
        val tv = label(textSp - 0.5f, Color.argb(200, 255, 176, 32)).apply { this.text = text; setPadding(0, dp(3), 0, dp(3)) }
        list.addView(tv)
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    // ---------------------------------------------------------------- inside

    private fun line(m: LiveChat.Msg): CharSequence {
        val sb = SpannableStringBuilder()
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
        if (m.text.isNotBlank()) sb.append(if (m.kind == LiveChat.Kind.GIFT && m.platform == LiveChat.Platform.TWITCH) " → " else ": ").append(m.text)
        return sb
    }

    private fun nameColor(m: LiveChat.Msg): Int = when {
        m.owner -> Color.rgb(255, 196, 64)
        m.mod -> Color.rgb(106, 166, 255)
        m.member -> Color.rgb(61, 214, 140)
        else -> NAME_COLORS[(m.authorId.hashCode() and 0x7fffffff) % NAME_COLORS.size]
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
        setFocusable(false)
    }

    private fun toggleTools() { tools.visibility = if (tools.visibility == View.VISIBLE) View.GONE else View.VISIBLE }

    private fun setExpanded(e: Boolean, remember: Boolean = true) {
        expanded = e
        if (remember) prefs.edit().putBoolean("hud_open", e).apply()
        if (e) unread = 0
        if (!e) setFocusable(false)
        render()
    }

    private fun render() {
        root.removeAllViews()
        if (expanded) {
            root.addView(panel, FrameLayout.LayoutParams(panelW, panelH))
            scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
        } else {
            root.addView(bubble, FrameLayout.LayoutParams(dp(52), dp(52)))
            renderBubble()
        }
        clampToScreen()
        if (shown) OverlayWindows.update(wm, root, lp)
    }

    private fun renderBubble() {
        bubbleCount.text = if (unread > 99) "99+" else unread.toString()
        bubbleCount.visibility = if (unread > 0) View.VISIBLE else View.GONE
    }

    private fun setFocusable(f: Boolean) {
        if (focusable == f) return
        focusable = f
        lp.flags = if (f) lp.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
        else lp.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        if (shown) OverlayWindows.update(wm, root, lp)
        val imm = ctx.getSystemService(InputMethodManager::class.java)
        if (f) input.post { input.requestFocus(); imm?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT) }
        else { imm?.hideSoftInputFromWindow(input.windowToken, 0); input.clearFocus() }
    }

    private var screenW = 0
    private var screenH = 0

    /** [fresh]: read the screen size again (not on every move of a drag). */
    private fun clampToScreen(fresh: Boolean = true) {
        if (fresh || screenW == 0) DisplayInfo.read(ctx).let { screenW = it.width; screenH = it.height }
        val w = if (expanded) panelW else dp(52)
        val h = if (expanded) panelH else dp(52)
        lp.x = lp.x.coerceIn(0, maxOf(0, screenW - w))
        lp.y = lp.y.coerceIn(0, maxOf(0, screenH - h))
    }

    /** Drag [v] to move the window; a tap without movement calls [tap]. */
    @SuppressLint("ClickableViewAccessibility")
    private fun dragWith(v: View, tap: (() -> Unit)? = null) {
        val slop = ViewConfiguration.get(ctx).scaledTouchSlop
        var sx = 0f; var sy = 0f; var ox = 0; var oy = 0; var moved = false
        v.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    sx = e.rawX; sy = e.rawY; ox = lp.x; oy = lp.y; moved = false
                    DisplayInfo.read(ctx).let { screenW = it.width; screenH = it.height }
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - sx; val dy = e.rawY - sy
                    if (!moved && (abs(dx) > slop || abs(dy) > slop)) moved = true
                    if (moved) { lp.x = ox + dx.toInt(); lp.y = oy + dy.toInt(); clampToScreen(fresh = false); OverlayWindows.update(wm, root, lp) }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (moved) prefs.edit().putInt("hud_x", lp.x).putInt("hud_y", lp.y).apply() else tap?.invoke()
                    true
                }
                else -> false
            }
        }
    }

    companion object {
        private val NAME_COLORS = intArrayOf(
            Color.rgb(255, 138, 128), Color.rgb(255, 209, 128), Color.rgb(204, 255, 144), Color.rgb(128, 216, 255),
            Color.rgb(179, 136, 255), Color.rgb(255, 128, 171), Color.rgb(167, 255, 235), Color.rgb(255, 255, 141),
        )
    }
}
