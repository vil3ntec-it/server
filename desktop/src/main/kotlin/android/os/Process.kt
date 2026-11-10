package android.os

/** Desktop stand-in: thread priorities map to Java's (the sender thread runs above normal). */
object Process {
    const val THREAD_PRIORITY_URGENT_AUDIO = -19
    const val THREAD_PRIORITY_DISPLAY = -4
    fun setThreadPriority(p: Int) {
        Thread.currentThread().priority = if (p <= -10) Thread.MAX_PRIORITY else if (p < 0) Thread.NORM_PRIORITY + 2 else Thread.NORM_PRIORITY
    }
}
