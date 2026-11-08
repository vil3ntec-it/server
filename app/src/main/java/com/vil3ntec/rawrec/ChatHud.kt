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
 *  • the feed — the latest messages over the game, for reading only: touches go straight through
 *    it to the game (shooting, moving), it can never be hit by accident; old lines fade away;
 *  • the chat button — a small round button (drag it anywhere): tap it to open the panel;
 *  • the panel — the whole chat with a box to write, a tap on a message to answer, remove it or
 *    silence its writer, the giveaway and goal buttons, and «در پخش»: what viewers see (the chat,
 *    thank-yous, counters, goal), switched on and off at once while streaming.
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
        /** «در پخش»: [what] (one of [ON_STREAM]) shown to viewers or not. */
        fun onStream(what: String, on: Boolean)
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
    private val textSp = floatArrayOf(12.5f, 13.5f, 14.5f)[sizeLevel]
    private val bubbleSize = dp(48)

    private var shown = false
    private var open = false
    /** null = not known yet; false = the whole screen is captured (viewers would see what is here). */
    private var private: Boolean? = null
    private var chatOnStream = false
    private val streamState = LinkedHashMap<String, Boolean>()
    private var unread = 0
    private val items = ArrayList<Pair<LiveChat.Msg, TextView>>()
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
        contentDescription = ctx.getString(R.string.hud_open)
        addView(ImageView(ctx).apply {
            setImageResource(R.drawable.ic_chat)
            imageTintList = ColorStateList.valueOf(Color.WHITE)
        }, FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER))
        addView(bubbleCount, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, dp(18), Gravity.TOP or Gravity.END))
    }

    // ---- the feed (read only, touches pass through)
    internal val feed = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

    // ---- the panel
    private val stats = label(12f, Color.argb(235, 255, 255, 255), true).apply { maxLines = 1 }
    private val header = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(10), dp(6), dp(6), dp(6))
        addView(stats, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
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
    private val streamChips = LinkedHashMap<String, TextView>()
    private val streamRow = row(*ON_STREAM.map { key ->
        chip("") { actions.onStream(key, !(streamState[key] ?: false)) }.also { streamChips[key] = it }
    }.toTypedArray()).apply { setPadding(dp(8), 0, dp(8), dp(4)) }
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
    internal val panel = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        background = glass(16, maxOf(bgAlpha, 200))
        addView(header)
        addView(warn)
        addView(state)
        addView(streamRow)
        addView(tools)
        addView(selInfo)
        addView(modRow)
        addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        addView(inputRow)
        addView(readOnly)
    }
    private val panelRoot = FrameLayout(ctx).apply { addView(panel, FrameLayout.LayoutParams(panelW, panelH)) }

    init {
        dragBubble()
        input.setOnTouchListener { _, e -> if (e.action == MotionEvent.ACTION_DOWN) setFocusable(true); false }
        panelRoot.setOnTouchListener { _, e -> if (e.action == MotionEvent.ACTION_OUTSIDE && focusable) setFocusable(false); false }
        val back = View.OnKeyListener { _, code, e ->
            if (code == KeyEvent.KEYCODE_BACK && e.action == KeyEvent.ACTION_UP) { if (focusable) setFocusable(false) else setOpen(false); true } else false
        }
        panelRoot.isFocusableInTouchMode = true
        panelRoot.setOnKeyListener(back)
        input.setOnKeyListener(back)
        renderStream()
    }

    // ---------------------------------------------------------------- public

    /** The chat button (and the feed, once allowed) on the screen. */
    fun show() {
        if (shown) return
        try {
            readScreen()
            clamp()
            OverlayWindows.add(wm, bubble, lpBubble.apply { width = bubbleSize; height = bubbleSize })
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
        OverlayWindows.remove(wm, feed)
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

    /** What viewers see (keys of [ON_STREAM]); the chat's switch also decides the feed in whole-screen capture. */
    fun setStreamState(state: Map<String, Boolean>) {
        streamState.clear(); streamState.putAll(state)
        chatOnStream = state[ON_CHAT] == true
        renderStream()
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
        // the panel's full list
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
        if (m.history) return
        // the feed over the game: the newest few, each fading after a while
        addFeedLine(m)
        if (!open) { unread++; renderBubble() }
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
        val want = feedAllowed && !open && feed.childCount > 0
        if (want) {
            placeNearBubble(lpFeed, feedW, feedHeight())
            if (feed.isAttachedToWindow) OverlayWindows.update(wm, feed, lpFeed)
            else try { OverlayWindows.add(wm, feed, lpFeed.apply { width = feedW; height = WindowManager.LayoutParams.WRAP_CONTENT }) } catch (_: Exception) {}
        } else OverlayWindows.remove(wm, feed)
    }

    private fun feedHeight(): Int = feed.height.takeIf { it > 0 } ?: dp(30) * feed.childCount

    private fun addFeedLine(m: LiveChat.Msg) {
        val tv = label(textSp).apply {
            tag = m.id
            text = line(m)
            maxLines = 3
            setShadowLayer(dp(2).toFloat(), 0f, dp(1).toFloat(), Color.argb(200, 0, 0, 0))
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(if (m.kind == LiveChat.Kind.CHAT) Color.argb(bgAlpha, 12, 14, 18) else kindColor(m.kind, maxOf(bgAlpha, 150)))
            }
            setPadding(dp(9), dp(4), dp(9), dp(5))
        }
        feed.addView(tv, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(3) })
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
            placeNearBubble(lpPanel, panelW, panelH)
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

    private fun renderStream() {
        val names = mapOf(ON_CHAT to R.string.hud_s_chat, ON_ALERTS to R.string.hud_s_alerts, ON_SUBS to R.string.hud_s_subs,
            ON_VIEWERS to R.string.hud_s_viewers, ON_GOAL to R.string.hud_s_goal)
        for ((key, tv) in streamChips) {
            val on = streamState[key] == true
            tv.text = (if (on) "● " else "○ ") + ctx.getString(names[key] ?: R.string.hud_s_chat)
            (tv.background as? GradientDrawable)?.setColor(if (on) Color.argb(150, 255, 59, 71) else Color.argb(46, 255, 255, 255))
        }
        // The button's ring is red while the chat is shown to viewers.
        bubbleRing.setStroke(dp(2), if (chatOnStream) Color.rgb(255, 59, 71) else Color.argb(90, 255, 255, 255))
    }

    private fun renderBubble() {
        bubbleCount.text = if (unread > 99) "99+" else unread.toString()
        bubbleCount.visibility = if (unread > 0 && !open) View.VISIBLE else View.GONE
    }

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
                        if (open) { placeNearBubble(lpPanel, panelW, panelH); OverlayWindows.update(wm, panelRoot, lpPanel) }
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
        /** «در پخش»: the switches, which are the same settings as on the «زنده» page. */
        val ON_STREAM = listOf(ON_CHAT, ON_ALERTS, ON_SUBS, ON_VIEWERS, ON_GOAL)

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
