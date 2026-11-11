package com.vil3ntec.rawrec.desktop.studio

import com.github.kwhat.jnativehook.GlobalScreen
import com.github.kwhat.jnativehook.keyboard.NativeKeyEvent
import com.github.kwhat.jnativehook.keyboard.NativeKeyListener

/**
 * Shortcuts that work while another window (the game, the browser) has the focus — Ctrl+Alt with a letter, so they never
 * clash with a game's own keys: R record, P pause, L live, S save the replay, K picture, 1–9 scenes. Only these combinations
 * are acted on; every other key goes on untouched and is never kept or logged.
 */
object GlobalKeys {
    enum class Action(val key: Int, val label: String) {
        RECORD(NativeKeyEvent.VC_R, "R ضبط"), PAUSE(NativeKeyEvent.VC_P, "P مکث"), LIVE(NativeKeyEvent.VC_L, "L پخش"),
        REPLAY(NativeKeyEvent.VC_S, "S ذخیرهٔ بازپخش"), SCREENSHOT(NativeKeyEvent.VC_K, "K عکس"),
        MIC(NativeKeyEvent.VC_M, "M میکروفون"), CAMERA(NativeKeyEvent.VC_W, "W وب‌کم"),
    }

    @Volatile var onAction: ((Action) -> Unit)? = null
    @Volatile var onScene: ((Int) -> Unit)? = null
    @Volatile var error: String? = null; private set
    @Volatile var running = false; private set

    private val digits = listOf(NativeKeyEvent.VC_1, NativeKeyEvent.VC_2, NativeKeyEvent.VC_3, NativeKeyEvent.VC_4, NativeKeyEvent.VC_5,
        NativeKeyEvent.VC_6, NativeKeyEvent.VC_7, NativeKeyEvent.VC_8, NativeKeyEvent.VC_9)

    private val listener = object : NativeKeyListener {
        override fun nativeKeyPressed(e: NativeKeyEvent) {
            val m = e.modifiers
            val ctrl = m and (NativeKeyEvent.CTRL_L_MASK or NativeKeyEvent.CTRL_R_MASK) != 0
            val alt = m and (NativeKeyEvent.ALT_L_MASK or NativeKeyEvent.ALT_R_MASK) != 0
            if (!ctrl || !alt) return
            Action.entries.firstOrNull { it.key == e.keyCode }?.let { a -> onAction?.invoke(a); return }
            digits.indexOf(e.keyCode).takeIf { it >= 0 }?.let { i -> onScene?.invoke(i) }
        }
    }

    /** Starts listening (once); false with [error] when this system does not allow it (e.g. Wayland, or macOS without permission). */
    @Synchronized fun start(): Boolean {
        if (running) return true
        return try {
            // the library's own logging off: it would otherwise print every key event
            java.util.logging.Logger.getLogger(GlobalScreen::class.java.getPackage().name).apply { level = java.util.logging.Level.OFF; useParentHandlers = false }
            GlobalScreen.registerNativeHook()
            GlobalScreen.addNativeKeyListener(listener)
            running = true; error = null; true
        } catch (t: Throwable) {
            error = when {
                System.getProperty("os.name").lowercase().contains("mac") -> "macOS اجازه نداد: در «تنظیمات سیستم ← حریم خصوصی ← دسترسی‌پذیری» به RawRec Studio اجازه بده"
                System.getenv("WAYLAND_DISPLAY") != null -> "میان‌بُرهای سراسری روی Wayland کار نمی‌کنند (فقط وقتی پنجرهٔ برنامه فعال است)"
                (t.message ?: "").contains(".so") -> "برای میان‌بُرهای سراسری این بسته‌ها لازم‌اند: sudo apt install libxkbcommon-x11-0 libxtst6"
                else -> "میان‌بُرهای سراسری روشن نشدند: ${t.message ?: t.javaClass.simpleName}"
            }
            false
        }
    }

    @Synchronized fun stop() {
        if (!running) return
        try { GlobalScreen.removeNativeKeyListener(listener); GlobalScreen.unregisterNativeHook() } catch (_: Throwable) {}
        running = false
    }
}
