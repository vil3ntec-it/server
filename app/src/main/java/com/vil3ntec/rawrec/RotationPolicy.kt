package com.vil3ntec.rawrec

/**
 * One rotation = one decision. Fed only by the debounced display listener (1.2.2 also reacted to
 * onCapturedContentResize with a guessed orientation and compared against a plan that was still
 * being switched, which produced three switches, one of them the wrong way).
 *
 * 2.0, «one recording = one file» (the owner: an hour must not become ten videos):
 *  • in the first [smartWindowMs] a rotation starts the recording over in the new orientation — the
 *    usual «start, then open the game» ends up as one file at the game's full size;
 *  • later, a game is never shrunk: portrait → landscape gets the landscape picture (a new part,
 *    once); landscape → portrait stays in the same file, the portrait screen shown whole inside.
 *    An MP4 track can't change its size, so a file per rotation only with [newFileOnRotate].
 *
 * A change of the screen's size that is not a rotation (a foldable opened or closed, the phone's
 * resolution setting) always needs a new canvas: [onDisplay] with `resized = true`.
 */
class RotationPolicy(
    private val auto: Boolean,
    private val smartStart: Boolean,
    private val newFileOnRotate: Boolean = false,
    private val smartWindowMs: Long = 20_000,
) {
    enum class Action { NONE, RESTART, NEW_PART }

    /** The orientation of the recording's picture. */
    var landscape: Boolean? = null
        private set

    fun start(landscapeNow: Boolean) { landscape = landscapeNow }

    private fun decide(landscapeNow: Boolean, msSinceStart: Long, resized: Boolean): Action {
        val cur = landscape ?: return Action.NONE
        val rotated = auto && landscapeNow != cur
        if (!rotated && !resized) return Action.NONE
        if (smartStart && msSinceStart < smartWindowMs) return Action.RESTART
        if (resized || newFileOnRotate) return Action.NEW_PART
        // A game is never shrunk into a portrait picture (2.0 did that after the first 20 s: the
        // owner's game came out 1504 px wide on a 2400 px screen). Turning to landscape gets the
        // landscape picture, once; turning back to portrait stays in it (shown whole inside).
        if (rotated && landscapeNow && !cur) return Action.NEW_PART
        return Action.NONE
    }

    fun onDisplay(landscapeNow: Boolean, msSinceStart: Long, resized: Boolean = false): Action {
        val a = decide(landscapeNow, msSinceStart, resized)
        if (a != Action.NONE && auto) landscape = landscapeNow
        return a
    }

    /** Would [onDisplay] switch now? (Asks only; changes nothing.) */
    fun follows(landscapeNow: Boolean, msSinceStart: Long, resized: Boolean = false): Boolean =
        decide(landscapeNow, msSinceStart, resized) != Action.NONE
}
