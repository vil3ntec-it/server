package com.vil3ntec.rawrec.desktop

import com.sun.jna.Function
import com.sun.jna.NativeLibrary
import com.sun.jna.Pointer

/**
 * macOS «App Nap» slows the timers of a program that is not in front — a recorder behind a game would drop pictures and
 * sound. Like OBS, the app tells macOS it is doing latency-critical, user-started work for as long as it runs. Elsewhere
 * nothing is needed.
 */
object Awake {
    @Volatile private var token: Pointer? = null

    @Synchronized fun keep() {
        if (token != null || !System.getProperty("os.name").lowercase().contains("mac")) return
        try {
            val objc = NativeLibrary.getInstance("objc")
            NativeLibrary.getInstance("Foundation")
            val getClass = objc.getFunction("objc_getClass"); val sel = objc.getFunction("sel_registerName"); val send = objc.getFunction("objc_msgSend")
            fun s(n: String) = sel.invokePointer(arrayOf(n))
            val info = send.invokePointer(arrayOf(getClass.invokePointer(arrayOf("NSProcessInfo")), s("processInfo")))
            val reason = send.invokePointer(arrayOf(getClass.invokePointer(arrayOf("NSString")), s("stringWithUTF8String:"), "Recording and live streaming"))
            // NSActivityUserInitiated (0x00FFFFFF) | NSActivityLatencyCritical (0xFF00000000)
            val t = send.invokePointer(arrayOf(info, s("beginActivityWithOptions:reason:"), 0xFF00FFFFFFL, reason))
            send.invokePointer(arrayOf(t, s("retain")))
            token = t
        } catch (_: Throwable) {}
    }

    val active: Boolean get() = token != null
}
